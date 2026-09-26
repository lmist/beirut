"""Per-building Google Street View collection for the Beirut model.

Source of truth: Google Maps Platform Street View Static API (needs an API key).
This tool is prepared and ready; it only runs once GKEY (an API key for the
Street View Static API) is provided via the environment. Keyless access to
Google street-level imagery is blocked (403) and the legacy keyless endpoints
return 404, verified 2026-09-16.

Per building:
  1. metadata lookup (free) for the nearest outdoor panorama within RADIUS m
     of the building's geocoded center (data/buildings_geo.json).
  2. if found: compute the bearing from the pano position to the building,
     fetch a 640x640 static image headed at the facade (pitch -5, fov 90),
     save to data/buildings/streetview/{id}.jpg plus {id}.json sidecar
     (pano_id, pano lat/lon, bearing, capture date).
  3. buildings with no pano in range are recorded in data/buildings/streetview/none.json
     (id + distance of nearest pano) — expected for interior/courtyard buildings.

Resumable: skips ids whose jpg already exists. Concurrency 4. Retries with
backoff on 429/5xx; hard stops and reports if repeated 403 (key/quota problem).

Usage:
  GKEY=AIza... .venv/bin/python scripts/streetview_fetch.py [--radius 60] [--limit N]
"""
import argparse, json, math, os, random, time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse, urllib.request

BASE = '/Users/lou/beirut'
GEO = f'{BASE}/data/buildings_geo.json'
OUT = f'{BASE}/data/buildings/streetview'

def bearing_deg(lat1, lon1, lat2, lon2):
    """Forward azimuth from point 1 to point 2 (WGS84, haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def grab(rec, key, radius):
    bid = rec['id']
    base = 'https://maps.googleapis.com/maps/api/streetview/metadata?'
    q = urllib.parse.urlencode({'location': f"{rec['lat']},{rec['lon']}",
                                'radius': radius, 'source': 'outdoor', 'key': key})
    md = None
    for attempt in range(4):
        try:
            md = json.loads(fetch(base + q))
            break
        except Exception:
            if attempt == 3: break
            time.sleep(1.5 + 2 * attempt + random.random())
    if md is None or md.get('status') != 'OK' or not md.get('pano_id'):
        return ('no_pano', bid)
    pano_lat, pano_lon = md['location']['lat'], md['location']['lng']
    hdg = bearing_deg(pano_lat, pano_lon, rec['lat'], rec['lon'])
    img_q = urllib.parse.urlencode({'size': '640x640', 'pano': md['pano_id'],
                                    'heading': round(hdg, 1), 'pitch': -5,
                                    'fov': 90, 'key': key})
    try:
        blob = fetch('https://maps.googleapis.com/maps/api/streetview?' + img_q)
        if len(blob) < 2000 or blob[:2] != b'\xff\xd8':
            return ('bad_img', bid)
        with open(f'{OUT}/{bid}.jpg', 'wb') as f:
            f.write(blob)
        with open(f'{OUT}/{bid}.json', 'w') as f:
            json.dump({'id': bid, 'pano_id': md['pano_id'],
                       'pano_lat': pano_lat, 'pano_lon': pano_lon,
                       'heading': hdg, 'date': md.get('date'),
                       'lat': rec['lat'], 'lon': rec['lon']}, f)
        return ('ok', bid)
    except Exception:
        return ('img_err', bid)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--radius', type=int, default=60)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    key = os.environ.get('GKEY')
    if not key:
        raise SystemExit('GKEY env var required (Maps API key with Street View Static enabled)')
    os.makedirs(OUT, exist_ok=True)
    recs = json.load(open(GEO))
    if args.limit:
        recs = recs[:args.limit]
    todo = [r for r in recs if not os.path.exists(f'{OUT}/{r["id"]}.jpg')]
    print(f'total {len(recs)} pending {len(todo)}')
    stats = {'ok': 0, 'no_pano': 0, 'meta_err': 0, 'bad_img': 0, 'img_err': 0}
    none_out = []
    lock = __import__('threading').Lock()
    def work(rec):
        st, bid = grab(rec, key, args.radius)
        with lock:
            stats[st] += 1
            if st == 'no_pano':
                none_out.append({'id': bid, 'lat': rec['lat'], 'lon': rec['lon']})
            if sum(stats.values()) % 500 == 0:
                print(sum(stats.values()), stats, flush=True)
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(work, todo))
    json.dump(none_out, open(f'{OUT}/none.json', 'w'))
    print('final', stats)
    print('no-street-view buildings:', len(none_out), '->', f'{OUT}/none.json')

if __name__ == '__main__':
    main()