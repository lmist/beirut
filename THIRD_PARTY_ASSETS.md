# Third-party assets and license scope

The original game code, tests, build scripts, and original documentation are
available under the [MIT license](LICENSE). The asset files and dependencies
below are excluded from that grant. Public availability does not establish an
open-source license for those files, and conversion or cropping does not change
their source terms.

| Files | Source and retained information |
| --- | --- |
| `public/assets/game/` | Converted GTA/RenderWare vehicle and pedestrian models. `models.json` records source paths; [the asset survey](docs/asset-survey.md) records source bundles. Available source readmes are preserved in [docs/asset-notices/](docs/asset-notices/). |
| `public/data/tiles/`, `public/data/buildings.json`, and city-model-derived data | Supplied Rhino city model. A separate open license for the source model is not documented in this repository. |
| `public/data/city-locations.json` and OpenStreetMap-derived records | © OpenStreetMap contributors, ODbL 1.0. Source attribution is retained in the metadata. |
| `public/assets/world/` and the six source photographs under `data/` | Satellite imagery, Street View photographs, derived textures, and mixed-source material metadata. Provider attribution and source records remain in the JSON manifests and [world materials documentation](docs/world-materials.md). These assets are not licensed under MIT. |
| Images under `docs/` and `benchmarks/` | Reference images and game screenshots containing the above assets; excluded from the MIT grant. |
| npm dependencies and bundled fonts | Each package retains its own license. Dependency versions are in `package-lock.json`; font packages include their SIL Open Font License notices. |

Some supplied model readmes impose additional conditions. For example, the
W124 source readme restricts editing and re-uploading without permission and
allows sharing with credit. Preserve the original credits and terms. This
repository does not grant permissions on behalf of those authors or providers.

The game is reproducible using the included prepared assets, but the complete
asset collection is not offered as an MIT-licensed art pack. Asset provenance
and permissions must be considered separately from the game's open-source code.
