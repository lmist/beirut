#!/usr/bin/env python3
"""Build offline minimap roads and locality labels from OpenStreetMap.

The output is intentionally in the model's x,z coordinate frame so the browser
can draw it without a network request.  OSM geometry remains in the source
cache under .cache/osm; the final, attribution-bearing runtime artifact is
public/data/city-locations.json.
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "osm"
ROAD_CACHE = CACHE / "beirut-roads.json"
PLACE_CACHE = CACHE / "beirut-places.json"
OUTPUT = ROOT / "public" / "data" / "city-locations.json"
REGISTRATION_PATH = ROOT / "public" / "data" / "registration.json"

# Bounding box is deliberately wider than the model footprint so roads at the
# model edge remain continuous.  south, west, north, east.
BBOX = (33.858, 35.458, 33.910, 35.540)
M_PER_DEG_LAT = 111_320.0
MODEL_BOUNDS = (-3867.4, -3197.8, 3344.0, 2669.5)  # min_x, min_z, max_x, max_z

ROAD_QUERY = '''[out:json][timeout:120];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"]({south},{west},{north},{east});
out tags geom;'''
PLACE_QUERY = '''[out:json][timeout:120];
(
  node["place"~"^(neighbourhood|suburb|quarter|locality)$"]({south},{west},{north},{east});
  way["place"~"^(neighbourhood|suburb|quarter|locality)$"]({south},{west},{north},{east});
  relation["place"~"^(neighbourhood|suburb|quarter|locality)$"]({south},{west},{north},{east});
);
out center tags;'''


def fetch_overpass(query: str, destination: Path) -> None:
    """Fetch one OSM response with the headers required by Overpass."""
    payload = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "beirut-world-location-data/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        data = response.read()
    parsed = json.loads(data)
    if not isinstance(parsed.get("elements"), list):
        raise RuntimeError("Overpass returned no elements list")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def load_registration(path: Path = REGISTRATION_PATH) -> dict[str, float | int | str | None]:
    """Load the canonical model-to-WGS84 transform without inventing a fit."""
    if not path.exists():
        raise FileNotFoundError(f"Canonical registration is required: {path}")
    with path.open() as file:
        registration = json.load(file)
    required = ("angleDeg", "translationEast", "translationNorth", "anchorLat", "anchorLon")
    missing = [name for name in required if not isinstance(registration.get(name), (int, float))]
    if missing:
        raise ValueError(f"Registration is missing numeric values: {', '.join(missing)}")
    registration.setdefault("scale", 1.0)
    # Version-one records did not include a reflection and retain their prior
    # right-handed convention. New canonical data sets zSign to -1 explicitly.
    registration.setdefault("zSign", 1.0)
    if not isinstance(registration["scale"], (int, float)) or registration["scale"] <= 0:
        raise ValueError("Registration scale must be positive")
    if registration["zSign"] not in (-1, 1):
        raise ValueError("Registration zSign must be -1 or 1")
    return registration


def to_model(lat: float, lon: float, registration: dict[str, float | int | str | None]) -> tuple[float, float]:
    """Invert the canonical reflected/scaled local-frame -> WGS84 transform."""
    anchor_lat = float(registration["anchorLat"])
    anchor_lon = float(registration["anchorLon"])
    easting = (lon - anchor_lon) * M_PER_DEG_LAT * math.cos(math.radians(anchor_lat))
    northing = (lat - anchor_lat) * M_PER_DEG_LAT
    de = (easting - float(registration["translationEast"])) / float(registration["scale"])
    dn = (northing - float(registration["translationNorth"])) / float(registration["scale"])
    theta = math.radians(float(registration["angleDeg"]))
    x = de * math.cos(theta) + dn * math.sin(theta)
    reflected_z = -de * math.sin(theta) + dn * math.cos(theta)
    return x, reflected_z / float(registration["zSign"])


def to_wgs84(x: float, z: float, registration: dict[str, float | int | str | None]) -> tuple[float, float]:
    """Forward transform, retained here for round-trip validation."""
    anchor_lat = float(registration["anchorLat"])
    theta = math.radians(float(registration["angleDeg"]))
    scale = float(registration["scale"])
    reflected_z = z * float(registration["zSign"])
    easting = scale * (x * math.cos(theta) - reflected_z * math.sin(theta)) + float(registration["translationEast"])
    northing = scale * (x * math.sin(theta) + reflected_z * math.cos(theta)) + float(registration["translationNorth"])
    return (
        anchor_lat + northing / M_PER_DEG_LAT,
        float(registration["anchorLon"]) + easting / (M_PER_DEG_LAT * math.cos(math.radians(anchor_lat))),
    )


def point_line_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    """Distance from a point to a finite 2D segment, in model metres."""
    px, pz = point
    sx, sz = start
    ex, ez = end
    dx, dz = ex - sx, ez - sz
    length_sq = dx * dx + dz * dz
    if length_sq == 0:
        return math.hypot(px - sx, pz - sz)
    t = max(0.0, min(1.0, ((px - sx) * dx + (pz - sz) * dz) / length_sq))
    return math.hypot(px - (sx + t * dx), pz - (sz + t * dz))


def simplify(points: list[tuple[float, float]], tolerance_m: float = 1.5) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker simplification in the model's metre frame."""
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    farthest_index, farthest_distance = 0, 0.0
    for index, point in enumerate(points[1:-1], 1):
        distance = point_line_distance(point, start, end)
        if distance > farthest_distance:
            farthest_index, farthest_distance = index, distance
    if farthest_distance <= tolerance_m:
        return [start, end]
    return simplify(points[: farthest_index + 1], tolerance_m)[:-1] + simplify(points[farthest_index:], tolerance_m)


