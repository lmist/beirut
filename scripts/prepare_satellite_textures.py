#!/usr/bin/env python3
"""Bake registered photographic ground/roof maps for the streamed city tiles.

Raw imagery stays in data/sat/maps. Only the sampled runtime JPEGs and their
world-space bounds are written to public/assets/world/photographic.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
import json
import math
from pathlib import Path
import threading
import time
import urllib.error
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/sat/maps"
OUT = ROOT / "public/assets/world/photographic"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def cache_path(key):
    zoom, x, y = key
    return CACHE / f"z{zoom}" / f"{x}_{y}.jpg"


def valid_image(path):
    try:
        with path.open("rb") as stream:
            if stream.read(3) != b"\xff\xd8\xff":
                return False
        with Image.open(path) as im:
            if im.size != (256, 256):
                return False
            im.load()
        return True
    except (OSError, ValueError):
        return False


class Registration:
    def __init__(self, data):
        self.data = data
        self.c = math.cos(math.radians(data["angleDeg"]))
        self.s = math.sin(math.radians(data["angleDeg"]))
        self.mlat = data["metresPerDegreeLatitude"]
        self.mlon = self.mlat * math.cos(math.radians(data["anchorLat"]))

    def pixels(self, x, z, zoom):
        r = self.data
        z *= r["zSign"]
        east = r["scale"] * (x * self.c - z * self.s) + r["translationEast"]
        north = r["scale"] * (x * self.s + z * self.c) + r["translationNorth"]
        latitude = r["anchorLat"] + north / self.mlat
        longitude = r["anchorLon"] + east / self.mlon
        n = 256 * 2 ** zoom
        return ((longitude + 180) / 360 * n,
                (1 - math.asinh(math.tan(math.radians(latitude))) / math.pi) / 2 * n)

    def tile_range(self, bounds, zoom):
        points = [self.pixels(x, z, zoom)
                  for x in (bounds[0], bounds[2]) for z in (bounds[1], bounds[3])]
        return (math.floor(min(p[0] for p in points) / 256),
                math.floor(min(p[1] for p in points) / 256),
                math.floor(max(p[0] for p in points) / 256),
                math.floor(max(p[1] for p in points) / 256))

    def keys(self, bounds, zoom):
        x0, y0, x1, y1 = self.tile_range(bounds, zoom)
        return {(zoom, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


class TileSource:
    def __init__(self, workers, download):
        self.workers = workers
        self.download = download
        self.valid = set()
        self.status = {}
        self.blocked = threading.Event()
        self.lock = threading.Lock()
        self.wall_streak = 0
        self.downloaded = Counter()
        self.invalid = []

    def inspect_cache(self, needed):
        for key in sorted(needed):
            path = cache_path(key)
            if valid_image(path):
                self.valid.add(key)
            elif path.exists():
                self.invalid.append(key)

    def fetch(self, key):
        if self.blocked.is_set():
            return key, "stopped_after_access_wall"
        zoom, x, y = key
        path = cache_path(key)
        for attempt in range(3):
            if self.blocked.is_set():
                return key, "stopped_after_access_wall"
            host = (x + y + attempt) % 4
            url = f"https://mt{host}.google.com/vt?lyrs=s&x={x}&y={y}&z={zoom}"
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    body = response.read()
                if body[:3] != b"\xff\xd8\xff":
                    return key, "non_jpeg_response"
                with Image.open(BytesIO(body)) as im:
                    im.load()
                    if im.size != (256, 256):
                        return key, "unexpected_image_dimensions"
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".jpg.tmp")
                temporary.write_bytes(body)
                temporary.replace(path)
                with self.lock:
                    self.wall_streak = 0
                return key, "downloaded"
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    return key, "http_404"
                if error.code in (403, 429):
                    with self.lock:
                        self.wall_streak += 1
                        if self.wall_streak >= 5:
                            self.blocked.set()
                    if self.blocked.is_set():
                        return key, f"blocked_http_{error.code}"
                    time.sleep(min(30, 5 * 2 ** attempt))
                elif attempt == 2:
                    return key, f"http_{error.code}"
                else:
                    time.sleep(1 + attempt)
            except (OSError, ValueError) as error:
                if attempt == 2:
                    return key, type(error).__name__
                time.sleep(1 + attempt)
        return key, "request_failed"

    def ensure(self, keys, label):
        keys = set(keys)
        self.inspect_cache(keys - self.valid)
        missing = sorted(keys - self.valid)
        print(f"{label}: needed={len(keys)} cached={len(keys) - len(missing)} missing={len(missing)}", flush=True)
        if not self.download:
            for key in missing:
                self.status[key] = "not_cached"
            return
        counts = Counter()
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = [pool.submit(self.fetch, key) for key in missing]
            for count, future in enumerate(as_completed(futures), 1):
                key, status = future.result()
                self.status[key] = status
                counts[status] += 1
                if status == "downloaded":
                    self.valid.add(key)
                    self.downloaded[key[0]] += 1
                if count % 100 == 0 or count == len(missing):
                    print(f"{label}: {count}/{len(missing)} {dict(counts)}", flush=True)

    def fallback_key(self, key):
        z, x, y = key
        for level in range(z, 14, -1):
            divisor = 2 ** (z - level)
            parent = (level, x // divisor, y // divisor)
            if parent in self.valid:
                return parent
        return None

    def fill_fallbacks(self, keys, label):
        if not keys:
            return
        for zoom in range(max(key[0] for key in keys) - 1, 14, -1):
            unresolved = [key for key in keys if self.fallback_key(key) is None]
            if not unresolved or self.blocked.is_set():
                return
            parents = {(zoom, key[1] // 2 ** (key[0] - zoom), key[2] // 2 ** (key[0] - zoom))
                       for key in unresolved if key[0] > zoom}
            self.ensure(parents, f"{label} z{zoom}")

    def image(self, key):
        parent = self.fallback_key(key)
        if parent is None:
            # A missing source is explicitly counted in metadata.
            return Image.new("RGB", (256, 256), (93, 96, 90)), None
        with Image.open(cache_path(parent)) as original:
            im = original.convert("RGB")
        if parent == key:
            return im, parent[0]
        factor = 2 ** (key[0] - parent[0])
        side = 256 / factor
        x = (key[1] % factor) * side
        y = (key[2] % factor) * side
        return im.transform((256, 256), Image.Transform.EXTENT,
                            (x, y, x + side, y + side), Image.Resampling.BICUBIC), parent[0]


def sample_image(registration, source, bounds, zoom, size, overview=False):
    x0, y0, x1, y1 = registration.tile_range(bounds, zoom)
    mosaic = Image.new("RGB", ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
    resolutions = Counter()
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            im, actual_zoom = source.image((zoom, x, y))
            if overview and (zoom, x, y) not in source.valid:
                # Use already cached detailed photography in overview-only holes.
                for cx in range(4):
                    for cy in range(4):
                        child = (19, x * 4 + cx, y * 4 + cy)
                        if source.fallback_key(child) is not None:
                            piece, child_zoom = source.image(child)
                            im.paste(piece.resize((64, 64), Image.Resampling.LANCZOS), (cx * 64, cy * 64))
                            if actual_zoom is None:
                                actual_zoom = child_zoom
            mosaic.paste(im, ((x - x0) * 256, (y - y0) * 256))
            resolutions[str(actual_zoom) if actual_zoom is not None else "missing"] += 1
    width, height = size
    mesh = []
    # A mesh samples the exact registration and Mercator transform throughout
    # the image, including the much wider city overview.
    for row in range(8):
        for col in range(8):
            left, top = round(col * width / 8), round(row * height / 8)
            right, bottom = round((col + 1) * width / 8), round((row + 1) * height / 8)
            quad = []
            for px, py in ((left, top), (left, bottom), (right, bottom), (right, top)):
                world_x = bounds[0] + px / width * (bounds[2] - bounds[0])
                world_z = bounds[1] + py / height * (bounds[3] - bounds[1])
                sx, sy = registration.pixels(world_x, world_z, zoom)
                quad.extend((sx - x0 * 256, sy - y0 * 256))
            mesh.append(((left, top, right, bottom), tuple(quad)))
    image = mosaic.transform(size, Image.Transform.MESH, mesh, Image.Resampling.BICUBIC)
    return image, dict(resolutions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=range(4, 7), default=5)
    parser.add_argument("--cache-only", action="store_true")
    parser.add_argument("--tile-size", type=int, default=1024)
    parser.add_argument("--overview-size", type=int, default=4096)
    args = parser.parse_args()
    started = time.time()
    registration_data = json.loads((ROOT / "public/data/registration.json").read_text())
    registration = Registration(registration_data)
    manifest = json.loads((ROOT / "public/data/manifest.json").read_text())
    tiles = {row["id"]: [row["bounds"][i] for i in (0, 2, 3, 5)] for row in manifest["tiles"]}
    world = [min(b[0] for b in tiles.values()), min(b[1] for b in tiles.values()),
             max(b[2] for b in tiles.values()), max(b[3] for b in tiles.values())]
    tile_keys = {tile_id: registration.keys(bounds, 19) for tile_id, bounds in tiles.items()}
    required = set().union(*tile_keys.values())
    source = TileSource(args.workers, not args.cache_only)
    source.ensure(required, "Runtime z19")
    initially_cached = len(required & source.valid) - source.downloaded[19]
    source.fill_fallbacks(required, "Runtime fallback")

    overview_keys = registration.keys(world, 17)
    # A complete 4x4 z19 group already supplies an overview source tile. Fetch
    # z17 only for incomplete groups, including ocean beyond the streamed map.
    overview_downloads = {key for key in overview_keys
                          if not all(source.fallback_key((19, key[1] * 4 + cx, key[2] * 4 + cy))
                                     for cx in range(4) for cy in range(4))}
    source.ensure(overview_downloads, "Overview z17")
    source.fill_fallbacks(overview_downloads, "Overview fallback")
    (OUT / "satellite").mkdir(parents=True, exist_ok=True)
    records = {}
    for index, (tile_id, bounds) in enumerate(tiles.items(), 1):
        image, resolutions = sample_image(registration, source, bounds, 19, (args.tile_size, args.tile_size))
        filename = f"satellite/{tile_id}.jpg"
        image.save(OUT / filename, "JPEG", quality=87, optimize=True)
        records[tile_id] = {"url": f"/assets/world/photographic/{filename}", "bounds": bounds,
                            "width": args.tile_size, "height": args.tile_size,
                            "sourceZooms": resolutions}
        if index % 20 == 0 or index == len(tiles):
            print(f"Baked runtime textures: {index}/{len(tiles)}", flush=True)
    longest = max(world[2] - world[0], world[3] - world[1])
    size = (round(args.overview_size * (world[2] - world[0]) / longest),
            round(args.overview_size * (world[3] - world[1]) / longest))
    overview, _ = sample_image(registration, source, world, 17, size, overview=True)
    overview.save(OUT / "satellite/overview.jpg", "JPEG", quality=85, optimize=True)
    zoom_counts = Counter()
    missing = []
    for key in sorted(required):
        parent = source.fallback_key(key)
        if parent:
            zoom_counts[str(parent[0])] += 1
        else:
            missing.append(list(key))
    fully_z19 = sum(all(key in source.valid for key in keys) for keys in tile_keys.values())
    complete = sum(all(source.fallback_key(key) is not None for key in keys) for keys in tile_keys.values())
    overview_missing = sum(
        not all(source.fallback_key((19, key[1] * 4 + cx, key[2] * 4 + cy)) is not None
                for cx in range(4) for cy in range(4)) for key in overview_keys)
    coverage = {"runtimeTiles": len(tiles), "runtimeTilesComplete": complete,
                "runtimeTilesEntirelyZ19": fully_z19, "sourceTilesNeeded": len(required),
                "sourceTilesInitiallyCached": initially_cached, "sourceTilesAtZ19": zoom_counts["19"],
                "sourceTilesLowerZoom": sum(v for k, v in zoom_counts.items() if k != "19"),
                "sourceTilesMissing": len(missing), "sourceZooms": dict(zoom_counts),
                "downloadedByZoom": dict(source.downloaded), "overviewSourceZoom": 17,
                "overviewSourceTilesNeeded": len(overview_keys),
                "overviewSourceTilesMissing": overview_missing,
                "blocked": source.blocked.is_set(), "invalidCachedImages": len(source.invalid)}
    result = {"version": 1, "registrationVersion": registration_data["version"], "registration": registration_data,
              "source": "Google Maps satellite imagery", "attribution": "Imagery © Google",
              "uvConvention": "u=(worldX-minX)/(maxX-minX); v=(worldZ-minZ)/(maxZ-minZ); image rows increase with worldZ",
              "overview": {"url": "/assets/world/photographic/satellite/overview.jpg",
                           "bounds": world, "width": size[0], "height": size[1]},
              "tiles": records, "coverage": coverage}
    (OUT / "satellite.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
    audit = {"coverage": coverage, "registration": registration_data, "missing": missing,
             "requests": [{"tile": list(key), "status": value} for key, value in sorted(source.status.items())],
             "elapsedSeconds": round(time.time() - started, 1)}
    (CACHE / "runtime_texture_audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print(json.dumps(coverage, indent=2), flush=True)
    print(f"Completed in {audit['elapsedSeconds']} seconds", flush=True)


if __name__ == "__main__":
    main()
