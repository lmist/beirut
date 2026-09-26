import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { summarizeFrames, findOpenPoint, distanceToTile } from '../src/metrics.js';

test('60 fps verdict catches visible stalls even when the average exceeds 60', () => {
  const clean = summarizeFrames(Array(1800).fill(1000/60));
  assert.ok(clean.meets60Fps);
  const hitch = summarizeFrames([...Array(1799).fill(10), 90]);
  assert.ok(hitch.averageFps > 60);
  assert.equal(hitch.meets60Fps,false);
  assert.equal(hitch.over33Ms,1);
  assert.equal(summarizeFrames([]),null);
});

test('street placement clears the real building bounds and tile distances respect edges', async () => {
  const buildings = JSON.parse(await readFile('public/data/buildings.json','utf8'));
  const p = findOpenPoint(-620,-320,buildings);
  assert.ok(!buildings.some(b=>p.x>b[0]-2&&p.x<b[2]+2&&p.z>b[1]-2&&p.z<b[3]+2));
  assert.ok(Math.hypot(p.x+620,p.z+320)<125);
  assert.equal(distanceToTile(5,5,[0,0,0,10,10,10]),0);
  assert.equal(distanceToTile(13,14,[0,0,0,10,10,10]),5);
});

test('every shipped tile decodes with valid bounds, indices and source triangle totals', async () => {
  await MeshoptDecoder.ready;
  const manifest = JSON.parse(await readFile('public/data/manifest.json','utf8'));
  let triangles=0;
  for (const tile of manifest.tiles) {
    for (const level of [0,1]) {
      const file = await readFile(`public/data/tiles/${tile.id}.${level}.mesh`);
      const magic=file.readUInt32LE(0),nv=file.readUInt32LE(4),ni=file.readUInt32LE(8),vb=file.readUInt32LE(12),ib=file.readUInt32LE(16);
      assert.equal(magic,0x42525431);
      assert.equal(file.length,20+vb+ib);
      assert.equal(ni/3,tile.lods[level].triangles);
      const vertices=new Uint8Array(nv*20),indices=new Uint8Array(ni*4);
      MeshoptDecoder.decodeVertexBuffer(vertices,nv,20,file.subarray(20,20+vb));
      MeshoptDecoder.decodeIndexBuffer(indices,ni,4,file.subarray(20+vb));
      const data = new DataView(vertices.buffer);
      for(let i=0;i<nv;i++) for(let a=0;a<3;a++) {
        const p=data.getFloat32(i*20+a*4,true);
        assert.ok(Number.isFinite(p));
        assert.ok(p>=tile.bounds[a]-.01&&p<=tile.bounds[a+3]+.01);
      }
      for(const index of new Uint32Array(indices.buffer)) assert.ok(index<nv);
      if(level===0) triangles+=ni/3;
    }
  }
  assert.equal(triangles,manifest.extraction.triangles);
  assert.equal(manifest.extraction.objects_without_cached_mesh,undefined);
});

test('the actual WASM walking worker lands on terrain, blocks walls, and jumps', {timeout:15000}, async () => {
  const moduleUrl = new URL('../src/physics-worker.js',import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');global.self=globalThis;self.postMessage=m=>parentPort.postMessage(m);parentPort.on('message',data=>self.onmessage({data}));import(${JSON.stringify(moduleUrl)});`,{eval:true});
  const messages=[]; const waiters=[];
  worker.on('message',m=>{messages.push(m);for(const check of [...waiters])check(m);});
  const waitFor = (predicate) => new Promise((resolve,reject)=>{
    const seen=messages.findLast(predicate);if(seen)return resolve(seen);
    const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(check),1);reject(new Error('Timed out waiting for physics response'));},10000);
    const check=m=>{if(predicate(m)){clearTimeout(timer);waiters.splice(waiters.indexOf(check),1);resolve(m);}};waiters.push(check);
  });
  try {
    await waitFor(m=>m.type==='ready');
    // Ground extends 40 m; a vertical wall is 2 m in front of the spawn.
    const positions=new Float32Array([-20,0,-20,20,0,-20,20,0,20,-20,0,20, -5,0,-2,5,0,-2,5,5,-2,-5,5,-2]);
    const indices=new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7]);
    worker.postMessage({type:'tile',id:'test',position:positions.buffer,index:indices.buffer});
    await waitFor(m=>m.type==='tile-ready');
    worker.postMessage({type:'spawn',x:0,z:0});
    await waitFor(m=>m.type==='spawned');
    await waitFor(m=>m.type==='position'&&m.grounded);
    worker.postMessage({type:'input',forward:1,strafe:0,yaw:0});
    await new Promise(resolve=>setTimeout(resolve,800));
    const stopped=messages.findLast(m=>m.type==='position');
    assert.ok(stopped.z>-1.71&&stopped.z<-1.5,JSON.stringify(stopped));
    assert.ok(stopped.y>1.5&&stopped.y<1.75);
    messages.length=0;
    worker.postMessage({type:'input',forward:0,yaw:0,jump:true});
    const jumping=await waitFor(m=>m.type==='position'&&m.y>2.2);
    assert.equal(jumping.grounded,false);
    worker.postMessage({type:'active',value:false});
  } finally { await worker.terminate(); }
});
