import RAPIER from '@dimforge/rapier3d-compat';
import { createVehicle, vehiclePose, stepVehicleForces, yawRotation } from './driving-physics.js';

const WALKER_EYE = .78, VEHICLE_LIMIT = 32;
let world, player, controller, events, input = {}, drivingInput = {};
let active = false, grounded = false, velocityY = 0, playerHealth = 100;
let last = 0, accumulator = 0, jumpHeld = false, lastSafe = null, occupiedVehicleId = null, nextVehicleId = 1;
const tiles = new Map(), tileHandles = new Set(), vehicles = new Map(), vehicleHandles = new Set();
const tileSurfaces = new Map();
const architectureGroups=new Map(),architectureHandles=new Set();

const ready = RAPIER.init().then(() => {
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 60;
  player = world.createCollider(RAPIER.ColliderDesc.capsule(.5, .32).setTranslation(0, 200, 0));
  controller = world.createCharacterController(.025);
  controller.enableAutostep(.38, .24, false); controller.enableSnapToGround(.55);
  controller.setMaxSlopeClimbAngle(Math.PI * .26); controller.setMinSlopeSlideAngle(Math.PI * .3);
  events = new RAPIER.EventQueue(true);
  world.step(); self.postMessage({ type: 'ready' });
});

const isTile = collider => tileHandles.has(collider.handle);
const isArchitecture = collider => isTile(collider)||architectureHandles.has(collider.handle);
function refreshTerrainQueries() {
  // New colliders do not enter Rapier's broad phase until a step. A zero-time
  // step publishes streamed terrain without advancing the driving simulation.
  const timestep=world.timestep;
  world.timestep=0;
  try { world.step(); } finally { world.timestep=timestep; }
}
function groundAt(x, z, rayOriginY = 450) {
  if (!tiles.size || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: rayOriginY, z }, { x: 0, y: -1, z: 0 }), 480, true, undefined, undefined, undefined, undefined, isTile);
  if (!hit) return null;
  const y = rayOriginY - hit.timeOfImpact;
  const surfaces = tileSurfaces.get(hit.collider.handle);
  // Rapier triangle IDs index the uploaded mesh. Back faces can be encoded
  // after the front faces; both refer to the same authored surface category.
  const surface = surfaces?.length && Number.isInteger(hit.featureId) ? surfaces[hit.featureId % surfaces.length] : null;
  return y < -3 ? null : { y, normal: hit.normal, surface };
}
function vehicleAnchor(vehicle) { return vehiclePose(vehicle).position; }
function chaseDistance(origin, yaw, ideal, excluded) {
  const hit = world.castRay(new RAPIER.Ray(origin, { x: Math.sin(yaw)*.936, y: .351, z: Math.cos(yaw)*.936 }), ideal/.936, true, undefined, undefined, excluded, undefined, isArchitecture);
  return Math.max(.7, Math.min(ideal, hit ? hit.timeOfImpact*.936 - .3 : ideal));
}
function vehicleState(vehicle, withCamera = false) {
  const pose = vehiclePose(vehicle), position=pose.position;
  const state = { id: vehicle.id, model: vehicle.model, dimensions: vehicle.dimensions, position, yaw: vehicle.yaw, speed: vehicle.speed, health: vehicle.health, occupied: occupiedVehicleId === vehicle.id, grounded: vehicle.grounded, rotation:pose.rotation, wheels:pose.wheels };
  if (withCamera) state.cameraDistance = chaseDistance({ x: position.x, y: position.y + 1.0, z: position.z }, vehicle.yaw, 9, vehicle.collider);
  return state;
}
const allVehicleStates = () => [...vehicles.values()].map(vehicle => vehicleState(vehicle));
function postVehicleState(type = 'vehicle-state', vehicle = occupiedVehicleId && vehicles.get(occupiedVehicleId)) { self.postMessage({ type, vehicle: vehicle ? vehicleState(vehicle, occupiedVehicleId === vehicle.id) : null, vehicles: allVehicleStates(), playerHealth }); }

