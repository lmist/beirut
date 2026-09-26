#!/usr/bin/env python3
"""Convert supplied RenderWare DFF/TXD assets into browser-ready GLB files.

Run with Blender so DragonFF can import RenderWare geometry and TXD textures:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
    scripts/convert_game_assets.py -- --only w124_e500
"""

import argparse
import json
import math
import sys
import struct
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector


REPO = Path(__file__).resolve().parents[1]
DRAGONFF_PARENT = REPO / ".cache" / "conversion-tools"
OUTPUT_DIR = REPO / "public" / "assets" / "game"
MANIFEST_PATH = OUTPUT_DIR / "models.json"

ASSETS = (
    {
        "kind": "cars",
        "id": "w124_e500",
        "name": "Mercedes-Benz W124 E500",
        "source": "gta-assets/extracted/car-w124-e500-lowpoly/Mercedes Benz W124 E500 Low-Poly [Only DFF]/DFF File/washing.dff",
        "target_size": 4.85,
        "texture_limit": 512,
        "triangle_limit": 28000,
        "note": "DFF-only source; imported material and vertex colors retained.",
    },
    {
        "kind": "cars",
        "id": "mercedes_sprinter",
        "name": "Mercedes Sprinter",
        "source": "gta-assets/extracted/car-mercedes-sa-style-dff/Mercedes Dff only sprinter/burrito.dff",
        "target_size": 5.90,
        "texture_limit": 512,
        "triangle_limit": 28000,
        "note": "DFF-only source; imported material and vertex colors retained.",
    },
    {
        "kind": "cars",
        "id": "mercedes_s500_w223",
        "name": "Mercedes-Benz S500 W223",
        "source": "gta-assets/extracted/mercedes-s500-2021_MB_W223_CCD/admiral.dff",
        "txd": "gta-assets/extracted/mercedes-s500-2021_MB_W223_CCD/admiral.txd",
        "target_size": 5.18,
        "texture_limit": 512,
        "triangle_limit": 28000,
    },
    {
        "kind": "peds",
        "id": "urban_male_wmycon",
        "name": "Urban male pedestrian",
        "source": "gta-assets/extracted/peds-hq-original/HQ Peds/wmycon.dff",
        "txd": "gta-assets/extracted/peds-hq-original/HQ Peds/wmycon.txd",
        "target_size": 1.78,
        "texture_limit": 256,
        "triangle_limit": 7500,
        "player": True,
    },
    {
        "kind": "peds",
        "id": "urban_female_wfypro",
        "name": "Urban female pedestrian",
        "source": "gta-assets/extracted/peds-hq-original/HQ Peds/wfypro.dff",
        "txd": "gta-assets/extracted/peds-hq-original/HQ Peds/wfypro.txd",
        "target_size": 1.68,
        "texture_limit": 256,
        "triangle_limit": 7500,
        "yaw": math.pi / 2,
    },
    {
        "kind": "peds",
        "id": "urban_female_hfyst",
        "name": "Urban female pedestrian 2",
        "source": "gta-assets/extracted/peds-hq-original/HQ Peds/hfyst.dff",
        "txd": "gta-assets/extracted/peds-hq-original/HQ Peds/hfyst.txd",
        "target_size": 1.68,
        "texture_limit": 256,
        "triangle_limit": 7500,
        "yaw": math.pi / 2,
    },
    {
        "kind": "peds",
        "id": "urban_male_bmybu",
        "name": "Urban male pedestrian 2",
        "source": "gta-assets/extracted/peds-hq-original/HQ Peds/bmybu.dff",
        "txd": "gta-assets/extracted/peds-hq-original/HQ Peds/bmybu.txd",
        "target_size": 1.80,
        "texture_limit": 256,
        "triangle_limit": 7500,
    },
)


