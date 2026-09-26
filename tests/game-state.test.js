import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CourierMission } from '../src/game/mission.js';

test('courier rewards each stop once and adds the final bonus once', () => {
  const mission = new CourierMission([
    { name: 'First stop', x: 0, z: 0 },
    { name: 'Second stop', x: 100, z: 0 },
  ]);

  assert.equal(mission.cash, 250);
  assert.equal(mission.startDriving(), true);
  assert.equal(mission.arrive(0, 0, 0).cash, 400);
  assert.equal(mission.arrive(0, 0, 0), null, 'the completed stop is no longer targetable');
  assert.equal(mission.cash, 400);
  assert.equal(mission.arrive(100, 0, 0).cash, 1_050);
  assert.equal(mission.complete, true);
  assert.equal(mission.target, null);
  assert.equal(mission.arrive(100, 0, 0), null, 'the final reward cannot repeat');
  assert.equal(mission.cash, 1_050);
});

test('game model manifest points to existing GLB files', async () => {
  const manifest = JSON.parse(await readFile('public/assets/game/models.json', 'utf8'));
  for (const asset of [...manifest.cars, ...manifest.peds]) {
    assert.match(asset.url, /^\/assets\/game\/[^/]+\.glb$/);
    const glb = await readFile(`public${asset.url}`);
    assert.equal(glb.subarray(0, 4).toString('ascii'), 'glTF', asset.id);
    assert.ok(asset.triangles > 0, asset.id);
    assert.ok(asset.dimensions.x > 0 && asset.dimensions.y > 0 && asset.dimensions.z > 0, asset.id);
  }
});

test('all eleven supplied cars have usable proportions and four authored axle positions', async()=>{
  const {cars}=JSON.parse(await readFile('public/assets/game/models.json','utf8'));
  assert.equal(cars.length,11);
  assert.equal(new Set(cars.map(c=>c.id)).size,11);
  for(const car of cars){
    assert.ok(car.dimensions.x>1.5&&car.dimensions.x<2.8,car.id);
    assert.ok(car.dimensions.y>1&&car.dimensions.y<3,car.id);
    assert.ok(car.dimensions.z>4&&car.dimensions.z<6.5,car.id);
    assert.equal(car.wheels.length,4,car.id);
    assert.ok(car.wheels.slice(0,2).every(w=>w.z<0),car.id);
    assert.ok(car.wheels.slice(2).every(w=>w.z>0),car.id);
    assert.ok(car.wheels.every(w=>Number.isFinite(w.x)&&Math.abs(w.x)<car.dimensions.x/2),car.id);
    assert.ok(car.wheelRadius>=.25&&car.wheelRadius<=.48,car.id);
  }
});

test('saved mission progress restores earned rewards without duplicating them', () => {
  const stops = [{ id: 'hamra', name: 'Hamra', x: 0, z: 0 }, { id: 'wardieh', name: 'Wardieh', x: 100, z: 0 }];
  const mission = new CourierMission(stops);
  mission.startDriving(); mission.arrive(0, 0, 0);
  const restored = new CourierMission(stops);
  assert.equal(restored.restore(JSON.parse(JSON.stringify(mission.serialize()))), true);
  assert.equal(restored.target.name, 'Wardieh');
  assert.equal(restored.cash, 400);
  assert.equal(restored.arrive(0, 0, 0), null);
  restored.arrive(100, 0, 0);
  const completed = new CourierMission(stops);
  completed.restore(restored.serialize());
  assert.equal(completed.complete, true);
  assert.equal(completed.cash, 1050);
  assert.equal(completed.arrive(100, 0, 0), null);
  completed.restart();
  assert.equal(completed.cash, 250);
  assert.equal(completed.index, -1);
  assert.deepEqual(completed.visited, []);
});

test('mission restore rejects corrupt progress and a different route', () => {
  const mission = new CourierMission([{ id: 'hamra', name: 'Hamra', x: 0, z: 0 }]);
  for (const saved of [null, {}, { version: 1, route: ['hamra'], index: 2 }, { version: 1, route: ['hamra'], index: .5 }, { version: 1, route: ['other'], index: 0 }]) {
    assert.equal(mission.restore(saved), false);
    assert.equal(mission.index, -1);
  }
});
