/** Source coordinates are preserved; dimensions beyond the OSM footprint are
 * explicitly photographic estimates, not a measured architectural survey. */
import fs from 'node:fs/promises';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import * as THREE from 'three';
import { fromWgs84 } from '../src/game/georeference.js';

async function sourceJSON(path,fallback){
 try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const value=await fallback();await fs.mkdir('data/bliss-street/references',{recursive:true});await fs.writeFile(path,JSON.stringify(value,null,2)+'\n');return value;
}
async function osmWay(id){
 const response=await fetch(`https://api.openstreetmap.org/api/0.6/way/${id}/full.json`);if(!response.ok)throw new Error(`OSM way ${id}: HTTP ${response.status}`);
 return response.json();
}
function wayGeometry(document,id){const way=document.elements.find(element=>element.type==='way'&&element.id===id),nodes=new Map(document.elements.filter(element=>element.type==='node').map(node=>[node.id,node]));return{...way,geometry:way.nodes.map(id=>{const node=nodes.get(id);return{lat:node.lat,lon:node.lon};})};}
const registration=JSON.parse(await fs.readFile('public/data/registration.json','utf8'));
const gateSource=await sourceJSON('data/bliss-street/references/aub-main-gate-osm.json',()=>osmWay(332101455));
const campusSource=await sourceJSON('data/bliss-street/references/aub-boundary-osm.json',async()=>({elements:[wayGeometry(await osmWay(25579036),25579036)]}));
const node=id=>gateSource.elements.find(element=>element.type==='node'&&element.id===id);
const model=point=>fromWgs84(point.lat,point.lon,registration);
const a=model(node(3392193192)),b=model(node(3392193191)),back=model(node(3392193189));
const center={x:(a.x+b.x+model(node(3392193189)).x+model(node(3392193190)).x)/4,z:(a.z+b.z+model(node(3392193189)).z+model(node(3392193190)).z)/4};
const width=Math.hypot(b.x-a.x,b.z-a.z),depth=Math.hypot(back.x-a.x,back.z-a.z);
const tangent={x:(b.x-a.x)/width,z:(b.z-a.z)/width};
const gate={id:'aub-main-gate',name:'AUB Main Gate',kind:'gatehouse',position:[center.x,0,center.z],rotationY:-Math.atan2(tangent.z,tangent.x),width,depth,height:10.4,archWidth:3.55,archSpring:4.15,roofRise:1.45,sources:['aub-gate-footprint','aub-architecture','aub-materials'],confidence:'Located by OSM footprint and official AUB coordinate; elevations and ornament dimensions estimated from AUB photographs.'};
const campus=campusSource.elements.find(element=>element.id===25579036);
// The southern university boundary fronts Bliss Street. The main-gate segment
// has a gap covering the entire gatehouse; no boundary wall blocks its arch.
const path=campus.geometry.slice(51,57).map(model);
const walls=[];
for(let i=1;i<path.length;i++){
 const p=path[i-1],q=path[i],length=Math.hypot(q.x-p.x,q.z-p.z),steps=Math.ceil(length/5);
 for(let j=0;j<steps;j++){
  const a={x:p.x+(q.x-p.x)*j/steps,z:p.z+(q.z-p.z)*j/steps};
  const b={x:p.x+(q.x-p.x)*(j+1)/steps,z:p.z+(q.z-p.z)*(j+1)/steps};
  const mx=(a.x+b.x)/2-center.x,mz=(a.z+b.z)/2-center.z;
  const along=mx*tangent.x+mz*tangent.z,across=-mx*tangent.z+mz*tangent.x;
  if(Math.abs(along)<width/2+3&&Math.abs(across)<depth+3)continue;
  walls.push({id:`aub-boundary-${i}-${j}`,a:[a.x,0,a.z],b:[b.x,0,b.z],height:2.1,thickness:.48,sources:['aub-campus-footprint','aub-campus-edge','streetview-602'],confidence:'Boundary trace is OSM; 2.1 m wall height, coursing and coping estimated from April 2023 street photography. Individual stones are not surveyed.'});
 }
}
await MeshoptDecoder.ready;
const manifest=JSON.parse(await fs.readFile('public/data/manifest.json','utf8'));
const entranceSample=[(a.x+b.x)/2,0,(a.z+b.z)/2];
const rearSample=[(model(node(3392193189)).x+model(node(3392193190)).x)/2,0,(model(node(3392193189)).z+model(node(3392193190)).z)/2];
const worshipSource=await sourceJSON('data/bliss-street/references/bliss-religious-footprints.json',async()=>({'Assembly Hall':wayGeometry(await osmWay(25578952),25578952),'Daouk Mosque':wayGeometry(await osmWay(551960432),551960432)}));
const religious=[
 {id:'aub-assembly-hall',name:'AUB Assembly Hall',kind:'assembly-hall',replacementBuildingId:87,footprint:worshipSource['Assembly Hall'].geometry.slice(0,-1).map(point=>{const p=model(point);return[p.x,p.z];}),height:7.8,roofRise:6.1,sources:['assembly-footprint','assembly-history','streetview-87'],confidence:'Named OSM footprint and photographed crossing roofs; eave and ridge heights are visual estimates, not surveyed elevations.'},
 {id:'daouk-mosque',name:'Daouk Mosque',kind:'mosque',replacementBuildingId:264,footprint:worshipSource['Daouk Mosque'].geometry.slice(0,-1).map(point=>{const p=model(point);return[p.x,p.z];}),height:4.6,minaret:{position:[-2835.9,-1314.6],height:18.8,radius:.62,confidence:'The minaret is visible near image column334/640. Its base is estimated by intersecting the camera bearing with the rear portion of the mapped mosque; position uncertainty about2m and height estimated photographically.'},sources:['mosque-footprint','streetview-264'],confidence:'Named OSM footprint replaces the incorrect tall CAD box. Low arcade and slender minaret observed in April2023 photo; rear decoration is omitted.'}
];
for(const record of religious){const n=record.footprint.length;record.position=[record.footprint.reduce((v,p)=>v+p[0],0)/n,0,record.footprint.reduce((v,p)=>v+p[1],0)/n];}
const buildings=JSON.parse(await fs.readFile('public/data/buildings.json','utf8'));
const facadeReview=JSON.parse(await fs.readFile('public/assets/world/bliss/facades.json','utf8'));
const canopyEvidence=[1813,594,593,592,600,601,597,491,577].map(id=>({id,record:facadeReview.buildings[id],bounds:buildings[id]}));
const campusPolygon=campus.geometry.map(point=>{const p=model(point);return[p.x,p.z];});
const inside=(x,z,polygon)=>{let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
const trees=[];
const mappedTree=model({lat:33.8997471,lon:35.4826869});
trees.push({id:'osm-tree-6048740953',position:[mappedTree.x,0,mappedTree.z],kind:'broadleaf',height:14,crownDiameter:13,rotationY:.4,sources:['osm-aub-laurel','streetview-87'],placement:'mapped',confidence:'Exact OSM trunk coordinate; Cuban-laurel identification from OSM. Height and crown extent are photographic estimates.'});
for(let i=0;i<walls.length&&trees.length<105;i++){
 const wall=walls[i],dx=wall.b[0]-wall.a[0],dz=wall.b[2]-wall.a[2],length=Math.hypot(dx,dz),nx=dz/length,nz=-dx/length;
 // Two staggered groups immediately inside the mapped university perimeter.
 // There is deliberately no vegetation extrapolation across Bliss Street.
 for(let row=0;row<2&&trees.length<105;row++){
  if(row===1&&i%3!==0)continue;
  const offset=row===0?3.2+(i%4)*.7:10.5;
  const x=(wall.a[0]+wall.b[0])/2+nx*offset,z=(wall.a[2]+wall.b[2])/2+nz*offset;
  if(!inside(x,z,campusPolygon))continue;
  const along=(x-center.x)*tangent.x+(z-center.z)*tangent.z,across=-(x-center.x)*tangent.z+(z-center.z)*tangent.x;
  if(Math.abs(along)<width/2+10&&Math.abs(across)<34)continue;
  if(Math.abs(along)<8&&across<0&&across>-85)continue;
  const chapel=religious[0].footprint,minX=Math.min(...chapel.map(p=>p[0]))-6,maxX=Math.max(...chapel.map(p=>p[0]))+6,minZ=Math.min(...chapel.map(p=>p[1]))-6,maxZ=Math.max(...chapel.map(p=>p[1]))+6;
  if(x>minX&&x<maxX&&z>minZ&&z<maxZ)continue;
  if(buildings.some(b=>x>b[0]-1.1&&x<b[2]+1.1&&z>b[1]-1.1&&z<b[3]+1.1))continue;
  if(trees.some(tree=>Math.hypot(x-tree.position[0],z-tree.position[2])<4.4))continue;
  const evidence=canopyEvidence.toSorted((a,b)=>Math.abs((a.bounds[0]+a.bounds[2])/2-x)-Math.abs((b.bounds[0]+b.bounds[2])/2-x))[0];
  const narrow=row===1&&i%2===0;
  trees.push({id:`aub-canopy-estimate-${i}-${row}`,position:[x,0,z],kind:narrow?'cypress':'broadleaf',height:narrow?13+(i%4)*.6:10.5+(i%5)*.7,crownDiameter:narrow?3.0:9.8+(i%4)*1.2,rotationY:i*2.399963,sources:['aub-campus-footprint',`canopy-photo-${evidence.id}`],placement:'estimated-group',confidence:'Approximate mature canopy group reconstructed only inside AUB from nearby photographed vegetation. Individual tree positions, heights and species are not surveyed.'});
 }
}
const samples=[gate.position,entranceSample,rearSample,...religious.map(record=>record.position),...walls.flatMap(w=>[w.a,w.b]),...trees.map(tree=>tree.position)];
const ray=new THREE.Raycaster(),heights=samples.map(()=>-Infinity);
for(const tile of manifest.tiles){
 const targets=samples.map((p,i)=>({p,i})).filter(({p})=>p[0]>=tile.bounds[0]&&p[0]<=tile.bounds[3]&&p[2]>=tile.bounds[2]&&p[2]<=tile.bounds[5]);
 if(!targets.length)continue;
 const file=await fs.readFile(`public/data/tiles/${tile.id}.0.mesh`);
 const nv=file.readUInt32LE(4),ni=file.readUInt32LE(8),vb=file.readUInt32LE(12),ib=file.readUInt32LE(16);
 const vertices=new Uint8Array(nv*20),indices=new Uint8Array(ni*4);
 MeshoptDecoder.decodeVertexBuffer(vertices,nv,20,file.subarray(20,20+vb));MeshoptDecoder.decodeIndexBuffer(indices,ni,4,file.subarray(20+vb,20+vb+ib));
 const positions=new Float32Array(nv*3),view=new DataView(vertices.buffer),allIndices=new Uint32Array(indices.buffer),ground=[];
 for(let i=0;i<nv;i++)for(let j=0;j<3;j++)positions[i*3+j]=view.getFloat32(i*20+j*4,true);
 for(let i=0;i<ni;i+=3)if([1,3].includes(vertices[allIndices[i]*20+15]))ground.push(allIndices[i],allIndices[i+1],allIndices[i+2]);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(ground);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();
 for(const {p,i} of targets){ray.set(new THREE.Vector3(p[0],450,p[2]),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(mesh);if(hits.length)heights[i]=Math.max(heights[i],hits[0].point.y);}
 geometry.dispose();material.dispose();
}
if(heights.some(h=>!Number.isFinite(h)))throw new Error(`Missing terrain heights for ${heights.filter(h=>!Number.isFinite(h)).length} landmark samples; do not guess.`);
samples.forEach((p,i)=>{p[1]=Math.round(heights[i]*1000)/1000;});
gate.groundSamples={center:gate.position[1],entrance:entranceSample[1],rear:rearSample[1]};
gate.position[1]=entranceSample[1]+.035;
gate.foundationDepth=Math.max(0,gate.position[1]-rearSample[1]);
const sources=[
 {id:'aub-gate-footprint',url:'https://www.openstreetmap.org/way/332101455',local:'data/bliss-street/references/aub-main-gate-osm.json',use:'Footprint corners and orientation',license:'Open Database License; OpenStreetMap contributors'},
 {id:'aub-official-location',url:'https://linked.aub.edu.lb/collab/index.php/Main_Gate_Building',use:'Official coordinate cross-check: 33°53′58.19″N,35°28′56.23″E'},
 {id:'aub-architecture',url:'https://online-exhibit.aub.edu.lb/exhibits/show/aub-main-gate/1901-1902/the-main-gate-building-s-archi/architectural-features',local:'data/bliss-street/references/aub-main-gate-2015.jpg',use:'Symmetric gatehouse, horseshoe arch, paired towers and terracotta pitched roofs; visual reference only, not used as texture'},
 {id:'aub-materials',url:'https://online-exhibit.aub.edu.lb/exhibits/show/aub-main-gate/1901-1902/the-main-gate-building-s-archi/the-material',use:'Sandstone, yellow trim and wrought iron'},
 {id:'aub-campus-footprint',url:'https://www.openstreetmap.org/way/25579036',local:'data/bliss-street/references/aub-boundary-osm.json',use:'Southern campus boundary trace',license:'Open Database License; OpenStreetMap contributors'},
 {id:'aub-campus-edge',url:'https://www.aub.edu/Neighborhood/Documents/1-2AUB-NI-Report-2015-11-01_FINAL.pdf',use:'Campus wall edge along Bliss Street'},
 {id:'streetview-602',local:'data/photographic/facades/images/602.jpg',panoId:'jxt9PcBZ_3fypNtkExMOdw',date:'2023-04',lat:33.89927541211059,lon:35.48127490394604,headingDeg:3.3,use:'Ashlar campus wall, pale coping and estimated height; image is a modelling reference, not a new texture'}
];
sources.push(
 {id:'assembly-footprint',url:'https://www.openstreetmap.org/way/25578952',local:'data/bliss-street/references/bliss-religious-footprints.json',use:'Named AssemblyHall footprint; nave, transept and apse',license:'Open Database License; OpenStreetMap contributors'},
 {id:'assembly-history',url:'https://www.aub.edu.lb/ieds/Documents/Fact%20Book/FB201516.pdf',use:'AUB identifies AssemblyHall as formerchapel with redroof tiles and rosewindows'},
 {id:'streetview-87',local:'data/photographic/facades/images/87.jpg',panoId:'atd26L2eSXUc3jfKHDfdBA',date:'2017-10',lat:33.89979705813437,lon:35.4827067170658,headingDeg:128.6,use:'Stonewalls, pointedgables, windows, buttresses, redtiled crossingroofs'},
 {id:'mosque-footprint',url:'https://www.openstreetmap.org/way/551960432',local:'data/bliss-street/references/bliss-religious-footprints.json',use:'Named DaoukMosque footprint',license:'Open Database License; OpenStreetMap contributors'},
 {id:'streetview-264',local:'data/photographic/facades/images/264.jpg',panoId:'dgf9KphQPXiiqySe7Qe8bg',date:'2023-04',lat:33.89868143676545,lon:35.47796992585772,headingDeg:190.8,use:'Lowarched streetarcade, flatroof, slendercylindrical minaret with gallery andsmallpointedlantern'}
);
sources.push({id:'osm-aub-laurel',url:'https://www.openstreetmap.org/node/6048740953',local:'data/bliss-street/references/bliss-chapel-osm.xml',use:'Mapped Cuban-laurel trunk coordinate, evergreen broadleaved tree; canopy dimensions are estimated',license:'Open Database License; OpenStreetMap contributors'});
for(const evidence of canopyEvidence){const photo=evidence.record.photo;sources.push({id:`canopy-photo-${evidence.id}`,local:photo.path,url:photo.url,panoId:photo.panoId,date:photo.date,lat:photo.lat,lon:photo.lon,headingDeg:photo.headingDeg,use:evidence.record.review.notes});}
const result={version:1,registrationVersion:registration.version,title:'Bliss Street — AUB frontage',note:'Architectural reconstruction from published AUB photographs and mapped footprints. Approximate dimensions, no invented landmark identities. Terrain elevation sampled directly from the current city mesh.',sources,landmarks:[gate,...religious],replacementBuildingIds:religious.map(record=>record.replacementBuildingId),walls,trees,campusPolygon};
await fs.writeFile('public/data/bliss-landmarks.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({trees:trees.length,gate,wallSegments:walls.length,wallLength:Math.round(walls.reduce((n,w)=>n+Math.hypot(w.b[0]-w.a[0],w.b[2]-w.a[2]),0))}));