def intersects_model(points: Iterable[tuple[float, float]], padding_m: float = 180.0) -> bool:
    min_x, min_z, max_x, max_z = MODEL_BOUNDS
    return any(
        min_x - padding_m <= x <= max_x + padding_m and min_z - padding_m <= z <= max_z + padding_m
        for x, z in points
    )


def round_point(point: tuple[float, float]) -> list[float]:
    return [round(point[0], 1), round(point[1], 1)]


def road_record(element: dict[str, Any], registration: dict[str, float | int | str | None]) -> dict[str, Any] | None:
    geometry = element.get("geometry", [])
    if len(geometry) < 2:
        return None
    points = [to_model(point["lat"], point["lon"], registration) for point in geometry]
    if not intersects_model(points):
        return None
    points = simplify(points)
    if len(points) < 2:
        return None
    tags = element.get("tags", {})
    name_local = tags.get("name")
    name_english = tags.get("name:en")
    ref = tags.get("ref")
    name_ar = tags.get("name:ar") or (name_local if any("\u0600" <= char <= "\u06ff" for char in (name_local or "")) else None)
    return {
        "id": f"way/{element['id']}",
        "name": name_english or name_local or ref,
        "nameAr": name_ar,
        "highway": tags.get("highway"),
        # The optional fields below retain source fidelity for a future road
        # detail panel while the minimap only needs id/name/highway/points.
        "nameLocal": name_local,
        "ref": ref,
        "bridge": tags.get("bridge") not in (None, "no"),
        "tunnel": tags.get("tunnel") not in (None, "no"),
        "points": [round_point(point) for point in points],
    }


def place_record(element: dict[str, Any], registration: dict[str, float | int | str | None]) -> dict[str, Any] | None:
    tags = element.get("tags", {})
    center = element.get("center", element)
    lat, lon = center.get("lat"), center.get("lon")
    if lat is None or lon is None:
        return None
    x, z = to_model(float(lat), float(lon), registration)
    if not intersects_model([(x, z)], padding_m=350.0):
        return None
    name_local = tags.get("name")
    name_english = tags.get("name:en")
    if not (name_english or name_local):
        return None
    name_ar = tags.get("name:ar") or (name_local if any("\u0600" <= char <= "\u06ff" for char in (name_local or "")) else None)
    record = {
        "id": f"{element['type']}/{element['id']}",
        "name": name_english or name_local,
        "nameAr": name_ar,
        "kind": tags.get("place"),
        "x": round(x, 1),
        "z": round(z, 1),
        "lat": round(float(lat), 7),
        "lon": round(float(lon), 7),
    }
    return record


