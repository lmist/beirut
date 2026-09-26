import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { boundaryLoops, clipAbove, signedArea } from '../scripts/prepare_bliss_architecture.mjs';
import { blissStops, nearestBlissStation, pointAlongBliss } from '../src/world/bliss-route.js';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const corridor = read('public/data/bliss-street.json');
const sourceBounds = read('public/data/buildings.json');
const sourceGround = read('public/data/building-ground.json');
const close = (actual, expected, tolerance = .002) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const closePoint = (actual, expected, tolerance = .002) => actual.forEach((n, i) => close(n, expected[i], tolerance));

// Independent ground proof: barycentric interpolation of the decoded source
// triangles, without invoking the extractor's Rapier raycaster.
async function decodedStreetTerrain() {
  await MeshoptDecoder.ready;
  const triangles = [], manifest = read('public/data/manifest.json');
  for (const tile of manifest.tiles) {
    if (!corridor.buildings.some(b => b.bounds[0] <= tile.bounds[3] && b.bounds[2] >= tile.bounds[0] && b.bounds[1] <= tile.bounds[5] && b.bounds[3] >= tile.bounds[2])) continue;
    const file = readFileSync(new URL(`../public/data/tiles/${tile.id}.0.mesh`, import.meta.url));
    const nv = file.readUInt32LE(4), ni = file.readUInt32LE(8), vb = file.readUInt32LE(12);
    const packed = new Uint8Array(nv * 20), bytes = new Uint8Array(ni * 4);
    MeshoptDecoder.decodeVertexBuffer(packed, nv, 20, file.subarray(20, 20 + vb));
    MeshoptDecoder.decodeIndexBuffer(bytes, ni, 4, file.subarray(20 + vb));
    const view = new DataView(packed.buffer), index = new Uint32Array(bytes.buffer);
    const vertex = id => [view.getFloat32(id * 20, true), view.getFloat32(id * 20 + 4, true), view.getFloat32(id * 20 + 8, true)];
    for (let i = 0; i < ni; i += 3) {
      if (![1, 3].includes(packed[index[i] * 20 + 15])) continue;
      const points = [vertex(index[i]), vertex(index[i + 1]), vertex(index[i + 2])];
      const [a, b, c] = points;
      const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(denominator) < 1e-8) continue;
      triangles.push({ points, denominator, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])) });
    }
  }
  return (x, z) => {
    let height = null;
    for (const t of triangles) {
      if (x < t.minX - 1e-6 || x > t.maxX + 1e-6 || z < t.minZ - 1e-6 || z > t.maxZ + 1e-6) continue;
      const [a, b, c] = t.points;
      const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / t.denominator;
      const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / t.denominator, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-6) continue;
      const y = wa * a[1] + wb * b[1] + wc * c[1];
      if (y > -5 && y <= 250 && (height === null || y > height)) height = y;
    }
    return height;
  };
}

test('Bliss covers every exact named OSM way as one eastern-to-western chain including the bend', () => {
  const named = read('public/data/city-locations.json').roads.filter(road => road.name === 'Bliss Street');
  assert.deepEqual(corridor.roads.map(r => r.id).sort(), named.map(r => r.id).sort());
  assert.equal(corridor.roads.length, 6);
  assert.equal(corridor.registrationVersion, read('public/data/registration.json').version);
  closePoint(corridor.points[0], [-2200.5, -1373.6]);
  closePoint(corridor.points.at(-1), [-3433.7, -1123.2]);
  // The west bend turns south beyond the long AUB frontage and must not be truncated.
  assert.ok(corridor.points.some(([x, z]) => x < -3439 && z > -1203));
  let station = 0;
  for (const [i, segment] of corridor.segments.entries()) {
    if (i) assert.deepEqual(corridor.segments[i - 1].b, segment.a);
    close(segment.station, station);
    const length = Math.hypot(segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]);
    close(segment.length, length);
    station += length;
  }
  close(corridor.length, station);
  assert.ok(corridor.length > 1395 && corridor.length < 1396);
});

