# Bey City — Beirut, by heart

A Beirut driving and exploration game built on the supplied city model. **17,575 buildings**, real terrain, a Hamra opening, third-person walking, and a neighborhood delivery story. The modern visual pass adds late-afternoon shadows, reflective cars, verified sidewalk placement, and saved mission progress. [What changed and remaining fidelity limits](docs/realism-pass.md).

## Play

Requires **Node.js 22.23.2** (also recorded in `.nvmrc`), npm, and a desktop
browser with WebGL2. The repository includes the prepared city meshes, vehicle
and pedestrian models, textures, and map metadata. No API keys, Python, Blender,
Git LFS, or original asset downloads are needed to play or build the game.

```sh
git clone https://github.com/lmist/beirut.git
cd beirut
# If you use nvm: nvm install && nvm use
npm ci
npm start
```

Open **http://127.0.0.1:5173** and choose **Begin the journey**.

For the production build:

```sh
npm run build
npm run preview -- --port 4173
```

Open **http://127.0.0.1:4173**. All runtime models, map data, fonts, and WASM are served locally.

Keep all of `dist/` together when hosting the production build and serve it from
the site root over HTTP(S). Opening `index.html` directly with `file://` does not
support the game's workers and asset requests. `/cars.html` contains the vehicle
gallery. Dependency versions are fixed by `package-lock.json`; use `npm ci` to
reproduce them. Internet access is needed for the initial dependency install.

### Included assets and optional source pipelines

`src/`, the HTML entry points, `public/`, and the locked npm dependencies are the
complete playable game. `tests/`, `docs/`, and `benchmarks/` preserve validation,
asset provenance, and implementation notes. GitHub Actions runs the JavaScript
tests and production build on each push and pull request.

The scripts under `scripts/` also preserve the optional asset preparation work.
Running those pipelines from original inputs requires separately supplied raw
data: the Rhino city model, source DFF/TXD archives and DragonFF for Blender, or
the original imagery and collection credentials, depending on the script. These
inputs, local caches, and credentials are excluded from Git, apart from six small
source photographs in `data/bliss-street/imagery-collected/` used by the shopfront
provenance tests. The prepared outputs
under `public/` are included, so those pipelines are unnecessary for a fresh
clone to reproduce the current game. See [model conversion](docs/model-conversion.md)
and [world materials](docs/world-materials.md) for their inputs and commands.

The original project code and documentation are open source under the
[MIT license](LICENSE). Third-party models, imagery, map data, and fonts retain
their existing terms and are excluded from that license. See
[third-party asset notices](THIRD_PARTY_ASSETS.md), the
[asset survey](docs/asset-survey.md), and per-asset metadata under `public/`.

| Control | On foot | In a Mercedes |
| --- | --- | --- |
| WASD / arrows | Move | Accelerate, brake/reverse, steer |
| Mouse / drag | Look around | Chase camera follows the car |
| Shift | Run | — |
| Space | Jump | Handbrake |
| F | Enter a nearby car | Exit the car |
| E | Talk to a nearby pedestrian | — |
| H | — | Horn |
| R | — | Recover and repair the car |
| M | Open/close the city map | Open/close the city map |
| Escape | Release mouse / close map | Release mouse / close map |

The map pauses movement. Cars collide with city geometry and parked vehicles; hard impacts damage the car and the player. A wrecked car must be recovered before it can accelerate again. Stop before exiting. Expand **Mouse driving** under the speedometer for latched pedal and steering controls; WASD takes over immediately.

## Bliss Street

Choose **Walk Bliss Street** to explore the full 1.4 km corridor, including the western bend. The pass adds photo-reviewed 3D facades, the AUB Main Gate and campus wall, Assembly Hall, Daouk Mosque, distinctive historic shopfronts, and actual photographic signs. Display settings offer four arrival points and an elevated view. [Coverage, sources, reconstruction limits and rebuild commands](docs/bliss-street.md).

## The Last Cassette

Find the waiting W124, then take a forgotten cassette through **Hamra, Wardieh, and Clémenceau**. Slow down inside each gold marker in a grounded car to deliver it. Each stop earns $150 and a fragment of city lore; finishing the route adds $500. Progress saves locally; restart the cassette route from the city map. Dialogue and the delivery story are fictional.

The radar rotates with your heading and shows the player, cars, and current objective. The radar route goes around building footprints, with a steering bearing and distance to the next turn. M opens a north-up city map. Neighborhood names, nearby street names, and Arabic area labels remain visible during play; the full map links the current location to Google Maps.

## This iteration