def read_elements(path: Path) -> list[dict[str, Any]]:
    with path.open() as file:
        data = json.load(file)
    elements = data.get("elements")
    if not isinstance(elements, list):
        raise RuntimeError(f"{path} is not an Overpass element response")
    return elements


def build(roads_path: Path, places_path: Path, output_path: Path, registration: dict[str, float | int | str | None]) -> dict[str, Any]:
    roads = [record for element in read_elements(roads_path) if (record := road_record(element, registration))]
    places = [record for element in read_elements(places_path) if (record := place_record(element, registration))]
    areas = [record for record in places if record["kind"] in {"neighbourhood", "suburb", "quarter"}]
    landmarks = [record for record in places if record["kind"] == "locality"]
    areas.sort(key=lambda record: (record["name"].casefold(), record["id"]))
    landmarks.sort(key=lambda record: (record["name"].casefold(), record["id"]))
    round_trip_lat, round_trip_lon = to_wgs84(*to_model(33.8886, 35.4955, registration), registration)
    round_trip_error_m = math.hypot(
        (round_trip_lat - 33.8886) * M_PER_DEG_LAT,
        (round_trip_lon - 35.4955) * M_PER_DEG_LAT * math.cos(math.radians(float(registration["anchorLat"]))),
    )
    output_registration = dict(registration)
    output_registration.update({
        "crs": "WGS84",
        "modelUnits": "metres",
        "accuracyMeters": None,
        "roundTripErrorMetres": round(round_trip_error_m, 6),
        "fitProxyCaveat": "Road/block and satellite overlays verify placement proxies; they do not establish per-building positional accuracy.",
        "displayGuidance": "Treat a street name as nearby; use the nearest road label only within 150 metres.",
    })
    output = {
        "version": 1,
        "generated": date.today().isoformat(),
        "modelBounds": {"minX": MODEL_BOUNDS[0], "minZ": MODEL_BOUNDS[1], "maxX": MODEL_BOUNDS[2], "maxZ": MODEL_BOUNDS[3]},
        "registration": output_registration,
        "lookup": {"streetPrefix": "Near ", "maxStreetDistanceMetres": 150, "googleMapsUrlTemplate": "https://www.google.com/maps/search/?api=1&query={lat},{lon}"},
        "roads": roads,
        "areas": areas,
        "landmarks": landmarks,
        "sources": [
            {
                "provider": "OpenStreetMap contributors",
                "via": "Overpass API",
                "queryBbox": {"south": BBOX[0], "west": BBOX[1], "north": BBOX[2], "east": BBOX[3]},
                "license": "ODbL 1.0",
                "attribution": "© OpenStreetMap contributors",
            },
            {"provider": "Model registration", "detail": "Canonical reflected registration is loaded from public/data/registration.json. Road/block and satellite overlays are placement proxies, not per-building accuracy measurements."},
            {"provider": "Google Maps Geocoding API", "detail": "Three authorized spot checks returned OK on 2026-09-16. Google response text is not redistributed in this file."},
        ],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="download current OSM source responses before building")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    fields = {"south": BBOX[0], "west": BBOX[1], "north": BBOX[2], "east": BBOX[3]}
    if args.refresh or not ROAD_CACHE.exists():
        fetch_overpass(ROAD_QUERY.format(**fields), ROAD_CACHE)
    if args.refresh or not PLACE_CACHE.exists():
        fetch_overpass(PLACE_QUERY.format(**fields), PLACE_CACHE)
    result = build(ROAD_CACHE, PLACE_CACHE, args.output, load_registration())
    print(f"wrote {args.output}: {len(result['roads'])} roads, {len(result['areas'])} areas, {len(result['landmarks'])} landmarks")


if __name__ == "__main__":
    main()