test('corridor identities and heights preserve the supplied source with ordered finite stations', () => {
  const ids = corridor.buildings.map(b => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(corridor.summary.frontageBuildings, ids.length);
  let previous = -Infinity;
  for (const building of corridor.buildings) {
    assert.deepEqual(building.bounds, sourceBounds[building.id].slice(0, 4));
    assert.equal(building.sourceBase, sourceBounds[building.id][4]);
    assert.equal(building.roof, sourceBounds[building.id][5]);
    assert.equal(building.ground, sourceGround[building.id]);
    close(building.height, building.roof - building.ground);
    assert.ok(building.station >= previous && building.station <= corridor.length);
    assert.ok(building.frontage.minimumSetback <= corridor.selection.maximumFrontageSetbackMetres);
    assert.ok(building.height > 0 && Number.isFinite(building.distance));
    assert.ok(['left', 'right'].includes(building.side));
    previous = building.station;
  }
  assert.equal(corridor.summary.existingPhotoAssociations, corridor.buildings.filter(b => b.photo).length);
});

// Independently intersect the sample ray with rectangle edges, rather than the
// survey builder's slab algorithm. This catches a silently dropped street side.
function firstEdgeHit(origin, direction, bounds, limit) {
  const [x0, z0, x1, z1] = bounds;
  if (origin[0] >= x0 && origin[0] <= x1 && origin[1] >= z0 && origin[1] <= z1) return 0;
  const edges = [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]];
  let nearest = Infinity;
  for (const [a, b] of edges) {
    const e = [b[0] - a[0], b[1] - a[1]], q = [a[0] - origin[0], a[1] - origin[1]];
    const determinant = direction[0] * e[1] - direction[1] * e[0];
    if (Math.abs(determinant) < 1e-9) continue;
    const t = (q[0] * e[1] - q[1] * e[0]) / determinant;
    const u = (q[0] * direction[1] - q[1] * direction[0]) / determinant;
    if (t >= -1e-8 && t <= limit + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) nearest = Math.min(nearest, Math.max(0, t));
  }
  return nearest;
}

test('every first-hit frontage on both street sides is represented, independent of traversal order', () => {
  const settings = corridor.selection, box = corridor.roadBounds, range = settings.maximumFrontageSetbackMetres;
  const candidates = sourceBounds.map((bounds, id) => ({ bounds, id })).filter(({ bounds: b }) =>
    b[5] - b[4] >= settings.minimumVolumeHeightMetres && (b[2] - b[0]) * (b[3] - b[1]) >= settings.minimumFootprintAreaSquareMetres &&
    b[0] <= box.maxX + range && b[2] >= box.minX - range && b[1] <= box.maxZ + range && b[3] >= box.minZ - range);
  const selected = candidateOrder => {
    const result = new Set();
    for (const segment of corridor.segments) {
      const dx = segment.b[0] - segment.a[0], dz = segment.b[1] - segment.a[1], length = Math.hypot(dx, dz);
      const count = Math.ceil(length / settings.sampleSpacingMetres);
      for (let i = 0; i <= count; i++) for (const side of [-1, 1]) {
        const p = [segment.a[0] + dx * i / count, segment.a[1] + dz * i / count], ray = [-dz / length * side, dx / length * side];
        let first;
        for (const candidate of candidateOrder) {
          const b = candidate.bounds, x = (b[0] + b[2]) / 2, z = (b[1] + b[3]) / 2;
          if ((x - p[0]) * ray[0] + (z - p[1]) * ray[1] < 0) continue;
          const hit = firstEdgeHit(p, ray, b, range);
          if (Number.isFinite(hit) && (!first || hit < first.hit || (hit === first.hit && candidate.id < first.id))) first = { id: candidate.id, hit };
        }
        if (first) result.add(first.id);
      }
    }
    return [...result].sort((a, b) => a - b);
  };
  const ids = corridor.buildings.map(b => b.id).sort((a, b) => a - b);
  assert.deepEqual(selected(candidates), ids);
  assert.deepEqual(selected([...candidates].reverse()), ids);
});

test('CAD boundary extraction retains a recessed L-shaped wall instead of its convex hull', () => {
  const a = [0, 0], b = [4, 0], c = [4, 1], d = [1, 1], e = [1, 4], f = [0, 4];
  const triangles = [[a, b, c], [d, c, a], [a, d, f], [f, e, d]];
  const loops = boundaryLoops(triangles);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 6);
  close(Math.abs(signedArea(loops[0])), 7);
  assert.ok(loops[0].some(([x, y]) => x === 1 && y === 1));
  const clipped = clipAbove(loops[0], .5);
  close(Math.abs(signedArea(clipped)), 5);
  assert.ok(clipped.every(([, y]) => y >= .5));
});

