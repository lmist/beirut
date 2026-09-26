import test from 'node:test';
import assert from 'node:assert/strict';
import { ResidentPaths, residentObstructed } from '../src/game/residents.js';
import { GameExperience } from '../src/game/experience.js';

const road = { id: 'hamra', highway: 'residential', points: [[0, 0], [100, 0]] };

test('resident route candidates follow roads and keep their full paths outside buildings', () => {
  const buildings = [[30, 1, 50, 12, 0, 30]];
  const paths = new ResidentPaths([road], buildings);
  const points = paths.candidates({ x: 50, z: 0 }, 100, 70);
  assert.ok(points.length > 0);
  for (const point of points) {
    assert.ok(paths.clear(point.x, point.z));
    if (!point.path) continue;
    for (let i = 0; i <= 40; i++) {
      const { a, b } = point.path;
      assert.ok(paths.clear(a.x + (b.x - a.x) * i / 40, a.z + (b.z - a.z) * i / 40));
    }
  }
  assert.equal(new ResidentPaths([{ ...road, bridge: true }], []).candidates({ x: 50, z: 0 }).length, 0);
  assert.equal(new ResidentPaths([{ ...road, highway: 'motorway' }], []).candidates({ x: 50, z: 0 }).length, 0);
});

test('residents wait outside occupied vehicle footprints and for nearby people', () => {
  const car = { position: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2 };
  assert.equal(residentObstructed({ x: 3, y: 0, z: 0 }, null, [car]), true);
  assert.equal(residentObstructed({ x: 0, y: 0, z: 3 }, null, [car]), false);
  assert.equal(residentObstructed({ x: 3, y: 10, z: 0 }, null, [car]), false);
  assert.equal(residentObstructed({ x: 1, y: 0, z: 0 }, { x: 0, z: 0 }), true);
  assert.equal(residentObstructed({ x: 1, y: 0, z: 0 }, null, [], [{ x: 1.5, y: 0, z: 0 }]), true);
});

test('residents spawn only on actual sidewalks and do not walk across asphalt', async () => {
  const candidates = [
    { x: 0, z: 0, surface: 1, y: 0 },
    { x: 10, z: 0, surface: 5, y: 15 },
    { x: 20, z: 0, surface: 3, y: 0, path: { a: { x: 14, z: 0 }, b: { x: 26, z: 0 } } },
    { x: 40, z: 0, surface: 3, y: 0, path: { a: { x: 34, z: 0 }, b: { x: 46, z: 0 } } },
  ];
  let calls = 0;
  const context = { sampleGround: async points => ++calls === 1 ? points : points.map(point => ({ ...point, y: 0, surface: point.x > 22 && point.x < 26 ? 1 : 3 })) };
  const residents = await GameExperience.prototype.sampleResidents.call(context, candidates);
  assert.equal(residents.length, 2);
  assert.equal(residents[0].x, 20);
  assert.equal(residents[0].path, null, 'a safe center remains an idle resident when the route crosses asphalt');
  assert.ok(residents[1].path, 'a fully validated sidewalk can support walking');
});
