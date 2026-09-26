import fs from 'node:fs/promises';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import RAPIER from '@dimforge/rapier3d-compat';

await Promise.all([MeshoptDecoder.ready,RAPIER.init()]);
const manifest=JSON.parse(await fs.readFile('public/data/manifest.json','utf8'));
const buildings=JSON.parse(await fs.readFile('public/data/buildings.json','utf8'));
const points=[],grid=new Map(),heights=Array.from({length:buildings.length},()=>Array(5).fill(-Infinity));
for(const [id,b] of buildings.entries()) {
  const x=(b[0]+b[2])/2,z=(b[1]+b[3])/2;
  [[x,z],[b[0],z],[b[2],z],[x,b[1]],[x,b[3]]].forEach(([x,z],sample)=>{
    const p={id,sample,x,z};points.push(p);const key=Math.floor(x/128)*65536+Math.floor(z/128);
    if(!grid.has(key))grid.set(key,[]);grid.get(key).push(p);
  });
}
let completed=0;
for(const tile of manifest.tiles) {
  const file=await fs.readFile(`public/data/tiles/${tile.id}.0.mesh`);
  const nv=file.readUInt32LE(4),ni=file.readUInt32LE(8),vb=file.readUInt32LE(12),ib=file.readUInt32LE(16);
  const vertices=new Uint8Array(nv*20),indices=new Uint8Array(ni*4);
  MeshoptDecoder.decodeVertexBuffer(vertices,nv,20,file.subarray(20,20+vb));
  MeshoptDecoder.decodeIndexBuffer(indices,ni,4,file.subarray(20+vb,20+vb+ib));
  const positions=new Float32Array(nv*3),view=new DataView(vertices.buffer),allIndices=new Uint32Array(indices.buffer),ground=[];
  for(let i=0;i<nv;i++)for(let j=0;j<3;j++)positions[i*3+j]=view.getFloat32(i*20+j*4,true);
  for(let i=0;i<ni;i+=3){const surface=vertices[allIndices[i]*20+15];if(surface===1||surface===3)ground.push(allIndices[i],allIndices[i+1],allIndices[i+2]);}
  if(!ground.length)continue;
  const world=new RAPIER.World({x:0,y:0,z:0});
  world.createCollider(RAPIER.ColliderDesc.trimesh(positions,new Uint32Array(ground)));world.step();
  for(let x=Math.floor(tile.bounds[0]/128);x<=Math.floor(tile.bounds[3]/128);x++)for(let z=Math.floor(tile.bounds[2]/128);z<=Math.floor(tile.bounds[5]/128);z++)for(const p of grid.get(x*65536+z)||[]) {
    if(p.x<tile.bounds[0]-.05||p.x>tile.bounds[3]+.05||p.z<tile.bounds[2]-.05||p.z>tile.bounds[5]+.05)continue;
    const hit=world.castRay(new RAPIER.Ray({x:p.x,y:450,z:p.z},{x:0,y:-1,z:0}),500,true);
    if(hit)heights[p.id][p.sample]=Math.max(heights[p.id][p.sample],450-hit.timeOfImpact);
  }
  world.free();
  if(++completed%25===0)process.stdout.write(`${completed}/${manifest.tiles.length} tiles\n`);
}
let fallback=0;
const result=heights.map((values,i)=>{const valid=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!valid.length){fallback++;return buildings[i][4];}return Math.round(valid[Math.floor(valid.length/2)]*100)/100;});
await fs.writeFile('public/data/building-ground.json',JSON.stringify(result));
console.log(JSON.stringify({buildings:result.length,fallback,min:Math.min(...result),max:Math.max(...result)}));