test('disconnected coplanar source pieces remain separate and ground clipping preserves sloped roofs', () => {
  const triangles = [[[0, 0], [2, 0], [2, 3]], [[0, 0], [2, 3], [0, 3]],
    [[5, 7], [8, 7], [8, 9]], [[5, 7], [8, 9], [5, 9]]];
  const loops = boundaryLoops(triangles);
  assert.equal(loops.length, 2);
  assert.deepEqual(loops.map(p => Math.abs(signedArea(p))).sort(), [6, 6]);
  const pentagon = [[0, 0], [6, 0], [6, 3], [3, 5], [0, 3]];
  const clipped = clipAbove(pentagon, 2);
  close(Math.abs(signedArea(clipped)), 12);
  assert.ok(clipped.some(([x, y]) => x === 3 && y === 5));
  assert.ok(clipped.every(([, y]) => y >= 2));
  assert.deepEqual(clipAbove(pentagon, 6), []);
  assert.deepEqual(clipAbove(pentagon, -1), pentagon);
});

test('CAD pieces touching at one vertex retain both boundary loops and their full area', () => {
  // Real source walls for buildings 640 and 2063 contain this topology. A
  // vertex-global visited set silently discards the second touching component.
  const triangles = [[[0, 0], [2, 0], [2, 2]], [[0, 0], [2, 2], [0, 2]],
    [[2, 2], [4, 2], [4, 4]], [[2, 2], [4, 4], [2, 4]]];
  const loops = boundaryLoops(triangles);
  assert.equal(loops.length, 2);
  close(loops.reduce((area, loop) => area + Math.abs(signedArea(loop)), 0), 8);
});

test('route interpolation clamps endpoints and changes direction correctly through a corner', () => {
  const route = { length: 25, segments: [{ a: [2, 3], b: [11, 15], station: 0, length: 15 }, { a: [11, 15], b: [1, 15], station: 15, length: 10 }] };
  const start = pointAlongBliss(route, -20), midpoint = pointAlongBliss(route, 7.5), corner = pointAlongBliss(route, 15), end = pointAlongBliss(route, 100);
  closePoint([start.x, start.z], [2, 3]);
  closePoint([midpoint.x, midpoint.z], [6.5, 9]);
  closePoint([corner.x, corner.z], [11, 15]);
  closePoint([end.x, end.z], [1, 15]);
  close(start.station, 0); close(end.station, 25);
  closePoint([-Math.sin(midpoint.yaw), -Math.cos(midpoint.yaw)], [.6, .8]);
  closePoint([-Math.sin(end.yaw), -Math.cos(end.yaw)], [-1, 0]);
  close(nearestBlissStation(route, { x: 6, z: 17 }), 20);
  assert.throws(() => pointAlongBliss({ segments: [] }, 0), /no mapped route/);
});

test('Bliss stops lie on the full route in travel order, including the sourced AUB gate', () => {
  const first = pointAlongBliss(corridor, 0), last = pointAlongBliss(corridor, corridor.length);
  closePoint([first.x, first.z], corridor.points[0]); closePoint([last.x, last.z], corridor.points.at(-1));
  const stops = blissStops(corridor);
  assert.deepEqual(stops.map(s => s.id), ['east', 'gate', 'middle', 'west']);
  assert.equal(new Set(stops.map(s => s.id)).size, stops.length);
  for (const [i, stop] of stops.entries()) {
    if (i) assert.ok(stop.station > stops[i - 1].station);
    assert.ok(stop.station > 0 && stop.station < corridor.length);
    close(nearestBlissStation(corridor, stop), stop.station, .004);
  }
  // AUB's published main-gate coordinate, converted with registration v2.
  const gateStation = nearestBlissStation(corridor, { x: -2433.73, z: -1419.94 });
  assert.ok(Math.abs(stops.find(s => s.id === 'gate').station - gateStation) < 10);
  assert.ok(stops.at(-1).z > -1200, 'western stop must reach the street bend');
});

