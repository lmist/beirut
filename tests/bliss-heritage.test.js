import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createBlissHeritage, disposeBlissHeritage, heritageColliders, clipFootprint } from '../src/world/bliss-heritage.js';
import { signedArea } from '../scripts/prepare_bliss_architecture.mjs';
import { simplifyFootprint, photoWallPoint } from '../scripts/prepare_bliss_heritage.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../public/data/bliss-heritage.json',import.meta.url)));

test('Three replacement masses retain CAD footprint extents and trace photo estimates',()=>{
 assert.deepEqual(data.replacementBuildingIds,[360,640,359]);
 const sources=new Set(data.sources.map(s=>s.id));
 for(const building of data.buildings){
  assert.match(building.dimensionStatus,/Photo-estimated/);
  assert.ok(building.sourceIds.every(id=>sources.has(id)));
  assert.ok(building.footprint.length>=4);
  const xs=building.footprint.map(p=>p[0]),zs=building.footprint.map(p=>p[1]);
  for(const [value,expected]of [[Math.min(...xs),building.originalBounds[0]],[Math.max(...xs),building.originalBounds[2]],[Math.min(...zs),building.originalBounds[1]],[Math.max(...zs),building.originalBounds[3]]])assert.ok(Math.abs(value-expected)<.012);
  assert.ok(Math.abs(signedArea(building.footprint))>300);
 }
 assert.ok(data.buildings.find(b=>b.id===640).footprint.length>12,'Curved and stepped footprint must not turn into a broad AABB');
});

test('The three gables cover only the observed historic row and leave the adjacent tower',()=>{
 const building=data.buildings.find(b=>b.id===360),row=building.row,axis=[row.normal[1],-row.normal[0]];
 const low=clipFootprint(building.footprint,row.center,axis,row.right,false),high=clipFootprint(building.footprint,row.center,axis,row.right,true);
 assert.equal(row.gables,3);
 assert.ok(row.right-row.left>25&&row.right-row.left<40,'Photo row must not stretch across the entire 54m source mass');
 assert.ok(building.tower.height>row.ridge+8);
 assert.ok(Math.abs(Math.abs(signedArea(low))+Math.abs(signedArea(high))-Math.abs(signedArea(building.footprint)))<.001);
 const colliders=heritageColliders(data).filter(c=>c.buildingId===360);
 assert.ok(colliders.some(c=>Math.abs(c.center[1]+c.halfExtents[1]-(building.ground+row.eave))<.01));
 assert.ok(colliders.some(c=>Math.abs(c.center[1]+c.halfExtents[1]-(building.ground+building.tower.height))<.01));
});

test('Photographed historic window openings contain real recesses',()=>{
 const group=createBlissHeritage(data);group.updateMatrixWorld(true);
 for(const id of [640,359,360]){
  const building=data.buildings.find(b=>b.id===id),meshGroup=group.children.find(g=>g.userData.buildingId===id);
  // Check off-centre points so the test does not strike the photographed sash.
  for(const opening of building.openings.slice(0,3)){
   const wall=building.walls.find(w=>w.id===opening.wallId),normal=new THREE.Vector3(wall.normal[0],0,wall.normal[1]),right=new THREE.Vector3(wall.normal[1],0,-wall.normal[0]);
   const point=new THREE.Vector3(opening.center[0],building.ground+opening.bottom+opening.height*.27,opening.center[1]).addScaledVector(right,opening.width*.22);
   const hit=new THREE.Raycaster(point.clone().addScaledVector(normal,2),normal.clone().negate(),0,4).intersectObject(meshGroup,true)[0];
   assert.ok(hit,`Window in building ${id} should contain recessed glazing`);
   assert.ok(hit.distance>2.25,`Window ${id}/${opening.sourcePixel} is flattened by a hidden solid wall at ${hit.distance}m`);
  }
 }
 disposeBlissHeritage(group);
});

test('A bounded number of batches renders finite detailed geometry',()=>{
 const group=createBlissHeritage(data);let meshes=0,vertices=0;
 group.traverse(o=>{if(!o.isMesh)return;meshes++;vertices+=o.geometry.attributes.position.count;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});
 assert.ok(meshes<=34);assert.ok(vertices<220000);
 assert.equal(group.userData.stats.openings,27);
 for(const collider of group.userData.colliders){assert.ok(collider.center.every(Number.isFinite));assert.ok(collider.halfExtents.every(n=>Number.isFinite(n)&&n>0));}
 disposeBlissHeritage(group);
});

test('Footprint simplification removes only collinear survey vertices',()=>{
 assert.deepEqual(simplifyFootprint([[0,0],[1,0],[2,0],[2,1],[0,1]]),[[0,0],[2,0],[2,1],[0,1]]);
 const camera={position:[0,2,5],forward:[0,0,-1],right:[1,0,0],up:[0,1,0],tangent:1};
 const wall={center:[0,0],normal:[0,1],width:8};
 const hit=photoWallPoint(camera,[wall],.6,.5);assert.ok(hit);assert.ok(Math.abs(hit.point[0]-1)<.00001);assert.equal(hit.point[1],0);
 assert.equal(photoWallPoint(camera,[wall],1,.5),null,'Outside-wall source pixels do not acquire an invented facade');
});
