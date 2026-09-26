# Beirut photographic materials

The city combines registered satellite imagery, camera-projected Street View photographs, and a library of real Beirut facade samples. The PS2 picture mode uses a 540p render buffer, nearest-neighbor magnification, mipmapped distance detail, warm lighting, and restrained color quantization.

## Roofs and ground

All 124 runtime tiles have a 1024 × 1024 satellite texture sampled through the canonical `public/data/registration.json`. Every required z19 source tile is present: 6,446 of 6,446. A 4096 × 3333 overview remains available at city scale. The compiled satellite images total 51.6 MiB; source imagery stays under ignored `data/`.

Each image carries the actual geometry tile bounds. Image columns follow world X and rows follow world Z. Roofs use the photographic color directly with subdued additional lighting. Ground blends the imagery with local surface detail, retaining legible pavement at walking distance. Photography contains existing shadows, roof parallax, capture-date differences, and some visible color seams.

## Facades

The compiled set assigns individual photographs to **8,854 buildings**: 6,145 newly targeted views and 2,709 reused frames. The other 8,721 buildings use photographic reference materials. These counts describe buildings with a selected view, not complete visibility of all walls.

`facades.json` records the actual horizontal camera position, estimated elevation, heading, pitch, field of view, and atlas cell for each assigned building. The collection pass uses the corrected target coordinates, reuses suitable cached frames, and requests new upward-looking views where useful. Camera-to-facade rays reject modeled occluders. Uploaded photospheres known to contain interiors are excluded.

The renderer projects each square camera frame onto walls facing that camera. It clips pixels outside the captured frame and keeps unseen sides on reference materials. Perspective division happens per pixel; the image is not stretched to fill every wall. Two-pixel atlas gutters and a bounded mip level prevent neighboring photos bleeding together. Atlas URLs include a content hash, so an open game retains its image layout across subsequent collection runs.

Sixteen perspective-rectified wall, window, balcony, and shutter samples provide photographic reference materials for unobserved walls. Each sample records its original photo path and SHA-256, crop corners, estimated width, and floor count. Multi-floor crops preserve several floors together, and UVs use a building-local origin with whole floors fitted between the ground and roof. The 256 px texture layers contain only resampled Beirut photographs; building walls no longer use the generated material atlas. These are real Beirut pixels, but reuse does not establish the appearance of an unphotographed building. Unavailable photography falls back to a plain wall or roof.

Camera elevation is estimated from nearby modeled ground plus 2.5 m. The model, camera positions, and facade alignment are not survey-calibrated; individual assignments remain geometric candidates. Coverage counts and source dates are stored in `facades.json`.

## Streaming and controls

The overview and 256 px reference texture array stay resident. Camera frames are preserved in 192 px atlas cells with four-pixel gutters, up from 96 px. Detailed satellite and facade atlases stream for nearby tiles, with two concurrent loads, at most twelve resident tiles, and a 192 MiB detail-texture budget. The overview adds approximately 69.4 MiB. Tiles share the shader and retain one city draw per visible mesh; there is no material or draw call per building.

**Display → Real Beirut imagery** switches the photographic treatment. **World textures** toggles all texture treatment, and **Building facades** controls wall detail. The imagery switch controls aerial imagery and location-specific camera projections. Reusable wall materials remain photographic; disabling building facades shows plain walls. The generated atlas is retained for non-building surfaces only.

## Rebuild

```sh
npm run prepare:satellite-textures
npm run prepare:facade-textures
# Rebuild only the inspected, reusable photo materials (offline):
.cache/registration-venv/bin/python scripts/prepare_facade_materials.py
```

The satellite script accepts `--cache-only` for an offline bake. The facade command rebuilds from collected files without making paid image requests. To collect additional corrected Street View targets, run the facade script with `--collect`; its key is read from the ignored local credential file and never included in runtime assets.

Sources and collection records are under `data/photographic/` and `data/sat/maps/`. Runtime metadata is under `public/assets/world/photographic/`. Projection math lives in `src/world/photo-projection.js`, streaming in `src/world/photographic.js`, and shading in `src/world/materials.js`.

## Validation

All 23 tests pass, including registration, camera projection, immutable atlas hashes, real decoded geometry assignments at both detail levels, and the existing physics tests. The production build succeeds. The walking/driving/overview benchmark measured 120.0 fps average, 104.7 fps 1% low, and 9.3 ms p99 on Apple M3 Pro at a 960 × 540 render buffer. The longest frame was 15.9 ms; renderer and imagery error counts were zero. [Full report](../benchmarks/photographic-beirut-m3-pro-ps2.json).
