import * as THREE from 'three';
import { createWorldMaterials } from './world/materials.js';
import { createDaylight } from './world/lighting.js';
import { createBlissArchitecture } from './world/bliss-architecture.js';
import { blissStops } from './world/bliss-route.js';
import { createBlissLandmarks } from './world/bliss-landmarks.js';
import { createBlissShopfronts } from './world/bliss-shopfronts.js';
import { createBlissHeritage } from './world/bliss-heritage.js';
import { GameExperience } from './game/experience.js';
import { JOURNEY_START as START } from './game/journey.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { distanceToTile, findOpenPoint, summarizeFrames } from './metrics.js';
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './style.css';

const $ = id => document.getElementById(id);
const canvas = $('world');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, .25, 20000);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor('#c7d2d2');
let renderScale = Math.min(devicePixelRatio, 1.5), mode = 'overview', ready = false;
let manifest, buildings = [], yaw = 0, pitch = 0, visibleTriangles = 0, detailDistance = 1800;
let fullLoads = 0, lowLoads = 0, autoTour = false, tourTime = 0, isSpawning = false;
let physicsReady = false, physicsMs = 0, physicsTiles = 0, grounded = false;
let lastPosition = null, previousPosition = null, pendingSpawn = null, lastPositionTime = 0;
let errorCount = 0, lastError = '', frameHistory = [], cpuHistory = [], benchmark = null, benchmarkReport = null;
let game = null;
let blissCorridor=null,blissViewpoints=[];
let blissLandmarks=null,blissHeritage=null;
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
  console.error(gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment));
  reportError('A city material could not compile.');
};
const actorPosition = new THREE.Vector3();
let pendingBenchmark = false, toastTimer, frameNumber = 0, lastTileCheck = 0, lastUi = 0, lastQuality = 0;
const keys = new Set(), loaded = new Map(), pending = new Map(), collisionReady = new Set(), collisionPending = new Map();
const inputVector = new THREE.Vector3(), direction = new THREE.Vector3();
const look = new THREE.Euler(0, 0, 0, 'YXZ');
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = .075;
orbit.minDistance = 130;
orbit.maxDistance = 14000;
orbit.maxPolarAngle = Math.PI * .48;
orbit.enablePan = true;
orbit.addEventListener('start', () => { autoTour = false; $('tour').innerHTML = 'Take the aerial tour <span>→</span>'; });
function overviewCamera() {
  camera.position.set(-3600, 4550, 6000);
  orbit.target.set(-700, 15, 200);
  camera.lookAt(orbit.target);
  camera.setViewOffset(innerWidth, innerHeight, -innerWidth * .13, 0, innerWidth, innerHeight);
  orbit.update();
}
overviewCamera();
function resize() {
  if ($('quality').value === 'ps2') renderScale = Math.min(1, 540 / innerHeight);
  if (canvas.width !== Math.floor(innerWidth*renderScale) || canvas.height !== Math.floor(innerHeight*renderScale) || renderer.getPixelRatio() !== renderScale) {
    renderer.setDrawingBufferSize(innerWidth,innerHeight,renderScale);
  }
  camera.aspect = innerWidth / innerHeight;
  if (mode === 'overview') camera.setViewOffset(innerWidth, innerHeight, -innerWidth * .13, 0, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
resize();
addEventListener('resize', () => { if (benchmark) cancelBenchmark('Benchmark cancelled because the viewport changed.'); resize(); });

const uniforms = {
  uEye: { value: camera.position }, uFogNear: { value: 5000 }, uFogFar: { value: 12500 },
  uFogColor: { value: new THREE.Color('#a4919d') }, uFacades: { value: 1 }, uTime: { value: 0 },
};
const worldMaterials=createWorldMaterials(uniforms, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
const daylight=createDaylight(scene,renderer,worldMaterials.uniforms);
const blissArchitecture=createBlissArchitecture({scene,preserveUnobserved:true,anisotropy:Math.min(8,renderer.capabilities.getMaxAnisotropy())});
const blissShopfronts=createBlissShopfronts({scene,anisotropy:Math.min(8,renderer.capabilities.getMaxAnisotropy())});
const seaMaterial=worldMaterials.sea;
scene.add(worldMaterials.sky);
const seaGeometry = new THREE.PlaneGeometry(70000, 70000);
seaGeometry.rotateX(-Math.PI / 2);
seaGeometry.translate(0, -5, 0);
scene.add(new THREE.Mesh(seaGeometry, seaMaterial));

const workers = Array.from({ length: 2 }, () => new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' }));
let jobSequence = 0;
const decodeJobs = new Map(), decodeQueue = [];
for (const worker of workers) {
  worker.busy = false;
  worker.onmessage = ({ data }) => {
    const job = decodeJobs.get(data.id);
    decodeJobs.delete(data.id);
    worker.busy = false;
    if (job) data.error ? job.reject(new Error(data.error)) : job.resolve(data.buffers);
    drainDecodeQueue();
  };
  worker.onerror = event => {
    reportError(event.message || 'Map worker failed');
    for (const [id, job] of decodeJobs) if (job.worker === worker) { job.reject(new Error('Map decoder failed')); decodeJobs.delete(id); }
    worker.busy = false;
    drainDecodeQueue();
  };
}
function drainDecodeQueue() {
  for (const worker of workers) {
    if (worker.busy || !decodeQueue.length) continue;
    const job = decodeQueue.shift();
    worker.busy = true;
    job.worker = worker;
    decodeJobs.set(job.id, job);
    worker.postMessage({ id: job.id, url: job.url });
  }
}
function decodeTile(url, priority) {
  return new Promise((resolve, reject) => {
    const job = { id: ++jobSequence, url, resolve, reject };
    if (priority) decodeQueue.unshift(job); else decodeQueue.push(job);
    drainDecodeQueue();
  });
}
function loadTile(tile, level, priority = false) {
  const key = `${tile.id}.${level}`;
  if (loaded.has(key)) return Promise.resolve(loaded.get(key));
  if (pending.has(key)) return pending.get(key);
  const promise = decodeTile(`/data/tiles/${key}.mesh`, priority).then(buffers => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffers.position), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buffers.normal), 3, true));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buffers.color), 3, true));
    geometry.setAttribute('surface', new THREE.BufferAttribute(new Uint8Array(buffers.surface), 1));
    geometry.setAttribute('baseHeight', new THREE.BufferAttribute(new Float32Array(buffers.baseHeight),1));
    geometry.setAttribute('photoSlot', new THREE.BufferAttribute(new Float32Array(buffers.photoSlot),1));
    geometry.setAttribute('buildingSeed', new THREE.BufferAttribute(new Uint8Array(buffers.buildingSeed),1,true));
    geometry.setAttribute('buildingFrame', new THREE.BufferAttribute(new Float32Array(buffers.buildingFrame),3));
    geometry.setAttribute('architecture',new THREE.BufferAttribute(new Uint8Array(buffers.architecture),1));
    geometry.setAttribute('ao', new THREE.BufferAttribute(new Uint8Array(buffers.ao), 1, true));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffers.index), 1));
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...tile.bounds.slice(0, 3)), new THREE.Vector3(...tile.bounds.slice(3)));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, worldMaterials.photos.materialForTile(tile.id));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.visible = level === 1;
    mesh.userData = { tile, level, touched: performance.now() };
    scene.add(mesh);
    loaded.set(key, mesh);
    pending.delete(key);
    if (level === 1) lowLoads++; else fullLoads++;
    return mesh;
  }).catch(error => { pending.delete(key); throw error; });
  pending.set(key, promise);
  return promise;
}

