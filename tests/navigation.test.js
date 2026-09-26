import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { StreetNavigation } from '../src/game/navigation.js';
import { findOpenPoint } from '../src/metrics.js';
import { JOURNEY_START, JOURNEY_STOPS } from '../src/game/journey.js';

test('the Hamra opening has a connected local route for every cassette delivery', () => {
  const buildings = JSON.parse(fs.readFileSync('public/data/buildings.json'));
  const geo = JSON.parse(fs.readFileSync('public/data/city-locations.json'));
  const available = [...geo.landmarks, ...geo.areas];
  const navigation = new StreetNavigation(buildings);
  let start = JOURNEY_START, total = 0;
  navigation.connect(start);
  for (const name of JOURNEY_STOPS) {
    const target = available.find(point => point.name.toLowerCase().includes(name.toLowerCase()));
    assert.ok(target, `registered location: ${name}`);
    const route = navigation.route(start, findOpenPoint(target.x,target.z,buildings,4));
    assert.ok(route.length > 1, `connected route to ${name}`);
    assert.ok(Math.hypot(route.at(-1).x - target.x, route.at(-1).z - target.z) < 45);
    for (let i = 1; i < route.length; i++) {
      assert.ok(navigation.clear(route[i - 1], route[i]), `building clearance on ${name}`);
      total += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
    }
    start = route.at(-1);
  }
  assert.ok(total < 2600, `a compact introductory route, measured ${Math.round(total)}m`);
});