EXTRA_CARS = (
    ("mercedes_190e_evo2", "Mercedes-Benz 190E Evolution II", "car-1990-190evo2/premier", 4.54, 1340),
    ("mercedes_c63_amg", "Mercedes-Benz C63 AMG", "car-c63amg-dff/2012 Mercedes Benz C63 AMG DFF ONLY/sultan", 4.59, 1730),
    ("mercedes_ml500", "Mercedes-Benz ML500", "mercedes-ml500/SA_Mercedes-Benz_ML_500/landstal", 4.64, 2135),
    ("mercedes_sl500", "Mercedes-Benz SL500", "mercedes-sl500/mbsl500/feltzer", 4.53, 1845),
    ("mercedes_s500_2006", "Mercedes-Benz S500 (2006)", "mercedes-s500-2006/2006 Mercedes-Benz S500/washing", 5.08, 1940),
    ("mercedes_sclass_w140", "Mercedes-Benz S-Class W140", "mercedes-sclass-w140-multiengine/HQLM/merit", 5.11, 2050),
    ("mercedes_s500_w222", "Mercedes-Benz S500 AMG W222", "mercedes-s500-amg-w222-2014/[Glendale] Mercedes - Benz S500 w222/glendale", 5.25, 2015),
    ("mercedes_s500_2025", "Mercedes-Benz S500 W223 (2025)", "mercedes-s500-w223-2025/Emperor", 5.29, 2090),
)
for car_id, name, stem, length, mass in EXTRA_CARS:
    source = "gta-assets/extracted/" + stem
    txd = source + ".txd"
    if car_id == "mercedes_s500_2025":
        txd = source.rsplit("/", 1)[0] + "/emperor.txd"
    asset = dict(kind="cars", id=car_id, name=name, source=source+".dff",
                 target_size=length, mass=mass, texture_limit=1024, triangle_limit=42000)
    if (REPO / txd).exists() and (REPO / txd).stat().st_size:
        asset["txd"] = txd
    ASSETS += (asset,)


def blender_args():
    args = sys.argv
    return args[args.index("--") + 1 :] if "--" in args else []


def clear_scene():
    # Direct removal works reliably in headless Blender even when a previous
    # imported object is hidden or excluded from the active view layer.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def import_asset(asset):
    if str(DRAGONFF_PARENT) not in sys.path:
        sys.path.insert(0, str(DRAGONFF_PARENT))
    import DragonFF
    from DragonFF.ops import dff_importer, txd_importer

    if not getattr(bpy.types.Scene, "dff", None):
        DragonFF.register()

    txd_images = {}
    if asset.get("txd"):
        txd_path = REPO / asset["txd"]
        txd_result = txd_importer.import_txd(
            {"file_name": str(txd_path), "skip_mipmaps": True, "pack": True}
        )
        txd_images = txd_result.images

    source_path = REPO / asset["source"]
    if asset["id"] == "mercedes_s500_2025":
        data = bytearray(source_path.read_bytes())
        frame_start = 36
        count = struct.unpack_from("<I", data, frame_start + 24)[0]
        geometry_start = data.find(struct.pack("<I", 26), frame_start + 28 + count * 56)
        while geometry_start >= 0 and data[geometry_start+8:geometry_start+12] != bytes.fromhex("ffff0318"):
            geometry_start = data.find(struct.pack("<I", 26), geometry_start+1)
        if geometry_start < 0:
            raise RuntimeError("Missing geometry list in W223 source")
        # Repair the two inconsistent frame-list lengths in this supplied DFF.
        struct.pack_into("<I", data, frame_start+4, geometry_start-frame_start-12)
        struct.pack_into("<I", data, frame_start+16, 4+count*56)
        source_path = DRAGONFF_PARENT / "w223-2025-normalized.dff"
        source_path.write_bytes(data)
    if asset["id"] == "mercedes_sclass_w140":
        data=bytearray(source_path.read_bytes())
        offsets=[];cursor=0
        while True:
            cursor=data.find(struct.pack("<I",20),cursor)
            if cursor<0:break
            if data[cursor+12:cursor+20]==struct.pack("<II",1,16):offsets.append(cursor)
            cursor+=1
        for left,right in zip(offsets,offsets[1:]):
            if struct.unpack_from("<I",data,left+4)[0]>right-left-12:
                struct.pack_into("<I",data,left+4,right-left-12)
        source_path=DRAGONFF_PARENT / "w140-normalized.dff"
        source_path.write_bytes(data)
    result = dff_importer.import_dff(
        {
            "file_name": str(source_path),
            "txd_images": txd_images,
            "image_ext": None,
            "connect_bones": False,
            # Skin DFFs use a material split table to assign faces to their
            # head, clothing, hand, and footwear texture slots. Without it,
            # DragonFF assigns every polygon the first (body) material.
            "use_mat_split": True,
            "remove_doubles": True,
            "create_backfaces": False,
            "group_materials": True,
            "import_normals": True,
            "materials_naming": "TEX",
            "hide_damage_parts": True,
        }
    )
    if result.warning:
        print(f"DragonFF warning for {asset['id']}: {result.warning}")