const physics = new Worker(new URL('./physics-worker.js', import.meta.url), { type: 'module' });
const physicsInit = new Promise((resolve, reject) => {
  physics.onerror = event => { const error = new Error(event.message || 'Walking engine failed'); reject(error); reportError(error.message); };
  physics.onmessage = ({ data }) => {
    game?.onPhysics(data);
    if (data.type === 'vehicle-exited') {
      lastPosition = previousPosition = data; lastPositionTime = performance.now();
      actorPosition.set(data.x,data.y,data.z); yaw = data.yaw; keys.clear();
    }
    if (data.type === 'ready') { physicsReady = true; resolve(); }
    if (data.type === 'tile-ready') {
      collisionReady.add(data.id);
      collisionPending.get(data.id)?.resolve();
      collisionPending.delete(data.id);
    }
    if (data.type === 'spawned') {
      lastPosition = previousPosition = data;
      lastPositionTime = performance.now();
      actorPosition.set(data.x, data.y, data.z);
      camera.position.copy(actorPosition);
      pendingSpawn?.resolve(data);
      pendingSpawn = null;
    }
    if (data.type === 'position') {
      previousPosition = lastPosition || data;
      lastPosition = data;
      lastPositionTime = performance.now();
      physicsMs = data.physicsMs;
      physicsTiles = data.tiles;
      grounded = data.grounded;
    }
    if (data.type === 'boundary') toast('Edge of the model. Returned to the last street.');
    if (data.type === 'error') {
      if (pendingSpawn) { pendingSpawn.reject(new Error(data.message)); pendingSpawn = null; }
      else reportError(data.message);
    }
  };
});
function addCollision(tile) {
  if (collisionReady.has(tile.id)) return Promise.resolve();
  if (collisionPending.has(tile.id)) return collisionPending.get(tile.id).promise;
  const entry = {};
  entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
  collisionPending.set(tile.id, entry);
  loadTile(tile, 0, true).then(mesh => {
    const position = mesh.geometry.attributes.position.array.slice().buffer;
    const indices = mesh.geometry.index.array;
    const index = indices.slice().buffer;
    const categories = mesh.geometry.attributes.surface.array;
    const surfaces = new Uint8Array(indices.length / 3);
    for(let face=0;face<surfaces.length;face++)surfaces[face]=categories[indices[face*3]];
    physics.postMessage({ type: 'tile', id: tile.id, position, index, surfaces:surfaces.buffer }, [position, index, surfaces.buffer]);
  }).catch(error => { collisionPending.delete(tile.id); entry.reject(error); });
  return entry.promise;
}
async function prepareLocation(x, z) {
  const nearby = manifest.tiles.filter(tile => distanceToTile(x, z, tile.bounds) < 180);
  if (!nearby.length) throw new Error('This location is outside the model. Choose a point within the city.');
  await physicsInit;
  await Promise.all(nearby.map(addCollision));
}
function spawn(x, z) {
  return new Promise((resolve, reject) => {
    pendingSpawn = { resolve, reject };
    physics.postMessage({ type: 'spawn', x, z });
  });
}
async function enterWalk(x = START.x, z = START.z, lock = true, facing = null, populationFacing = null) {
  if (isSpawning || !ready || benchmark) return;
  isSpawning = true;
  keys.clear();
  try {
    if (lock) requestLook();
    showLoading('Preparing this street', 0);
    const point = findOpenPoint(x, z, buildings);
    await prepareLocation(point.x, point.z);
    const start = await spawn(point.x, point.z);
    yaw = facing ?? (x === START.x && z === START.z ? START.yaw : start.yaw); pitch = -.015;
    setMode('walk');
    updateTiles(true);
    await game?.start(actorPosition, populationFacing ?? yaw);
    await worldMaterials.photos.settle();
    await warmScene();
  } catch (error) { reportError(error.message); }
  finally { isSpawning = false; $('loading').hidden = true; }
}
async function warmScene() {
  const saved=[];
  scene.traverse(object=>{saved.push([object,object.visible,object.frustumCulled]);object.visible=true;if(object.isMesh)object.frustumCulled=false;});
  const target=new THREE.WebGLRenderTarget(8,8);
  const previous=renderer.getRenderTarget();
  try {
    await renderer.compileAsync(scene,camera);
    for(const [object] of saved){object.visible=true;if(object.isMesh)object.frustumCulled=false;}
    renderer.setRenderTarget(target);
    renderer.render(scene,camera);
  } finally {
    renderer.setRenderTarget(previous);target.dispose();
    for(const [object,visible,frustumCulled] of saved){object.visible=visible;object.frustumCulled=frustumCulled;}
  }
}
function setMode(next) {
  mode = next;
  camera.fov = next==='overview'?46:next==='walk'?62:58;
  autoTour = false;
  keys.clear();
  orbit.enabled = next === 'overview';
  document.body.classList.toggle('in-world', next !== 'overview');
  $('crosshair').hidden = next === 'overview';
  $('walk-hint').hidden = next === 'overview' || document.pointerLockElement === canvas;
  $('touch-controls').hidden = next === 'overview' || !matchMedia('(pointer: coarse)').matches;
  if (!$('touch-controls').hidden) $('touch-controls').style.display = 'grid';
  document.querySelectorAll('[data-mode]').forEach(button => { button.classList.toggle('active', button.dataset.mode === next); button.setAttribute('aria-pressed', String(button.dataset.mode === next)); });
  if (next !== 'walk' && game?.vehicle) physics.postMessage({type:'exit-vehicle'});
  if (next !== 'walk') { game?.sound.update(0,false,false); game && (game.cameraInitialized=false); }
  if (next === 'overview') {
    document.exitPointerLock?.();
    overviewCamera();
    $('controls').innerHTML = '<kbd>DRAG</kbd> orbit <span>·</span> <kbd>SCROLL</kbd> zoom <span>·</span> <kbd>M</kbd> map';
    $('location-mode').textContent = 'The city, from above';
  } else {
    camera.clearViewOffset();
    if (next === 'fly') {
      camera.position.set(-550, 280, 700);
      yaw = .1; pitch = -.25;
    }
    $('controls').innerHTML = next === 'walk' ? '<kbd>WASD</kbd> move / drive <span>·</span><kbd>F</kbd> enter / exit <span>·</span><kbd>SPACE</kbd> jump / brake <span>·</span><kbd>M</kbd> map' : '<kbd>WASD</kbd> fly <span>·</span><kbd>Q / E</kbd> height <span>·</span><kbd>M</kbd> map';
    $('location-mode').textContent = next === 'walk' ? 'Street level · on foot' : 'Above the rooftops';
  }
  physics.postMessage({ type: 'active', value: next === 'walk' });
  camera.updateProjectionMatrix();
  updateTiles(true);
}
function updateTiles(force = false) {
  if (!manifest) return;
  const now = performance.now();
  if (!force && now - lastTileCheck < 300) return;
  lastTileCheck = now;
  worldMaterials.photos.update(camera.position,mode,manifest.tiles);
  blissArchitecture.update(camera.position,mode);
  blissShopfronts.update(camera.position,mode);
  if(benchmark){const photos=worldMaterials.photos.diagnostics();benchmark.maxPhotoGpuMiB=Math.max(benchmark.maxPhotoGpuMiB||0,photos.estimatedGpuMiB);benchmark.maxPhotoTiles=Math.max(benchmark.maxPhotoTiles||0,photos.residentTiles);}
  const x = camera.position.x, z = camera.position.z;
  let triangles = 0, disposed = 0;
  for (const tile of manifest.tiles) {
    const d = distanceToTile(x, z, tile.bounds);
    const detail = mode !== 'overview' && d < 640;
    const visible = mode === 'overview' || d < detailDistance;
    const low = loaded.get(`${tile.id}.1`), full = loaded.get(`${tile.id}.0`);
    if (low) low.visible = visible && !(detail && full);
    if (full) { full.visible = visible && detail; if (detail) full.userData.touched = now; }
    if (visible) triangles += (detail && full ? tile.lods[0] : tile.lods[1]).triangles;
    if (detail && !full && ready) loadTile(tile, 0, true).then(() => updateTiles(true)).catch(error => reportError(error.message));
    if (mode === 'walk' && d < 180 && !collisionReady.has(tile.id)) addCollision(tile).catch(error => reportError(error.message));
    if (full && d > 1500 && now - full.userData.touched > 15000 && disposed < 1) {
      scene.remove(full); full.geometry.dispose(); loaded.delete(`${tile.id}.0`); disposed++;
    }
  }
  const remove = manifest.tiles.filter(t => collisionReady.has(t.id) && distanceToTile(x, z, t.bounds) > 1050 && !(game?.vehicles||[]).some(car=>distanceToTile(car.position.x,car.position.z,t.bounds)<100)).map(t => t.id);
  if (remove.length && !isSpawning && mode === 'walk') { physics.postMessage({ type: 'remove', ids: remove }); remove.forEach(id => collisionReady.delete(id)); }
  visibleTriangles = triangles;
  uniforms.uFogNear.value = mode === 'overview' ? 10500 : detailDistance * .28;
  uniforms.uFogFar.value = mode === 'overview' ? 17000 : detailDistance * .9;
}

