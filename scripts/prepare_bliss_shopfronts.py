#!/usr/bin/env python3
"""Rectify inspected Bliss Street signs and attach them to existing CAD fronts.

Uses only original, already-collected photographs. No network, image generation,
inpainting or stock branding. Run again after preparing bliss-architecture.json:
  .cache/registration-venv/bin/python scripts/prepare_bliss_shopfronts.py

Corner order is top-left, top-right, bottom-right, bottom-left in source pixels.
Physical dimensions are estimates. Camera registration is useful for horizontal
placement, but cannot establish surveyed sign dimensions or ground elevation.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/world/bliss/shopfronts"

# Hand-inspected source pixels. No cars, people, foliage or sky are inside these
# signs. Multi-plane 640 is one shallow curved CAD frontage, not separate shops.
SIGNS = [
    dict(id="mcdonalds", name="McDonald's", buildingId=839, sourceId="bliss-839",
         corners=[[0,368],[531,363],[532,429],[0,435]], baseOffset=2.85,
         height=1.25, depth=.28, maxWidthRatio=.96, alpha="mcdonalds-fascia-and-arches",
         storefront=dict(height=2.75, bays=3, pierColor="#795944")),
    dict(id="dunkin", name="Dunkin'", buildingId=640, sourceId="bliss-640",
         corners=[[62,374],[271,383],[269,434],[52,431]], baseOffset=2.75,
         height=1.15, depth=.28, frontNormalTolerance=.95,
         storefront=dict(height=2.65, bays=2, pierColor="#7b7067")),
    dict(id="le-sam-upper", name="Le Sam", buildingId=640, sourceId="bliss-640",
         corners=[[519,353],[585,364],[590,405],[520,398]], baseOffset=3.65,
         height=1.55, depth=.12, frontNormalTolerance=.95),
    dict(id="le-sam-canopy", name="Le Sam canopy fascia", buildingId=640, sourceId="bliss-640",
         corners=[[277,383],[622,412],[624,437],[276,407]], baseOffset=2.80,
         height=.52, depth=.60, frontNormalTolerance=.95,
         storefront=dict(height=2.70, bays=4, pierColor="#8f9694")),
    dict(id="bubbles", name="Bubbles", buildingId=359, sourceId="bliss-359",
         corners=[[166,337],[453,324],[456,355],[160,368]], baseOffset=2.80,
         height=1.1, depth=.28, maxWidthRatio=.94,
         storefront=dict(height=2.70, bays=3, pierColor="#afa575")),
    dict(id="bliss-one", name="Bliss One", buildingId=360, sourceId="bliss-360",
         corners=[[239,294],[341,292],[342,320],[239,323]], baseOffset=2.70,
         height=1.35, depth=.30,
         storefront=dict(height=2.60, bays=2, pierColor="#5a5655")),
    dict(id="mini-malik", name="Mini Malik", buildingId=360, sourceId="bliss-360",
         corners=[[347,286],[489,281],[490,344],[345,345]], baseOffset=1.70,
         height=3.00, depth=.25),
    dict(id="bliss-suite-hotel", name="Bliss Suite Hotel", buildingId=17, sourceId="bliss-17",
         corners=[[109,301],[340,331],[338,350],[103,320]], baseOffset=5.45,
         height=1.05, depth=.25, maxWidthRatio=.82),
    dict(id="zaatar-w-zeit", name="Zaatar w Zeit — photographed logo and Arabic sign", buildingId=1669,
         sourceId="bliss-1669", corners=[[70,466],[194,491],[191,526],[67,501]],
         baseOffset=2.80, height=1.00, depth=.30,
         notes="Only the fully visible logo/Arabic portion is cropped; the English name leaves the original frame."),
]


def camera_basis(source, registration):
    heading, pitch, angle = map(math.radians, [source["headingDeg"], source["pitchDeg"], registration["angleDeg"]])
    east, north = math.sin(heading), math.cos(heading)
    x = east * math.cos(angle) + north * math.sin(angle)
    z = (-east * math.sin(angle) + north * math.cos(angle)) / registration["zSign"]
    return (np.array(source["camera"]), np.array([-z, 0, x]),
            np.array([x*math.cos(pitch), math.sin(pitch), z*math.cos(pitch)]),
            np.array([-x*math.sin(pitch), math.cos(pitch), -z*math.sin(pitch)]),
            math.tan(math.radians(source["fovDeg"] / 2)))


def project_to_face(pixel, source, registration, face):
    camera, right, forward, up, tangent = camera_basis(source, registration)
    ray = forward + (pixel[0] / 320 - 1) * tangent * right + (1 - pixel[1] / 320) * tangent * up
    normal = np.array([face["normal"][0], 0, face["normal"][1]])
    point = np.array([face["center"][0], face["base"], face["center"][1]])
    distance = np.dot(point - camera, normal) / np.dot(ray, normal)
    if not math.isfinite(distance) or distance <= 0:
        raise ValueError(f"Sign is behind its source camera: {source['imageId']}")
    return camera + ray * distance


def perspective_coefficients(corners, width, height):
    # PIL needs output -> source, so solve that homography directly.
    output = [[0,0],[width,0],[width,height],[0,height]]
    matrix, values = [], []
    for (x,y), (u,v) in zip(output, corners):
        matrix += [[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]
        values += [u,v]
    return np.linalg.solve(np.array(matrix), np.array(values)).tolist()


def crop_sign(spec, source):
    original = ROOT / source["path"]
    image = Image.open(original).convert("RGBA")
    if spec.get("alpha"):
        # Keep the photographed metal fascia and yellow arches. Outside the
        # fascia, a narrow colour mask preserves only the actual yellow pixels;
        # windows behind the freestanding arches remain transparent.
        mask = Image.new("L", image.size)
        ImageDraw.Draw(mask).polygon([(0,400),(530,395),(532,427),(0,434)], fill=255)
        pixels = np.asarray(image)
        alpha = np.array(mask)
        yy, xx = np.indices(alpha.shape)
        yellow = ((xx >= 322) & (xx <= 386) & (yy >= 368) & (yy <= 426) &
                  (pixels[:,:,0] > 95) & (pixels[:,:,1] > 85) &
                  (pixels[:,:,2] < pixels[:,:,1] * .72))
        alpha[yellow] = 255
        image.putalpha(Image.fromarray(alpha))
    c = np.array(spec["corners"])
    # Never upscale beyond the largest native photographed edge.
    width = max(8, round(max(np.linalg.norm(c[1]-c[0]), np.linalg.norm(c[2]-c[3]))))
    height = max(8, round(max(np.linalg.norm(c[3]-c[0]), np.linalg.norm(c[2]-c[1]))))
    image = image.transform((width,height), Image.Transform.PERSPECTIVE,
                            perspective_coefficients(c, width, height), Image.Resampling.BICUBIC)
    path = OUT / f"{spec['id']}.webp"
    image.save(path, "WEBP", lossless=True, method=6)
    return dict(textureUrl=f"/assets/world/bliss/shopfronts/{path.name}",
                sourceSha256=hashlib.sha256(original.read_bytes()).hexdigest(),
                textureWidth=width, textureHeight=height, transparent=bool(spec.get("alpha")))


def mounts(spec, source, building, registration):
    target = np.array(source["targetFacadeCenter"])
    # Heritage replacement bodies preserve their original mounting planes here;
    # the generic renderer's facades list is intentionally empty for those IDs.
    source_faces = building.get("sourceFacades") or building["facades"]
    anchor = min(source_faces, key=lambda f: np.linalg.norm(np.array(f["center"]) - target))
    n = np.array(anchor["normal"])
    # This is the visible left->right direction of an outward-facing sign.
    right = np.array([n[1], -n[0]])
    center = np.array(anchor["center"])
    corners = np.array(spec["corners"])
    source_left = (corners[0] + corners[3]) / 2
    source_right = (corners[1] + corners[2]) / 2
    hits = [project_to_face(pixel, source, registration, anchor)[[0,2]] for pixel in [source_left,source_right]]
    values = [float(np.dot(hit-center, right)) for hit in hits]
    x, width = sum(values)/2, abs(values[1]-values[0])
    faces = [f for f in source_faces if np.dot(f["normal"], n) >= spec.get("frontNormalTolerance", .995)]
    spans = []
    for face in faces:
        fc = np.array(face["center"])
        fr = np.array([face["normal"][1], -face["normal"][0]])
        ends = [fc-fr*face["width"]/2, fc+fr*face["width"]/2]
        lo, hi = sorted(float(np.dot(end-center,right)) for end in ends)
        spans.append((lo,hi,face))
    low = min(item[0] for item in spans); high = max(item[1] for item in spans)
    original_width = width
    width = min(width, (high-low)*spec.get("maxWidthRatio", .96))
    x = min(high-width/2-.015, max(low+width/2+.015, x))
    left, right_edge = x-width/2, x+width/2
    # Some CAD triangle loops overlap; split all endpoints and select the
    # street-most source plane at each interval rather than doubling textures.
    edges = sorted({left,right_edge,*[max(left,min(right_edge,p)) for lo,hi,_ in spans for p in [lo,hi]]})
    result = []
    for lo,hi in zip(edges, edges[1:]):
        if hi-lo < .025: continue
        middle = (lo+hi)/2
        possible = [f for a,b,f in spans if a-1e-4 <= middle <= b+1e-4]
        if not possible: continue
        face = max(possible, key=lambda f: np.dot(np.array(f["center"])-center,n))
        fn = np.array(face["normal"]); fr = np.array([fn[1],-fn[0]])
        # Intersect the anchor-front coordinates with this exact CAD wall plane.
        point = center + right*middle
        point += n * (np.dot(np.array(face["center"])-point,fn) / np.dot(n,fn))
        segment_width = (hi-lo) / abs(np.dot(fr,right))
        result.append(dict(faceId=face["id"], center=np.round(point,6).tolist(),
                           normal=face["normal"], tangent=face["tangent"], base=face["base"],
                           width=round(segment_width,5), height=spec["height"],
                           uv=[round((lo-left)/width,6),round((hi-left)/width,6)],
                           facadeWidth=face["width"]))
    if not result: raise ValueError(f"No CAD wall supports {spec['id']}")
    return anchor, result, width, original_width


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = json.loads((ROOT / "public/assets/world/bliss/facades.json").read_text())
    architecture = json.loads((ROOT / "public/data/bliss-architecture.json").read_text())
    buildings = {b["id"]:b for b in architecture["buildings"]}
    records = []
    for spec in SIGNS:
        source = sources["sources"][spec["sourceId"]]
        building = buildings[spec["buildingId"]]
        anchor, planes, width, native_width = mounts(spec, source, building, sources["registration"])
        record = dict(id=spec["id"], name=spec["name"], buildingId=spec["buildingId"],
                      sourceId=spec["sourceId"], sourcePath=source["path"], sourceUrl=source["url"],
                      sourceCorners=spec["corners"], sourceCaptureDate=source.get("date"),
                      sourcePanoramaId=source["panoId"], copyright=source.get("copyright", "© Google"),
                      faceId=anchor["id"], targetFacadeCenter=source["targetFacadeCenter"],
                      width=round(width,5), height=spec["height"], physicalAspectRatio=round(width/spec["height"],4),
                      widthRatio=round(width/anchor["width"],5),
                      heightRatio=round(spec["height"]/(anchor["top"]-anchor["base"]),5),
                      baseOffset=spec["baseOffset"], depth=spec["depth"], mounts=planes,
                      dimensionsEstimated=True, geometryConfidence="approximate-photo-to-CAD-fit",
                      dimensionBasis="Horizontal camera rays fitted/clipped to existing CAD frontage; height and distance above local facade ground estimated from photographed retail floors.",
                      projectedWidthBeforeClipping=round(native_width,5),
                      notes=spec.get("notes", "Photographic fascia only. Unobserved shop interiors are not reconstructed."),
                      **crop_sign(spec, source))
        if spec.get("storefront"): record["storefront"] = {**spec["storefront"], "estimated":True}
        records.append(record)
    payload = dict(version=1, name="Inspected Bliss Street shopfront signs", registrationVersion=sources["registration"]["version"],
                   attribution="Street imagery © Google; recorded capture dates are retained per sign.",
                   method="Manually traced source-photo quadrilaterals, perspective rectification, and CAD-mounted fascia geometry. No generated image content.",
                   limitations=["Sign identity is visually observed; exact dimensions and source-to-CAD registration are approximate.",
                                "Only legible unobstructed fascias are published. No shops are inferred on residential or unseen frontages.",
                                "Small dark shop bays below selected signs are geometric placeholders based on visible glazing, not photographed interiors."],
                   summary=dict(signs=len(records), businesses=8, buildings=len({r["buildingId"] for r in records}),
                                sourcePhotos=len({r["sourceId"] for r in records}), cadMountSegments=sum(len(r["mounts"]) for r in records)),
                   signs=records)
    (ROOT / "public/data/bliss-shopfronts.json").write_text(json.dumps(payload,indent=2,allow_nan=False)+"\n")
    sheet = Image.new("RGB", (720, len(records)*112), "#252729")
    draw = ImageDraw.Draw(sheet)
    for index, record in enumerate(records):
        image = Image.open(ROOT / "public" / record["textureUrl"].lstrip("/"))
        image.thumbnail((600,78))
        sheet.paste(image,(8,index*112+25),image if image.mode=="RGBA" else None)
        draw.text((8,index*112+6),f"{record['name']} / {record['sourceId']} / original photo crop",fill="#eeeeee")
    sheet.save(OUT / "review-sheet.jpg",quality=93)
    print(json.dumps(payload["summary"]))


if __name__ == "__main__": main()
