"""Sentinel-2 composite crops for all Beirut buildings via chunk-grid Earth Engine fetch.

Strategy: split the city bbox into a 2x2 grid of chunks (~3500 x ~2730 px each at ~1 m/px,
under the 4000 px cap). Each chunk is fetched as a SINGLE EE thumbnail request (PNG, EPSG:4326,
north-up). Chunks are expanded by a 120 m margin so that 200 m building crops straddling chunk
boundaries stay fully inside one chunk image. Buildings are then cropped from the chunk whose
tile contains their center using the affine pixel mapping of that chunk.

Pixel mapping (row 0 = north):
    lon = west + px_x * (east - west) / W
    lat = south + (H - 1 - px_y) * (north - south) / H

Auth: gearth2@translate-330918 (key file path in KEY; never printed).
"""
import json
import math
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image

KEY = '/Users/lou/beirut/translate-330918-3903cc004740.json'
SA = 'gearth2@translate-330918.iam.gserviceaccount.com'
PROJECT = 'translate-330918'

ROOT = '/Users/lou/beirut'
GEO = os.path.join(ROOT, 'data', 'buildings_geo.json')
OUT_DIR = os.path.join(ROOT, 'data', 'buildings', 'earth')
CHUNK_DIR = os.path.join(ROOT, 'data', 'sat', 'ee-chunks')
CHUNK_FAIL = os.path.join(CHUNK_DIR, 'failures.log')
CROP_FAIL = os.path.join(OUT_DIR, 'failures.log')

M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 92300.0   # ~111320 * cos(33.9 deg)
MARGIN_M = 120.0          # half max crop side (200/2) + slack, so boundary crops stay complete
MONTHS = 6
MAX_CLOUD = 40
MIN_V, MAX_V = 0, 2500
MAX_PX = 4000
FETCH_TIMEOUT = 420  # seconds; heavy urban median composites can take minutes to render


def chunk_grid(lat0, lat1, lon0, lon1, rows, cols):
    """Return list of dicts: expanded chunk region + unexpanded tile for assignment."""
    latstep = (lat1 - lat0) / rows
    lonstep = (lon1 - lon0) / cols
    dlat = MARGIN_M / M_PER_DEG_LAT
    dlon = MARGIN_M / M_PER_DEG_LON
    chunks = []
    for r in range(rows):
        for c in range(cols):
            s = lat0 + r * latstep
            n = lat0 + (r + 1) * latstep
            w = lon0 + c * lonstep
            e = lon0 + (c + 1) * lonstep
            chunks.append({
                'r': r, 'c': c,
                'west': w - dlon, 'east': e + dlon,
                'south': s - dlat, 'north': n + dlat,
                'tile': (s, n, w, e),
            })
    return {f'{ch["r"]}_{ch["c"]}': ch for ch in chunks}


def fetch_chunk(ee, chunk, start, end, retries=3):
    """Fetch one chunk's composite thumbnail PNG into CHUNK_DIR. Returns (path, bytes) or raises."""
    c = chunk
    W = min(MAX_PX, max(1, round((c['east'] - c['west']) * M_PER_DEG_LON)))
    H = min(MAX_PX, max(1, round((c['north'] - c['south']) * M_PER_DEG_LAT)))
    region = ee.Geometry.Rectangle([c['west'], c['south'], c['east'], c['north']])
    comp = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(region)
            .filterDate(start, end)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', MAX_CLOUD))
            .median())
    url = comp.select(['B4', 'B3', 'B2']).getThumbURL({
        'region': region, 'crs': 'EPSG:4326',
        'dimensions': f'{W}x{H}', 'min': MIN_V, 'max': MAX_V, 'format': 'png'})
    path = os.path.join(CHUNK_DIR, f'chunk_{c["r"]}_{c["c"]}.png')
    if os.path.exists(path) and os.path.getsize(path) >= 1000 and _is_png(path):
        return path, os.path.getsize(path)  # idempotent: reuse a previously fetched chunk
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT) as resp, open(path, 'wb') as f:
                f.write(resp.read())
            if os.path.getsize(path) < 1000 or not _is_png(path):
                raise RuntimeError(f'bad download ({os.path.getsize(path)} bytes)')
            return path, os.path.getsize(path)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(5 * attempt)
    raise RuntimeError(f'chunk {c["r"]}_{c["c"]} failed after {retries} tries: {last_err}')


