# GTA asset survey

Surveyed `gta-assets/` on 2026-09-16. The package is a collection of GTA: San
Andreas/RenderWare mods rather than browser models. The useful geometry is in
`.dff` files and the matching materials are in `.txd` files. The runtime uses converted GLBs under `public/assets/game/`; the inventory
below describes the supplied source bundles. `scripts/convert_game_assets.py`
provides the Blender/DragonFF conversion pipeline.

## Immediate conclusions

- No GLB, GLTF, FBX, or COLLADA files were found.
- One web-readable source exists: `car-1990-190evo2.rar` contains a Wavefront
  OBJ body template. It references an absent `.mtl`, so it is geometry only
  until a material is supplied. The OBJ has 8,183 vertices, 8,762 UVs, 13,582
  normals, and 14,972 faces. Its dimensions are approximately 18.95 x 12.32 x
  44.47 source units; it will likely need a 0.1 scale when placed in the
  metre-based Beirut world.
- All other cars and pedestrians are DFF/TXD pairs or DFF-only files. They
  need conversion before Three.js can load them.
- `gta-assets/extracted/` is incomplete: it has 2,712 files (~1.2 GiB), with
  1,104 zero-byte placeholders. Archive member listings are the reliable
  inventory. The Arab RAR also extracts with `bsdtar` but reports unsupported
  methods with the installed `7z`.

## Cars

The sizes below are uncompressed archive member sizes. A DFF-only car has no
matching texture archive and will need a new material or a texture generated
from another source.

| Archive | Model files | Assessment |
| --- | --- | --- |
| `car-1990-190evo2.rar` (7.0 MiB) | `premier.dff` 1,763,328 B; `premier.txd` 6,292,776 B; `Templates/Mercedes 190 Evo2 body.obj` 1,530,274 B; two remap PNGs | Best conversion fallback because an OBJ is included; the missing MTL still needs manual material setup. |
| `car-c63amg-dff.7z` (2.7 MiB) | `2012 Mercedes Benz C63 AMG DFF ONLY/sultan.dff` 8,486,912 B | Detailed C63, DFF only despite the small archive. Readme describes HQ interior/exterior. |
| `car-mercedes-sa-style-dff.zip` (147 KiB) | `Mercedes Dff only sprinter/burrito.dff` 398,126 B | Smallest Mercedes-branded body; Sprinter/van shape, no TXD. Good as a distant traffic proxy after a flat material. |
| `car-w124-e500-lowpoly.zip` (1.4 MiB) | `Mercedes Benz W124 E500 Low-Poly [Only DFF]/DFF File/washing.dff` 590,262 B; `PREVIEW.png` 1,209,213 B | Best low-poly sedan geometry, DFF only. Readme explicitly calls it LQ/low size and says it replaces `washing`. |
| `mercedes-ml500.rar` (2.1 MiB) | `SA_Mercedes-Benz_ML_500/landstal.dff` 5,134,336 B; `landstal.txd` 915,456 B | Complete textured SUV, reasonable second choice for a player/mission vehicle. |
| `mercedes-sl500.rar` (1.5 MiB) | `mbsl500/feltzer.dff` 3,233,792 B; `feltzer.txd` 1,014,696 B | Complete textured convertible; moderate size and a strong hero/rare car. |
| `mercedes-s500-2006.rar` (2.2 MiB) | `2006 Mercedes-Benz S500/washing.dff` 4,315,136 B; `washing.txd` 1,795,368 B | Complete textured sedan; still manageable, but uses the same GTA vehicle name as the W124. |
| `mercedes-sclass-w140-multiengine.rar` (21.7 MiB) | Three `merit.dff`/`.txd` variants: HQLM 7,458,030/5,158,340 B; IVF+AD 7,834,468/6,556,648 B; Vehfuncs 13,391,907/6,950,248 B | Complete W140 with game-specific variants and optional scripts; choose HQLM if this model is needed. |
| `mercedes-s500-2021_MB_W223_CCD.zip` (6.2 MiB) | `admiral.dff` 16,459,776 B; `admiral.txd` 1,315,380 B; `client.lua`; `meta.xml` | Complete modern S500, but much heavier geometry than the low-poly choices. |
| `mercedes-s500-amg-w222-2014.rar` (13.1 MiB) | `glendale.dff` 28,194,816 B; `glendale.txd` 20,564,956 B | Highest texture/geometry cost among the practical complete pairs. |
| `mercedes-s500-w223-2025.zip` (41.0 MiB) | `Emperor.dff` 41,369,600 B; `emperor.txd` 16,189,100 B; `w223.z3d` 19,029,513 B | Source model plus ZModeler file, but too large for ambient browser traffic. |