function placeVehicle(candidate) {
  const x = Number(candidate.x), z = Number(candidate.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { rejected: { ...candidate, reason: 'invalid-position' } };
  const ground = groundAt(x, z);
  if (!ground) return { rejected: { ...candidate, reason: 'no-ground' } };
  const id = String(candidate.id ?? `vehicle-${nextVehicleId++}`);
  if (vehicles.has(id)) return { rejected: { ...candidate, id, reason: 'duplicate-id' } };
  const yaw = Number.isFinite(candidate.yaw) ? candidate.yaw : 0;
  const simulation=createVehicle(RAPIER,world,{...candidate,x,z,yaw},ground.y);
  const safe = { x, y: ground.y, z, yaw };
  const vehicle = { id, model: candidate.model || 'w124_e500', health:100, spawn:safe, lastClear:safe, ...simulation };
  vehicles.set(id, vehicle); vehicleHandles.add(vehicle.collider.handle); return { vehicle: vehicleState(vehicle) };
}
function spawnVehicles(data) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : Array.isArray(data.vehicles) ? data.vehicles : Array.isArray(data.points) ? data.points : [];
  const added = [], rejected = [], limit = Math.max(0, Math.min(VEHICLE_LIMIT - vehicles.size, data.max ?? VEHICLE_LIMIT));
  for (const candidate of candidates.slice(0, limit)) { const result = placeVehicle(candidate); if (result.vehicle) added.push(result.vehicle); else rejected.push(result.rejected); }
  self.postMessage({ type: 'vehicles-spawned', vehicles: added, rejected, playerHealth }); postVehicleState();
}
function sampleGround(data) {
  const points = (Array.isArray(data.points) ? data.points : []).slice(0, 128).map(point => { const ground = groundAt(Number(point.x), Number(point.z)); return { ...point, y: ground?.y ?? null, normal: ground?.normal ?? null, surface: ground?.surface ?? null, found: Boolean(ground) }; });
  self.postMessage({ type: 'ground-samples', requestId: data.requestId, points });
}
function enterVehicle(id) {
  if (occupiedVehicleId) return;
  const p = player.translation(); let target = id == null ? null : vehicles.get(String(id)); let nearest = Infinity;
  if (target) { const a = vehicleAnchor(target); nearest = Math.hypot(a.x - p.x, a.z - p.z); }
  if (!target) for (const vehicle of vehicles.values()) { const a = vehicleAnchor(vehicle); if(Math.abs(a.y-p.y)>3)continue; const distance = Math.hypot(a.x - p.x, a.z - p.z); if (distance < nearest) { nearest = distance; target = vehicle; } }
  if (!target || nearest > 5.5 || Math.abs(vehicleAnchor(target).y-p.y)>3) { self.postMessage({ type: 'vehicle-enter-denied', reason: 'no-nearby-vehicle' }); return; }
  target.body.wakeUp(); drivingInput = {}; occupiedVehicleId = target.id; player.setSensor(true); const a = vehicleAnchor(target); player.setTranslation({ x: a.x, y: a.y + 1.15, z: a.z }); velocityY = 0; postVehicleState('vehicle-entered', target);
}
function exitIsClear(position, vehicle) {
  // Ground is queried separately because the terrain mesh has no thickness.
  // Shoulder-height rays reject a doorway or wall beside the parked car.
  for (const direction of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
    const hit = world.castRay(new RAPIER.Ray({ x: position.x, y: position.y + .12, z: position.z }, { x: direction.x, y: 0, z: direction.z }), .58, true, undefined, undefined, undefined, undefined, isTile);
    if (hit) return false;
  }
  // Rapier reports the zero-thickness triangle floor as an overlap for a
  // capsule query, even when the capsule is lifted. The exact ground ray plus
  // these cardinal shoulder rays is reliable for the streamed city mesh.
  return true;
}
function exitVehicle() {
  const vehicle = occupiedVehicleId && vehicles.get(occupiedVehicleId); if (!vehicle) return;
  if(Math.abs(vehicle.speed)>1.5){self.postMessage({type:'vehicle-exit-denied',reason:'stop-first'});return;}
  const a = vehicleAnchor(vehicle), right = { x: Math.cos(vehicle.yaw), z: -Math.sin(vehicle.yaw) }, forward = { x: -Math.sin(vehicle.yaw), z: -Math.cos(vehicle.yaw) };
  let exit = null;
  for (const [side, back] of [[3, 0], [-3, 0], [3, -1.5], [-3, -1.5], [0, 3]]) {
    const x = a.x + right.x * side - forward.x * back, z = a.z + right.z * side - forward.z * back, ground = groundAt(x, z, a.y + vehicle.halfHeight + .6), candidate = ground && { x, y: ground.y + .84, z };
    if (candidate && exitIsClear(candidate, vehicle)) { exit = candidate; break; }
  }
  if (!exit) { self.postMessage({ type: 'vehicle-exit-denied', reason: 'no-safe-exit' }); return; }
  vehicle.speed = 0; drivingInput = {}; player.setSensor(false); player.setTranslation(exit); lastSafe = { ...exit }; grounded = true; velocityY = -2; occupiedVehicleId = null;
  self.postMessage({ type: 'vehicle-exited', vehicle: vehicleState(vehicle), x: exit.x, y: exit.y + WALKER_EYE, z: exit.z, yaw: vehicle.yaw, playerHealth, vehicles: allVehicleStates() });
}
function resetVehicle(id, toSpawn = false) {
  const resolvedId = id == null ? occupiedVehicleId : String(id), vehicle = resolvedId && vehicles.get(resolvedId); if (!vehicle) return;
  const safe = toSpawn ? vehicle.spawn : vehicle.lastClear || vehicle.spawn, ground = groundAt(safe.x, safe.z, safe.y + vehicle.halfHeight + .6); if (!ground) return;
  const restoredPlayer = toSpawn || playerHealth <= 0;
  vehicle.body.setTranslation({x:safe.x,y:ground.y+vehicle.rideHeight+.08,z:safe.z},true);
  vehicle.body.setRotation(yawRotation(safe.yaw),true);vehicle.body.setLinvel({x:0,y:0,z:0},true);vehicle.body.setAngvel({x:0,y:0,z:0},true);
  vehicle.body.resetForces(true);vehicle.steering=0;vehicle.speed=0;vehicle.health=100;vehicle.impactCooldown=1;drivingInput={};
  if(restoredPlayer)playerHealth=100;postVehicleState('vehicle-reset',vehicle);
}
function stepVehicles(dt) {
  for(const vehicle of vehicles.values()) {
    stepVehicleForces(vehicle,occupiedVehicleId===vehicle.id?drivingInput:{},dt,occupiedVehicleId===vehicle.id,collider=>collider.handle!==player.handle&&collider.handle!==vehicle.collider.handle);
  }
}
function finishVehicles() {
  events.drainContactForceEvents(event=>{
    for(const vehicle of vehicles.values()){
    if(vehicle.collider.handle!==event.collider1()&&vehicle.collider.handle!==event.collider2())continue;
    if(vehicle.impactCooldown>0)continue;
    const force=event.totalForceMagnitude()/vehicle.mass;
    const impact=force/60;
    if(impact<1.8)continue;
    const damage=Math.min(40,Math.round((impact-1.5)*4));
    vehicle.health=Math.max(0,vehicle.health-damage);vehicle.impactCooldown=.8;
    if(occupiedVehicleId===vehicle.id)playerHealth=Math.max(0,playerHealth-Math.ceil(damage*.25));
    self.postMessage({type:'vehicle-impact',vehicle:vehicleState(vehicle),damage,playerHealth});
    }
  });
  for(const vehicle of vehicles.values()) {
    const pose=vehiclePose(vehicle),q=pose.rotation;
    if(pose.grounded&&1-2*(q.x*q.x+q.z*q.z)>.85&&Math.abs(pose.speed)>1&&vehicle.impactCooldown===0) {
      const previous=vehicle.lastClear;
      if(Math.hypot(pose.position.x-previous.x,pose.position.z-previous.z)>6)vehicle.lastClear={...pose.position,yaw:pose.yaw};
    }
    if(vehicle.id===occupiedVehicleId)player.setTranslation({x:pose.position.x,y:pose.position.y+1.15,z:pose.position.z});
  }
}

