import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { StreetDetailLayout, distanceToRoad, roadHalfWidth, selectStreetSamples } from '../src/game/street-detail.js';
import { StreetProps } from '../src/game/street-props.js';

const roads=[{id:'main',name:'Main',highway:'residential',points:[[-200,0],[200,0]]},
  {id:'cross',name:'Cross',highway:'secondary',points:[[0,-100],[0,100]]}];

test('street furniture stays outside every carriageway and expanded building footprint',()=>{
  const buildings=[[-75,4,-35,30,0,20],[40,-25,80,-4,0,20]];
  const layout=new StreetDetailLayout({roads,buildings});
  const points=layout.candidates({x:0,z:0},{radius:180,limit:64});
  assert.ok(points.length>12);
  for(const point of points) {
    for(const segment of layout.segments)assert.ok(distanceToRoad(point.x,point.z,segment)>roadHalfWidth(segment.road.highway)+.4);
    for(const b of buildings)assert.ok(point.x<b[0]-.5||point.x>b[2]+.5||point.z<b[1]-.5||point.z>b[3]+.5);
    assert.ok(Math.hypot(point.x,point.z)<=180);
  }
});

test('street layout remains deterministic and bounded as the viewer moves',()=>{
  const layout=new StreetDetailLayout({roads});
  const a=layout.candidates({x:0,z:0}),b=layout.candidates({x:1,z:1});
  assert.deepEqual(layout.candidates({x:0,z:0}),a);
  const shared=a.filter(p=>b.some(q=>p.id===q.id));
  assert.ok(shared.length>8);
  for(const p of shared){const q=b.find(q=>q.id===p.id);assert.equal(p.x,q.x);assert.equal(p.z,q.z);assert.equal(p.kind,q.kind);}
  assert.equal(layout.candidates({x:0,z:0},{limit:0}).length,0);
  assert.equal(layout.candidates({x:0,z:0},{limit:3}).length,3);
});

test('Hamra arrival receives a varied close street scene without adding building facades',()=>{
  const roads=JSON.parse(readFileSync('public/data/city-locations.json')).roads;
  const buildings=JSON.parse(readFileSync('public/data/buildings.json'));
  const layout=new StreetDetailLayout({roads,buildings});
  const points=layout.candidates({x:-2121.95,z:-953.55});
  assert.equal(points.length,48);
  assert.ok(points[0].range<15);
  assert.ok(new Set(points.map(p=>p.kind)).size>=4);
  assert.ok(points.some(p=>p.streetAr==='شارع الحمراء'));
});

test('street geometry reuses bounded instance pools when the population refreshes',()=>{
  const props=new StreetProps(new THREE.Scene());
  const points=Array.from({length:100},(_,i)=>({x:i*20,y:5,z:0,kind:['tree','palm','lamp','bench','shrub'][i%5]}));
  const initialGeometry=props.leaves.geometry;
  props.populate(points);
  assert.equal(props.count,64);
  assert.ok(props.trunks.count>0);
  for(const mesh of Object.values(props.pools)) {
    assert.ok(mesh.count<=64);
    assert.ok(mesh.castShadow&&mesh.receiveShadow);
    assert.ok(mesh.geometry.getAttribute('position').count>0);
  }
  props.populate([{x:0,y:2,z:0,kind:'lamp'}]);
  assert.equal(props.count,1);assert.equal(props.poles.count,1);assert.equal(props.trunks.count,0);
  assert.equal(props.leaves.geometry,initialGeometry);
});

test('wide measured carriageways reject nominal curb props and choose one actual sidewalk alternative',()=>{
  const layout=new StreetDetailLayout({roads:[roads[0]]});
  const candidates=layout.candidates({x:0,z:0},{sampleAlternatives:true,limit:48});
  assert.ok(candidates.length<=128);
  assert.ok(candidates.some(point=>point.lateralOffset===6));
  // This street is wider in the source mesh than the OSM highway-class estimate.
  const sampled=candidates.map(point=>({...point,y:3,surface:Math.abs(point.z)>9.7?3:1}));
  const chosen=selectStreetSamples(sampled);
  assert.ok(chosen.length>0);
  assert.ok(chosen.every(point=>point.surface===3&&point.lateralOffset>0));
  assert.equal(new Set(chosen.map(point=>point.placementId)).size,chosen.length);
  for(let i=0;i<chosen.length;i++)for(let j=i+1;j<chosen.length;j++)assert.ok(Math.hypot(chosen[i].x-chosen[j].x,chosen[i].z-chosen[j].z)>=7);
  assert.deepEqual(selectStreetSamples(sampled),chosen);
});

test('measured street placement rejects roofs and parked vehicles but accepts legacy samples',()=>{
  const points=[{x:0,y:0,z:0,id:'asphalt',surface:1},{x:10,y:0,z:0,id:'roof',surface:5},
    {x:20,y:0,z:0,id:'occupied',surface:3},{x:30,y:0,z:0,id:'sidewalk',surface:3},
    {x:40,y:0,z:0,id:'legacy'}];
  assert.deepEqual(selectStreetSamples(points,{vehicles:[{position:{x:20,y:1,z:0},yaw:Math.PI/4}]}).map(point=>point.id),['sidewalk','legacy']);
  assert.deepEqual(selectStreetSamples(points,{limit:0}),[]);
});