def remove_nonvisual_objects(kind):
    bpy.context.view_layer.update()

    def remove_preserving_children(obj):
        # DFF part meshes frequently sit at local origin below a frame empty.
        # Blender's direct data-block removal does not retain that inherited
        # transform, so bake each child into world space before removing frames.
        for child in list(obj.children):
            world_matrix = child.matrix_world.copy()
            child.parent = None
            child.matrix_world = world_matrix
        bpy.context.view_layer.update()
        bpy.data.objects.remove(obj, do_unlink=True)

    for obj in list(bpy.context.scene.objects):
        name = obj.name.lower()
        if obj.type in {"CAMERA", "LIGHT"} or obj.name in {"Cube", "Light", "Camera"}:
            remove_preserving_children(obj)
        elif kind == "cars" and (
            "_dam" in name or "_vlo" in name or "chassis_lod" in name or ".col" in name or "shadowmesh" in name or name.endswith("_col")
        ):
            remove_preserving_children(obj)
        elif kind == "cars" and obj.type == "EMPTY" and "wheel_" not in name:
            remove_preserving_children(obj)
        elif kind == "peds" and obj.type == "EMPTY":
            remove_preserving_children(obj)


def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def restore_skin_parenting():
    """Make each skinned mesh a direct child of its imported armature.

    DragonFF sometimes routes the mesh through a frame empty. We remove those
    non-rendering frames for the browser export, so restore the standard glTF
    mesh-to-skeleton relationship without changing world-space geometry.
    """
    for obj in mesh_objects():
        armature = next(
            (modifier.object for modifier in obj.modifiers
             if modifier.type == "ARMATURE" and modifier.object),
            None,
        )
        if armature and obj.parent != armature:
            world_matrix = obj.matrix_world.copy()
            obj.parent = armature
            obj.matrix_world = world_matrix


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("Import produced no mesh geometry")
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def decimate_to_limit(limit):
    objects = mesh_objects()
    triangles = sum(len(obj.data.polygons) for obj in objects)
    if triangles <= limit:
        return triangles
    ratio = max(0.01, limit / triangles)
    for obj in objects:
        modifier = obj.modifiers.new(name="Browser triangle budget", type="DECIMATE")
        modifier.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    return sum(len(obj.data.polygons) for obj in mesh_objects())


def resize_textures(limit):
    count = 0
    for image in bpy.data.images:
        width, height = image.size
        largest = max(width, height)
        if largest > limit:
            scale = limit / largest
            image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
            image.pack()
            count += 1
    return count