test('extracted CAD facade polygons retain source bounds, measured street ground and actual roof height', async () => {
  const architecture = read('public/data/bliss-architecture.json');
  const landmarks = read('public/data/bliss-landmarks.json');
  const heritagePath = new URL('../public/data/bliss-heritage.json', import.meta.url);
  const heritage = existsSync(heritagePath) ? read('public/data/bliss-heritage.json') : null;
  const replacements = new Map(landmarks.replacementBuildingIds.map(id => [id, {
    kind: 'bliss-landmarks', record: landmarks.landmarks.find(item => item.replacementBuildingId === id), sourceManifest: landmarks,
  }]));
  for (const id of heritage?.replacementBuildingIds ?? []) {
    assert.ok(!replacements.has(id), `building ${id} must have only one replacement owner`);
    replacements.set(id, { kind: 'bliss-heritage', record: heritage.buildings.find(item => item.id === id), sourceManifest: heritage });
  }
  const terrainAt = await decodedStreetTerrain();
  assert.deepEqual(architecture.buildings.map(b => b.id).sort((a, b) => a - b), corridor.buildings.map(b => b.id).sort((a, b) => a - b));
  const ids = new Set(); let measured = 0, slopeCorrections = 0;
  for (const building of architecture.buildings) {
    const replacement = replacements.get(building.id);
    let faces = building.facades;
    if (replacement) {
      assert.equal(building.replacedBy, replacement.kind);
      assert.equal(building.facades.length, 0, 'replaced source mass must not receive duplicate facade geometry');
      const source = replacement.record, sourceIds = source?.sources ?? source?.sourceIds;
      assert.ok(sourceIds?.length, 'each replacement needs a corresponding sourced geometry record');
      assert.ok(sourceIds.every(id => replacement.sourceManifest.sources.some(item => item.id === id)), 'replacement source references must resolve in its manifest');
      assert.ok(source.footprint?.length >= 3 && source.footprint.every(p => p.length === 2 && p.every(Number.isFinite)), 'replacement requires a finite retained or independently sourced footprint');
      assert.ok(Math.abs(signedArea(source.footprint)) > 1 && Number.isFinite(source.height) && source.height > 0);
      if (replacement.kind === 'bliss-heritage') {
        assert.deepEqual(source.originalBounds, sourceBounds[building.id]);
        assert.ok(source.sourceFacade?.polygon?.length >= 3 && source.walls?.length >= 3, 'heritage replacement must preserve its source facade and wall geometry');
        assert.ok(building.sourceFacades?.length > 0, 'retired source faces remain available for geometric proof');
        faces = building.sourceFacades;
      } else faces=building.sourceFacades??[];
    }
    if (!faces.length) {
      assert.match(building.omissionReason ?? '', /No source wall remains at least 2\.6m tall above local measured street terrain/);
      continue;
    }
    const bounds = sourceBounds[building.id];
    for (const face of faces) {
      assert.ok(!ids.has(face.id)); ids.add(face.id);
      let measuredGround = null;
      for (const offset of [1, 2.5, 4]) {
        measuredGround = terrainAt(face.center[0] + face.normal[0] * offset, face.center[1] + face.normal[1] * offset);
        if (measuredGround !== null) break;
      }
      if (measuredGround !== null) {
        close(face.base, measuredGround, .025); measured++;
        if (Math.abs(face.base - sourceGround[building.id]) > .25) slopeCorrections++;
      } else close(face.base, sourceGround[building.id]);
      assert.match(face.baseSource, /raycast against road\/sidewalk mesh/);
      assert.ok(face.top <= bounds[5] + .08 && face.top > face.base);
      assert.ok(Math.abs(signedArea(face.polygon)) >= 5.99);
      assert.equal(new Set(face.polygon.map(p => p.join(','))).size, face.polygon.length);
      close(Math.hypot(...face.normal), 1); close(Math.hypot(...face.tangent), 1);
      close(face.normal[0] * face.tangent[0] + face.normal[1] * face.tangent[1], 0);
      close(Math.max(...face.polygon.map(p => p[1])), face.top - face.base, .004);
      for (const [u, y] of face.polygon) {
        assert.ok(y >= -.001 && y <= face.top - face.base + .004);
        const x = face.center[0] + face.tangent[0] * u, z = face.center[1] + face.tangent[1] * u;
        assert.ok(x >= bounds[0] - .3 && x <= bounds[2] + .3 && z >= bounds[1] - .3 && z <= bounds[3] + .3, `face ${face.id} exceeds its source footprint`);
      }
    }
  }
  const renderCount = architecture.buildings.reduce((sum, building) => sum + building.facades.length, 0);
  const retainedCount = architecture.buildings.reduce((sum, building) => sum + (building.sourceFacades?.length ?? 0), 0);
  assert.equal(renderCount, architecture.summary.facades);
  assert.equal(ids.size, renderCount + retainedCount);
  assert.ok(measured > ids.size * .8, 'terrain must independently substantiate most facade bases');
  assert.ok(slopeCorrections > 0, 'the sloped corridor cannot use one building median for every facade');
});
