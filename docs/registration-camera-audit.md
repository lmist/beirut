# Registration and Street View camera audit

This audit is based only on existing local metadata, cached registration inputs,
and collection code. It did not make network requests or change the game.

## Registration correction

The original registration used a right-handed `+Z → north` assumption. That
was wrong for the browser frame, which converts Rhino coordinates as
`(X, Y, Z) → (X, Z, -Y)`. The accepted registration reflects the model's Z
axis before rotation: `EN = scale × R(angle) × [X, -Z] + translation`.

The old `buildings_geo.json` coordinates and Street View targets were derived
from the superseded transform and can be kilometres from the corrected model
location. Actual `pano_lat`/`pano_lon` values remain valid camera coordinates,
but an image filename must no longer be presumed to identify the same model
building after reassociation.

## What is in the Street View cache

| Item | Count | Result |
| --- | ---: | --- |
| Model buildings | 17,575 | `data/buildings_geo.json` has one transform-derived target per building. |
| Street View JPEGs | 12,444 | Every file is a valid 640 × 640 JPEG. |
| Street View sidecars | 12,444 | Every JPEG has a matching `{id}.json` sidecar. |
| No-panorama targets | 5,131 | `none.json` records the target only; it has no camera or panorama ID. |
| Unique panoramas | 7,674 | 2,346 panoramas serve more than one building; the largest reuse is 42 buildings. |

Each image sidecar contains these fields:

```json
{
  "id": 0,
  "pano_id": "…",
  "pano_lat": 33.0,
  "pano_lon": 35.0,
  "heading": 0.0,
  "date": "YYYY-MM",
  "lat": 33.0,
  "lon": 35.0
}
```

The meanings matter:

- `pano_lat` and `pano_lon` are the actual panorama camera position returned
  by Street View. They remain useful after a model refit.
- `pano_id` identifies that same source panorama and is the key for grouping
  or later rendering a revised view.
- `heading` is the bearing computed from that panorama toward the **old**
  target coordinate.
- `lat` and `lon` are the coordinate sent to Street View when the image was
  collected. They exactly match the same building ID in the **legacy**
  `buildings_geo.json`; they are not a separate measurement of the building
  location.

The collector used a fixed 640 × 640 request, `pitch=-5`, and `fov=90`. Those
settings are present in `scripts/streetview_fetch.py`, but pitch and field of
view were not copied into each sidecar. The all-JPEG, all-640 × 640 audit is
consistent with that implementation, but cannot prove that every file was
made with identical parameters.

## Camera-position quality checks

Distance below means the distance between the old target and the saved actual
panorama position. It is a collection association check, not a registration
residual.

| Measure | Metres |
| --- | ---: |
| Median | 19.3 |
| 90th percentile | 50.3 |
| 95th percentile | 57.8 |
| 99th percentile | 96.1 |
| Over 60 m | 474 images |
| Over 100 m | 112 images |
| Over 1 km | 22 images |

Six entries share one panorama outside a generous Beirut envelope and should
be excluded from automatic reuse. In total, 22 images have an old-target to
camera distance above 1 km. The current cache therefore does not fully obey
the collector's nominal 60 m radius and needs distance-based filtering before
any reassociation.

## Can the alignment be improved without collecting images again?

Yes for the map-to-camera association. The cached camera coordinates and
panorama IDs allow the corrected geographic transform to be applied to every
model building, then compared against the *actual* saved panorama positions
without another metadata lookup.

After a new transform is accepted:

1. Convert each model building centroid to its revised WGS84 coordinate.
2. Group the existing sidecars by their 7,674 panorama IDs and spatially index
   the saved `pano_lat`/`pano_lon` points.
3. Exclude the 22 over-1-km old associations and apply a conservative new
   camera-distance cutoff appropriate to the feature being matched.
4. For each candidate image, recompute the bearing from its saved camera to
   the revised building position. Compare it with the stored heading to tell
   whether its pixels still face the same facade direction.

This can re-associate the existing imagery and identify good candidates with
no new request. It cannot rotate an already-downloaded 640 × 640 image. If the
corrected building selects a different camera or materially changes the desired
bearing, the saved `pano_id` is enough to request a corrected view later
without another panorama-metadata lookup, but that would still create a new
static image request. Targets in `none.json` have no saved panorama candidate,
so they would need a fresh metadata lookup after refitting.

### Corrected-transform reuse coverage

The reproducible `scripts/reassociate_imagery.py` scan excludes the 22 implausible old associations. Of 17,575 buildings, 10,125 have a retained camera within 60 m. Within that distance, 5,401 have a saved frame aimed within 15° of the corrected building bearing; 8,004 have one within 40°. Allowing an 80 m camera distance and a 40° bearing difference yields 9,586 buildings with at least one candidate.

These figures count actual saved frames, not every heading ever associated with an unfiltered panorama. They indicate possible pixel reuse only; occlusion, camera height, and facade coverage remain unchecked. Full output is under `data/registration-v2/`.

## What the previous 75 m and 104 m values mean

The retained old registration result was a rigid local-meter to WGS84 fit with
angle −5.50°, easting translation +870 m, northing translation −680 m, and
anchor 33.888°N, 35.495°E. Both cached parameter arrays retain those values,
but the transform is superseded because it omitted the required reflection.

The captured registration note reports roughly 75 m median coastline residual
and 104 m river residual. They are nearest-feature residuals between the
model's extracted coast/river features and cached OSM coast/river geometry.
They are **not** per-building validation errors, Street View camera errors, or
an assertion that every photograph is displaced by 75–104 m.

The existing cache contains fitting code and source arrays, but no persisted
fit run log or independent building-control-point residual table. In
particular, `buildings_geo.json` is generated from the same superseded
transform later used by the Street View target requests. It can verify legacy
transform serialization, but it cannot independently validate the corrected
transform.
