#!/usr/bin/env python3
"""Collect a small, categorized Beirut Street View reference survey.

Images are source references for art direction and remain under data/, never in
the browser's public directory.  This script reads the already gitignored
Google Maps key file locally and never prints it.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
KEY_FILE = ROOT / "googlenv"
OUT = ROOT / "data" / "street-references"

# The set samples the requested road, bridge, sidewalk, trees and signs
# conditions across the model's geographic extent.  Target coordinates are
# only used to find an authorized Google outdoor panorama.
SITES = [
    ("hamra-sidewalk", "sidewalks and storefront signs", 33.8954753, 35.4820202),
    ("manara-trees", "coastal road and mature trees", 33.8939371, 35.4717101),
    ("verdun-street", "mixed-use street and sidewalks", 33.8857678, 35.4826958),
    ("badaro-street", "neighbourhood street and trees", 33.8757985, 35.5160464),
    ("museum-square", "street edge, paving and wayfinding", 33.8789712, 35.5149794),
    ("ras-el-nabaa-bridge", "bridge approach and road furniture", 33.8782446, 35.5073088),
    ("salim-slam", "major junction, signs and roadway", 33.8853828, 35.4975365),
    ("downtown-saifi", "central sidewalks and street signs", 33.8929743, 35.5084655),
    ("gemmayzeh", "street character, trees and storefronts", 33.8969521, 35.5096877),
    ("mar-mikhael", "sidewalks, poles and commercial frontage", 33.8968646, 35.5251623),
    ("karantina", "port-edge industrial street and signs", 33.8998399, 35.5321807),
    ("cola", "transport corridor and sidewalk condition", 33.8759200, 35.4957707),
]


def read_key() -> str:
    raw = KEY_FILE.read_text().strip().splitlines()[0]
    key = raw.split("=", 1)[-1].strip()
    if not key:
        raise RuntimeError("Google Maps key file is empty")
    return key


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "beirut-world-reference-survey/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "beirut-world-reference-survey/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def bearing(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float:
    p1, p2 = math.radians(from_lat), math.radians(to_lat)
    delta_lon = math.radians(to_lon - from_lon)
    y = math.sin(delta_lon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def distance_metres(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    """Short-range equirectangular distance, adequate for survey disclosure."""
    north = (lat_b - lat_a) * 111_320.0
    east = (lon_b - lon_a) * 111_320.0 * math.cos(math.radians((lat_a + lat_b) / 2))
    return math.hypot(north, east)


def main() -> None:
    key = read_key()
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    for slug, purpose, lat, lon in SITES:
        metadata_query = urllib.parse.urlencode({"location": f"{lat},{lon}", "radius": 100, "source": "outdoor", "key": key})
        metadata = fetch_json("https://maps.googleapis.com/maps/api/streetview/metadata?" + metadata_query)
        if metadata.get("status") != "OK" or not metadata.get("pano_id"):
            results.append({"id": slug, "purpose": purpose, "lat": lat, "lon": lon, "status": metadata.get("status", "UNKNOWN")})
            continue
        pano = metadata["location"]
        heading = bearing(pano["lat"], pano["lng"], lat, lon)
        image_query = urllib.parse.urlencode({"size": "640x640", "pano": metadata["pano_id"], "heading": round(heading, 1), "pitch": -4, "fov": 92, "key": key})
        image = fetch_bytes("https://maps.googleapis.com/maps/api/streetview?" + image_query)
        if len(image) < 2000 or image[:2] != b"\xff\xd8":
            results.append({"id": slug, "purpose": purpose, "lat": lat, "lon": lon, "status": "BAD_IMAGE"})
            continue
        filename = f"{slug}.jpg"
        (OUT / filename).write_bytes(image)
        results.append({
            "id": slug,
            "purpose": purpose,
            "lat": lat,
            "lon": lon,
            "status": "OK",
            "file": filename,
            "panoLat": pano["lat"],
            "panoLon": pano["lng"],
            "panoDistanceMetres": round(distance_metres(lat, lon, pano["lat"], pano["lng"]), 1),
            "heading": round(heading, 1),
            "date": metadata.get("date"),
        })
    (OUT / "survey.json").write_text(json.dumps({"provider": "Google Maps Platform Street View Static API", "sites": results}, indent=2) + "\n")
    success = sum(site["status"] == "OK" for site in results)
    print(f"Street references: {success}/{len(results)} available; details in {OUT / 'survey.json'}")


if __name__ == "__main__":
    main()
