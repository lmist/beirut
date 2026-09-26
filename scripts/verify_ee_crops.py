"""Verify /Users/lou/beirut/data/buildings/earth crops: count, bytes, non-blank spot checks,
and one geographic cross-check of a crop center against chunk pixel math."""
import json
import math
import os

import numpy as np
from PIL import Image

ROOT = '/Users/lou/beirut'
OUT_DIR = os.path.join(ROOT, 'data', 'buildings', 'earth')
CHUNK_DIR = os.path.join(ROOT, 'data', 'sat', 'ee-chunks')
KEY = '/Users/lou/beirut/translate-330918-3903cc004740.json'
SA = 'gearth2@translate-330918.iam.gserviceaccount.com'
PROJECT = 'translate-330918'
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 92300.0
MARGIN_M = 120.0
MAX_PX = 4000

recs = json.load(open(os.path.join(ROOT, 'data', 'buildings_geo.json')))
by_id = {b['id']: b for b in recs}

# rebuild chunk geometry exactly as crop_ee.py does
ROWS, COLS = 2, 3
lat0 = min(b['lat'] for b in recs)
lat1 = max(b['lat'] for b in recs)
lon0 = min(b['lon'] for b in recs)
lon1 = max(b['lon'] for b in recs)
latstep = (lat1 - lat0) / ROWS
lonstep = (lon1 - lon0) / COLS
dlat = MARGIN_M / M_PER_DEG_LAT
dlon = MARGIN_M / M_PER_DEG_LON
chunks = {}
for r in range(ROWS):
    for c in range(COLS):
        s, n = lat0 + r * latstep, lat0 + (r + 1) * latstep
        w, e = lon0 + c * lonstep, lon0 + (c + 1) * lonstep
        d = {'west': w - dlon, 'east': e + dlon, 'south': s - dlat, 'north': n + dlat}
        d['W'] = min(MAX_PX, max(1, round((d['east'] - d['west']) * M_PER_DEG_LON)))
        d['H'] = min(MAX_PX, max(1, round((d['north'] - d['south']) * M_PER_DEG_LAT)))
        d['ppd_lon'] = (d['east'] - d['west']) / d['W']
        d['ppd_lat'] = (d['north'] - d['south']) / d['H']
        d['path'] = os.path.join(CHUNK_DIR, f'chunk_{r}_{c}.png')
        chunks[f'{r}_{c}'] = d

# 1. count + bytes
files = [f for f in os.listdir(OUT_DIR) if f.endswith('.jpg')]
ids_on_disk = set(int(f[:-4]) for f in files)
missing = [b['id'] for b in recs if b['id'] not in ids_on_disk]
total_bytes = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in files)
print(f'count={len(files)} expected={len(recs)} missing={len(missing)}')
print(f'bytes_total={total_bytes}')

# 2. five known-point buildings: known ids spread over the city
spot = [b for b in recs if b['id'] in (0, 4, 5000, 10000, 17574)]
print('\nspot checks (should be non-blank, >1 unique color):')
for b in spot:
    p = os.path.join(OUT_DIR, f'{b["id"]}.jpg')
    im = np.asarray(Image.open(p).convert('RGB'))
    uniq = len(np.unique(im.reshape(-1, 3), axis=0))
    std = float(im.std())
    print(f'  id={b["id"]} lat={b["lat"]:.5f} lon={b["lon"]:.5f} std={std:.1f} uniq_colors={uniq} '
          f'{"OK" if std > 8 and uniq > 50 else "SUSPECT"}')

# 3. geographic cross-check: building id=10000, compute center-pixel in its chunk, round-trip
b = by_id[10000]
r = min(ROWS - 1, max(0, int(math.floor((b['lat'] - lat0) / (lat1 - lat0) * ROWS))))
c = min(COLS - 1, max(0, int(math.floor((b['lon'] - lon0) / (lon1 - lon0) * COLS))))
ch = chunks[f'{r}_{c}']
side = max(32.0, min(200.0, max(b['w'], b['d']) * 2.5))
half = side / 2.0
px_c = (b['lon'] - ch['west']) / ch['ppd_lon']
py_c = (ch['north'] - b['lat']) / ch['ppd_lat']
back_lon = ch['west'] + px_c * ch['ppd_lon']
back_lat = ch['north'] - py_c * ch['ppd_lat']
print('\ngeo cross-check id=10000:')
print(f'  chunk={r}_{c} W={ch["W"]} H={ch["H"]} ppd_lon={ch["ppd_lon"]:.9f} ppd_lat={ch["ppd_lat"]:.9f}')
print(f'  center px=({px_c:.2f},{py_c:.2f})  round-trip lon {back_lon:.6f} vs {b["lon"]:.6f} '
      f'(d={abs(back_lon - b["lon"]) * M_PER_DEG_LON:.2f} m)')
print(f'  round-trip lat {back_lat:.6f} vs {b["lat"]:.6f} '
      f'(d={abs(back_lat - b["lat"]) * M_PER_DEG_LAT:.2f} m)')
im = np.asarray(Image.open(os.path.join(OUT_DIR, '10000.jpg')).convert('L'))
print(f'  crop std={im.std():.1f}  {"OK" if im.std() > 8 else "SUSPECT"}')