def add_ped_actions():
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        return []
    armature = armatures[0]
    armature.animation_data_create()
    idle_action = bpy.data.actions.new("idle_loop")
    armature.animation_data.action = idle_action
    armature.data.pose_position = "POSE"
    bone_names = [bone.name for bone in armature.pose.bones]
    candidates = [
        name for name in bone_names
        if any(word in name.lower() for word in ("upperarm", "thigh", "calf"))
    ]
    def insert_rotation(action, name, frame, angle):
        path = f'pose.bones["{name}"].rotation_quaternion'
        value = Quaternion((1.0, 0.0, 0.0), angle)
        for axis, axis_value in enumerate(value):
            curve = action.fcurve_ensure_for_datablock(
                armature, path, index=axis, group_name=name
            )
            curve.keyframe_points.insert(frame, axis_value)

    # The bind pose already has natural arms-down posture. An explicit idle
    # action prevents a consumer from falling back to a T pose.
    idle_bone = next((name for name in bone_names if "spine" in name.lower()), bone_names[0])
    for frame in (1, 30):
        insert_rotation(idle_action, idle_bone, frame, 0.0)
    idle_action.frame_start = 1
    idle_action.frame_end = 30

    action = bpy.data.actions.new("walk_loop")
    armature.animation_data.action = action
    # Arm and thigh swings use the imported bone-local X axis. The left and
    # right sides alternate; feet return to the bind pose at loop boundaries.
    for name in candidates:
        lowered = name.lower()
        side = 1 if " l " in f" {lowered} " else -1
        amplitude = 0.34 if "upperarm" in lowered else 0.28
        if "calf" in lowered:
            amplitude = 0.16
        for frame, angle in ((1, 0.0), (13, amplitude * side), (25, 0.0)):
            insert_rotation(action, name, frame, angle)
    if candidates:
        action.frame_start = 1
        action.frame_end = 25
    else:
        bpy.data.actions.remove(action)
        bpy.data.actions.remove(idle_action)
    return bone_names


def orient_and_ground(asset):
    visual = mesh_objects()
    wheel_frames = [o for o in bpy.context.scene.objects if o.type == "EMPTY" and "wheel_" in o.name.lower()]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    source_min, source_max = bounds(visual)
    source_size = source_max - source_min
    base_dimension = source_size.y if asset["kind"] == "cars" else source_size.x
    if base_dimension <= 0:
        raise RuntimeError(f"Invalid bounds for {asset['id']}")
    root = bpy.data.objects.new(asset["id"], None)
    bpy.context.scene.collection.objects.link(root)
    for obj in armatures:
        world_matrix = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world_matrix
    for obj in visual + wheel_frames:
        # Keep skinned meshes directly parented to their imported armature so
        # glTF exports the skeleton and weights as a valid skin.
        if obj.parent in armatures:
            continue
        world_matrix = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world_matrix
    scale = asset["target_size"] / base_dimension
    if asset["kind"] == "cars":
        # RenderWare vehicles: X right, Y forward, Z up.
        root.rotation_euler = (-math.pi / 2, 0, 0)
        root.scale = (scale,) * 3
    else:
        # Supplied GTA ped skins use X-up, Y-right, Z-forward. This rotation
        # maps them to glTF X-right, Y-up, -Z-forward without a reflection.
        rotation = Matrix(((0, 0, -1), (1, 0, 0), (0, -1, 0))).to_4x4()
        if asset.get("yaw"):
            rotation = Matrix.Rotation(asset["yaw"], 4, "Y") @ rotation
        root.matrix_world = rotation @ Matrix.Diagonal((scale, scale, scale, 1))
    bpy.context.view_layer.update()
    final_min, _ = bounds(visual)
    root.location.x -= (final_min.x + bounds(visual)[1].x) / 2
    root.location.z -= (final_min.z + bounds(visual)[1].z) / 2
    root.location.y -= final_min.y
    bpy.context.view_layer.update()
    final_min, final_max = bounds(visual)
    return root, final_max - final_min


def export_glb(asset):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{asset['id']}.glb"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=False,
        export_animations=True,
        # Scene geometry has already been converted to glTF's Y-up convention.
        # Letting Blender apply its normal Z-up to Y-up conversion here would
        # rotate every exported model a second time.
        export_yup=False,
        export_apply=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    return destination


