# Bliss Street reconstruction

The game includes the whole named Bliss Street centerline: **1,395.104 m**, six connected OpenStreetMap ways, including the western bend. The corridor survey records **102 modeled frontage buildings** on both sides. This is a geometry-based frontage selection, not a cadastral survey.

## Visit

Choose **Walk Bliss Street** on the opening screen. Display settings provide four arrival points—eastern end, AUB Main Gate, middle blocks and western bend—and street-level or elevated viewing. Direct entry: `/?street=bliss&section=gate`; use `section=east`, `middle` or `west`, with optional `&view=overlook`.

## Physical architecture

Street-facing CAD triangles are grouped into real wall planes and traced into polygons, including concave boundaries and disconnected pieces. Facade bases are sampled against the road and sidewalk terrain. Reviewed window openings are cut into a shallow wall shell, with recessed glazing, frames, sills, balcony slabs and rails, storefronts, floor bands and curtain-wall grids. Photo evidence controls the selected features; there is no randomly assigned architectural style.

The implemented detailed layer covers **27 existing source buildings plus five complete building replacements**. The remaining corridor buildings retain photographic fallback or have insufficient usable evidence. This is not a claim that all 102 buildings have been rebuilt in detail.

AUB's Main Gate has a modeled horseshoe passage, stone courses, ironwork, towers and roof. A **620.43 m** campus boundary follows the mapped outline and terrain. Assembly Hall and Daouk Mosque replace the old CAD masses using named OSM footprints and photographic references. The historic shop row, Dunkin/Le Sam corner and Bubbles frontage have separate replacement geometry fitted to their retained footprints. The gabled row and adjacent modern tower are separate masses within the old combined CAD object.

Nine rectified photographic signs represent eight visible businesses. Signs keep their actual photo pixels and documented mounting estimates. Sixty-two campus trees include one mapped trunk and 61 explicitly approximate, photograph-supported canopy placements. Walls, gate piers, replacement buildings and tree trunks have fixed collision bodies; the Main Gate passage remains open.

## Evidence and limits

The pass collected **97 new 640×640 Street View photographs**, reusing existing sources for a total of **172 published reference frames**. No generated imagery was used. Every review records its source image, camera metadata, crop where applicable, and confidence.

Photographic association is not proof of a complete reconstruction. Of the 102 targets, 99 have reviewed source imagery. Primary views were classified as 14 observed, 41 partial, 40 occluded, four unusable and three uncovered. Layout information exists for 46 targets when alternate views are included. Trees, boundary walls, overlapping buildings and changes since the CAD model prevent exact reconstruction of every frontage. Some source buildings combine several real structures; some photographs show newer buildings or vacant lots. These conflicts are retained in the data instead of silently squeezing the observed floors into an incompatible mass.

Unobserved or geometrically conflicting facades retain the existing photographic treatment. This fallback reuses Beirut materials and does not establish a location-specific match; no neutral overlay is added over them. Unseen elevations of the explicit replacement buildings remain plainly modeled. Physical dimensions, detailed proportions and many placements are estimated from photographs; this is a reference-based game reconstruction, not photogrammetry or a surveyed digital twin. The mosque minaret's placement records an approximately 2 m photographic uncertainty. Runtime coverage and geometry counts are exposed in the existing diagnostics.

## Rebuild and verify

```sh
npm run prepare:bliss
npm test
npm run build
```

Rebuilding uses the local source/cache records and does not collect additional paid imagery. Collection is a separate explicit command in `scripts/collect_bliss_photos.py` with a persisted request limit. The completed run made 97 static-image requests under its 120-request ceiling.

Source and output records:

- `public/data/bliss-street.json`: full corridor and per-building selection.
- `public/assets/world/bliss/facades.json` and `reviews.json`: reference images and individual visual reviews.
- `public/data/bliss-architecture.json`: source planes, photo-derived parameters, geometric conflicts and replacement links.
- `public/data/bliss-landmarks.json`, `bliss-heritage.json`, `bliss-shopfronts.json`: explicit models and photographic signage.
- `benchmarks/bliss/`: rendered checks and runtime snapshots.

Sources include the local registered CAD model, [OpenStreetMap](https://www.openstreetmap.org/copyright), Google Street View photographs (© Google), [AUB's campus map](https://www.aub.edu.lb/protection/Documents/AUB_map.pdf), and the [AUB Main Gate architectural archive](https://online-exhibit.aub.edu.lb/exhibits/show/aub-main-gate/1901-1902/the-main-gate-building-s-archi/architectural-features). Per-asset provenance retains the specific source records.