def _is_png(path):
    with open(path, 'rb') as f:
        return f.read(8) == b'\x89PNG\r\n\x1a\n'


def crop_buildings(chunks, recs):
    """Assign each building to its tile chunk, crop from chunk image array, save JPEGs."""
    os.makedirs(OUT_DIR, exist_ok=True)
    n_ok = 0
    clipped = 0
    failures = []

    # precompute per-chunk pixel params
    chunks_by_rc = {f'{c["r"]}_{c["c"]}': c for c in chunks}
    for c in chunks:
        c['W'] = min(MAX_PX, max(1, round((c['east'] - c['west']) * M_PER_DEG_LON)))
        c['H'] = min(MAX_PX, max(1, round((c['north'] - c['south']) * M_PER_DEG_LAT)))
        c['ppd_lon'] = (c['east'] - c['west']) / c['W']   # deg per pixel
        c['ppd_lat'] = (c['north'] - c['south']) / c['H']
        c['arr'] = np.asarray(Image.open(os.path.join(CHUNK_DIR, f'chunk_{c["r"]}_{c["c"]}.png')).convert('RGB'))
        assert c['arr'].shape[0] == c['H'] and c['arr'].shape[1] == c['W'], \
            f'chunk {c["r"]}_{c["c"]} dims {c["arr"].shape} != {c["H"]}x{c["W"]}'

    t0 = time.time()
    for i, b in enumerate(recs):
        lat, lon, wid, dep = b['lat'], b['lon'], b['w'], b['d']
        # tile assignment (floor, clamped) over the union bbox
        r = min(ROWS - 1, max(0, int(math.floor((lat - TILE_S0) / (TILE_N1 - TILE_S0) * ROWS))))
        c = min(COLS - 1, max(0, int(math.floor((lon - TILE_W0) / (TILE_E1 - TILE_W0) * COLS))))
        ch = chunks_by_rc.get(f'{r}_{c}')
        if ch is None:
            failures.append((b['id'], 'outside every chunk'))
            continue
        side = max(32.0, min(200.0, max(wid, dep) * 2.5))
        half = side / 2.0
        dlat = half / M_PER_DEG_LAT
        dlon = half / M_PER_DEG_LON
        # pixel rect in chunk coords (row 0 = north)
        px0 = (lon - dlon - ch['west']) / ch['ppd_lon']
        px1 = (lon + dlon - ch['west']) / ch['ppd_lon']
        py1 = (ch['north'] - (lat + dlat)) / ch['ppd_lat']   # top row (north edge)
        py0 = (ch['north'] - (lat - dlat)) / ch['ppd_lat']   # bottom row (south edge)
        x0, x1 = int(math.floor(px0)), int(math.ceil(px1))
        y0, y1 = int(math.floor(py1)), int(math.ceil(py0))
        # clip to chunk bounds
        cx0, cx1 = max(0, x0), min(ch['W'], x1)
        cy0, cy1 = max(0, y0), min(ch['H'], y1)
        if cx1 - cx0 < 1 or cy1 - cy0 < 1:
            failures.append((b['id'], f'clip empty ch={r}_{c} rect=({x0},{y0},{x1},{y1})'))
            continue
        if cx0 != x0 or cx1 != x1 or cy0 != y0 or cy1 != y1:
            clipped += 1
        crop = ch['arr'][cy0:cy1, cx0:cx1]
        img = Image.fromarray(crop).resize((256, 256), Image.Resampling.LANCZOS)
        img.save(os.path.join(OUT_DIR, f'{b["id"]}.jpg'), quality=85)
        n_ok += 1
        if n_ok % 3000 == 0:
            print(f'  {n_ok}/{len(recs)} crops ({time.time() - t0:.0f}s)', flush=True)
    return n_ok, clipped, failures


