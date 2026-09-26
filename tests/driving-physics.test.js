import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
test('physics worker samples real ground and drives a spawned Mercedes', { timeout: 15000 }, async () => {
  const moduleUrl = new URL('../src/physics-worker.js', import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');global.self=globalThis;self.postMessage=m=>parentPort.postMessage(m);parentPort.on('message',data=>self.onmessage({data}));import(${JSON.stringify(moduleUrl)});`, { eval: true });
  const messages = [], waiters = [];
  worker.on('message', message => { messages.push(message); for (const check of [...waiters]) check(message); });
  const waitFor = (predicate, label = 'response') => new Promise((resolve, reject) => {
    const seen = messages.findLast(predicate); if (seen) return resolve(seen);
    const timer = setTimeout(() => { waiters.splice(waiters.indexOf(check), 1); reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(messages.slice(-8))}`)); }, 10000);
    const check = message => { if (predicate(message)) { clearTimeout(timer); waiters.splice(waiters.indexOf(check), 1); resolve(message); } };
    waiters.push(check);
  });
  try {
    await waitFor(message => message.type === 'ready');
    const positions = new Float32Array([
      -30,0,-30,30,0,-30,30,0,30,-30,0,30,
      -6,0,-18,6,0,-18,6,4,-18,-6,4,-18,
      -6,8,-4,6,8,-4,6,8,-7,-6,8,-7,
    ]);
    const indices = new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,8,10,9,8,11,10]);
    const surfaces = new Uint8Array([1,3,5,5,5,5]);
    worker.postMessage({ type: 'tile', id: 'ground', position: positions.buffer, index: indices.buffer, surfaces: surfaces.buffer });
    await waitFor(message => message.type === 'tile-ready');
    worker.postMessage({ type: 'sample-ground', requestId: 'street', points: [{ x: 0, z: 0 }] });
    assert.ok(Math.abs((await waitFor(message => message.type === 'ground-samples')).points[0].y) < .001);
    worker.postMessage({type:'sample-ground',requestId:'surface-types',points:[{x:20,z:-20},{x:-20,z:20},{x:0,z:-5},{x:100,z:100}]});
    const sampled=(await waitFor(message=>message.type==='ground-samples'&&message.requestId==='surface-types')).points;
    assert.deepEqual(sampled.map(point=>point.surface),[1,3,5,null], 'road, sidewalk, overhead deck and missing ground retain their actual mesh categories');
    worker.postMessage({ type: 'spawn', x: 0, z: 0 });
    await waitFor(message => message.type === 'spawned');
    worker.postMessage({ type: 'spawn-vehicles', candidates: [
      { id: 'benz', x: 0, z: -3, yaw: 0, model: 'mercedes-w124', dimensions: { x: 2.478, y: 1.362, z: 4.85 } },
      { id: 'roof', x: 0, z: -5, yaw: 0, model: 'mercedes-w124' },
      { id: 'parked', x: 0, z: -10, yaw: 0, model: 'mercedes-sprinter', dimensions: { x: 2.975, y: 2.314, z: 5.9 } },
    ] });
    const spawned = await waitFor(message => message.type === 'vehicles-spawned');
    assert.equal(spawned.vehicles[0].model, 'mercedes-w124');
    assert.equal(spawned.vehicles[0].dimensions.z, 4.85);
    assert.ok(Math.abs(spawned.vehicles[0].position.y) < .15);
    assert.equal(spawned.vehicles[1].cameraDistance, undefined);
    worker.postMessage({ type: 'enter-vehicle', id: 'roof' });
    await waitFor(message=>message.type==='vehicle-enter-denied','refuse entry on another floor');
    worker.postMessage({ type: 'enter-vehicle', id: 'benz' });
    await waitFor(message => message.type === 'vehicle-entered');
    worker.postMessage({ type: 'driving-input', input: { forward: 1 } });
    const moving = await waitFor(message => message.type === 'position' && message.vehicle?.id === 'benz' && message.speed > 1, 'moving vehicle');
    assert.ok(moving.vehicle.position.z < -3);
    assert.ok(Math.abs(moving.vehicle.position.y) < .25);
    assert.equal(moving.vehicle.wheels.length,4);
    assert.ok(moving.vehicle.rotation);
    const impact = await waitFor(message => message.type === 'vehicle-impact' && message.vehicle?.id === 'benz', 'vehicle impact');
    assert.ok(impact.damage > 0 && impact.vehicle.health < 100);
    assert.ok(Math.abs(impact.vehicle.position.y) < .5, 'car stays on the road when driving below a deck');
    worker.postMessage({ type: 'driving-input', input: {} });
    worker.postMessage({ type: 'reset-vehicle', id: 'benz' });
    const reset = await waitFor(message => message.type === 'vehicle-reset', 'vehicle reset');
    assert.equal(reset.vehicle.speed, 0);
    assert.equal(reset.vehicle.health, 100);
    assert.ok(reset.vehicle.position.z > -9);
    worker.postMessage({ type: 'exit-vehicle' });
    const exited = await waitFor(message => message.type === 'vehicle-exited', 'vehicle exit');
    assert.ok(Number.isFinite(exited.x) && Number.isFinite(exited.y) && Number.isFinite(exited.z));
    worker.postMessage({ type: 'active', value: false });
  } finally { await worker.terminate(); }
});
