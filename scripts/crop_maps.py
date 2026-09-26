#!/usr/bin/env python
"""Crop one north-up satellite image per building from the z19 Google Maps mosaic.

For each building in buildings_geo.json, compute a square crop of
side = clamp(max(w,d)*2.5, 32, 200) meters centered on (lat, lon),
pull the intersecting z19 tile(s), resize to 256x256 LANCZOS, save JPEG q85
to data/buildings/maps/{id}.jpg. Failures -> data/buildings/maps/failures.log.
"""
import math
import json
import os
import sys
from multiprocessing import Pool

from PIL import Image

Z = 19
TILE = 256
DATA = "/Users/lou/beirut/data"
GEO = os.path.join(DATA, "buildings_geo.json")
TILE_DIR = os.path.join(DATA, "sat/maps/z19")
OUT_DIR = os.path.join(DATA, "buildings/maps")
FAIL_LOG = os.path.join(OUT_DIR, "failures.log")
WORKERS = 8
CHUNK = 64

# Latitude used to derive the meters-per-degree lon scale (per spec).
LAT_REF = 33.88


def latlon_to_px(lat, lon):
    n = (1 << Z) * TILE
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def crop_one(rec):
    bid = rec["id"]
    lat, lon, w, d = rec["lat"], rec["lon"], rec["w"], rec["d"]
    side_m = max(w, d) * 2.5
    side_m = max(32.0, min(200.0, side_m))

    dlat = side_m / 111320.0
    dlon = side_m / 92300.0

    cx, cy = latlon_to_px(lat, lon)
    ppx = latlon_to_px(lat, lon - dlon / 2.0)[0]
    npx = latlon_to_px(lat, lon + dlon / 2.0)[0]
    spy = latlon_to_px(lat + dlat / 2.0, lon)[1]
    npy = latlon_to_px(lat - dlat / 2.0, lon)[1]

    x0f, x1f = min(ppx, npx, cx), max(ppx, npx, cx)
    y0f, y1f = min(npy, spy, cy), max(npy, spy, cy)

    x0, y0 = math.floor(x0f), math.floor(y0f)
    x1, y1 = math.ceil(x1f), math.ceil(y1f)
    cw, ch = x1 - x0, y1 - y0

    tx0, ty0 = x0 // TILE, y0 // TILE
    tx1, ty1 = (x1 - 1) // TILE, (y1 - 1) // TILE

    canvas = Image.new("RGB", (cw, ch))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            tp = os.path.join(TILE_DIR, f"{tx}_{ty}.jpg")
            if not os.path.exists(tp):
                return (bid, f"missing tile {tx}_{ty}.jpg")
            try:
                with Image.open(tp) as im:
                    im.load()
            except Exception as exc:
                return (bid, f"corrupt tile {tx}_{ty}.jpg: {exc}")
            canvas.paste(im, (tx * TILE - x0, ty * TILE - y0))

    crop = canvas.crop((int(round(x0f)) - x0, int(round(y0f)) - y0,
                        int(round(x1f)) - x0, int(round(y1f)) - y0))
    out = crop.resize((TILE, TILE), Image.LANCZOS)
    try:
        out.save(os.path.join(OUT_DIR, f"{bid}.jpg"), "JPEG", quality=85)
    except Exception as exc:
        return (bid, f"save failed: {exc}")
    return None


def work(chunk):
    failures = []
    for rec in chunk:
        f = crop_one(rec)
        if f is not None:
            failures.append(f)
    return failures


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(GEO) as fh:
        records = json.load(fh)
    if len(records) != 17575:
        print(f"WARNING: expected 17575 records, got {len(records)}", flush=True)

    chunks = [records[i:i + CHUNK] for i in range(0, len(records), CHUNK)]
    all_failures = []
    done = 0
    with Pool(WORKERS) as pool:
        for fails in pool.imap_unordered(work, chunks):
            all_failures.extend(fails)
            done += 1
            processed = min(len(records), done * CHUNK)
            if processed % 2000 < CHUNK:
                print(f"progress: {processed}/{len(records)}", flush=True)

    with open(FAIL_LOG, "w") as fh:
        for bid, reason in all_failures:
            fh.write(f"{bid}\t{reason}\n")
    print(f"done: {len(records) - len(all_failures)} ok, {len(all_failures)} failed", flush=True)
    return 0 if len(all_failures) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())