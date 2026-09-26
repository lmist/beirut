#!/usr/bin/env python3
"""Prepare full-resolution real Bliss Street references from the existing cache.

No requests are made and no synthetic pixels are generated. Street-side identity
and architectural observations are explicitly separated from geometric camera
candidates. Re-run after editing data/bliss-street/imagery-review-*.json.

  .cache/registration-venv/bin/python scripts/prepare_bliss_photos.py
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from prepare_facade_textures import City, angular_difference, completed_request_matches

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/bliss-street"
PUBLIC = ROOT / "public/assets/world/bliss"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def cached_sources(plan):
    sources = {}
    assigned = {}
    for row in plan["records"]:
        bid = row["buildingId"]
        for kind in ("cached", "desired"):
            photo = row.get(kind)
            if not photo or not (ROOT / photo["path"]).exists():
                continue
            if kind == "desired" and not completed_request_matches(bid, photo):
                continue
            sources[photo["imageId"]] = photo
            assigned[bid] = photo["imageId"]
    collection_path = DATA / "imagery-collection.json"
    if collection_path.exists():
        collection = json.loads(collection_path.read_text())
        for sid, source in collection.get("sources", {}).items():
            if (ROOT / source["path"]).exists():
                sources[sid] = source
        for bid, row in collection.get("buildings", {}).items():
            if row.get("sourceId") in sources:
                assigned[int(bid)] = row["sourceId"]
    return sources, assigned


def candidates_for(city, bid, sources):
    centre, b = city.centres[bid], city.buildings[bid]
    ranked = []
    for sid, source in sources.items():
        camera = np.array(source["camera"])
        delta = centre - camera[::2]
        distance = float(np.linalg.norm(delta))
        if not 5 < distance < 90:
            continue
        heading_error = angular_difference(city.heading(delta), source["headingDeg"])
        if heading_error > min(38, source["fovDeg"] * .42):
            continue
        midpoint = (max(b[4], city.ground[bid]) + b[5]) / 2
        target_pitch = math.degrees(math.atan2(midpoint - camera[1], distance))
        pitch_error = abs(target_pitch - source["pitchDeg"])
        if pitch_error > source["fovDeg"] * .43:
            continue
        visible = city.sight(bid, camera) is not None
        score = heading_error / 60 + distance / 150 + pitch_error / 60 + (0 if visible else .5)
        ranked.append((score, {
            "sourceId": sid,
            "distanceMetres": round(distance, 2),
            "headingErrorDeg": round(heading_error, 1),
            "pitchErrorDeg": round(pitch_error, 1),
            "proxyVisibility": visible,
            "status": "geometric-candidate-not-identity-verification",
        }))
    ranked.sort(key=lambda item: item[0])
    result, panoramas = [], set()
    for _, row in ranked:
        pano = sources[row["sourceId"]]["panoId"]
        if pano in panoramas:
            continue
        panoramas.add(pano)
        result.append(row)
        if len(result) == 3:
            break
    return result


def write_photo(source):
    """Preserve the complete frame and field of view at its original resolution."""
    digest = hashlib.sha256((ROOT / source["path"]).read_bytes()).hexdigest()[:10]
    filename = f'{source["imageId"]}-{digest}.webp'
    path = PUBLIC / "photos" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with Image.open(ROOT / source["path"]) as im:
            im.convert("RGB").save(path, "WEBP", quality=92, method=6)
    with Image.open(path) as im:
        width, height = im.size
    return {**source, "url": f"/assets/world/bliss/photos/{filename}",
            "width": width, "height": height, "sha256Original": hashlib.sha256(
                (ROOT / source["path"]).read_bytes()).hexdigest(),
            "cameraHeightMethod": "estimated from nearest modeled ground +2.5m",
            "identityStatus": "geometric candidate unless specifically reviewed"}


def load_reviews():
    saved = PUBLIC / "reviews.json"
    reviews, histories = {}, {}

    def add(bid, review):
        # A road-facing tree/wall photograph must not erase an informative
        # older side view. Keep observations tied to their own source frames.
        for alternate in review.get("alternateReviews", []):
            add(bid, alternate)
        clean = {key: value for key, value in review.items() if key != "alternateReviews"}
        source_key = tuple(clean.get("review", {}).get("sourceIds", []))
        histories.setdefault(bid, {})[source_key] = clean
        reviews[bid] = clean

    if saved.exists():
        for bid, review in json.loads(saved.read_text()).get("buildings", {}).items():
            add(bid, review)
    for path in sorted(DATA.glob("imagery-review-*.json")):
        body = json.loads(path.read_text())
        for bid, review in body.get("buildings", body).items():
            add(bid, review)
    for bid, review in list(reviews.items()):
        primary = tuple(review.get("review", {}).get("sourceIds", []))
        reviews[bid] = {**review, "alternateReviews": [row for key, row in histories[bid].items() if key != primary]}
    return reviews


def write_crop(bid, review, source):
    crop = review.get("crop")
    if not crop:
        return None
    x, y, w, h = crop
    if min(w, h) < 8:
        raise ValueError(f"Building {bid}: crop too small")
    with Image.open(ROOT / source["path"]) as image:
        if min(x, y) < 0 or x + w > image.width or y + h > image.height:
            raise ValueError(f"Building {bid}: crop outside image")
        cropped = image.convert("RGB").crop((x, y, x + w, y + h))
        digest = hashlib.sha256(cropped.tobytes()).hexdigest()[:10]
        filename = f"{bid}-{digest}.webp"
        path = PUBLIC / "materials" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(path, "WEBP", quality=95, method=6)
    return {"url": f"/assets/world/bliss/materials/{filename}",
            "sourceId": source["imageId"], "sourcePixelRect": crop,
            "width": w, "height": h,
            "rectification": "none; observed material sample, not a surveyed whole facade",
            "use": "material-reference"}


def contact_sheets(buildings, sources):
    sheets = []
    ordered = sorted(buildings.items(), key=lambda item: item[1].get("station", 0))
    for start in range(0, len(ordered), 16):
        batch = ordered[start:start + 16]
        sheet = Image.new("RGB", (1680, math.ceil(len(batch) / 4) * 466), "#171717")
        draw = ImageDraw.Draw(sheet)
        for index, (bid, row) in enumerate(batch):
            x, y = index % 4 * 420, index // 4 * 466
            source = sources.get(row.get("sourceId"))
            if source:
                with Image.open(ROOT / source["path"]) as im:
                    sheet.paste(im.convert("RGB").resize((416, 416)), (x, y))
            else:
                draw.text((x + 20, y + 190), "NO VERIFIED SAVED FRAME", fill="#bbbbbb")
            draw.text((x + 5, y + 420),
                      f"id={bid} station={row.get('station', 0):.0f}m {row.get('side', '')}", fill="white")
            draw.text((x + 5, y + 438),
                      f"{row.get('sourceId') or 'none'} | {row['review']['status']}", fill="white")
        filename = f"imagery-corridor-{start // 16 + 1:02}.jpg"
        sheet.save(DATA / filename, quality=92)
        sheets.append(str((DATA / filename).relative_to(ROOT)))
    return sheets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corridor", default="public/data/bliss-street.json")
    parser.add_argument("--skip-candidates", action="store_true")
    args = parser.parse_args()
    corridor = json.loads((ROOT / args.corridor).read_text())
    city = City()
    plan = json.loads((ROOT / "data/photographic/facades/plan.json").read_text())
    if plan["registration"] != city.registration:
        raise ValueError("Photo plan uses a superseded geographic registration")
    sources, assigned = cached_sources(plan)
    reviews = load_reviews()
    buildings, used_sources = {}, set()
    for target in corridor["buildings"]:
        bid = int(target["id"])
        review = reviews.get(str(bid), {})
        source_id = review.get("sourceId", assigned.get(bid))
        candidates = [] if args.skip_candidates else candidates_for(city, bid, sources)
        if source_id:
            used_sources.add(source_id)
        used_sources.update(c["sourceId"] for c in candidates)
        used_sources.update(sid for sid in review.get("review", {}).get("sourceIds", []) if sid in sources)
        for alternate in review.get("alternateReviews", []):
            used_sources.update(sid for sid in alternate.get("review", {}).get("sourceIds", []) if sid in sources)
        row = {"id": bid, "station": target.get("station", 0), "side": target.get("side"),
               "sourceId": source_id, "candidates": candidates,
               "review": review.get("review", {"status": "unreviewed" if source_id else "uncovered",
                   "confidence": "low", "sourceIds": [source_id] if source_id else [],
                   "notes": "No visual observation recorded. Do not infer architecture from a nearby building."}),
               "style": review.get("style", {}), "observed": review.get("observed", {}),
               "architecture": review.get("architecture", {}),
               "alternateReviews": review.get("alternateReviews", [])}
        if source_id and review.get("crop"):
            crop_source = review.get("cropSourceId") or next(iter(
                review.get("review", {}).get("sourceIds", [])), source_id)
            if crop_source not in sources:
                raise ValueError(f"Building {bid}: unknown material crop source {crop_source}")
            row["texture"] = write_crop(bid, review, sources[crop_source])
        buildings[str(bid)] = row
    published = {sid: write_photo(sources[sid]) for sid in sorted(used_sources)}
    for row in buildings.values():
        if row["sourceId"]:
            row["photo"] = published[row["sourceId"]]
    statuses = Counter(row["review"]["status"] for row in buildings.values())
    def has_layout(row):
        architecture = row.get("architecture", {})
        return bool(architecture.get("floorsObserved") and architecture.get("baysObserved"))

    summary = {"buildings": len(buildings),
               "assignedSourcePhotos": sum(bool(row["sourceId"]) for row in buildings.values()),
               "withCameraCandidates": sum(bool(row["candidates"]) for row in buildings.values()),
               "publishedSources": len(published), "reviewStatuses": dict(statuses),
               "primaryLayoutBuildings": sum(has_layout(row) for row in buildings.values()),
               "anyViewLayoutBuildings": sum(any(has_layout(view) for view in [row] + row.get("alternateReviews", []))
                                                for row in buildings.values()),
               "noSourceBuildingIds": [row["id"] for row in buildings.values() if not row["sourceId"]],
               "sourceResolution": "640x640 original frames, no AI generation or upscaling",
               "newRequests": json.loads((DATA / "imagery-collection.json").read_text()).get(
                   "summary", {}).get("requests", 0) if (DATA / "imagery-collection.json").exists() else 0}
    body = {"version": 1, "provider": "Google Street View", "attribution": "© Google",
            "registration": city.registration, "summary": summary,
            "limitations": ["Original frames date from their recorded capture dates.",
                "Camera ground elevation is estimated, and a geometric candidate is not verified building identity.",
                "Occluded surfaces and unobserved details are not reconstructed from these records."],
            "sources": published, "buildings": buildings}
    PUBLIC.mkdir(parents=True, exist_ok=True)
    write_json(PUBLIC / "reviews.json", {"version": 1,
        "method": "Human-readable observations recorded after visual inspection of the listed actual photographs; dimensions and identity confidence remain explicitly qualified.",
        "buildings": reviews})
    write_json(PUBLIC / "facades.json", body)
    write_json(DATA / "imagery-manifest.json", body)
    sheets = contact_sheets(buildings, sources)
    write_json(DATA / "imagery-summary.json", {**summary, "contactSheets": sheets})
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
