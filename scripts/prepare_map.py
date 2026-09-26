"""Extract cached Rhino render meshes into 512 m spatial tiles."""
from pathlib import Path
import collections
import json
import struct
import time
import numpy as np
import rhino3dm as rhino

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/data'
RAW = ROOT / '.cache/tiles'
TILE_SIZE = 512
PALETTE = {1: [155, 159, 141], 2: [72, 132, 141], 3: [194, 190, 171], 4: [166, 167, 156], 5: [222, 214, 195]}


def extract(source):
    start = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    doc = rhino.File3dm.Read(str(source))
    if doc is None:
        raise RuntimeError(f'Cannot read {source}')
    if doc.Settings.ModelUnitSystem != rhino.UnitSystem.Meters:
        raise ValueError('Expected model coordinates in meters')
    tiles = collections.defaultdict(list)
    report = collections.Counter()
    buildings = []
    layer_counts = collections.Counter()
    for oi, obj in enumerate(doc.Objects):
        geo = obj.Geometry
        layer = obj.Attributes.LayerIndex
        if layer not in PALETTE:
            report['annotations_or_curves'] += 1
            continue
        meshes = []
        if isinstance(geo, rhino.Mesh):
            meshes = [geo]
        elif isinstance(geo, rhino.Brep):
            for face in geo.Faces:
                mesh = face.GetMesh(rhino.MeshType.Any)
                if mesh is not None:
                    meshes.append(mesh)
                else:
                    report['faces_without_cached_mesh'] += 1
        elif isinstance(geo, rhino.Extrusion):
            mesh = geo.GetMesh(rhino.MeshType.Any)
            if mesh is not None:
                meshes = [mesh]
        else:
            report['annotations_or_curves'] += 1
            continue
        if not meshes:
            report['objects_without_cached_mesh'] += 1
            continue
        object_min = np.full(3, np.inf)
        object_max = np.full(3, -np.inf)
        layer_counts[layer] += 1
        color = np.array(PALETTE[layer], dtype=np.float32)
        if layer == 5:
            color += ((oi * 16807 % 127) / 127 - .5) * 27
        for mesh in meshes:
            if len(mesh.Faces) == 0:
                continue
            p = np.array([[v.X, v.Z, -v.Y] for v in mesh.Vertices], dtype=np.float32)
            p = np.round(p, 3)
            object_min = np.minimum(object_min, p.min(axis=0))
            object_max = np.maximum(object_max, p.max(axis=0))
            f = np.array([mesh.Faces[i] for i in range(len(mesh.Faces))], dtype=np.uint32)
            tri = np.concatenate([f[:, :3], f[f[:, 2] != f[:, 3]][:, [0, 2, 3]]])
            # Flat face normals retain the architectural silhouette without smooth corners.
            a, b, c = p[tri[:, 0]], p[tri[:, 1]], p[tri[:, 2]]
            normals = np.cross(b-a, c-a)
            lengths = np.linalg.norm(normals, axis=1)
            valid = lengths > 1e-7
            tri, normals, lengths = tri[valid], normals[valid], lengths[valid]
            normals /= lengths[:, None]
            centers = p[tri].mean(axis=1)
            coords = np.floor(centers[:, [0, 2]] / TILE_SIZE).astype(np.int32)
            keys = coords[:, 0].astype(np.int64) * 65536 + coords[:, 1]
            for key in np.unique(keys):
                selected = keys == key
                cell = tuple(coords[np.flatnonzero(selected)[0]])
                flat = p[tri[selected]].reshape(-1, 3)
                norm = np.repeat(normals[selected], 3, axis=0)
                # Twenty-byte vertices: float position, signed normal, category, RGB, AO.
                packed = np.zeros((len(flat), 20), dtype=np.uint8)
                packed[:, :12] = flat.view(np.uint8).reshape(-1, 12)
                packed[:, 12:15] = np.round(norm * 127).astype(np.int8).view(np.uint8)
                packed[:, 15] = layer
                packed[:, 16:19] = np.clip(color, 0, 255).astype(np.uint8)
                base, top = p[:, 1].min(), p[:, 1].max()
                ao = .78 + .22 * np.clip((flat[:, 1]-base) / max(top-base, 1), 0, 1) if layer == 5 else np.ones(len(flat))
                packed[:, 19] = np.round(ao * 255).astype(np.uint8)
                tiles[cell].append(packed)
                report['triangles'] += len(flat) // 3
        if layer == 5 and np.isfinite(object_min).all():
            buildings.append([round(float(v), 2) for v in [object_min[0], object_min[2], object_max[0], object_max[2], object_min[1], object_max[1]]])
        if oi % 2500 == 0:
            print(f'{oi}/{len(doc.Objects)} objects; {report["triangles"]:,} triangles', flush=True)
    entries = []
    for (x, z), parts in sorted(tiles.items()):
        vertices = np.concatenate(parts)
        # Deduplicate exactly matching packed vertices, including hard normals.
        unique, indices = np.unique(vertices.view('V20').reshape(-1), return_inverse=True)
        vertex_bytes = unique.tobytes()
        index_bytes = indices.astype('<u4').tobytes()
        name = f'{x}_{z}'
        (RAW / f'{name}.raw').write_bytes(struct.pack('<II', len(unique), len(indices)) + vertex_bytes + index_bytes)
        positions = np.frombuffer(vertex_bytes, dtype=np.dtype({'names':['p'], 'formats':[('<f4',3)], 'offsets':[0], 'itemsize':20}))['p']
        entries.append({'id': name, 'bounds': [*positions.min(axis=0).tolist(), *positions.max(axis=0).tolist()], 'vertices':len(unique), 'triangles':len(indices)//3})
    manifest = {'version':1, 'source':source.name, 'sourceBytes':source.stat().st_size, 'units':'meters', 'tileSize':TILE_SIZE, 'tiles':entries, 'buildings':len(buildings), 'layers':dict(layer_counts), 'extraction':dict(report)}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    (OUT / 'buildings.json').write_text(json.dumps(buildings, separators=(',', ':')))
    print(json.dumps({'tiles':len(entries), 'buildings':len(buildings), 'report':dict(report), 'seconds':round(time.time()-start,1)},indent=2), flush=True)


if __name__ == '__main__':
    import sys
    extract(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT / 'BEIRUT 001.3dm')