def main():
    import ee
    ee.Initialize(credentials=ee.ServiceAccountCredentials(SA, KEY), project=PROJECT)

    recs = json.load(open(GEO))
    lats = [b['lat'] for b in recs]
    lons = [b['lon'] for b in recs]
    global ROWS, COLS, TILE_S0, TILE_N1, TILE_W0, TILE_E1
    ROWS, COLS = 2, 3
    lat0, lat1 = min(lats), max(lats)
    lon0, lon1 = min(lons), max(lons)
    TILE_S0, TILE_N1, TILE_W0, TILE_E1 = lat0, lat1, lon0, lon1

    os.makedirs(CHUNK_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    end = datetime.now(timezone.utc)
    start = (end - timedelta(days=30 * MONTHS)).strftime('%Y-%m-%d')
    end = end.strftime('%Y-%m-%d')

    chunks = chunk_grid(lat0, lat1, lon0, lon1, ROWS, COLS)
    print(f'bbox lat {lat0:.5f}..{lat1:.5f} lon {lon0:.5f}..{lon1:.5f}, '
          f'{len(chunks)} chunks, {len(recs)} buildings', flush=True)
    for c in chunks.values():
        W = min(MAX_PX, max(1, round((c['east'] - c['west']) * M_PER_DEG_LON)))
        H = min(MAX_PX, max(1, round((c['north'] - c['south']) * M_PER_DEG_LAT)))
        print(f'  chunk {c["r"]}_{c["c"]}: {c["west"]:.5f},{c["south"]:.5f}->'
              f'{c["east"]:.5f},{c["north"]:.5f}  {W}x{H}', flush=True)

    # fetch chunks (retry x3)
    ee_requests = 0
    fetch_failures = []
    for c in chunks.values():
        try:
            path, size = fetch_chunk(ee, c, start, end)
            ee_requests += 1
            print(f'  fetched chunk_{c["r"]}_{c["c"]}.png ({size} bytes)', flush=True)
        except Exception as e:  # noqa: BLE001
            fetch_failures.append(f'chunk_{c["r"]}_{c["c"]}: {e}')
            print(f'  FAILED chunk_{c["r"]}_{c["c"]}: {e}', flush=True)
    if fetch_failures:
        with open(CHUNK_FAIL, 'a') as f:
            for line in fetch_failures:
                f.write(line + '\n')
        missing = [c for c in chunks.values() if not os.path.exists(
            os.path.join(CHUNK_DIR, f'chunk_{c["r"]}_{c["c"]}.png'))]
        if missing:
            print(f'ABORT: {len(missing)} chunks missing after retries', flush=True)
            return

    n_ok, clipped, failures = crop_buildings(list(chunks.values()), recs)
    with open(CROP_FAIL, 'w') as f:
        for bid, reason in failures:
            f.write(f'{bid}\t{reason}\n')

    total_bytes = sum(os.path.getsize(os.path.join(OUT_DIR, f'{b["id"]}.jpg'))
                      for b in recs if os.path.exists(os.path.join(OUT_DIR, f'{b["id"]}.jpg')))
    print(f'DONE ok={n_ok}/{len(recs)} clipped={clipped} crop_failures={len(failures)} '
          f'bytes={total_bytes}', flush=True)
    print(json.dumps({'chunks_fetched': ee_requests, 'images': n_ok,
                      'clipped': clipped, 'failures': len(failures),
                      'bytes_total': total_bytes}))


if __name__ == '__main__':
    main()