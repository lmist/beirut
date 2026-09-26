import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBuildingIndex, buildingBaseHeights, buildingPhotoSlots } from '../src/world/building-index.js';

test('an overlapping centroid cannot split a larger facade into different buildings',()=>{
  const buildings=createBuildingIndex([[0,0,30,20,0,30],[8,0,12,8,0,20]],64,[2,6]);
  // The first centroid fits the small box, but the full wall belongs to #0.
  const positions=new Float32Array([0,0,0,30,0,0,0,30,0,30,30,0]);
  const surface=new Uint8Array([5,5,5,5]),indices=new Uint32Array([0,1,2,1,3,2]);
  const seeds=new Uint8Array(4),frames=new Float32Array(12);
  const slots=buildingPhotoSlots(positions,surface,indices,buildings,new Map([[0,1],[1,2]]),seeds,frames);
  assert.deepEqual([...slots],[1,1,1,1]);
  assert.deepEqual([...buildingBaseHeights(positions,surface,indices,buildings)],[2,2,2,2]);
  assert.equal(new Set(seeds).size,1);
  assert.deepEqual([...frames],[0,0,30,0,0,30,0,0,30,0,0,30]);
});

test('photographed facade materials carry physical scale and traceable source crops',async()=>{
  const meta=JSON.parse(await readFile('public/assets/world/photographic/facade-materials.json','utf8'));
  assert.equal(meta.version,2);assert.equal(meta.tileSize,256);
  assert.equal(meta.patches.length,16);
  for(const [i,patch] of meta.patches.entries()) {
    assert.match(patch.sourcePath,/^data\/(buildings\/streetview|photographic\/facades\/images)\/\d+\.jpg$/);
    assert.match(patch.sourceSha256,/^[a-f0-9]{64}$/);
    assert.equal(patch.sourceCorners.length,4);
    assert.ok(patch.sourceCorners.flat().every(n=>Number.isFinite(n)&&n>=0&&n<=640));
    assert.ok(patch.widthMeters>0);assert.equal(patch.heightMeters,patch.floors*3.2);
    assert.equal(patch.kind,i<12?'wall':'ground');
  }
  assert.ok(meta.patches.some(p=>p.floors>=3),'preserve several photographed floors together');
});

test('facade heights use the street surface rather than an underground foundation',()=>{
  const buildings=[[0,0,10,10,0,30],[12,0,20,10,5,45]];
  const index=createBuildingIndex(buildings,64,[11.5,20.25]);
  assert.equal(index.baseAt(5,20,5),11.5);
  assert.equal(index.baseAt(15,35,5),20.25);
  const positions=new Float32Array([0,0,0,10,0,0,10,30,0,100,2,100]);
  const surfaces=new Uint8Array([5,5,5,1]);
  const bases=buildingBaseHeights(positions,surfaces,new Uint32Array([0,1,2]),index);
  assert.deepEqual([...bases],[11.5,11.5,11.5,0]);
});

test('overlapping building bounds select the smallest fitting building and retain floors',()=>{
  const index=createBuildingIndex([[0,0,20,20,0,50],[4,4,8,8,0,20]],64,[10,3]);
  assert.equal(index.baseAt(5,15,5),3);
  assert.equal(index.baseAt(5,35,5),10);
});

test('all buildings have finite terrain samples and the texture sheet has 16 valid cells',async()=>{
  const [buildings,ground,atlas]=await Promise.all(['public/data/buildings.json','public/data/building-ground.json','public/assets/world/materials.json'].map(async p=>JSON.parse(await readFile(p,'utf8'))));
  assert.equal(ground.length,buildings.length);
  assert.ok(ground.every(h=>Number.isFinite(h)&&h>-10&&h<150));
  assert.equal(atlas.materials.length,16);
  assert.equal(atlas.columns.length,5);assert.equal(atlas.rows.length,5);
  const png=await readFile(`public${atlas.atlas}`);
  assert.equal(png.readUInt32BE(16),atlas.columns.at(-1));
  assert.equal(png.readUInt32BE(20),atlas.rows.at(-1));
  for(const edges of [atlas.columns,atlas.rows])for(let i=1;i<edges.length;i++)assert.ok(edges[i]>edges[i-1]);
});