def manifest_entry(asset, dimensions, bone_names, output):
    entry = {
        "id": asset["id"],
        "name": asset["name"],
        "url": f"/assets/game/{output.name}",
        "source": asset["source"],
        "triangles": sum(len(obj.data.polygons) for obj in mesh_objects()),
        "dimensions": {axis: round(value, 3) for axis, value in zip(("x", "y", "z"), dimensions)},
        "textureLimit": asset["texture_limit"],
    }
    if asset["kind"] == "cars":
        wheels = []
        for label in ("lf", "rf", "lb", "rb"):
            obj = next((o for o in bpy.context.scene.objects if o.type == "EMPTY" and "wheel_" + label in o.name.lower()), None)
            if obj:
                wheels.append({axis: round(v, 4) for axis, v in zip("xyz", obj.matrix_world.translation)})
        wheel_meshes = [o for o in mesh_objects() if "wheel" in o.name.lower()]
        radius = .34
        if wheel_meshes:
            lo, hi = bounds(wheel_meshes[:1])
            radius = max(.25, min(.48, (hi.y-lo.y)/2))
        entry["wheels"] = wheels
        entry["wheelRadius"] = round(radius, 4)
        entry["mass"] = asset.get("mass", 2400 if asset["id"] == "mercedes_sprinter" else 1750)
    if asset.get("player"):
        entry["player"] = True
    if asset.get("txd"):
        entry["textureSource"] = asset["txd"]
    if asset.get("note"):
        entry["note"] = asset["note"]
    if bone_names:
        entry["armature"] = {
            "bones": bone_names,
            "idleAnimation": "idle_loop",
            "walkAnimation": "walk_loop",
        }
    return entry


def load_manifest():
    if not MANIFEST_PATH.exists():
        return {"cars": [], "peds": []}
    with MANIFEST_PATH.open() as handle:
        return json.load(handle)


def save_manifest(manifest):
    order = {asset["id"]: index for index, asset in enumerate(ASSETS)}
    for category in ("cars", "peds"):
        manifest[category].sort(key=lambda asset: order[asset["id"]])
    with MANIFEST_PATH.open("w") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")


def convert(asset, manifest):
    print(f"Converting {asset['id']}")
    clear_scene()
    import_asset(asset)
    remove_nonvisual_objects(asset["kind"])
    if asset["kind"] == "cars":
        # Some source meshes contain stray corrupt vertices outside the vehicle.
        for obj in mesh_objects():
            bm=bmesh.new();bm.from_mesh(obj.data)
            invalid=[v for v in bm.verts if any(not math.isfinite(c) or abs(c)>100 for c in v.co)]
            if invalid:
                print(f"Removing {len(invalid)} invalid vertices from {obj.name}")
                bmesh.ops.delete(bm,geom=invalid,context='VERTS');bm.to_mesh(obj.data);obj.data.update()
            bm.free()
        bpy.context.view_layer.update()
    restore_skin_parenting()
    resize_textures(asset["texture_limit"])
    decimate_to_limit(asset["triangle_limit"])
    bone_names = add_ped_actions() if asset["kind"] == "peds" else []
    _, dimensions = orient_and_ground(asset)
    if asset["kind"] == "cars" and not (1 < dimensions.x < 4 and .8 < dimensions.y < 4 and 3 < dimensions.z < 8):
        raise RuntimeError(f"Invalid vehicle dimensions: {tuple(dimensions)}")
    output = export_glb(asset)
    entry = manifest_entry(asset, dimensions, bone_names, output)
    manifest[asset["kind"]] = [
        current for current in manifest.get(asset["kind"], []) if current["id"] != asset["id"]
    ] + [entry]
    save_manifest(manifest)
    print(f"Wrote {output} ({entry['triangles']} triangles)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cars", action="store_true")
    parser.add_argument("--only", choices=[asset["id"] for asset in ASSETS])
    args = parser.parse_args(blender_args())
    manifest = load_manifest()
    selected = [asset for asset in ASSETS if (not args.only or asset["id"] == args.only) and (not args.cars or asset["kind"] == "cars")]
    for asset in selected:
        convert(asset, manifest)


if __name__ == "__main__":
    main()