function stepWalker(dt) {
  let f = input.forward || 0, s = input.strafe || 0; const magnitude = Math.hypot(f, s); if (magnitude > 1) { f /= magnitude; s /= magnitude; }
  const speed = input.sprint ? 9 : 4.5, yaw = input.yaw || 0;
  if (input.jump && !jumpHeld && grounded) velocityY = 8; jumpHeld = !!input.jump; velocityY = Math.max(velocityY - 24 * dt, -40);
  const movement = { x: (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed * dt, y: velocityY * dt, z: (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed * dt };
  controller.computeColliderMovement(player, movement); const delta = controller.computedMovement(); grounded = controller.computedGrounded();
  if (grounded && velocityY < 0) velocityY = -2; if (velocityY > 0 && delta.y < movement.y * .5) velocityY = 0;
  const p = player.translation(); player.setTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }); const current = player.translation();
  if (grounded) lastSafe = { x: current.x, y: current.y, z: current.z }; else if (lastSafe && current.y < lastSafe.y - 45) { player.setTranslation(lastSafe); velocityY = 0; world.step(); self.postMessage({ type: 'boundary' }); }
}

self.onmessage = async ({ data }) => {
  await ready;
  try {
    if (data.type === 'tile') {
      if (tiles.has(data.id)) return;
      const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(data.position), new Uint32Array(data.index))); tiles.set(data.id, collider); tileHandles.add(collider.handle); if(data.surfaces)tileSurfaces.set(collider.handle,new Uint8Array(data.surfaces)); refreshTerrainQueries(); self.postMessage({ type: 'tile-ready', id: data.id });
    } else if(data.type==='architecture') {
      const boxes=data.boxes;
      if(typeof data.id!=='string'||!data.id||!Array.isArray(boxes)||boxes.length>5000||Array.from(boxes).some(b=>!b||!Array.isArray(b.center)||b.center.length!==3||!Array.from(b.center).every(Number.isFinite)||!Array.isArray(b.halfExtents)||b.halfExtents.length!==3||!Array.from(b.halfExtents).every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(b.yaw)))throw new Error('Invalid architectural collision boxes');
      for(const collider of architectureGroups.get(data.id)||[]){architectureHandles.delete(collider.handle);world.removeCollider(collider,true);}
      const colliders=boxes.map(b=>{const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(...b.halfExtents).setTranslation(...b.center).setRotation(yawRotation(b.yaw)));architectureHandles.add(collider.handle);return collider;});
      architectureGroups.set(data.id,colliders);refreshTerrainQueries();self.postMessage({type:'architecture-ready',id:data.id,count:colliders.length});
    } else if (data.type === 'remove') {
      for (const id of data.ids) { const collider = tiles.get(id); if (collider) { tileHandles.delete(collider.handle); tileSurfaces.delete(collider.handle); world.removeCollider(collider, true); tiles.delete(id); } }
    } else if (data.type === 'spawn') {
      active = false; world.step(); const ground = groundAt(data.x, data.z); if (!ground) throw new Error('No walkable ground at this location. Choose another point on the map.');
      const y = ground.y + .86; player.setSensor(false); player.setTranslation({ x: data.x, y, z: data.z }); lastSafe = { x: data.x, y, z: data.z };
      let bestYaw = 0, bestDistance = -1;
      for (let i = 0; i < 72; i++) { const angle = i * Math.PI / 36, ray = new RAPIER.Ray({ x: data.x, y: y + .78, z: data.z }, { x: -Math.sin(angle), y: 0, z: -Math.cos(angle) }); const obstruction = world.castRay(ray, 120, true, undefined, undefined, player, undefined, isTile), distance = obstruction ? obstruction.timeOfImpact : 120; if (distance > bestDistance) { bestDistance = distance; bestYaw = angle; } }
      occupiedVehicleId = null; velocityY = 0; grounded = false; input = {}; drivingInput = {}; world.step(); active = true; last = performance.now(); accumulator = 0; self.postMessage({ type: 'spawned', x: data.x, y: y + WALKER_EYE, z: data.z, yaw: bestYaw, playerHealth });
    } else if (data.type === 'input') input = data;
    else if (data.type === 'driving-input') drivingInput = data.input || data;
    else if (data.type === 'spawn-vehicles' || data.type === 'vehicle-spawn-query') spawnVehicles(data);
    else if (data.type === 'sample-ground') sampleGround(data);
    else if (data.type === 'enter-vehicle') enterVehicle(data.id);
    else if (data.type === 'exit-vehicle') exitVehicle();
    else if (data.type === 'reset-vehicle') resetVehicle(data.id, data.toSpawn === true);
    else if (data.type === 'active') { active = data.value; last = performance.now(); accumulator = 0; input = {}; drivingInput = {}; }
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};

setInterval(() => {
  if (!world || !active) return;
  const now = performance.now(); accumulator += Math.min((now - last) / 1000, .1); last = now; const begin = performance.now(); let steps = 0;
  while (accumulator >= 1 / 60 && steps < 4) { const dt = 1 / 60; accumulator -= dt; steps++; if (!occupiedVehicleId) stepWalker(dt); stepVehicles(dt); world.step(events); finishVehicles(); }
  if (steps) {
    const p = player.translation(), occupied = occupiedVehicleId && vehicles.get(occupiedVehicleId), walkerYaw = input.yaw || 0, state = occupied ? vehicleState(occupied, true) : null;
    self.postMessage({ type: 'position', x: p.x, y: p.y + WALKER_EYE, z: p.z, grounded: occupied ? occupied.grounded : grounded, yaw: occupied ? occupied.yaw : walkerYaw, speed: occupied?.speed || 0, playerHealth, vehicle: state, vehicles: allVehicleStates(), cameraDistance: state ? state.cameraDistance : chaseDistance({ x: p.x, y: p.y + WALKER_EYE, z: p.z }, walkerYaw, 5.8, player), physicsMs: performance.now() - begin, tiles: tiles.size });
  }
}, 8);
