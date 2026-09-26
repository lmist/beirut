# Photographic building facade repair

The `before.png` and `after.png` views use the Hamra arrival camera.

Building walls use real, locally cached Beirut Street View pixels. The reusable
material sheet is rebuilt by `scripts/prepare_facade_materials.py` using an
inverse perspective transform; its manifest retains original photo paths,
SHA-256 hashes, selected corners, estimated widths and floor counts. No image
synthesis is used. `source-survey.jpg` records the inspected Hamra sources.

The renderer anchors wall coordinates to the building, keeps multiple source
floors together, fits whole floors to the building height, and avoids selecting
plain shutter materials for upper floors. Triangle ownership requires a full
triangle fit before falling back to a centroid query. Building walls and roofs
no longer sample the generated material atlas. Aerial roofs and existing
camera projections remain enabled; photographs receive reduced extra shading
to avoid doubling their baked lighting.

Street photo atlas cells are rebuilt at 192 px with four-pixel gutters, within
the existing streaming budget. The reusable wall array has 256 px layers.
Upsampling a crop does not add source detail.

These fixes do **not** establish an exact photo match for every modeled facade.
Camera projections remain approximate, and unobserved walls reuse photographed
Beirut materials. The source geometry is still simplified. Source-photo wires,
shadows and repeated windows remain visible in some materials.

Validation: 43 JavaScript tests, two perspective-transform tests, production
build, and street-level browser inspection.
