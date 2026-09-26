# Bey City performance

The photographic city run uses real satellite textures, individual Street View projections, and photographed facade reference materials. Apple M3 Pro, Chromium 152, PS2 mode: 1280 × 720 viewport and 960 × 540 render buffer. The 30-second route follows GPU and nearby texture warm-up.

| Metric | Result |
| --- | ---: |
| Average FPS | 120.0 |
| 1% low | 104.7 fps |
| p99 frame time | 9.3 ms |
| Longest frame | 15.9 ms |
| Frames above 20 ms | 0 / 3,600 |
| Maximum speed tested | 100.8 km/h |
| Maximum draw calls | 299 |
| Peak photographic texture memory | 258 MiB |
| Peak detailed photo tiles | 12 |
| Renderer / imagery errors | 0 |

Walking, driving, and the city view passed the measured 60 fps smoothness target. The route included 9.99 seconds inside the Mercedes. Performance depends on hardware, viewport, background load, and texture streaming; this warmed route does not measure every first-visit asset upload.

[Photographic city report](photographic-beirut-m3-pro-ps2.json).

Earlier reports retain the authored-material city and previous iterations for comparison. The previous [PS2 game report](bey-city-m3-pro-ps2.json) recorded one 50.8 ms overview-transition frame; the [authored textured-world report](textured-world-m3-pro-ps2.json) recorded a 25.0 ms maximum. Those runs describe their respective assets and code, not the current photographic build.
