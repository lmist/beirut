#!/usr/bin/env python3
"""Build streamed Street View atlases in the city's canonical coordinate frame.

Raw images and resumable request records stay under data/photographic/facades.
Only compact atlases and projection parameters are published. Camera elevation
and visibility are estimates from the model, not surveyed facade calibration.

Usage:
  .cache/registration-venv/bin/python scripts/prepare_facade_textures.py
  .cache/registration-venv/bin/python scripts/prepare_facade_textures.py --collect --max-new 2000
  .cache/registration-venv/bin/python scripts/prepare_facade_textures.py --build-only
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import io
import http.client
import hashlib
import json
import math
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/photographic/facades'
PUBLIC = ROOT / 'public/assets/world/photographic'
LEGACY = ROOT / 'data/buildings/streetview'
PLAN = RAW / 'plan.json'
CELL = 192
GUTTER = 4
GRID = 80.0


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n')
    temporary.replace(path)


def angular_difference(a, b):
    return abs((a - b + 180) % 360 - 180)


def completed_request_matches(bid, desired):
    if not desired or not (ROOT / desired['path']).exists():
        return False
    path = RAW / 'requests' / f'{bid}.json'
    if not path.exists():
        return False
    completed = json.loads(path.read_text())
    parameters = completed.get('parameters', {})
    return (completed.get('status') == 'OK'
            and parameters.get('pano') == desired['panoId']
            and parameters.get('heading') == desired['headingDeg']
            and parameters.get('pitch') == desired['pitchDeg']
            and parameters.get('fov') == desired['fovDeg'])


class City:
    def __init__(self):
        self.registration = json.loads((ROOT / 'public/data/registration.json').read_text())
        self.buildings = np.asarray(json.loads((ROOT / 'public/data/buildings.json').read_text()))
        self.ground = np.asarray(json.loads((ROOT / 'public/data/building-ground.json').read_text()))
        self.centres = (self.buildings[:, :2] + self.buildings[:, 2:4]) / 2
        self.tree = cKDTree(self.centres)
        self.grid = {}
        for bid, b in enumerate(self.buildings):
            for gx in range(math.floor(b[0] / GRID), math.floor(b[2] / GRID) + 1):
                for gz in range(math.floor(b[1] / GRID), math.floor(b[3] / GRID) + 1):
                    self.grid.setdefault((gx, gz), []).append(bid)
        self.tiles = json.loads((ROOT / 'public/data/manifest.json').read_text())['tiles']

    def world(self, lat, lon):
        r = self.registration
        east = (lon - r['anchorLon']) * 111320 * math.cos(math.radians(r['anchorLat'])) - r['translationEast']
        north = (lat - r['anchorLat']) * 111320 - r['translationNorth']
        a = math.radians(r['angleDeg'])
        return np.array([(east * math.cos(a) + north * math.sin(a)) / r['scale'],
                         (-east * math.sin(a) + north * math.cos(a)) / r['scale'] / r['zSign']])

    def geographic(self, x, z):
        r = self.registration
        a = math.radians(r['angleDeg'])
        east = r['scale'] * (x * math.cos(a) - z * r['zSign'] * math.sin(a)) + r['translationEast']
        north = r['scale'] * (x * math.sin(a) + z * r['zSign'] * math.cos(a)) + r['translationNorth']
        return [r['anchorLat'] + north / 111320,
                r['anchorLon'] + east / (111320 * math.cos(math.radians(r['anchorLat'])))]

    def heading(self, delta):
        r = self.registration
        a = math.radians(r['angleDeg'])
        east = delta[0] * math.cos(a) - delta[1] * r['zSign'] * math.sin(a)
        north = delta[0] * math.sin(a) + delta[1] * r['zSign'] * math.cos(a)
        return math.degrees(math.atan2(east, north)) % 360

    def camera_height(self, xz):
        distances, bids = self.tree.query(xz, k=5)
        weights = 1 / np.maximum(distances, 5) ** 2
        return float(np.sum(self.ground[bids] * weights) / np.sum(weights) + 2.5)

    def sight(self, bid, camera):
        """Ray against nearby building bounds at facade midpoint elevation."""
        target = self.centres[bid]
        b = self.buildings[bid]
        origin = np.array([camera[0], camera[2]])
        delta = target - origin
        distance = float(np.linalg.norm(delta))
        if distance < 4 or distance > 100:
            return None
        inv = np.divide(1, delta, out=np.full(2, 1e12), where=np.abs(delta) > 1e-8)
        t0, t1 = (b[:2] - origin) * inv, (b[2:4] - origin) * inv
        entry = float(np.max(np.minimum(t0, t1)))
        # A panorama inside the rectangular proxy cannot supply a reliable ray.
        if entry < 0.02:
            return None
        facade = origin + delta * entry
        facade_distance = float(np.linalg.norm(facade - origin))
        if facade_distance < 3:
            return None
        mid_y = float((max(b[4], self.ground[bid]) + b[5]) / 2)
        ids = set()
        low, high = np.minimum(origin, facade), np.maximum(origin, facade)
        for gx in range(math.floor(low[0] / GRID), math.floor(high[0] / GRID) + 1):
            for gz in range(math.floor(low[1] / GRID), math.floor(high[1] / GRID) + 1):
                ids.update(self.grid.get((gx, gz), []))
        ids.discard(bid)
        if ids:
            other = self.buildings[list(ids)]
            tt0 = (other[:, :2] - origin) * inv
            tt1 = (other[:, 2:4] - origin) * inv
            enters = np.maximum(np.max(np.minimum(tt0, tt1), axis=1), 0)
            exits = np.min(np.maximum(tt0, tt1), axis=1)
            heights = camera[1] + (mid_y - camera[1]) * enters / entry
            blocked = (enters <= exits) & (exits > 0.035) & (enters < entry - 0.035) & (other[:, 5] > heights + 1.5)
            if np.any(blocked):
                return None
        corner_headings = [self.heading(np.array([x, z]) - origin)
                           for x in [b[0], b[2]] for z in [b[1], b[3]]]
        heading = self.heading(delta)
        half_width = max(angular_difference(heading, h) for h in corner_headings)
        upper = math.degrees(math.atan2(b[5] - camera[1], facade_distance))
        lower = math.degrees(math.atan2(max(b[4], self.ground[bid]) - camera[1], facade_distance))
        pitch = (upper + lower) / 2
        fov = max(48, min(110, max(half_width * 2 + 12, upper - lower + 12)))
        return {'distance': distance, 'facadeDistance': facade_distance, 'heading': heading,
                'pitch': pitch, 'fov': fov, 'upper': upper, 'lower': lower, 'halfWidth': half_width}


def load_sources(city):
    rejected = {r['imageId'] for r in json.loads((ROOT / 'data/registration-v2/rejected-photos.json').read_text())}
    photos, panoramas = [], {}
    for path in sorted(LEGACY.glob('[0-9]*.json')):
        image_id = int(path.stem)
        if image_id in rejected or not path.with_suffix('.jpg').exists():
            continue
        row = json.loads(path.read_text())
        # The old outdoor query still returned uploaded business/interior
        # photospheres. Their position and camera altitude are not dependable.
        # Exclude this known legacy ID family unless separately calibrated.
        if row['pano_id'].startswith('CAo'):
            continue
        if not (33.84 < row['pano_lat'] < 33.93 and 35.44 < row['pano_lon'] < 35.56):
            continue
        xz = city.world(row['pano_lat'], row['pano_lon'])
        pano_id = row['pano_id']
        if pano_id not in panoramas:
            panoramas[pano_id] = {'panoId': pano_id, 'lat': row['pano_lat'], 'lon': row['pano_lon'],
                                  'camera': [float(xz[0]), city.camera_height(xz), float(xz[1])],
                                  'date': row.get('date')}
        photos.append({**panoramas[pano_id], 'imageId': f'legacy-{image_id}',
                       'path': str(path.with_suffix('.jpg').relative_to(ROOT)),
                       'headingDeg': round(float(row['heading']), 1), 'pitchDeg': -5, 'fovDeg': 90})
    return photos, list(panoramas.values())


def make_plan(city, refresh=False):
    if PLAN.exists() and not refresh:
        plan = json.loads(PLAN.read_text())
        if plan['registration'] == city.registration:
            return plan
    photos, panoramas = load_sources(city)
    photo_tree = cKDTree([[p['camera'][0], p['camera'][2]] for p in photos])
    pano_tree = cKDTree([[p['camera'][0], p['camera'][2]] for p in panoramas])
    records, counts = [], Counter()
    for bid, centre in enumerate(city.centres):
        prior_candidates = photo_tree.query_ball_point(centre, 90)
        prior_candidates.sort(key=lambda i: np.linalg.norm(centre - np.array(photos[i]['camera'])[::2]))
        reusable = []
        sight_cache = {}
        for index in prior_candidates[:40]:
            p = photos[index]
            if p['panoId'] not in sight_cache:
                sight_cache[p['panoId']] = city.sight(bid, p['camera'])
            sight = sight_cache[p['panoId']]
            if sight is None:
                continue
            error = angular_difference(sight['heading'], p['headingDeg'])
            if error + min(sight['halfWidth'], 10) > 39:
                continue
            vertical_fraction = max(0, min(sight['upper'], 37) - max(sight['lower'], -47)) / max(1, sight['upper'] - sight['lower'])
            if vertical_fraction < 0.65:
                continue
            score = sight['distance'] / 100 + error / 60 + (1 - vertical_fraction)
            reusable.append((score, {**p, 'confidence': round(max(0.35, 0.76 - score * 0.16), 3),
                                     'distanceMetres': round(sight['distance'], 2), 'source': 'cached-street-view'}))
        reusable.sort(key=lambda p: p[0])
        chosen = reusable[0][1] if reusable else None
        _, nearest = pano_tree.query(centre, k=16, distance_upper_bound=95)
        candidates = []
        for index in nearest:
            if index >= len(panoramas):
                continue
            p = panoramas[int(index)]
            if p['panoId'] not in sight_cache:
                sight_cache[p['panoId']] = city.sight(bid, p['camera'])
            sight = sight_cache[p['panoId']]
            if sight is None:
                continue
            score = sight['distance'] / 110 + max(0, sight['halfWidth'] - 35) / 80
            if sight['fov'] > 108 and sight['halfWidth'] > 55:
                continue
            candidates.append((score, p, sight))
        candidates.sort(key=lambda p: p[0])
        desired = None
        if candidates:
            score, p, sight = candidates[0]
            desired = {**p, 'imageId': f'corrected-{bid}', 'path': f'data/photographic/facades/images/{bid}.jpg',
                       'headingDeg': round(sight['heading'], 1), 'pitchDeg': round(sight['pitch'], 1),
                       'fovDeg': round(sight['fov'], 1), 'confidence': round(max(0.40, 0.82 - score * 0.2), 3),
                       'distanceMetres': round(sight['distance'], 2), 'source': 'targeted-street-view'}
        counts['cached' if chosen else 'new' if desired else 'uncovered'] += 1
        records.append({'buildingId': bid, 'cached': chosen, 'desired': desired})
        if (bid + 1) % 3000 == 0:
            print(json.dumps({'planned': bid + 1, 'counts': counts}), flush=True)
    plan = {'version': 1, 'registration': city.registration, 'records': records}
    write_json(PLAN, plan)
    print(json.dumps({'plan': counts, 'panoramas': len(panoramas), 'legacyPhotos': len(photos)}), flush=True)
    return plan


class StreetView:
    def __init__(self):
        raw = (ROOT / 'googlenv').read_text().strip().splitlines()[0]
        self.key = raw.split('=', 1)[-1].strip().strip('"').strip("'")
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.connections = threading.local()
        self.wall_count = 0

    def request(self, endpoint, params):
        path = '/maps/api/streetview' + endpoint + '?' + urllib.parse.urlencode({**params, 'key': self.key})
        for attempt in range(4):
            if self.stop.is_set():
                return None, 'STOPPED'
            try:
                if not getattr(self.connections, 'connection', None):
                    self.connections.connection = http.client.HTTPSConnection('maps.googleapis.com', timeout=25)
                connection = self.connections.connection
                connection.request('GET', path, headers={'User-Agent': 'beirut-texture-collection/1.0'})
                response = connection.getresponse()
                content = response.read()
                if response.status >= 400:
                    raise urllib.error.HTTPError('', response.status, response.reason, response.headers, None)
                if endpoint != '/metadata':
                    with self.lock:
                        self.wall_count = 0
                return content, 'OK'
            except urllib.error.HTTPError as error:
                code = error.code
                if code in (403, 429):
                    with self.lock:
                        self.wall_count += 1
                        if self.wall_count >= 5:
                            self.stop.set()
                    time.sleep(2 ** (attempt + 1))
                elif code >= 500:
                    time.sleep(1.5 * (attempt + 1))
                else:
                    return None, f'HTTP_{code}'
            except Exception as error:
                # Exception strings can contain the credential-bearing URL.
                if getattr(self.connections, 'connection', None):
                    self.connections.connection.close()
                    self.connections.connection = None
                if attempt == 3:
                    return None, type(error).__name__
                time.sleep(1 + attempt)
        return None, 'RETRY_EXHAUSTED'

    def metadata(self, lat, lon):
        body, status = self.request('/metadata', {'location': f'{lat:.8f},{lon:.8f}', 'radius': 90, 'source': 'outdoor'})
        if body is None:
            return {'status': status}
        result = json.loads(body)
        if result.get('status') in ('REQUEST_DENIED', 'OVER_QUERY_LIMIT'):
            with self.lock:
                self.wall_count += 1
                if self.wall_count >= 5:
                    self.stop.set()
        else:
            with self.lock:
                self.wall_count = 0
        return result


def collect(city, plan, max_new, metadata_limit, improve_cached=False):
    api = StreetView()
    (RAW / 'images').mkdir(parents=True, exist_ok=True)
    (RAW / 'metadata').mkdir(parents=True, exist_ok=True)
    (RAW / 'requests').mkdir(parents=True, exist_ok=True)
    uncovered = [r for r in plan['records'] if not r['cached'] and not r['desired']]
    uncovered.sort(key=lambda r: float(np.linalg.norm(city.centres[r['buildingId']] - [-600, -240])))

    def find_pano(record):
        bid = record['buildingId']
        path = RAW / 'metadata' / f'{bid}.json'
        metadata = json.loads(path.read_text()) if path.exists() else api.metadata(*city.geographic(*city.centres[bid]))
        write_json(path, metadata)
        if metadata.get('status') != 'OK' or not metadata.get('pano_id'):
            return metadata.get('status', 'UNKNOWN')
        if metadata['pano_id'].startswith('CAo'):
            return 'UNCALIBRATED_PHOTOSPHERE'
        loc = metadata['location']
        xz = city.world(loc['lat'], loc['lng'])
        camera = [float(xz[0]), city.camera_height(xz), float(xz[1])]
        sight = city.sight(bid, camera)
        if sight is None:
            return 'GEOMETRY_OCCLUDED'
        record['desired'] = {'panoId': metadata['pano_id'], 'lat': loc['lat'], 'lon': loc['lng'],
                             'camera': camera, 'date': metadata.get('date'), 'imageId': f'corrected-{bid}',
                             'path': f'data/photographic/facades/images/{bid}.jpg',
                             'headingDeg': round(sight['heading'], 1), 'pitchDeg': round(sight['pitch'], 1),
                             'fovDeg': round(sight['fov'], 1), 'confidence': round(max(0.4, 0.82 - sight['distance'] / 550), 3),
                             'distanceMetres': round(sight['distance'], 2), 'source': 'targeted-street-view'}
        return 'OK'

    metadata_ids = {r['buildingId'] for r in uncovered[:metadata_limit]}
    pending = [r for r in plan['records']
               if (improve_cached or not r['cached'])
               and ((r['desired'] and not completed_request_matches(r['buildingId'], r['desired'])) or r['buildingId'] in metadata_ids)]
    # Fill untextured targets first; within that group work outwards from spawn.
    pending.sort(key=lambda r: (bool(r['cached']), float(np.linalg.norm(city.centres[r['buildingId']] - [-600, -240]))))
    if max_new:
        pending = pending[:max_new]
    print(json.dumps({'imagesPendingThisRun': len(pending)}), flush=True)
    stats = Counter()
    started = time.time()

    def fetch_image(record):
        bid = record['buildingId']
        if record['desired'] is None:
            meta_status = find_pano(record)
            if meta_status != 'OK':
                return 'METADATA_' + meta_status
        p = record['desired']
        if completed_request_matches(bid, p):
            return 'EXISTING'
        params = {'size': '640x640', 'pano': p['panoId'], 'heading': p['headingDeg'],
                  'pitch': p['pitchDeg'], 'fov': p['fovDeg'], 'return_error_code': 'true'}
        blob, status = api.request('', params)
        if blob is not None:
            try:
                with Image.open(io.BytesIO(blob)) as im:
                    im.verify()
                if not blob.startswith(b'\xff\xd8') or len(blob) < 2000:
                    status = 'BAD_IMAGE'
                else:
                    path = ROOT / p['path']
                    temp = path.with_suffix('.tmp')
                    temp.write_bytes(blob)
                    temp.replace(path)
            except Exception:
                status = 'BAD_IMAGE'
        write_json(RAW / 'requests' / f'{bid}.json', {'buildingId': bid, 'status': status, 'parameters': params,
                                                     'camera': p['camera'], 'date': p.get('date')})
        return status

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(fetch_image, r) for r in pending]
        for n, future in enumerate(as_completed(futures), 1):
            stats[future.result()] += 1
            if n % 100 == 0:
                write_json(PLAN, plan)
                print(json.dumps({'images': n, 'counts': stats, 'seconds': round(time.time() - started)}), flush=True)
            if api.stop.is_set():
                for f in futures:
                    f.cancel()
                break
    write_json(PLAN, plan)
    print(json.dumps({'imagesFinal': stats, 'blocked': api.stop.is_set(), 'seconds': round(time.time() - started)}), flush=True)


def image_cell(path):
    with Image.open(path) as source:
        im = source.convert('RGB').resize((CELL, CELL), Image.Resampling.LANCZOS)
    # Keep the complete camera frame: cropping would invalidate FOV projection.
    pixels = np.asarray(im)
    padded = np.pad(pixels, ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode='edge')
    return Image.fromarray(padded)


def build_reference_patches():
    from prepare_facade_materials import build_reference_patches as build_materials
    return build_materials()


def build(city, plan):
    output = PUBLIC / 'facades'
    output.mkdir(parents=True, exist_ok=True)
    rows, selected = [], {}
    stats = Counter()
    for record in plan['records']:
        bid = record['buildingId']
        desired = record['desired']
        image = desired if completed_request_matches(bid, desired) else record['cached']
        if image is None:
            rows.append(None)
            continue
        selected[bid] = image
        stats[image['source']] += 1
        rows.append({'camera': [round(c, 3) for c in image['camera']],
                     'headingDeg': image['headingDeg'], 'pitchDeg': image['pitchDeg'], 'fovDeg': image['fovDeg'],
                     'imageId': image['imageId'], 'confidence': image['confidence'],
                     'date': image.get('date'), 'distanceMetres': image['distanceMetres']})
    tile_rows = {}
    cells_written = 0
    bytes_written = 0
    thumbnails = {}
    for tile in city.tiles:
        q = tile['bounds']
        b = city.buildings
        overlap = np.flatnonzero((b[:, 0] <= q[3]) & (b[:, 2] >= q[0]) & (b[:, 1] <= q[5]) & (b[:, 3] >= q[2]))
        bids = [int(bid) for bid in overlap if int(bid) in selected]
        if not bids:
            continue
        pitch = CELL + GUTTER * 2
        columns = math.ceil(math.sqrt(len(bids)))
        count_rows = math.ceil(len(bids) / columns)
        width, height = columns * pitch, count_rows * pitch
        atlas = Image.new('RGB', (width, height), (128, 128, 128))
        cells = {}
        for n, bid in enumerate(bids):
            photo = selected[bid]
            image_id = photo['imageId']
            if image_id not in thumbnails:
                thumbnails[image_id] = image_cell(ROOT / photo['path'])
            x, y = (n % columns) * pitch, (n // columns) * pitch
            atlas.paste(thumbnails[image_id], (x, y))
            cells[str(bid)] = [round((x + GUTTER) / width, 8), round((y + GUTTER) / height, 8),
                               round(CELL / width, 8), round(CELL / height, 8)]
        encoded = io.BytesIO()
        atlas.save(encoded, format='WEBP', quality=78, method=4)
        content = encoded.getvalue()
        digest = hashlib.sha256(content).hexdigest()[:12]
        filename = f'{tile["id"]}-{digest}.webp'
        path = output / filename
        if not path.exists():
            temp = path.with_suffix('.tmp')
            temp.write_bytes(content)
            temp.replace(path)
        bytes_written += path.stat().st_size
        cells_written += len(bids)
        tile_rows[tile['id']] = {'url': f'/assets/world/photographic/facades/{filename}',
                                'width': width, 'height': height, 'cells': cells}
    summary = {'totalBuildings': len(rows), 'buildingsWithPhoto': len(selected), 'uncoveredBuildings': len(rows) - len(selected),
               'sources': dict(stats), 'atlasTiles': len(tile_rows), 'atlasCells': cells_written,
               'atlasBytes': bytes_written, 'cellPixels': CELL, 'gutterPixels': GUTTER}
    metadata_status = Counter()
    rejected_photospheres = 0
    for path in (RAW / 'metadata').glob('*.json'):
        metadata = json.loads(path.read_text())
        metadata_status[metadata.get('status', 'UNKNOWN')] += 1
        rejected_photospheres += int(metadata.get('pano_id', '').startswith('CAo'))
    request_status = Counter(json.loads(path.read_text()).get('status', 'UNKNOWN')
                             for path in (RAW / 'requests').glob('*.json'))
    summary['metadataLookups'] = sum(metadata_status.values())
    summary['metadataStatus'] = dict(metadata_status)
    summary['uncalibratedPhotospheresRejected'] = rejected_photospheres
    summary['imageRequestStatus'] = dict(request_status)
    fingerprint = hashlib.sha256(json.dumps(city.registration, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    manifest = {'version': 1, 'registrationVersion': city.registration['version'],
                'registration': city.registration, 'registrationFingerprint': fingerprint,
                'provider': 'Google Street View', 'attribution': '© Google',
                'cameraHeightMethod': 'inverse-distance weighted nearest five modeled ground heights + 2.5m',
                'visibilityMethod': 'camera-to-facade midpoint ray against modeled building bounds',
                'accuracyStatus': 'Geometric candidates; camera altitude, occlusion and photographic alignment are not independently surveyed.',
                'uvOrigin': 'top-left', 'imageAspect': 1, 'summary': summary, 'buildings': rows, 'tiles': tile_rows}
    write_json(PUBLIC / 'facades.json', manifest)
    write_json(RAW / 'summary.json', summary)
    # Small inspectable sheet samples different districts and both source types.
    samples = sorted(selected, key=lambda bid: float(np.linalg.norm(city.centres[bid] - [-600, -240])))
    samples = samples[:8] + samples[::max(1, len(samples) // 16)][:16]
    sheet = Image.new('RGB', (6 * 180, math.ceil(len(samples) / 6) * 205), '#202020')
    draw = ImageDraw.Draw(sheet)
    for n, bid in enumerate(samples):
        x, y = (n % 6) * 180, (n // 6) * 205
        with Image.open(ROOT / selected[bid]['path']) as im:
            sheet.paste(im.convert('RGB').resize((180, 180)), (x, y))
        draw.text((x + 5, y + 184), f'{bid} {selected[bid]["imageId"]}', fill='white')
    sheet.save(RAW / 'contact-sheet.jpg', quality=90)
    build_reference_patches()
    print(json.dumps({'build': summary}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collect', action='store_true')
    parser.add_argument('--max-new', type=int, default=2000, help='Maximum pending building targets in this run; zero processes all pending targets')
    parser.add_argument('--metadata-limit', type=int, default=0, help='Maximum uncovered target metadata lookups in this run')
    parser.add_argument('--improve-cached', action='store_true', help='Also replace usable legacy views with upward aimed views')
    parser.add_argument('--refresh-plan', action='store_true')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--retire-obsolete', action='store_true', help='Move superseded atlas versions out of public after a completed build')
    args = parser.parse_args()
    city = City()
    plan = make_plan(city, args.refresh_plan)
    if args.collect and not args.build_only:
        collect(city, plan, args.max_new, args.metadata_limit, args.improve_cached)
    if not args.skip_build:
        build(city, plan)
    if args.retire_obsolete:
        manifest = json.loads((PUBLIC / 'facades.json').read_text())
        current = {Path(row['url']).name for row in manifest['tiles'].values()}
        retired = RAW / 'retired-atlases'
        retired.mkdir(parents=True, exist_ok=True)
        moved = 0
        for path in (PUBLIC / 'facades').glob('*.webp'):
            if path.name not in current:
                destination = retired / path.name
                if destination.exists():
                    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
                    destination = retired / f'{path.stem}-{digest}.webp'
                path.replace(destination)
                moved += 1
        print(json.dumps({'retiredAtlasVersions': moved, 'currentAtlases': len(current)}), flush=True)


if __name__ == '__main__':
    main()
