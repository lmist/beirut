import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { createBuildingIndex,buildingPhotoSlots } from '../src/world/building-index.js';
import { photoSlots,photoMetadata,validatePhotoRegistration } from '../src/world/photo-projection.js';

const json=async path=>JSON.parse(await readFile(path,'utf8'));

test('compiled photography covers the complete city and uses the canonical registration',async()=>{
  const [map,satellite,facades,registration,buildings]=await Promise.all(['public/data/manifest.json','public/assets/world/photographic/satellite.json','public/assets/world/photographic/facades.json','public/data/registration.json','public/data/buildings.json'].map(json));
  validatePhotoRegistration(satellite,registration);validatePhotoRegistration(facades,registration);
  assert.equal(satellite.coverage.sourceTilesMissing,0);
  assert.equal(facades.buildings.length,buildings.length);
  for(const tile of map.tiles) {
    const aerial=satellite.tiles[tile.id];assert.ok(aerial,`Satellite missing ${tile.id}`);
    assert.deepEqual(aerial.bounds,[tile.bounds[0],tile.bounds[2],tile.bounds[3],tile.bounds[5]]);
    const image=await readFile(`public${aerial.url}`);
    assert.equal(image[0],255);assert.equal(image[1],216);
    const wall=facades.tiles[tile.id];
    if(!wall)continue;
    const webp=await readFile(`public${wall.url}`);
    assert.equal(webp.toString('ascii',8,12),'WEBP');
    const hash=wall.url.match(/-([a-f0-9]{8,64})\.webp$/)?.[1];
    assert.ok(hash,`Facade atlas must be immutable: ${wall.url}`);
    assert.equal(createHash('sha256').update(webp).digest('hex').slice(0,hash.length),hash);
    for(const [id,[u,v,w,h]] of Object.entries(wall.cells)) {
      const photo=facades.buildings[id];assert.ok(photo);
      assert.ok([u,v,w,h,...photo.camera,photo.headingDeg,photo.pitchDeg,photo.fovDeg].every(Number.isFinite));
      assert.ok(u>=0&&v>=0&&w>0&&h>0&&u+w<=1.000001&&v+h<=1.000001);
      assert.ok(photo.fovDeg>0&&photo.fovDeg<=120);
    }
  }
});

test('real decoded street geometry references valid facade camera slots at both detail levels',async()=>{
  const [buildings,ground,facades,registration]=await Promise.all(['public/data/buildings.json','public/data/building-ground.json','public/assets/world/photographic/facades.json','public/data/registration.json'].map(json));
  const lookup=createBuildingIndex(buildings,64,ground);
  await MeshoptDecoder.ready;
  for(const id of ['-2_-1','-4_-1','3_-1'])for(const lod of [0,1]) {
    const file=await readFile(`public/data/tiles/${id}.${lod}.mesh`);
    const nv=file.readUInt32LE(4),ni=file.readUInt32LE(8),vb=file.readUInt32LE(12);
    const vertices=new Uint8Array(nv*20),indices=new Uint8Array(ni*4);
    MeshoptDecoder.decodeVertexBuffer(vertices,nv,20,file.subarray(20,20+vb));
    MeshoptDecoder.decodeIndexBuffer(indices,ni,4,file.subarray(20+vb));
    const view=new DataView(vertices.buffer),positions=new Float32Array(nv*3),surfaces=new Uint8Array(nv);
    for(let i=0;i<nv;i++){for(let a=0;a<3;a++)positions[i*3+a]=view.getFloat32(i*20+a*4,true);surfaces[i]=vertices[i*20+15];}
    const tile=facades.tiles[id],slots=photoSlots(tile),metadata=photoMetadata(tile,facades.buildings,registration);
    const assigned=buildingPhotoSlots(positions,surfaces,new Uint32Array(indices.buffer),lookup,slots);
    let textured=0;
    for(let i=0;i<nv;i++){
      assert.ok(assigned[i]>=0&&assigned[i]<metadata.height);
      if(assigned[i]){assert.equal(surfaces[i],5);textured++;}
    }
    if(slots.size)assert.ok(textured>0,`${id}.${lod} never uses its facade data`);
  }
});
