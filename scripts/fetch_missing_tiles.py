#!/usr/bin/env python3
"""Download the specific missing z19 tiles needed by failed building crops."""
import json, math, os, time
import urllib.error, urllib.request

OUT = "/Users/lou/beirut/data/sat/maps/z19"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HOSTS = ["mt0.google.com", "mt1.google.com", "mt2.google.com", "mt3.google.com"]

def tile_xy(lat, lon, z=19):
    n = 1 << z
    x = int((lon + 180.0) / 360.0 * n)
    r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n)
    return x, y

# Recompute missing tiles from failed building IDs (same geometry as crop_maps.py).
GEO = json.load(open("/Users/lou/beirut/data/buildings_geo.json"))
recs = {r["id"]: r for r in GEO}
fail_ids = [int(l.split("\t")[0]) for l in open("/Users/lou/beirut/data/buildings/maps/failures.log") if l.strip()]
MISSING = set()
for bid in fail_ids:
    r = recs[bid]
    side_m = max(32.0, min(200.0, max(r["w"], r["d"]) * 2.5))
    dlat = side_m / 111320.0
    dlon = side_m / 92300.0
    tx0, ty0 = tile_xy(r["lat"] + dlat / 2.0, r["lon"] - dlon / 2.0)
    tx1, ty1 = tile_xy(r["lat"] - dlat / 2.0, r["lon"] + dlon / 2.0)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            MISSING.add((tx, ty))
MISSING = sorted(t for t in MISSING
                  if not (os.path.exists(f"{OUT}/{t[0]}_{t[1]}.jpg")
                          and os.path.getsize(f"{OUT}/{t[0]}_{t[1]}.jpg") > 1000))
print(f"building ids to fix: {len(fail_ids)}, tiles to fetch: {len(MISSING)}", flush=True)

def fetch(xy):
    x, y = xy
    path = os.path.join(OUT, f"{x}_{y}.jpg")
    for attempt in range(6):
        host = HOSTS[(x + y + attempt) % 4]
        url = f"https://{host}/vt?lyrs=s&x={x}&y={y}&z=19"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            if body[:3] == b"\xff\xd8\xff":
                tmp = path + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, path)
                return None
        except Exception:
            time.sleep(2)
    return xy

from concurrent.futures import ThreadPoolExecutor
bad = list(filter(None, ThreadPoolExecutor(max_workers=6).map(fetch, MISSING)))
print(f"fetched {len(MISSING) - len(bad)}/{len(MISSING)}, still failing {len(bad)}", flush=True)
for xy in bad[:30]:
    print("STILL_MISSING", xy[0], xy[1])