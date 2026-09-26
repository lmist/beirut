# Beirut, by heart — playable visual pass

This pass keeps the registered Rhino city and the Three.js/Rapier runtime. It improves the existing game rather than replacing the city with an invented scene.

## What changed

- Adaptive resolution is the default. ACES tone mapping, linear/anisotropic texture filtering, a shared late-afternoon sun, local cast shadows, sky reflections, and refined sea shading replace the default pixel treatment. Retro remains optional.
- Car paint has clearcoat and environment reflections; previously untextured W124 glass and trim now receive appropriate materials.
- Arrival is on Hamra Street, facing a clear driving corridor. The cassette route connects Hamra, Wardieh, and Clémenceau. Its building-clearance navigation path totals approximately 2.34 km.
- Mission progress is saved locally and restored with earned rewards derived from completed stops. The city map includes an explicit restart control.
- Street furniture uses pooled geometry: shaped trees, palms, lamps, benches, planters, and signs drawn from actual bilingual road labels. Candidate locations follow road data and are checked against authored sidewalk triangles, with alternative offsets for wider modeled streets. Props avoid vehicle footprints.
- Residents spawn on measured sidewalk surfaces. Walking segments are checked along their length and residents pause for vehicles and people; an unsafe segment leaves a resident standing on a validated sidewalk.
- The interface now uses an unobtrusive ivory/olive treatment. New engine, rolling, and ambient layers are procedural audio, not Beirut field recordings.

## Implementation and validation

`src/world/lighting.js` owns the sun, environment, and bounded shadow pass. The initial aerial frame allocates a shadow target before the city draws. Street shadows follow the player and snap in light space to reduce shimmer.

Terrain streaming transfers a category for each collision triangle. Rapier ground samples return road/sidewalk/building surface types. Newly streamed colliders receive a zero-time broad-phase update so queries are valid before simulation advances.

Automated checks cover map geometry, registration, photo metadata, driving/walking physics, real ground categories, mission saves/rewards, connected delivery paths, pedestrian safety, and deterministic street placement. Browser captures and performance results are under `benchmarks/realism/`.

## Remaining fidelity limits

The city still uses simplified building geometry and approximate photographic projection. Repeated reference facades remain visible. Furniture placement is inferred within verified sidewalk surfaces, not a survey of the real furniture at that address. Parked vehicles are simulated; autonomous traffic is not implemented. Street furniture is decorative geometry without dedicated collision bodies. A subsequent district art pass should replace the most visible repeated facades with authored shopfronts, balconies, and locally verified details, followed by traffic and field audio.