function showLoading(label, fraction) {
  $('loading').hidden = false;
  $('loading-label').textContent = label;
  $('loading-count').textContent = `${Math.round(fraction * 100)}%`;
  $('loading-bar').style.width = `${Math.round(fraction * 100)}%`;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function reportError(message) { errorCount++; lastError = message; console.error(message); toast(message); }
async function requestLook() {
  try { await canvas.requestPointerLock?.(); }
  catch { $('walk-hint').textContent = 'Drag the city to look around'; }
}
$('enter').onclick = () => enterWalk();
async function visitBliss(id='gate',view='walk') {
  if(!ready||isSpawning||benchmark)return;
  const stop=blissViewpoints.find(p=>p.id===id)||blissViewpoints[0];
  if(!stop)return;
  if(game?.map?.expanded)game.map.toggle();
  if(game?.vehicle){toast('Leave the car before travelling to Bliss Street.');return;}
  $('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');
  await enterWalk(stop.x,stop.z,false,stop.yaw,stop.travelYaw??stop.yaw);
  if(view==='overlook'){
    const target=actorPosition.clone();target.y+=4;
    setMode('fly');camera.position.set(stop.x,target.y+65,stop.z+48);
    yaw=0;pitch=-Math.atan2(65,48);game.cameraInitialized=false;updateTiles(true);
  }
  toast(`${stop.name} · Walk the full 1.4 km street with WASD.`);
}
$('bliss-enter').onclick=()=>visitBliss('gate');
$('bliss-visit').onclick=()=>visitBliss($('bliss-stop').value,$('bliss-view').value);
$('tour').onclick = () => {
  setMode('overview');
  autoTour = true;
  tourTime = 0;
  $('tour').innerHTML = 'Tour in progress <span>↻</span>';
};
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
  if (!ready || benchmark) return;
  if (button.dataset.mode === 'walk') enterWalk(); else setMode(button.dataset.mode);
});
canvas.addEventListener('click', () => { if (mode !== 'overview' && !document.pointerLockElement && !benchmark) requestLook(); });
let drag = null;
canvas.addEventListener('pointerdown', event => { if (mode !== 'overview' && !document.pointerLockElement) { drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); } });
canvas.addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', event => {
  if (mode === 'overview' || benchmark) return;
  let dx = 0, dy = 0;
  if (document.pointerLockElement === canvas) { dx = event.movementX; dy = event.movementY; }
  else if (drag) { dx = event.clientX - drag.x; dy = event.clientY - drag.y; drag = { x: event.clientX, y: event.clientY }; }
  yaw -= dx * .0022;
  pitch = THREE.MathUtils.clamp(pitch - dy * .0022, -1.45, 1.45);
});
document.addEventListener('pointerlockchange', () => { $('walk-hint').hidden = mode === 'overview' || document.pointerLockElement === canvas; keys.clear(); });
addEventListener('keydown', event => {
  if (['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)) return;
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyQ','KeyE'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) { $('drive-pedal').value='0'; $('drive-steering').value='0'; }
  if (event.code === 'KeyM' && !event.repeat) toggleMap();
  if (event.code === 'KeyF' && !event.repeat && mode === 'walk') game?.interact();
  if (event.code === 'KeyR' && !event.repeat && mode === 'walk') game?.resetVehicle();
  if (event.code === 'KeyE' && !event.repeat && mode === 'walk') game?.talk();
  if (event.code === 'KeyH' && !event.repeat && mode === 'walk') game?.sound.horn();
  if (event.code === 'Enter' && !event.repeat && mode === 'overview') enterWalk();
  if (event.code === 'Escape' && game?.map?.expanded) game.map.toggle();
  if (event.code === 'Escape' && benchmark) cancelBenchmark('Benchmark cancelled.');
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => { $('drive-pedal').value='0'; $('drive-steering').value='0'; keys.clear(); physics.postMessage({ type:'input', forward:0, strafe:0 }); });
document.addEventListener('visibilitychange', () => {
  keys.clear();
  physics.postMessage({ type:'active', value:!document.hidden && mode === 'walk' && !game?.map?.expanded });
  if (document.hidden && benchmark) cancelBenchmark('Benchmark cancelled because the tab was hidden.');
});
for (const [id, code] of [['touch-forward','KeyW'],['touch-back','KeyS'],['touch-left','KeyA'],['touch-right','KeyD']]) {
  $(id).onpointerdown = event => { event.preventDefault(); keys.add(code); $(id).setPointerCapture(event.pointerId); };
  $(id).onpointerup = $(id).onpointercancel = () => keys.delete(code);
}
$('settings-toggle').onclick = () => { $('settings').hidden = !$('settings').hidden; $('settings-toggle').setAttribute('aria-expanded', String(!$('settings').hidden)); };
$('settings-close').onclick = () => { $('settings').hidden = true; $('settings-toggle').setAttribute('aria-expanded', 'false'); };
$('quality').onchange = () => {
  renderScale = $('quality').value === 'ps2' ? Math.min(1,540/innerHeight) : $('quality').value === 'performance' ? .75 : $('quality').value === 'native' ? Math.min(devicePixelRatio,2) : Math.min(devicePixelRatio, 1.5);
  document.body.classList.toggle('retro-display', $('quality').value === 'ps2');
  daylight.setQuality($('quality').value);
  resize();
  if (benchmark) cancelBenchmark('Benchmark cancelled after a display setting changed.');
};
$('detail').onchange = () => { detailDistance = +$('detail').value; updateTiles(true); if (benchmark) cancelBenchmark('Benchmark cancelled after a display setting changed.'); };
$('photographs').onchange=()=>{worldMaterials.photos.uniforms.uPhotographs.value=+$('photographs').checked;updateTiles(true);if(benchmark)cancelBenchmark('Benchmark cancelled after imagery changed.');};
$('facades').onchange = () => { uniforms.uFacades.value = +$('facades').checked;blissArchitecture.setEnabled($('facades').checked); };
$('world-textures').onchange = () => {worldMaterials.uniforms.uTextures.value=+$('world-textures').checked;if(benchmark)cancelBenchmark('Benchmark cancelled after surface textures changed.');};
function toggleMap() { if (game?.map) { game.map.toggle(); return; } $('minimap').classList.toggle('collapsed'); $('map-toggle').textContent = $('minimap').classList.contains('collapsed') ? '+' : '−'; }
$('map-toggle').onclick = toggleMap;
const map = $('map-canvas'), ctx = map.getContext('2d');
const mapBase = document.createElement('canvas'); mapBase.width = 440; mapBase.height = 288;
const mapCtx = mapBase.getContext('2d');
const mapBounds = [-4000, -3300, 3500, 2900];
function mx(x) { return (x - mapBounds[0]) / (mapBounds[2] - mapBounds[0]) * 440; }
function mz(z) { return (z - mapBounds[1]) / (mapBounds[3] - mapBounds[1]) * 288; }
function buildMap() {
  mapCtx.fillStyle = '#dce5dd'; mapCtx.fillRect(0,0,440,288);
  mapCtx.fillStyle = '#687861';
  for (const b of buildings) mapCtx.fillRect(mx(b[0]), mz(b[1]), Math.max(.65, mx(b[2])-mx(b[0])), Math.max(.65, mz(b[3])-mz(b[1])));
}
function drawMap() {
  if (game?.map) return;
  if ($('minimap').classList.contains('collapsed')) return;
  ctx.drawImage(mapBase,0,0);
  const position = mode === 'overview' ? orbit.target : camera.position;
  const x = mx(position.x), z = mz(position.z);
  ctx.save(); ctx.translate(x,z); ctx.rotate(mode === 'overview' ? -orbit.getAzimuthalAngle() : -yaw);
  ctx.fillStyle = '#647c4e28'; ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,32,-Math.PI*.7,-Math.PI*.3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#263c2b'; ctx.strokeStyle = '#f3f6e7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0,0,4.5,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
  $('position-label').textContent = mode === 'overview' ? 'N ↑' : `${Math.round(position.x)} E / ${Math.round(-position.z)} N`;
}
map.onclick = () => game?.map?.toggle();

async function runBenchmark() {
  if (!ready || benchmark || pendingBenchmark || isSpawning) return;
  pendingBenchmark = true;
  $('benchmark').disabled = true;
  $('enter').disabled = $('tour').disabled = true;
  $('benchmark-result').textContent = 'Warming geometry and collision data…';
  try {
    document.exitPointerLock?.();
    await enterWalk(START.x,START.z,false);
    if (mode !== 'walk') throw new Error('Could not prepare the benchmark street');
    for(const car of game?.vehicles||[])physics.postMessage({type:'reset-vehicle',id:car.id,toSpawn:true});
    await Promise.all(manifest.tiles.filter(t => distanceToTile(camera.position.x, camera.position.z, t.bounds) < 900).map(t => loadTile(t,0,true)));
    await warmScene();
    benchmark = { phase:'warmup', warmupUntil:performance.now()+2500, start:0, frames:[], cpu:[], scales:[], streetFrames:[], driveFrames:[], overviewFrames:[], route:'on-foot + Mercedes drive + city orbit', initialYaw:yaw, maxDrawCalls:0, maxTriangles:0, maxDrivingSpeedKmh:0, drivingMs:0 };
    $('benchmark-result').textContent = 'Warming the renderer…';
  } catch (error) { reportError(error.message); $('benchmark').disabled = $('enter').disabled = $('tour').disabled = false; }
  finally { pendingBenchmark = false; }
}
function cancelBenchmark(message) {
  benchmark = null;
  $('benchmark').disabled = false;
  $('enter').disabled = $('tour').disabled = false;
  $('benchmark').textContent = 'Run benchmark ↗';
  $('benchmark-result').textContent = message;
  toast(message);
}
function finishBenchmark() {
  const b = benchmark;
  const summary = summarizeFrames(b.frames,b.cpu);
  const debug = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  benchmarkReport = {
    timestamp:new Date().toISOString(), route:b.route, ...summary,
    routeValid:b.drivingMs>=7000&&b.maxDrivingSpeedKmh>5,drivingSeconds:b.drivingMs/1000,
    meets60Fps:summary.meets60Fps&&b.drivingMs>=7000&&b.maxDrivingSpeedKmh>5,
    street:summarizeFrames(b.streetFrames),driving:summarizeFrames(b.driveFrames), overview:summarizeFrames(b.overviewFrames),
    viewport:{ width:innerWidth,height:innerHeight,devicePixelRatio },
    renderScale:{ min:Math.min(...b.scales),max:Math.max(...b.scales) },
    resolutionMode:$('quality').value, viewingDistance:detailDistance,worldTextures:worldMaterials.uniforms.uTextures.value===1,photographs:{...worldMaterials.photos.diagnostics(),maxGpuMiB:b.maxPhotoGpuMiB,maxResidentTiles:b.maxPhotoTiles},textureArray:{layers:16,tileSize:256},
    renderBuffer:{width:renderer.domElement.width,height:renderer.domElement.height},
    maxDrawCalls:b.maxDrawCalls, maxTriangles:b.maxTriangles,maxDrivingSpeedKmh:b.maxDrivingSpeedKmh,game:game?.diagnostics(),
    gpu:debug ? renderer.getContext().getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    userAgent:navigator.userAgent, sourceTriangles:manifest.extraction.triangles, buildings:manifest.buildings,
    wasm:['meshoptimizer decoder','Rapier character controller'], errors:errorCount,
  };
  benchmark = null;
  $('benchmark').disabled = false;
  $('enter').disabled = $('tour').disabled = false;
  $('benchmark').textContent = 'Run benchmark again ↗';
  const r = benchmarkReport;
  $('benchmark-result').innerHTML = `<div><strong>${r.averageFps.toFixed(1)}</strong> average fps</div><div class="metric-row"><span>1% low</span><span>${r.onePercentLowFps.toFixed(1)} fps</span></div><div class="metric-row"><span>95th percentile</span><span>${r.p95Ms.toFixed(2)} ms</span></div><div class="metric-row"><span>99th percentile</span><span>${r.p99Ms.toFixed(2)} ms</span></div><div class="metric-row"><span>Frames over 20 ms</span><span>${r.over20Ms} / ${r.frames}</span></div><div class="bench-verdict">${!r.routeValid?'Driving route incomplete. Run the benchmark again.':r.meets60Fps ? '60 fps target met on this device.' : '60 fps target not met on this run.'}</div>`;
  $('download-report').hidden = false;
  toast(`Benchmark: ${r.averageFps.toFixed(1)} fps · p99 ${r.p99Ms.toFixed(1)} ms`);
}
$('benchmark').onclick = runBenchmark;
$('download-report').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(benchmarkReport,null,2)],{type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = 'beirut-benchmark.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};

let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const frameMs = now-lastFrame;
  const dt = Math.min(frameMs / 1000,.05);
  lastFrame = now;
  const cpuStart = performance.now();
  frameNumber++;
  if (document.hidden) return;
  if (benchmark) {
    if (benchmark.phase === 'warmup' && now >= benchmark.warmupUntil) { benchmark.phase = 'street'; benchmark.start = now; }
    if (benchmark.start) {
      const elapsed = (now-benchmark.start)/1000;
      if (elapsed < 10) {
        yaw = benchmark.initialYaw + elapsed * .32;
        pitch = -.02 + Math.sin(elapsed * .35) * .1;
      } else if (elapsed < 20) {
        if (benchmark.phase !== 'drive') {
          benchmark.phase='drive'; const car=game?.vehicles[0],run=benchmark;
          if(car)spawn(car.position.x+Math.cos(car.yaw)*3,car.position.z-Math.sin(car.yaw)*3).then(()=>{if(benchmark===run)physics.postMessage({type:'enter-vehicle',id:car.id});}).catch(error=>cancelBenchmark(error.message));
        }
      } else if (elapsed < 30) {
        if (benchmark.phase !== 'overview') { benchmark.phase = 'overview'; setMode('overview'); }
        const angle = (elapsed-20)*.14;
        camera.position.set(-700 + Math.sin(angle)*7200,4550,200+Math.cos(angle)*7200);
        camera.lookAt(orbit.target);
      }
      if (elapsed >= 30) finishBenchmark();
      else if (benchmark) {
        benchmark.frames.push(frameMs);
        benchmark.scales.push(renderScale);
        if (elapsed < 10) benchmark.streetFrames.push(frameMs); else if(elapsed<20)benchmark.driveFrames.push(frameMs); else benchmark.overviewFrames.push(frameMs);
      }
    }
  }
  let forward = 0, strafe = 0, sprint = false;
  if (mode === 'overview') {
    if (autoTour && !benchmark) {
      tourTime += dt;
      const a = tourTime*.045-.46;
      camera.position.set(-700+Math.sin(a)*7000,4300+Math.sin(tourTime*.08)*400,200+Math.cos(a)*7000);
      camera.lookAt(orbit.target);
    } else if (!benchmark?.start) orbit.update();
  } else {
    forward = Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    strafe = Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    sprint = keys.has('ShiftLeft')||keys.has('ShiftRight');
    if (benchmark?.phase === 'street') forward = 1;
    if (benchmark?.phase === 'drive') {forward=1;strafe=Math.sin((now-benchmark.start)*.00045)*.25;}
    if (mode === 'walk') {
      if(game?.vehicle && !keys.size && !benchmark) { forward=Number($('drive-pedal').value)||0; strafe=Number($('drive-steering').value)||0; }
      if (game?.map?.expanded) { forward=0; strafe=0; }
      physics.postMessage({ type:'input',forward,strafe,sprint,yaw,jump:keys.has('Space') });
      if (game?.vehicle) physics.postMessage({type:'driving-input',input:{forward:Math.max(0,forward),backward:Math.max(0,-forward),left:Math.max(0,-strafe),right:Math.max(0,strafe),handbrake:keys.has('Space'),brake:$('drive-pedal').value==='brake'}});
      if (lastPosition && previousPosition) {
        const alpha = THREE.MathUtils.clamp((now-lastPositionTime)/16.667,0,1);
        actorPosition.set(THREE.MathUtils.lerp(previousPosition.x,lastPosition.x,alpha), THREE.MathUtils.lerp(previousPosition.y,lastPosition.y,alpha), THREE.MathUtils.lerp(previousPosition.z,lastPosition.z,alpha));
        if (!game?.started) camera.position.copy(actorPosition);
      }
    } else {
      inputVector.set(strafe,Number(keys.has('KeyE')||keys.has('Space'))-Number(keys.has('KeyQ')), -forward).normalize();
      inputVector.applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw).multiplyScalar(dt*(sprint?240:65));
      camera.position.add(inputVector);
      camera.position.y = Math.max(camera.position.y,2);
    }
    look.set(pitch,yaw,0); camera.quaternion.setFromEuler(look);
  }
  game?.update(dt,now,{position:mode==='walk'?actorPosition:mode==='overview'?orbit.target:camera.position,yaw,pitch,mode,forward,strafe,sprint});
  updateTiles();
  uniforms.uTime.value = now/1000;
  worldMaterials.sky.position.copy(camera.position);
  daylight.update(mode === 'walk' ? actorPosition : camera.position, mode === 'overview');
  renderer.render(scene,camera);
  const cpuMs = performance.now()-cpuStart;
  if (benchmark?.start) {
    benchmark.cpu.push(cpuMs);
    benchmark.maxDrawCalls = Math.max(benchmark.maxDrawCalls,renderer.info.render.calls);
    benchmark.maxTriangles = Math.max(benchmark.maxTriangles,renderer.info.render.triangles);
    benchmark.maxDrivingSpeedKmh=Math.max(benchmark.maxDrivingSpeedKmh,Math.abs(game?.speed||0)*3.6);
    if(benchmark.phase==='drive'&&game?.vehicle)benchmark.drivingMs+=frameMs;
  }
  if (ready && frameMs > 0) {
    frameHistory.push(frameMs); cpuHistory.push(cpuMs);
    if (frameHistory.length > 240) { frameHistory.shift(); cpuHistory.shift(); }
  }
  if (now-lastQuality > 1800 && ready && $('quality').value === 'auto' && frameHistory.length > 90 && !isSpawning) {
    const samples = frameHistory.slice(-90).sort((a,b)=>a-b);
    const slow = samples[Math.floor(samples.length*.85)];
    if (slow>18.5 && renderScale>.7) { renderScale = Math.max(.7,renderScale-.15); resize(); }
    else if (slow<14 && renderScale<Math.min(devicePixelRatio,1.5)) { renderScale = Math.min(Math.min(devicePixelRatio,1.5),renderScale+.1); resize(); }
    lastQuality = now;
  }
  if (now-lastUi > 500) {
    lastUi = now;
    const stats = summarizeFrames(frameHistory,cpuHistory);
    $('fps').textContent = stats ? String(Math.round(stats.averageFps)) : '—';
    $('status').textContent = ready ? `${mode === 'walk' ? (game?.vehicle?'BEHIND THE WHEEL':'ON FOOT') : mode === 'fly' ? 'FREE FLIGHT' : 'BEIRUT'} / LATE AFTERNOON` : 'OPENING THE CITY';
    $('compass').querySelector('svg').style.transform = `rotate(${(mode === 'overview' ? orbit.getAzimuthalAngle() : yaw)*180/Math.PI}deg)`;
    $('engine-details').textContent = `WebGL 2 · meshopt + Rapier WASM · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles/1e6).toFixed(2)}M triangles · ${renderScale.toFixed(2)}× resolution · ${physicsMs.toFixed(2)} ms physics · ${collisionReady.size} collision tiles`;
    if (benchmark?.start) $('benchmark').textContent = `Testing… ${Math.min(30,Math.floor((now-benchmark.start)/1000))} / 30s`;
    drawMap();
    $('diagnostics').textContent = JSON.stringify({ready,mode,errorCount,lastError,lowLoads,fullLoads,loadedTiles:loaded.size,physicsReady,physicsTiles,physicsMs,grounded,bliss:{...blissArchitecture.diagnostics(),corridorBuildings:blissCorridor?.buildings.length,landmarks:blissLandmarks?.userData.stats,heritage:blissHeritage?.userData.stats,shopfronts:blissShopfronts.stats},photographs:worldMaterials.photos.diagnostics(),worldTextures:worldMaterials.uniforms.uTextures.value===1,position:actorPosition.toArray(),game:game?.diagnostics(),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,renderScale,viewport:[innerWidth,innerHeight],frameStats:stats,benchmarkActive:!!benchmark,benchmark:benchmarkReport});
  }
}
requestAnimationFrame(animate);

async function init() {
  try {
    const responses = await Promise.all([fetch('/data/manifest.json'), fetch('/data/buildings.json')]);
    if (responses.some(response => !response.ok)) throw new Error('Map assets are missing. Run the map preparation scripts first.');
    [manifest,buildings] = await Promise.all(responses.map(response=>response.json()));
    $('building-count').textContent = manifest.buildings.toLocaleString();
    game = new GameExperience({scene,camera,physics,buildings,prepareLocation,toast,worldMaterials});
    const gameReady=game.init();
    buildMap();
    const order = [...manifest.tiles].sort((a,b)=>distanceToTile(-700,0,a.bounds)-distanceToTile(-700,0,b.bounds));
    let completed = 0;
    await Promise.all(order.map(tile=>loadTile(tile,1).then(()=>{completed++;showLoading('Opening Beirut',completed/order.length);})));
    await Promise.all([gameReady,worldMaterials.ready,blissArchitecture.ready,blissShopfronts.ready]);
    const landmarkResponse=await fetch('/data/bliss-landmarks.json');
    if(landmarkResponse.ok){
      blissLandmarks=createBlissLandmarks(await landmarkResponse.json());scene.add(blissLandmarks);
      physics.postMessage({type:'architecture',id:'bliss-landmarks',boxes:blissLandmarks.userData.colliders});
    }
    const heritageResponse=await fetch('/data/bliss-heritage.json');
    if(heritageResponse.ok){
      blissHeritage=createBlissHeritage(await heritageResponse.json());scene.add(blissHeritage);
      physics.postMessage({type:'architecture',id:'bliss-heritage',boxes:blissHeritage.userData.colliders});
    }
    const blissResponse=await fetch('/data/bliss-street.json');
    if(blissResponse.ok){blissCorridor=await blissResponse.json();blissViewpoints=blissStops(blissCorridor);$('bliss-enter').disabled=$('bliss-visit').disabled=false;}
    await renderer.compileAsync(scene,camera);
    ready = true;
    frameHistory = [];cpuHistory = [];
    $('loading').hidden = true;
    $('enter-label').textContent = 'BEGIN THE JOURNEY';
    $('enter').disabled = $('tour').disabled = $('benchmark').disabled = false;
    updateTiles(true);
    const route=new URLSearchParams(location.search);
    if(route.get('street')==='bliss')await visitBliss(route.get('section')||'gate',route.get('view')||'walk');
    // Warm the first street while the visitor studies the overview.
    try {
      const start = findOpenPoint(START.x,START.z,buildings);
      prepareLocation(start.x,start.z).catch(error=>reportError(error.message));
    } catch (error) { reportError(error.message); }
  } catch (error) {
    reportError(error.message);
    $('loading-label').textContent = 'Unable to open the city';
    $('loading-count').textContent = '';
  }
}
init();
