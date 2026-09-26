#!/usr/bin/env python3
"""Rectify inspected Beirut photographs; no generated pixels or network calls.

Widths and floor heights are architectural estimates, not surveyed dimensions.
These reusable materials do not establish the identity of unobserved buildings.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/assets/world/photographic'
# Clockwise corners: top-left, top-right, bottom-right, bottom-left.
# Multiple floors stay together instead of repeating a tiny window/shadow crop.
PATCHES = [
    ('legacy-9355', 'terracotta-balconies', [(363,49),(492,48),(486,203),(360,205)], 7.2, 3),
    ('legacy-9355', 'blue-glass-balconies', [(270,40),(352,38),(348,183),(264,188)], 4.8, 3),
    ('legacy-9325', 'aged-stone-window', [(145,75),(265,77),(264,214),(140,212)], 3.8, 1),
    ('legacy-9355', 'planted-apartment-balconies', [(364,98),(490,96),(485,200),(360,203)], 7.2, 2),
    ('legacy-7322', 'ochre-apartment-windows', [(39,12),(289,0),(290,227),(57,251)], 8.0, 2),
    ('legacy-7322', 'barred-balcony', [(346,188),(619,149),(620,302),(344,325)], 8.4, 1),
    ('legacy-15854', 'office-concrete-grid', [(318,96),(424,137),(422,231),(318,216)], 12.0, 4),
    ('legacy-15555', 'white-balcony-bands', [(6,110),(85,120),(84,226),(7,227)], 10.0, 4),
    ('corrected-1025', 'hamra-paired-windows', [(310,137),(438,137),(451,314),(306,320)], 7.0, 3),
    ('corrected-849', 'hamra-red-balconies', [(435,48),(492,75),(490,245),(435,240)], 5.8, 3),
    ('legacy-10147', 'cream-shutter', [(94,0),(216,28),(216,117),(93,83)], 3.2, 1),
    ('legacy-9325', 'weathered-plaster', [(158,36),(251,38),(251,75),(156,73)], 3.6, 1),
    ('legacy-10147', 'cream-ground-shutter', [(94,0),(216,28),(216,94),(93,62)], 3.2, 1),
    ('legacy-15555', 'dark-glass-shopfront', [(497,202),(552,187),(549,313),(497,310)], 2.4, 1),
    ('legacy-10147', 'cream-ground-shutter', [(94,0),(216,28),(216,117),(93,83)], 3.2, 1),
    ('legacy-7322', 'barred-ground-window', [(346,188),(619,149),(620,302),(344,325)], 8.4, 1),
]


def source_path(image_id):
    family, number = image_id.split('-')
    return ROOT / (f'data/buildings/streetview/{number}.jpg' if family == 'legacy' else f'data/photographic/facades/images/{number}.jpg')


def perspective_coefficients(quad, size):
    # Inverse homography: each destination pixel maps into the original photo.
    matrix, values = [], []
    for (x,y), (u,v) in zip([(0,0),(size,0),(size,size),(0,size)], quad):
        matrix.extend([[x,y,1,0,0,0,-u*x,-u*y], [0,0,0,x,y,1,-v*x,-v*y]])
        values.extend([u,v])
    return np.linalg.solve(np.asarray(matrix), np.asarray(values))


def build_reference_patches():
    size, gutter, count = 256, 4, 4
    stride = size + 2*gutter
    atlas = Image.new('RGB', (count*stride,count*stride))
    rows = []
    for i, (image_id,name,quad,width,floors) in enumerate(PATCHES):
        path = source_path(image_id)
        with Image.open(path) as source:
            patch = source.convert('RGB').transform((size,size), Image.Transform.PERSPECTIVE,
                perspective_coefficients(quad,size), Image.Resampling.BICUBIC)
        padded = Image.fromarray(np.pad(np.asarray(patch), ((gutter,gutter),(gutter,gutter),(0,0)), mode='edge'))
        x,y = i%count*stride,i//count*stride
        atlas.paste(padded,(x,y))
        rows.append({'name':name,'imageId':image_id,'sourcePath':str(path.relative_to(ROOT)),
            'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(), 'sourceCorners':quad,
            'widthMeters':width,'heightMeters':floors*3.2,'floors':floors,'kind':'wall' if i<12 else 'ground',
            'rect':[(x+gutter)/atlas.width,(y+gutter)/atlas.height,size/atlas.width,size/atlas.height]})
    PUBLIC.mkdir(parents=True,exist_ok=True)
    atlas.save(PUBLIC/'facade-materials.webp',quality=94,method=6)
    manifest={'version':2,'url':'/assets/world/photographic/facade-materials.webp',
        'width':atlas.width,'height':atlas.height,'tileSize':size,'uvOrigin':'top-left','attribution':'© Google',
        'processing':'Perspective rectification and resampling of existing Beirut Street View photographs; no synthesis.',
        'purpose':'Reusable photographed Beirut materials; not location-specific matches for unobserved walls.',
        'dimensionStatus':'Estimated architectural scale, not surveyed.', 'patches':rows}
    (PUBLIC/'facade-materials.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    return manifest


if __name__ == '__main__':
    print(json.dumps({'patches':len(build_reference_patches()['patches'])}))
