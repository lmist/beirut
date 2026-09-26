import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { landmarkColliders } from '../src/world/bliss-landmarks.js';

const landmarks = JSON.parse(readFileSync(new URL('../public/data/bliss-landmarks.json', import.meta.url)));

// Exercise the real worker and Rapier with a controlled clock. No physics
// behavior is stubbed; ticks advance the production 60 Hz simulation.
async function physics(t) {
  const moduleUrl = new URL('../src/physics-worker.js', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    let clock = 0, tick, queue = Promise.resolve();
    global.self = globalThis;
    self.postMessage = message => parentPort.postMessage(message);
    Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
    global.setInterval = callback => { tick = callback; return 1; };
    const imported = import(${JSON.stringify(moduleUrl)});
    parentPort.on('message', message => {
      queue = queue.then(async () => {
        await imported;
        if (message.type === '__ticks') {
          for (let i = 0; i < message.frames; i++) { clock += 1000 / 60 + 0.000001; tick(); }
          parentPort.postMessage({ type: '__ticked', requestId: message.requestId });
        } else await self.onmessage({ data: message });
      }).catch(error => parentPort.postMessage({ type: '__harness-error', message: error.stack }));
    });
  `, { eval: true });
  t.after(() => worker.terminate());
  const messages = [], waiters = new Set();
  let failure, request = 0;
  const fail = error => { failure = error; for (const waiter of [...waiters]) waiter.reject(error); };
  worker.on('error', fail);
  worker.on('message', message => {
    messages.push(message);
    if (message.type === '__harness-error') return fail(new Error(message.message));
    for (const waiter of [...waiters]) waiter.check();
  });
  function waitFor(predicate, after = 0) {
    return new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      let timer;
      const cleanup = () => { clearTimeout(timer); waiters.delete(waiter); };
      const waiter = {
        check() { const found = messages.slice(after).find(predicate); if (found) { cleanup(); resolve(found); } },
        reject(error) { cleanup(); reject(error); },
      };
      timer = setTimeout(() => waiter.reject(new Error(`Worker response timed out: ${JSON.stringify(messages.slice(-3))}`)), 5000);
      waiters.add(waiter); waiter.check();
    });
  }
  async function send(message, type) {
    const after = messages.length;
    worker.postMessage(message);
    if (!type) return;
    return waitFor(response => typeof type === 'function' ? type(response) : response.type === type, after);
  }
  await waitFor(message => message.type === 'ready');
  return {
    send,
    async ground({ x = 0, y = 0, z = 0, radius = 40 } = {}) {
      const position = new Float32Array([x-radius,y,z-radius, x+radius,y,z-radius, x+radius,y,z+radius, x-radius,y,z+radius]);
      const index = new Uint32Array([0,2,1,0,3,2]), surfaces = new Uint8Array([1,1]);
      return send({ type: 'tile', id: `ground-${request++}`, position: position.buffer, index: index.buffer, surfaces: surfaces.buffer }, 'tile-ready');
    },
    architecture(boxes, id = 'bliss') {
      return send({ type: 'architecture', id, boxes }, message => message.type === 'architecture-ready' || message.type === 'error');
    },
    spawn(x = 0, z = 0) { return send({ type: 'spawn', x, z }, 'spawned'); },
    async walk({ forward = 0, yaw = 0, frames = 1 } = {}) {
      const after = messages.length, requestId = request++;
      await send({ type: 'input', forward, yaw });
      await send({ type: '__ticks', frames, requestId }, message => message.type === '__ticked' && message.requestId === requestId);
      const result = messages.slice(after).findLast(message => message.type === 'position');
      assert.ok(result, 'controlled simulation tick returns a position');
      return result;
    },
  };
}

const wallBox = z => ({ center: [0, 3, z], halfExtents: [5, 3, .25], yaw: 0 });
const localToWorld = (origin, yaw, x, z) => ({ x: origin[0] + x * Math.cos(yaw) + z * Math.sin(yaw), z: origin[2] - x * Math.sin(yaw) + z * Math.cos(yaw) });
const localZ = (point, origin, yaw) => (point.x-origin[0])*Math.sin(yaw) + (point.z-origin[2])*Math.cos(yaw);

test('architecture blocks walking and shortens the chase camera immediately after registration', { timeout: 10000 }, async t => {
  const p = await physics(t); await p.ground();
  assert.deepEqual(await p.architecture([wallBox(-2)]), { type: 'architecture-ready', id: 'bliss', count: 1 });
  await p.spawn(0, 2);
  const camera = await p.walk({ yaw: Math.PI });
  assert.ok(camera.cameraDistance > 3.2 && camera.cameraDistance < 3.6, `camera retracts before the wall: ${camera.cameraDistance}`);
  const stopped = await p.walk({ forward: 1, frames: 120 });
  assert.ok(stopped.z > -1.6 && stopped.z < -1.2, `walker stops at the near face: ${stopped.z}`);
  assert.ok(stopped.grounded, 'wall collision does not lift the walker off the street');
});

test('architecture roofs do not replace terrain for ground sampling or player spawning', { timeout: 10000 }, async t => {
  const p = await physics(t); await p.ground();
  await p.architecture([{ center: [0, 5, 0], halfExtents: [4, .5, 4], yaw: .3 }]);
  const sampled = await p.send({ type: 'sample-ground', requestId: 'roof', points: [{ x: 0, z: 0 }] }, 'ground-samples');
  assert.ok(sampled.points[0].found);
  assert.ok(Math.abs(sampled.points[0].y) < .001, `ground remains the road beneath the added roof: ${sampled.points[0].y}`);
  assert.equal(sampled.points[0].surface, 1, 'ground retains the road surface classification');
  const spawned = await p.spawn();
  assert.ok(spawned.y > 1.5 && spawned.y < 1.8, `walker spawns beneath the architectural roof: ${spawned.y}`);
});

test('actual AUB gate permits passage while its rotated piers and campus wall stop the walker', { timeout: 10000 }, async t => {
  const p = await physics(t), gate = landmarks.landmarks.find(record => record.id === 'aub-main-gate');
  assert.ok(gate, 'the production AUB gate record exists');
  const boxes = landmarkColliders(landmarks);
  const installed = await p.architecture(boxes, 'actual-landmarks');
  assert.equal(installed.type, 'architecture-ready'); assert.equal(installed.count, boxes.length);
  await p.ground({ x: gate.position[0], y: gate.position[1], z: gate.position[2], radius: 30 });
  const approach = gate.depth / 2 + 2;
  let start = localToWorld(gate.position, gate.rotationY, 0, approach);
  await p.spawn(start.x, start.z);
  const through = await p.walk({ forward: 1, yaw: gate.rotationY, frames: 164 });
  assert.ok(localZ(through, gate.position, gate.rotationY) < -gate.depth/2-1, 'the walker can traverse the full arch passage');
  start = localToWorld(gate.position, gate.rotationY, gate.width * .32, approach);
  await p.spawn(start.x, start.z);
  const pier = await p.walk({ forward: 1, yaw: gate.rotationY, frames: 120 });
  assert.ok(localZ(pier, gate.position, gate.rotationY) > gate.depth/2+.25, 'the walker cannot enter a gate pier');
  assert.ok(localZ(pier, gate.position, gate.rotationY) < approach-.5, 'the walker reaches the pier instead of being stuck at spawn');

  const wall = landmarks.walls.find(record => Math.abs(record.a[1]-record.b[1]) < .02 && Math.hypot(record.a[0]-record.b[0], record.a[2]-record.b[2]) > 4);
  assert.ok(wall, 'use an actual nearly level wall span to isolate lateral collision');
  const origin = wall.a.map((value, i) => (value + wall.b[i])/2), yaw = -Math.atan2(wall.b[2]-wall.a[2], wall.b[0]-wall.a[0]);
  await p.ground({ x: origin[0], y: origin[1], z: origin[2], radius: 10 });
  start = localToWorld(origin, yaw, 0, 2);
  await p.spawn(start.x, start.z);
  const blocked = await p.walk({ forward: 1, yaw, frames: 90 });
  const distance = localZ(blocked, origin, yaw);
  assert.ok(distance > wall.thickness/2+.25 && distance < 1, `campus wall stops the walker at its street face: ${distance}`);
});

test('replacing an architecture group removes its old solids and clearing it releases the corridor', { timeout: 10000 }, async t => {
  const p = await physics(t); await p.ground();
  await p.architecture([wallBox(-2)]);
  assert.equal((await p.architecture([wallBox(-2)])).count, 1, 'repeated registration retains one replacement group');
  await p.architecture([wallBox(-6)]);
  await p.spawn();
  const moved = await p.walk({ forward: 1, frames: 160 });
  assert.ok(moved.z > -5.6 && moved.z < -5.2, `old wall is gone and the replacement stops movement: ${moved.z}`);
  assert.equal((await p.architecture([])).count, 0);
  await p.spawn();
  const clear = await p.walk({ forward: 1, frames: 120 });
  assert.ok(clear.z < -8.8, `empty replacement removes every prior collider: ${clear.z}`);
});

test('invalid replacements reject the payload and preserve the existing architectural collision group', { timeout: 15000 }, async t => {
  const p = await physics(t); await p.ground();
  const cases = [
    ['missing group ID', { id: undefined, boxes: [wallBox(-6)] }],
    ['null group ID', { id: null, boxes: [wallBox(-6)] }],
    ['numeric group ID', { id: 0, boxes: [wallBox(-6)] }],
    ['empty group ID', { id: '', boxes: [wallBox(-6)] }],
    ['omitted boxes', {}], ['null boxes', { boxes: null }], ['numeric boxes', { boxes: 0 }],
    ['non-array boxes', { boxes: {} }], ['null box', { boxes: [null] }],
    ['bad center', { boxes: [{ ...wallBox(-6), center: [0, NaN, -6] }] }],
    ['zero half extent', { boxes: [{ ...wallBox(-6), halfExtents: [5, 0, .25] }] }],
    ['negative half extent', { boxes: [{ ...wallBox(-6), halfExtents: [5, 3, -.25] }] }],
    ['missing yaw', { boxes: [{ center: [0, 3, -6], halfExtents: [5, 3, .25] }] }],
    ['infinite yaw', { boxes: [{ ...wallBox(-6), yaw: Infinity }] }],
    ['partially valid replacement', { boxes: [wallBox(-6), { ...wallBox(-8), center: [] }] }],
    ['oversized group', { boxes: Array.from({ length: 5001 }, () => wallBox(-6)) }],
    ['sparse center', { boxes: [{ ...wallBox(-6), center: [0, , -6] }] }],
    ['sparse half extents', { boxes: [{ ...wallBox(-6), halfExtents: [5, , .25] }] }],
    ['sparse boxes', { boxes: new Array(1) }],
  ];
  for (const [label, payload] of cases) await t.test(label, async () => {
    await p.architecture([wallBox(-2)]);
    const reply = await p.send({ type: 'architecture', id: 'bliss', ...payload }, message => message.type === 'error' || message.type === 'architecture-ready');
    await p.spawn();
    const stopped = await p.walk({ forward: 1, frames: 120 });
    assert.equal(reply.type, 'error', `${label} must produce an error instead of replacing the group`);
    assert.ok(stopped.z > -1.6 && stopped.z < -1.2, `${label} must leave the existing wall active: ${stopped.z}`);
  });
});
