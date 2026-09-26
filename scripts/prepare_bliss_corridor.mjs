/**
 * Build a reproducible survey of every named OSM Bliss Street section.
 * Only existing local geometry and photograph metadata are read. No requests.
 * Run from the repository root: node scripts/prepare_bliss_corridor.mjs
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { toWgs84 } from '../src/game/georeference.js';

const read = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const [locations, bounds, groundHeights, registration, facades] = await Promise.all([
  read('public/data/city-locations.json'), read('public/data/buildings.json'),
  read('public/data/building-ground.json'), read('public/data/registration.json'),
  read('public/assets/world/photographic/facades.json'),
]);
if (registration.version !== 2 || locations.registration.zSign !== registration.zSign) {
  throw new Error('Bliss survey requires the corrected, matching registration v2.');
}
const rounded = (n, places = 3) => Number(n.toFixed(places));
const roundPoint = p => p.map(n => rounded(n));
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const key = p => p.join(',');
const named = locations.roads.filter(road => road.name === 'Bliss Street');
if (!named.length) throw new Error('No exact Bliss Street road names found.');

// Follow the connected OSM ways from the eastern endpoint through the west bend.
const ends = new Map();
for (const road of named) {
  for (const p of [road.points[0], road.points.at(-1)]) {
    const item = ends.get(key(p)) ?? { point: p, roads: [] };
    item.roads.push(road); ends.set(key(p), item);
  }
}
if ([...ends.values()].some(item => item.roads.length > 2)) throw new Error('Branched Bliss road topology needs review.');
const terminals = [...ends.values()].filter(item => item.roads.length === 1);
if (terminals.length !== 2) throw new Error('Bliss Street must be one open connected chain.');
let cursor = terminals.sort((a, b) => b.point[0] - a.point[0])[0].point;
const visited = new Set(), roads = [], points = [], segments = [];
let station = 0;
while (visited.size < named.length) {
  const road = ends.get(key(cursor)).roads.find(r => !visited.has(r.id));
  if (!road) throw new Error('Disconnected Bliss Street ways.');
  visited.add(road.id);
  const ordered = key(road.points[0]) === key(cursor) ? road.points : [...road.points].reverse();
  const start = station;
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1], length = distance(a, b);
    segments.push({ a, b, station, length, roadId: road.id, direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] });
    station += length;
  }
  points.push(...(points.length ? ordered.slice(1) : ordered));
  roads.push({ id: road.id, name: road.name, nameAr: road.nameAr, points: ordered, stationStart: rounded(start), stationEnd: rounded(station) });
  cursor = ordered.at(-1);
}

function nearest(point) {
  let best;
  for (const [segmentIndex, segment] of segments.entries()) {
    const { a, b, length, direction: d } = segment;
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * d[0] + (point[1] - a[1]) * d[1]) / length));
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const dist = distance(point, p);
    if (!best || dist < best.distance) best = { point: p, distance: dist, station: segment.station + t * length, segmentIndex, direction: d };
  }
  return best;
}

// AABB slab intersection, in model metres. The ray direction is unit length.
function rayEntry(origin, direction, b, maxDistance) {
  let lo = 0, hi = maxDistance;
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < b[axis] || origin[axis] > b[axis + 2]) return null;
    } else {
      const t1 = (b[axis] - origin[axis]) / direction[axis];
      const t2 = (b[axis + 2] - origin[axis]) / direction[axis];
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    }
  }
  return hi >= lo ? lo : null;
}

const options = { sampleSpacingMetres: 2, maximumFrontageSetbackMetres: 65, minimumVolumeHeightMetres: 6, minimumFootprintAreaSquareMetres: 30 };
const roadBounds = { minX: Math.min(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxX: Math.max(...points.map(p => p[0])), maxZ: Math.max(...points.map(p => p[1])) };
const candidates = bounds.map((b, id) => ({ id, bounds: b, center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] })).filter(({ bounds: b }) =>
  b[5] - b[4] >= options.minimumVolumeHeightMetres && (b[2] - b[0]) * (b[3] - b[1]) >= options.minimumFootprintAreaSquareMetres &&
  b[0] <= roadBounds.maxX + 65 && b[2] >= roadBounds.minX - 65 && b[1] <= roadBounds.maxZ + 65 && b[3] >= roadBounds.minZ - 65);

const hits = new Map();
for (const segment of segments) {
  const steps = Math.ceil(segment.length / options.sampleSpacingMetres);
  for (let sample = 0; sample <= steps; sample++) {
    const fraction = sample / steps;
    const origin = [segment.a[0] + (segment.b[0] - segment.a[0]) * fraction, segment.a[1] + (segment.b[1] - segment.a[1]) * fraction];
    for (const sideSign of [-1, 1]) {
      // In model x/z, the physically left side of an east→west journey is south.
      const direction = [-segment.direction[1] * sideSign, segment.direction[0] * sideSign];
      let first;
      for (const building of candidates) {
        if ((building.center[0] - origin[0]) * direction[0] + (building.center[1] - origin[1]) * direction[1] < 0) continue;
        const d = rayEntry(origin, direction, building.bounds, options.maximumFrontageSetbackMetres);
        if (d === null) continue;
        if (!first || d < first.distance || (d === first.distance && building.id < first.id)) first = { id: building.id, distance: d };
      }
      if (!first) continue;
      const hit = hits.get(first.id) ?? { samples: 0, stationMin: Infinity, stationMax: -Infinity, minimumSetback: Infinity };
      hit.samples++;
      const sampleStation = segment.station + segment.length * fraction;
      hit.stationMin = Math.min(hit.stationMin, sampleStation); hit.stationMax = Math.max(hit.stationMax, sampleStation);
      hit.minimumSetback = Math.min(hit.minimumSetback, first.distance);
      hits.set(first.id, hit);
    }
  }
}

const buildings = [...hits].map(([id, exposure]) => {
  const b = bounds[id], center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], near = nearest(center);
  const cross = near.direction[0] * (center[1] - near.point[1]) - near.direction[1] * (center[0] - near.point[0]);
  const geo = toWgs84(...center, registration);
  const ground = groundHeights[id] ?? b[4];
  return {
    id, bounds: b.slice(0, 4), ground, roof: b[5], sourceBase: b[4], height: rounded(b[5] - ground), center: roundPoint(center),
    selectionStatus: exposure.samples >= 3 ? 'frontage' : 'partial-frontage',
    lat: rounded(geo.lat, 8), lon: rounded(geo.lon, 8), distance: rounded(near.distance), station: rounded(near.station),
    side: cross < 0 ? 'left' : 'right', nearestPoint: roundPoint(near.point), roadDirection: roundPoint(near.direction),
    roadId: segments[near.segmentIndex].roadId, segmentIndex: near.segmentIndex,
    frontage: { sampleCount: exposure.samples, stationStart: rounded(exposure.stationMin), stationEnd: rounded(exposure.stationMax), minimumSetback: rounded(exposure.minimumSetback) },
    photo: facades.buildings[id] ?? null,
  };
}).sort((a, b) => a.station - b.station || a.id - b.id);

const allBounds = { minX: Math.min(...buildings.map(b => b.bounds[0])), minZ: Math.min(...buildings.map(b => b.bounds[1])), maxX: Math.max(...buildings.map(b => b.bounds[2])), maxZ: Math.max(...buildings.map(b => b.bounds[3])) };
const summary = { namedWays: roads.length, centerlinePoints: points.length, lengthMetres: rounded(station), frontageBuildings: buildings.length, leftBuildings: buildings.filter(b => b.side === 'left').length, rightBuildings: buildings.filter(b => b.side === 'right').length, existingPhotoAssociations: buildings.filter(b => b.photo).length, missingPhotoAssociations: buildings.filter(b => !b.photo).length };
const manifest = {
  version: 1, name: 'Bliss Street', nameAr: 'شارع بليس', registrationVersion: registration.version,
  registrationFingerprint: createHash('sha256').update(JSON.stringify(registration)).digest('hex'),
  stationDirection: 'eastern endpoint to western endpoint, including the west bend', length: rounded(station), bounds: allBounds, roadBounds,
  endpoints: [points[0], points.at(-1)].map(([x, z]) => { const p = toWgs84(x, z, registration); return { x, z, lat: rounded(p.lat, 8), lon: rounded(p.lon, 8) }; }),
  selection: { method: 'First modeled building intersected on each side of the road by perpendicular samples.', ...options, sideConvention: 'Left/right while travelling from station zero (east) toward the west bend.', limitations: 'Axis-aligned bounds approximate footprints. A building visible through a gap is included; hidden buildings and very small rooftop volumes are excluded. This is geometry-based corridor coverage, not a surveyed cadastral inventory.' },
  accuracyStatus: 'Registration v2 is street-checked, not facade-surveyed. Cached photograph associations are geometric candidates requiring visual review.',
  roads, points, segments: segments.map(s => ({ ...s, station: rounded(s.station), length: rounded(s.length), direction: roundPoint(s.direction) })), buildings, summary,
  sources: [
    { path: 'public/data/city-locations.json', provider: 'OpenStreetMap contributors', attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0' },
    { path: 'public/data/buildings.json', provider: 'Supplied Beirut city model', role: 'Modeled bounds and roof elevations' },
    { path: 'public/data/building-ground.json', role: 'Existing terrain-derived ground elevations' },
    { path: 'public/data/registration.json', role: 'Canonical corrected registration v2' },
    { path: 'public/assets/world/photographic/facades.json', provider: 'Google Street View', attribution: '© Google', role: 'Existing association metadata; not independently verified facade matches' },
  ],
};
await fs.mkdir('data/bliss-street', { recursive: true });
await fs.writeFile('public/data/bliss-street.json', `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile('data/bliss-street/survey-summary.json', `${JSON.stringify({ ...summary, endpoints: manifest.endpoints, roadBounds, bounds: allBounds, buildingIds: buildings.map(b => b.id) }, null, 2)}\n`);

// Vector evidence map: labels are model building IDs, not asserted street addresses.
const padding = 40, mapWidth = allBounds.maxX - allBounds.minX + padding * 2, mapHeight = allBounds.maxZ - allBounds.minZ + padding * 2;
const mapPoint = p => [p[0] - allBounds.minX + padding, p[1] - allBounds.minZ + padding + 74];
const rects = buildings.map(b => {
  const [x, y] = mapPoint([b.bounds[0], b.bounds[1]]), [cx, cy] = mapPoint(b.center);
  const fill = b.photo ? '#256f7c' : '#645347';
  return `<g><title>Building ${b.id}; station ${b.station}m; ${b.side}; ${b.photo ? 'existing photograph candidate' : 'no existing photograph association'}</title><rect x="${x}" y="${y}" width="${b.bounds[2] - b.bounds[0]}" height="${b.bounds[3] - b.bounds[1]}" fill="${fill}" stroke="#b6c7c9" stroke-width=".5"${b.selectionStatus === 'partial-frontage' ? ' stroke-dasharray="2 2"' : ''}/><text x="${cx}" y="${cy + 2}" text-anchor="middle" fill="#ffffff" font-size="6">${b.id}</text></g>`;
}).join('\n');
const roadLine = points.map(p => mapPoint(p).join(',')).join(' ');
const stationLabels = buildings.filter((b, i) => i === 0 || Math.floor(b.station / 100) > Math.floor(buildings[i - 1].station / 100)).map(b => { const [x, y] = mapPoint(b.nearestPoint); return `<text x="${x}" y="${y - 5}" fill="#fce8ae" font-size="7">${Math.round(b.station)}m</text>`; }).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="${Math.round((mapHeight + 110) / mapWidth * 1800)}" viewBox="0 0 ${mapWidth} ${mapHeight + 110}">
<rect width="100%" height="100%" fill="#101b22"/>
<g font-family="system-ui,sans-serif"><text x="${padding}" y="26" fill="#fff" font-size="17">Bliss Street · entire named corridor · ${summary.lengthMetres} m</text>
<text x="${padding}" y="44" fill="#b3c6cc" font-size="10">${buildings.length} modeled frontage buildings · east → west stations · north up · corrected registration v2</text>
<text x="${padding}" y="61" fill="#b3c6cc" font-size="9">Blue: ${summary.existingPhotoAssociations} existing photo candidates · brown: ${summary.missingPhotoAssociations} missing associations · dashed: only a narrow visible part · IDs are model indices</text>
${rects}<polyline points="${roadLine}" stroke="#f2c85c" stroke-width="4" fill="none" stroke-linejoin="round"/>${stationLabels}
<text x="${padding}" y="${mapHeight + 100}" fill="#90a5af" font-size="9">© OpenStreetMap contributors · supplied city model · existing Google Street View metadata · geometry-based selection, not surveyed facade matches</text></g></svg>\n`;
await fs.writeFile('data/bliss-street/survey.svg', svg);
console.log(JSON.stringify(summary, null, 2));
