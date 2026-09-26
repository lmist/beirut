import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { photoCamera,projectPhoto,photoSlots,photoMetadata,validatePhotoRegistration } from '../src/world/photo-projection.js';
import { createBuildingIndex,buildingPhotoSlots } from '../src/world/building-index.js';
import { selectPhotoTiles } from '../src/world/photographic.js';

const registration={angleDeg:0,translationEast:0,translationNorth:0,scale:1,zSign:-1,anchorLat:33.888,anchorLon:35.495};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);

test('photo assets reject an outdated registration even when its version is unchanged',()=>{
  const current={...registration,version:2};
  assert.doesNotThrow(()=>validatePhotoRegistration({registrationVersion:2,registration:current},current));
  assert.throws(()=>validatePhotoRegistration({registrationVersion:2,registration:{...current,zSign:1}},current),/different geographic transform/);
  assert.throws(()=>validatePhotoRegistration({registrationVersion:1},current),/Rebuild/);
});

test('geographic north projects into a north-facing square frame without mirroring',()=>{
  const camera=photoCamera({camera:[0,2,0],headingDeg:0,pitchDeg:0,fovDeg:90},registration);
  assert.deepEqual(projectPhoto([0,2,-10],camera),[.5,.5,10]);
  close(projectPhoto([10,2,-10],camera)[0],1);
  close(projectPhoto([-10,2,-10],camera)[0],0);
  close(projectPhoto([0,12,-10],camera)[1],0);
  assert.ok(projectPhoto([0,2,10],camera)[2]<0);
});

test('upward photographs preserve pitch and the canonical reflected/rotated geographic frame',async()=>{
  const r=JSON.parse(await readFile('public/data/registration.json','utf8'));
  const camera=photoCamera({camera:[100,12,-200],headingDeg:113,pitchDeg:32,fovDeg:75},r);
  const target=camera.position.map((x,i)=>x+camera.forward[i]*24);
  const uv=projectPhoto(target,camera);
  close(uv[0],.5);close(uv[1],.5);close(uv[2],24);
  close(camera.forward.reduce((sum,x,i)=>sum+x*camera.right[i],0),0);
  assert.ok(camera.forward[1]>0);
});

test('building zero and overlapping buildings retain independent atlas slots',()=>{
  const tile={cells:{12:[.5,0,.5,.5],0:[0,0,.5,.5]}};
  assert.deepEqual([...photoSlots(tile)],[[0,1],[12,2]]);
  const buildings=createBuildingIndex([[0,0,20,20,0,50],[4,4,8,8,0,20]],64,[10,3]);
  const position=new Float32Array([4,2,4,8,2,4,8,18,4,0,30,0,20,30,0,20,50,0]);
  const seeds=new Uint8Array(6);
  const slots=buildingPhotoSlots(position,new Uint8Array([5,5,5,5,5,5]),new Uint32Array([0,1,2,3,4,5]),buildings,new Map([[0,1],[1,2]]),seeds);
  assert.deepEqual([...slots],[2,2,2,1,1,1]);
  assert.equal(seeds[0],seeds[2]);assert.notEqual(seeds[0],seeds[3]);
});

test('metadata and tile selection keep missing imagery isolated and respect GPU budget',()=>{
  const tile={cells:{0:[.01,.02,.3,.4]}};
  const data=photoMetadata(tile,[{camera:[1,2,3],headingDeg:0,pitchDeg:0,fovDeg:90,confidence:.8}],registration);
  assert.equal(data.width,6);assert.equal(data.height,2);
  assert.ok([...data.pixels].every(Number.isFinite));
  close(data.pixels[27],.8);close(data.pixels[40],.01);
  const tiles=[{id:'a',bounds:[0,0,0,512,50,512]},{id:'b',bounds:[512,0,0,1024,50,512]}];
  const satellite={tiles:{a:{width:1024,height:1024},b:{width:1024,height:1024}}},facades={tiles:{}};
  assert.deepEqual(selectPhotoTiles(tiles,{x:20,y:5,z:20},'walk',satellite,facades,6*1024*1024),['a']);
  assert.deepEqual(selectPhotoTiles(tiles,{x:20,y:4500,z:20},'overview',satellite,facades),[]);
});