- All eleven supplied Mercedes models, including the 190E Evo II, W124, C63, ML500, SL500, Sprinter, W140, and four S500 generations. The collection is available at `/cars.html`.
- Four supplied pedestrian models with idle/walk animation, reused in a pool of up to 24 residents on verified sidewalks.
- Real satellite imagery across all 124 city tiles, camera-projected Street View facades, and perspective-rectified Beirut photo materials with explicit floor scale on unobserved walls; see [world materials](docs/world-materials.md).
- Shaped trees, palms, terracotta planters, slatted benches, lamps, and bilingual signs placed on verified sidewalk surfaces; nearby resident and furniture pools move with exploration.
- Third-person walking and chase camera with wall clearance.
- Player health, car condition, speedometer, clock, cash, mission markers, local dialogue, and engine/horn sound.
- Adaptive resolution by default, warm directional shadows, ACES tone mapping, sky reflections, smooth texture filtering, and a restrained HUD. Native, Performance, and optional 540p Retro picture modes remain available.

Asset inventories and further game ideas: [asset survey](docs/asset-survey.md). Conversion details: [model conversion](docs/model-conversion.md). Twelve additional street references cover sidewalks, trees, signs, and bridge approaches: [street reference survey](docs/street-reference-survey.md).

## Location alignment

The canonical [`registration.json`](public/data/registration.json) corrects a north–south sign error in the previous mapping. The rebuilt local map contains 5,910 road polylines, 76 area labels, and 12 landmarks. Road labels, compass, full map, and Google Maps links share this transform.

The corrected mapping was checked against held-out OSM streets and satellite roof outlines in four areas. Address-level and facade-projection accuracy are not yet measured, so street labels continue to say **Near …**. The previous 75–104 m claim was a proxy-fit statistic, not verified building accuracy. See the [registration correction and validation](docs/registration-correction.md).

Legacy imagery remains unchanged. Corrected building targets are in ignored `data/registration-v2/`; new collection records are under `data/photographic/`. The game serves compact photographic atlases and keeps raw images and API credentials outside runtime assets. Unobserved walls use real Beirut reference materials; individual camera projections remain approximate.

## Performance

The measurements below describe earlier versions; see `benchmarks/realism/` for this pass.

Rendering uses spatial tiles, distance-based detail, a shared city shader, streamed photographic atlases, frustum culling, pooled actors, and infrequent HUD updates. Meshoptimizer WASM decodes geometry in background workers. Rapier WASM handles walking and rigid-body driving with four-wheel suspension at a fixed 60 Hz in its own worker. Character and vehicle animation runs on the GPU-backed Three.js renderer.

The built-in 30-second benchmark covers **10 seconds on foot, 10 seconds driving a Mercedes, and 10 seconds orbiting the city**, following a warm-up. Cars and player health reset before each run. It reports average FPS, 1% low, p95/p99, longest frame, frames over 20/33 ms, draw calls, GPU, viewport, and actual rendering scale. Hiding the tab or changing picture/distance settings cancels the test. The photographic PS2 run measured 120.0 fps average, 104.7 fps 1% low, and a 15.9 ms longest frame after warm-up, with no frame above 20 ms. See the [measurement summary](benchmarks/README.md). Reports are saved under `benchmarks/`; the original `m3-pro-1920x1080.json` measures the earlier city-only view.

## Rebuild the map

Requires the original Rhino file, Python 3.12+, and Node 22+:

```sh
uv venv .venv
uv pip install --python .venv/bin/python -r requirements-map.txt
npm run prepare:map
```

`scripts/prepare_map.py` reads the cached render meshes with rhino3dm, converts Rhino Z-up coordinates to browser Y-up, assigns triangles to 512 m tiles, preserves hard normals, and packs surface categories and shading attributes. `scripts/optimize_map.mjs` reorders indices for the GPU, builds the distant meshes with a 0.65 m geometric-error bound, and compresses both levels with meshoptimizer. Intermediate tiles are in `.cache/tiles`.

The source model's unit system must be metres. Missing cached meshes are counted in the extraction report in `public/data/manifest.json`.

## Verification

```sh
npm test
npm run build
```

Tests decode all 248 shipped meshes, validate bounds and indices against the manifest, account for every source triangle, verify street placement, detect benchmark stalls, and exercise the actual WASM walking worker against ground and walls, including jumping. Vehicle tests cover acceleration, parked-car collisions, damage, recovery, and driving under an elevated deck; mission tests verify rewards cannot repeat.

## Dependencies

[Three.js](https://threejs.org/) · [meshoptimizer](https://github.com/zeux/meshoptimizer) · [Rapier](https://rapier.rs/) · [rhino3dm](https://github.com/mcneel/rhino3dm) · [Vite](https://vite.dev/). DM Sans and Instrument Serif are distributed under the SIL Open Font License.
