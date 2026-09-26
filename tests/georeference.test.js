import test from 'node:test';
import assert from 'node:assert/strict';
import { fromEastNorth, fromWgs84, northVector, toEastNorth, toWgs84 } from '../src/game/georeference.js';

const reflected = {
  angleDeg: -0.03433903190136345,
  translationEast: 1259.9070773504736,
  translationNorth: -142.65213378157046,
  scale: 1.0007898128943244,
  zSign: -1,
  anchorLat: 33.888,
  anchorLon: 35.495,
};

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('reflected registration round-trips model, tangent-plane, and WGS84 coordinates', () => {
  for (const point of [{ x: 0, z: 0 }, { x: 1750.2, z: -930.4 }, { x: -2800.1, z: 2100.8 }]) {
    const en = toEastNorth(point.x, point.z, reflected);
    const model = fromEastNorth(en.east, en.north, reflected);
    close(model.x, point.x); close(model.z, point.z);
    const wgs84 = toWgs84(point.x, point.z, reflected);
    const restored = fromWgs84(wgs84.lat, wgs84.lon, reflected);
    close(restored.x, point.x, 1e-7); close(restored.z, point.z, 1e-7);
  }
});

test('reflected registration maps negative model z toward geographic north', () => {
  const north = northVector(reflected);
  assert.ok(north.z < -.999);
  assert.ok(Math.abs(north.x) < .001);
  const start = toEastNorth(0, 0, reflected);
  const end = toEastNorth(0, -100, reflected);
  assert.ok(end.north > start.north);
});

test('legacy registration defaults to unit scale and an unreflected z axis', () => {
  const legacy = { angleDeg: 0, translationEast: 10, translationNorth: 20 };
  assert.deepEqual(toEastNorth(3, 4, legacy), { east: 13, north: 24 });
  assert.deepEqual(fromEastNorth(13, 24, legacy), { x: 3, z: 4 });
  assert.deepEqual(northVector(legacy), { x: 0, z: 1 });
});

import { CityMap } from '../src/game/city-map.js';
import { readFile } from 'node:fs/promises';

test('north-up map places north above south and renders locality labels at finite coordinates',()=>{
  const text=[];
  const ctx={fillRect(){},save(){},setTransform(){},drawImage(){},restore(){},measureText(value){return{width:value.length*12};},strokeText(value,x,y){text.push({value,x,y});},fillText(value,x,y){text.push({value,x,y});},beginPath(){},arc(){},fill(){},stroke(){}};
  const map=Object.assign(Object.create(CityMap.prototype),{registration:reflected,bounds:[-4050,-3450,3600,3100],scale:3072/7650,base:{},fullCtx:ctx,areas:[{name:'Beirut',x:0,z:0}]});
  const frame=map.fullMapFrame(1280,920);
  const centre=map.fullPoint(0,0,frame),north=map.fullPoint(0,-100,frame),east=map.fullPoint(100,0,frame);
  assert.ok(north.y<centre.y);assert.ok(east.x>centre.x);
  map.drawFull({x:0,z:0},0,[],null);
  assert.ok(text.some(row=>row.value==='BEIRUT'));
  assert.ok(text.every(row=>Number.isFinite(row.x)&&Number.isFinite(row.y)));
});

test('runtime place data embeds the same corrected transform as the canonical registration',async()=>{
  const registration=JSON.parse(await readFile('public/data/registration.json','utf8'));
  const runtime=JSON.parse(await readFile('public/data/city-locations.json','utf8'));
  for(const key of ['angleDeg','scale','zSign','translationEast','translationNorth','anchorLat','anchorLon'])assert.equal(runtime.registration[key],registration[key],key);
  assert.equal(runtime.registration.accuracyMeters,null);
  assert.equal(registration.zSign,-1);
});
