"""Fetch a cloud-mosaicked Sentinel-2 RGB image from Google Earth Engine.

Auth: Earth Engine service account gearth2@translate-330918.iam.gserviceaccount.com
Key:  /Users/lou/beirut/translate-330918-3903cc004740.json  (do not print contents)
Project: translate-330918 (registered noncommercial)

Usage:
  .venv/bin/python scripts/gee_fetch.py --lat 33.8886 --lon 35.4955 --size 400 \
      --out data/gee-proto/downtown.png [--dimensions 512x512 --months 6 --max-cloud 40]

The composite is a median of recent cloud-filtered Sentinel-2 SR scenes;
pixels come back via EE's thumbnail endpoint (PNG, WGS84-aligned, north-up).
"""
import argparse, os, urllib.request

KEY = '/Users/lou/beirut/translate-330918-3903cc004740.json'
SA = 'gearth2@translate-330918.iam.gserviceaccount.com'
PROJECT = 'translate-330918'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lat', type=float, required=True)
    ap.add_argument('--lon', type=float, required=True)
    ap.add_argument('--size', type=float, default=400, help='box size in meters')
    ap.add_argument('--dimensions', default='512x512')
    ap.add_argument('--months', type=int, default=6, help='lookback window for the composite')
    ap.add_argument('--max-cloud', type=int, default=40, help='CloudyPixelPercentage cutoff')
    ap.add_argument('--min', type=int, default=0)
    ap.add_argument('--max', type=int, default=2500, help='RGB stretch max (SR DN scale ~0-3000)')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    import ee
    ee.Initialize(credentials=ee.ServiceAccountCredentials(SA, KEY), project=PROJECT)

    from datetime import datetime, timedelta, timezone
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30 * args.months)
    d = args.size / 111320.0
    reg = ee.Geometry.Rectangle([args.lon - d, args.lat - d, args.lon + d, args.lat + d])

    comp = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(reg)
            .filterDate(start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d'))
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', args.max_cloud))
            .median())

    url = comp.select(['B4', 'B3', 'B2']).getThumbURL({
        'region': reg, 'min': args.min, 'max': args.max,
        'dimensions': args.dimensions, 'format': 'png'})

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    urllib.request.urlretrieve(url, args.out)
    print(f'{args.out} ({os.path.getsize(args.out)} bytes, {args.dimensions})')

if __name__ == '__main__':
    main()