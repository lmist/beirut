import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createBlissLandmarks, disposeBlissLandmarks, landmarkColliders } from '../src/world/bliss-landmarks.js';
import { toWgs84 } from '../src/game/georeference.js';

const data=JSON.parse(fs.readFileSync(new URL('../public/data/bliss-landmarks.json',import.meta.url)));
const registration=JSON.parse(fs.readFileSync(new URL('../public/data/registration.json',import.meta.url)));

test('AUB landmarks carry traceable sources and match their mapped location',()=>{
 assert.equal(data.registrationVersion,registration.version);
 const gate=data.landmarks.find(record=>record.id==='aub-main-gate');
 const location=toWgs84(gate.position[0],gate.position[2],registration);
 assert.ok(Math.abs(location.lat-33.89953)<.00003);
 assert.ok(Math.abs(location.lon-35.48233)<.00003);
 assert.ok(gate.width>23&&gate.width<26);
 assert.ok(gate.depth>6&&gate.depth<8);
 const sources=new Set(data.sources.map(source=>source.id));
 for(const record of [...data.landmarks,...data.walls,...data.trees]){
  assert.ok(record.confidence);
  for(const id of record.sources)assert.ok(sources.has(id),`Missing source ${id}`);
 }
 assert.ok(data.walls.length>100);
 for(const wall of data.walls)for(const point of [wall.a,wall.b])assert.ok(point.every(Number.isFinite));
});

test('Gate is a true open passage at pedestrian height with a solid arch above',()=>{
 const group=createBlissLandmarks({...data,walls:[]});group.updateMatrixWorld(true);
 const gate=group.children[0],record=data.landmarks[0];
 const rayAt=(x,y)=>{
  const origin=new THREE.Vector3(x,y,record.depth/2+4).applyMatrix4(gate.matrixWorld);
  const direction=new THREE.Vector3(0,0,-1).transformDirection(gate.matrixWorld);
  return new THREE.Raycaster(origin,direction,0,record.depth+8).intersectObject(gate,true);
 };
 assert.equal(rayAt(0,1.7).length,0,'Passage should not contain a hidden cuboid wall');
 assert.ok(rayAt(0,6.5).length>0,'Upper arch masonry is present');
 assert.ok(rayAt(record.width*.40,1.7).length>0,'Tower masonry is present');
 disposeBlissLandmarks(group);
});

test('Complete source-backed frontage stays finite and batches wall materials',()=>{
 const group=createBlissLandmarks(data);let meshes=0,vertices=0;
 group.traverse(object=>{
  if(!object.isMesh)return;
  meshes++;vertices+=object.geometry.attributes.position.count;
  for(const value of object.geometry.attributes.position.array)assert.ok(Number.isFinite(value));
 });
 assert.ok(meshes<32,`Unexpected draw-call growth: ${meshes}`);
 assert.ok(vertices<660000,`Unexpected vertex growth: ${vertices}`);
 assert.ok(group.userData.stats.wallLengthMetres>600&&group.userData.stats.wallLengthMetres<650);
 const gate=data.landmarks[0],cos=Math.cos(gate.rotationY),sin=Math.sin(gate.rotationY);
 for(const wall of data.walls){
  const x=(wall.a[0]+wall.b[0])/2-gate.position[0],z=(wall.a[2]+wall.b[2])/2-gate.position[2];
  const localX=cos*x-sin*z,localZ=sin*x+cos*z;
  assert.ok(Math.abs(localX)>=gate.width/2+1||Math.abs(localZ)>gate.depth/2,'Campus wall must not bisect the gatehouse');
 }
 disposeBlissLandmarks(group);
});

test('Fixed colliders cover campus masonry while keeping the gate walkable',()=>{
 const colliders=landmarkColliders(data),gate=data.landmarks[0];
 assert.ok(colliders.length>data.walls.length+3);
 assert.deepEqual(data.replacementBuildingIds,[87,264]);
 for(const id of ['aub-assembly-hall','daouk-mosque'])assert.ok(colliders.some(record=>record.id.startsWith(id)));
 const point=[gate.position[0],gate.position[1]+1.7,gate.position[2]];
 for(const collider of colliders){
  assert.ok(collider.center.every(Number.isFinite));assert.ok(collider.halfExtents.every(value=>Number.isFinite(value)&&value>0));
  const dx=point[0]-collider.center[0],dz=point[2]-collider.center[2],c=Math.cos(collider.yaw),s=Math.sin(collider.yaw);
  const local=[c*dx-s*dz,point[1]-collider.center[1],s*dx+c*dz];
  assert.ok(local.some((value,index)=>Math.abs(value)>collider.halfExtents[index]),`Passage blocked by ${collider.id}`);
 }
});


test('Campus canopy stays inside the mapped university and uses bounded instancing',()=>{
 assert.ok(data.trees.length>=20&&data.trees.length<=105);
 const inside=(x,z,polygon)=>{let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
 for(const tree of data.trees){
  assert.ok(inside(tree.position[0],tree.position[2],data.campusPolygon),`${tree.id} planted outside AUB`);
  assert.ok(tree.position.every(Number.isFinite));
  assert.ok(['mapped','estimated-group'].includes(tree.placement));
  assert.ok(tree.height>=10&&tree.height<=16);
 }
 assert.equal(data.trees.filter(tree=>tree.placement==='mapped').length,1);
 const group=createBlissLandmarks({...data,landmarks:[],walls:[]}),instances=[];
 group.traverse(object=>{if(object.isInstancedMesh)instances.push(object);});
 assert.ok(instances.length<=2);
 assert.equal(instances.reduce((sum,mesh)=>sum+mesh.count,0),data.trees.length);
 disposeBlissLandmarks(group);
});
