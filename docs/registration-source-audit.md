# Registration source audit

Audited `BEIRUT 001.3dm` read-only with the repository's `.venv` `rhino3dm`
module, then checked `.cache/geo_extract`, `data/`, and the registration
scripts. The original Rhino file is a local architectural model. It contains
useful geometry and layer organization, but no trustworthy WGS84 anchor from
which to derive a geographic registration. The externally fitted correction is documented in [registration-correction.md](registration-correction.md).

## What is actually in the 3DM

The 698 MiB Rhino 6 archive loads as archive version 50 in about 11 seconds.
Its document metadata is:

| Field | Value |
| --- | --- |
| Application | Rhinoceros 6; Educational Lab License build 2020-03-19 |
| Created | 2019-12-27 15:23:41 by `Salim` |
| Last edited | 2020-04-06 03:16:28 by `18579` |
| Revision | 17 |
| Model units | Metres |
| Page units | Millimetres |
| Absolute tolerance | 0.001 m |
| Model base point | `(0, 0, 0)` |
| Model URL | Empty |
| Document notes | Empty (`File3dm.ReadNotes()` returns `''`) |
| Embedded files | None |
| Document/user strings | 0 |
| Named views | 0 |

The model bounding box in Rhino coordinates is:

```text
x = -3867.33 .. 3344.00
y = -2669.41 .. 3197.73
z =    -6.95 ..  280.40
```

The six layers and object counts are:

| Layer | Objects and geometry |
| --- | --- |
| `00_TEXT` | 1 Text |
| `01_TOPOGRAPHY` | 14 Mesh, 8 Brep, 5 PolylineCurve |
| `02_RIVER` | 2 Brep |
| `03_BLOCKS` | 1,878 Mesh, 2 Brep |
| `04_TUNNELS AND BRIDGES` | 56 Mesh, 46 Brep, 2 PolylineCurve, 2 PolyCurve |
| `05_BUILDINGS` | 17,536 Brep, 39 Extrusion, 1 Text |

There are 19,592 objects total. Object names are not useful identifiers: 165
objects are named `1`, with no other named-object set found. Groups are generic
(`Group01`, `Group02`, etc.). Only two text objects exist:

- A long project manifesto on `00_TEXT`, located at `(-4027.84, 5112.05, 0)`.
  It calls Beirut 001 a preliminary tool and explicitly asks whether surveyors
  should make it more accurate and share it again. It contains no coordinate,
  CRS, survey-control, or landmark values.
- `HEIGH AND COLOR LAYER` on `05_BUILDINGS`, located at `(2734.1, 1828.09,
  0)`. This is a layer note, not a geographic annotation.

The regular Rhino views are `Perspective`, `Text`, and `Top`; only `Top` is
useful as an orientation clue. Its camera is at `(-695.67, 83.52, 299.50)`
looking toward `(-695.67, 83.52, 0)`, with world Y up in the view. That confirms
the original plan is Rhino X/Y and the original vertical is Rhino Z. It does
not establish which local plan direction is geographic north.

## EarthAnchorPoint and hidden metadata

`Settings.EarthAnchorPoint` exists, but its geographic values are all unset:

```text
EarthBasepointLatitude   0.0
EarthBasepointLongitude  0.0
EarthBasepointElevation  0.0
Name                     ''
Description              ''
ModelBasePoint           (0, 0, 0)
ModelEast                (1, 0, 0)
ModelNorth               (0, 1, 0)
```

`EarthLocationIsSet()` returns `True` despite the zero coordinates, so that
boolean must not be treated as evidence of a location. Calling
`GetModelToEarthTransform(Meters)` returns a valid transform with diagonal
`(8.9831557e-06, 8.9831557e-06, 1, 1)` and no translation or rotation. It is
the local metre-to-degree scale around an unspecified origin, not a Beirut
registration. The compass is the default XY plane.

The render-content XML contains a Studio environment and a sun observer at
latitude `-22.7216`, longitude `-43.4552`, timezone `-5`. Those values belong
to render settings (a Rio-like default), are unrelated to the model, and must
not be used for registration. No RDK material, plug-in data, URL, or embedded
wallpaper supplies geographic control.

## What the cached fit proves

The cache contains extracted feature arrays and several fit scripts, not a
survey-control file:

| Artifact | Shape / role |
| --- | --- |
| `all_verts_xz.npy` | 8,762,663 transformed plan vertices |
| `buildings_verts.npy` | 2,693,582 building plan vertices |
| `water.npy` | 56,553 transformed water vertices |
| `coast_poly.npy` | 115-point model coast proxy |
| `river_cl.npy` | 70-point model river centerline |
| `osm_coast_clean.npy` | 15,798 densified OSM coastline points |
| `osm_river_clean.npy` | 4,421 densified OSM river points |
| `run_fit.py` .. `run_fit4.py` | progressively refined external OSM fits |
| `best_params.npy`, `transform.npy` | identical arrays `[-5.5, 870, -680]` |

`run_fit4.py` is the strongest reproducible fit source. It matches the model
coast proxy and the Nahr Beirut water centerline to cleaned OSM coastline and
river ways using a rigid rotation plus translation and a trimmed nearest-point
cost. It therefore provides a plausible external registration, not original
ground truth. The parameter files have the same SHA-256 and the same
2026-09-16 02:06:49 timestamp. No stdout or residual log was saved, so the
residual numbers quoted by later documentation are reproducible script claims,
not independently archived measurements.

A useful orientation check is present in the data itself. After the runtime
conversion `(Rhino X, Rhino Z, -Rhino Y)`, `river_cl.npy` runs approximately
from `(2807, -1680)` to `(1975, 1080)`: X decreases while runtime Z increases.
The OSM Nahr Beirut ways run from southeast (about 33.84 N, 35.579 E) toward
northwest (about 33.905 N, 35.542 E), also with westward X and northward Z.
This superficially supports the old runtime Z-positive-north interpretation,
but the cached centerline endpoint order is not documented as hydrological
upstream-to-mouth order. It is therefore weaker evidence than a held-out
street fit; do not reject a reflection on this endpoint check alone.

### New diagnostic reflected fit

During this audit, `scripts/audit_registration.py` produced
`.cache/registration-audit/road-fit.json` and the corresponding
`public/data/registration.json`. This is a new diagnostic, separate from the
original coast/river fit. It compares independently downloaded OSM street
samples with rasterized CAD block occupancy, holding out entire OSM ways by
ID modulo 5:

| Metric | Old rigid fit | Reflected similarity candidate |
| --- | ---: | ---: |
| Parameters | `-5.5°, E=870, N=-680, scale=1` | `-0.0343°, E=1259.91, N=-142.65, scale=1.00079, zSign=-1` |
| Held-out samples inside CAD blocks | 67.55% | 21.99% |
| Held-out p90 block penetration | 34.52 m | 4.39 m |
| Diagnostic score | 40.44 | 12.69 |

This strongly favors the reflected candidate for street/block consistency, but
it remains a proxy: `registration.json` correctly reports
`accuracyMeters: null`, because block occupancy does not prove building
centroid or facade accuracy. The candidate should be checked against held-out
building footprints and correctly recropped imagery before being called a
100 m fix.

## Imagery and derived-data independence

The target coordinates in legacy `data/buildings_geo.json` and image manifests were produced by the old transform. Their numerical agreement is not independent validation. Actual panorama camera coordinates and the georeferenced raw satellite tile pixels are separate external evidence.

The satellite diagnostic deliberately holds the image patch fixed and compares different CAD overlays. Choosing a patch centre from the candidate transform only selects an area to inspect; correspondence between its independently located roof pixels and the model outline is the substantive visual check. These spot checks do not produce surveyed error bounds. Tilted/leaning roofs, shadows, model age and a missing tile remain visible limitations.

The accepted runtime mapping now comes from `public/data/registration.json`. The location builder no longer hardcodes the old parameters. Corrected targets are written separately under `data/registration-v2/`; legacy imagery and sidecars remain unchanged.

## Reproduction warning

The cached `data/buildings_geo.json` artifact is numerically sound: all 17,575
entries have centers matching `public/data/buildings.json` within 0.0071 m.
However, both `.cache/geo_extract/finalize.py` and `finalize2.py` contain a
latent center-indexing expression that adds `[minX,maxX]` to `[minZ,maxZ]`
instead of averaging X and Z columns separately. Do not regenerate
`buildings_geo.json` from those scripts until that expression is corrected.
This audit does not claim the existing artifact was produced with the bad
expression; its values are verified correct.

## Conclusion

The original 3DM has no usable survey anchor. Existing street geometry and satellite pixels nevertheless support a corrected reflected transform, with substantially better held-out street/block consistency. A missing north–south reflection was the major error; facade-level camera and image calibration still require separate validation.