### Recommended Mercedes files

1. **Hero sedan:** `car-1990-190evo2.rar::premier.dff` + `premier.txd`.
   The 190 Evo fits a PS2-era visual target and the archive also offers an
   OBJ conversion route. Use the supplied `remap_190evo2.png` only after
   checking its UV/material mapping.
2. **Lightweight sedan:** `car-w124-e500-lowpoly.zip::Mercedes Benz W124 E500
   Low-Poly [Only DFF]/DFF File/washing.dff`. It is the smallest convincing
   sedan, but must receive a simple body/glass/wheel material because no TXD
   is included.
3. **Complete textured utility vehicle:** `mercedes-ml500.rar::SA_Mercedes-Benz_ML_500/landstal.dff`
   + `landstal.txd`. Use this when a matching TXD is more important than the
   lowest polygon/byte count.
4. **Complete textured rare car:** `mercedes-sl500.rar::mbsl500/feltzer.dff`
   + `feltzer.txd`.

The 398 KiB Sprinter DFF is a useful low-cost background proxy, but its lack
of TXD makes it less useful than the W124 for a visible player car.

## Pedestrians

Aggregate archive inventory:

| Archive | Contents | Assessment |
| --- | --- | --- |
| `peds-database-v2.rar` (34.0 MiB) | 204 DFF and 233 TXD files, plus previews and alternate variants | Best source for lightweight paired models. Many DFFs are 63–95 KiB. |
| `peds-arabs-middle-east.rar` (94.4 MiB) | 70 DFF + 70 TXD pairs | Useful regional clothing, including two Lebanese variants; all listed models are male. |
| `peds-gta5-pack2.zip` (8.1 MiB) | 10 nested ZIPs, each a DFF with source PNG texture layers | Potentially usable, but nested and not TXD-paired; conversion work is higher. |
| `peds-gta5-skinpack.rar` (65.8 MiB) | 122 DFF + 120 TXD | Broad GTA V-inspired set; generally heavier than the database minis. |
| `peds-hq-original.zip` (257.2 MiB) | 279 DFF + 279 TXD | Large HQ set; too costly for a first ambient crowd. |
| `skins-hd-pack-299.zip` (277.7 MiB) | 299 DFF + 299 TXD | Similar HD set with 299 models; duplicate-quality option, not a lightweight baseline. |
| `peds-original-peds-vary.zip` (8.5 MiB) | 1 DFF + 150 TXD | Texture variants for original base meshes; not a self-contained model set. |
| `peds-average-21.rar` (22.7 MiB) | 7 DFF + 7 TXD, each TXD about 11 MiB | Paired but not lightweight because of oversized textures. |
| `peds-cj-pack.rar` (48.3 MiB) | 7 DFF + 7 normal TXD plus 7 optional TXD | Useful named protagonist variants, but larger than the database minis. |
| `peds-hd-remake-2.0.7z` (532 B) | `Download Link.txt` only | No local models. |

### Recommended six pedestrian pairs

These are exact archive paths, with DFF/TXD sizes in bytes. The first five
come from the database's smallest complete pairs and support an urban crowd
with both genders; the last is the Lebanese regional accent model.

