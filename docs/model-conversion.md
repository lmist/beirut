# Game model conversion

`scripts/convert_game_assets.py` imports the supplied GTA RenderWare DFF/TXD
files with DragonFF and exports browser-ready GLB files to `public/assets/game`.

Run the complete conversion with Blender:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python \
  scripts/convert_game_assets.py
```

Use `-- --cars` to rebuild all eleven vehicles. The converter removes damaged and low-detail duplicate bodies, discards corrupt outlier vertices, validates final proportions, and exports the four authored wheel frames. It repairs malformed frame-list lengths in the supplied 2025 W223 and the oversized atomic chunk in the W140 without changing the source archives.

For a single asset, add `-- --only w124_e500` after the script path.

The converter removes GTA collision and damage meshes, limits vehicles to about
42,000 triangles and pedestrians to about 7,500, and embeds TXD textures at a
maximum of 512px for vehicles or 256px for pedestrians. DFF-only car sources keep their supplied material and vertex colors, with runtime paint, rubber, glass, and trim materials. Vehicle body texture alpha is treated as gloss; only glazing is transparent.

RenderWare vehicle coordinates are converted from X-right, Y-forward, Z-up to
glTF's X-right, Y-up, -Z-forward convention. The supplied pedestrian skins use
their imported X-up rig orientation and receive the matching X-to-Y conversion.
Each model is uniformly scaled to its listed real-world size and placed with
its lowest visual geometry at Y=0.

Pedestrian GLBs retain the imported armature and bone names in `models.json`.
When recognizable limb bones are present, the converter includes `idle_loop`
(arms-down bind pose) and `walk_loop` actions. The armature's imported local
axes are retained; use those bone-local axes for runtime pose adjustments.
