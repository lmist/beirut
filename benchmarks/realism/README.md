# September 26 visual pass validation

- All 41 automated tests pass, including real triangle surface sampling, driving/walking physics, saved mission progress, neighborhood routes, and resident/furniture placement.
- Production build and `git diff --check` pass. Vite reports the existing large engine/WASM bundle size warning.
- Browser verified cold city launch, Hamra arrival, immediate Mercedes entry, driving and braking, automatic progress restoration, and ground-verified street population (24 residents; 14 walkable paths at arrival).
- The corrected 30-second walking/driving/aerial benchmark completed with a valid driving segment and no application errors. M3 Pro, viewport1132×637, render buffer1698×955:79.2fps average,32.0fps1% low,p9924.2ms,max83.2ms. The strict60fps criterion was **not met** because of frame-time spikes. Another game tab remained open, so this is a session measurement rather than an isolated GPU benchmark.
- The benchmark throttle now takes priority over idle mouse controls; before this fix, a run completed without accelerating and was correctly rejected as invalid. `hamra-adaptive.json` contains the corrected run.

Screenshots are actual browser captures. No generated image replaces the running game.