| Role | Exact DFF | Exact TXD | Size (DFF/TXD) |
| --- | --- | --- | ---: |
| Player/urban mechanic male | `peds-database-v2.rar::Ped Database 2.2/wmymech/wmymech.dff` | `.../wmymech.txd` | 77,824 / 133,120 |
| Male police/encounter | `peds-database-v2.rar::Ped Database 2.2/bmypol1/bmypol1.dff` | `.../bmypol1.txd` | 65,002 / 131,240 |
| Male ambient | `peds-database-v2.rar::Ped Database 2.2/wmori/wmori.dff` | `.../wmori.txd` | 65,536 / 16,552 |
| Female ambient 1 | `peds-database-v2.rar::Ped Database 2.2/hfypro/hfypro.dff` | `.../hfypro.txd` | 62,907 / 147,752 |
| Female ambient 2 | `peds-database-v2.rar::Ped Database 2.2/sfypro/sfypro.dff` | `.../sfypro.txd` | 64,223 / 278,952 |
| Lebanese regional crowd | `peds-arabs-middle-east.rar::Middle East Arabs Skins/Lebanese Arab Man (Black Kamees & Black Sirwal & White Ghutra)/Lebanese1.dff` | same directory `Lebanese1.txd` | 519,310 / 502,696 |

`Lebanese2.dff`/`.txd` in the same directory is a gold/black clothing
variant with exactly the same sizes and is the natural swap for variety.
Syrian1 (`694,272 / 1,450,032`) and Palestinian1 (`694,272 / 2,295,376`)
are alternatives when more regional dress is wanted. They are several times
larger than the database minis. The Arab archive has no female models, so the
database female pairs should remain in the crowd.

## Conversion options

1. **Preferred for DFF/TXD pairs:** use Blender with a RenderWare/GTA DFF
   importer (for example, a DragonFF-class add-on), import the DFF and decode
   its matching TXD, then export GLB/GLTF. Preserve alpha on windows, hair,
   and clothing masks; apply a single atlas or compressed textures for web
   delivery. The installed Blender binary is
   `/Applications/Blender.app/Contents/MacOS/Blender`, but no DFF importer was
   found in the stock installation.
2. **Standalone GTA conversion:** use a RenderWare-aware converter to turn
   DFF into OBJ/DAE and TXD into PNG, then assemble materials and export GLB
   in Blender. This is a good fallback for the W124 and DFF-only Sprinter,
   where a flat PS2 palette can be authored without a source TXD.
3. **OBJ fast path:** import `Mercedes 190 Evo2 body.obj` directly with
   Three.js `OBJLoader` or Blender. Add the missing MTL/materials manually,
   apply the supplied remap PNG if UVs match, scale by about 0.1, and export
   GLB for consistent runtime loading. It has no animation data.

DFF/TXD assets are static meshes in these archives. No browser-ready walking,
driving, or pedestrian animation clips are included. Ambient peds should use
simple idle/walk loops or camera-facing low-detail variants after conversion;
the car files include GTA handling/vehicle metadata that can inform gameplay,
but that metadata is not directly usable by Three.js.

Retain the credits/readme terms during conversion. In particular, the W124
readme asks users not to edit or re-upload without permission and permits
sharing with credit.

## Three Beirut game concepts

1. **Hamra Night Courier:** the `wmymech` model is a playable urban mechanic
   who drives the 190 Evo (`premier`) between Hamra, Gemmayzeh, and the
   Corniche. Timed deliveries use the W124 as cheap traffic and the female,
   police, and Lebanese pairs as pedestrians at checkpoints.
2. **Corniche Valet Shift:** a short mission game about moving high-value cars
   through crowded valet lots. The SL500 is the rare customer car, the ML500
   is the practical shuttle, and Lebanese1/Lebanese2 plus database pedestrians
   fill the seafront, café, and hotel entrances. Tight parking spaces make the
   provided real car silhouettes meaningful without needing a full GTA-scale
   traffic system.
3. **Generator Run:** during a rolling blackout, the player uses the ML500 to
   deliver generator parts up Beirut's steep streets. Police encounters use
   `bmypol1`, ordinary residents use `wmori` and the two female database pairs,
   and Lebanese1/Lebanese2 mark neighborhood hubs. The city model's existing
   streets, slopes, and building geometry provide the route puzzle while the
   low-poly assets keep the PS2-style scene light.
