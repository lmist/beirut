/** Extract actual street-facing CAD planes, then apply photo-reviewed architecture.
 * Run after prepare_bliss_corridor.mjs and prepare_bliss_photos.py.
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import RAPIER from '@dimforge/rapier3d-compat';
import { createBuildingIndex } from '../src/world/building-index.js';

const round=(n,p=3)=>Number(n.toFixed(p));
const pointKey=p=>`${Math.round(p[0]*100)},${Math.round(p[1]*100)}`;
export function signedArea(points) {
  return points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
}
export function boundaryLoops(triangles) {
  const edges=new Map(),points=new Map();
  for(const triangle of triangles)for(let i=0;i<3;i++) {
    const a=triangle[i],b=triangle[(i+1)%3],ka=pointKey(a),kb=pointKey(b);
    if(ka===kb)continue;
    points.set(ka,a);points.set(kb,b);
    const key=[ka,kb].sort().join('|');
    if(edges.has(key))edges.delete(key);else edges.set(key,[ka,kb]);
  }
  const neighbors=new Map();
  for(const [a,b] of edges.values())for(const [from,to] of [[a,b],[b,a]]) {
    if(!neighbors.has(from))neighbors.set(from,[]);neighbors.get(from).push(to);
  }
  const used=new Set(),loops=[];
  const edgeKey=(a,b)=>[a,b].sort().join('|');
  for(const [start,first] of edges.values()) {
    if(used.has(edgeKey(start,first)))continue;
    let previous=start,current=first;const loop=[points.get(start)];
    used.add(edgeKey(start,first));
    for(let guard=0;guard<edges.size+2;guard++) {
      loop.push(points.get(current));
      const available=(neighbors.get(current)||[]).filter(key=>!used.has(edgeKey(current,key)));
      // A pair of separate contours can touch at one CAD vertex. Edges, not
      // vertices, are consumed, so both contours survive extraction.
      const next=available.includes(start)?start:available[0];
      if(!next)break;
      used.add(edgeKey(current,next));
      if(next===start){if(loop.length>=3)loops.push(loop);break;}
      previous=current;current=next;
    }
  }
  return loops;
}
export function clipAbove(points,minY) {
  const result=[];
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],insideA=a[1]>=minY,insideB=b[1]>=minY;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=(minY-a[1])/(b[1]-a[1]);result.push([a[0]+t*(b[0]-a[0]),minY]);}
  }
  return result;
}
export function nearestStreet(point,segments) {
  let best=null;
  for(const s of segments) {
    const [ax,az]=s.a,[bx,bz]=s.b,dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
    const t=Math.max(0,Math.min(1,((point[0]-ax)*dx+(point[1]-az)*dz)/(length*length||1)));
    const nearest=[ax+t*dx,az+t*dz],distance=Math.hypot(point[0]-nearest[0],point[1]-nearest[1]);
    if(!best||distance<best.distance)best={point:nearest,distance,station:s.station+t*length};
  }
  return best;
}

/** Counts come from inspected photos; metres come from the retained CAD wall.
 * Ratios are visual estimates, recorded as such, never surveyed dimensions. */
export function styleFromObservation(face,observation) {
  const style={...observation.style},a=observation.architecture||{};
  if(!['observed','partial','photo-reviewed','reviewed'].includes(observation.review?.status)||!a.floorsObserved||!a.baysObserved||a.status==='unresolved')return style;
  const floors=Math.trunc(a.floorsObserved),bays=Math.trunc(a.baysObserved),height=face.top-face.base;
  if(floors<1||floors>50||bays<1||bays>40)return style;
  if(floors===1){
    if(a.storefrontBays?.length)Object.assign(style,{floors:1,bays,groundHeight:Math.min(3.8,height-.15),storefront:{bays:a.storefrontBays,shutter:!!a.storefrontShutter,canopyDepth:a.canopyDepth||0}});
    return style;
  }
  const groundHeight=Math.min(3.8,height/floors*1.1);
  const floorHeight=a.floorCountMode==='minimum'?3.2:(height-groundHeight)/(floors-1);
  // A current tower in place of an old low-rise requires a separately verified
  // replacement footprint. Never squeeze fourteen stories into an 8m CAD box.
  if(floorHeight<2.1||floorHeight>5.4||groundHeight+(floors-2)*floorHeight>height-1)return {...style,geometryConflict:'Observed floors conflict with the retained source height.'};
  if(!(a.windowWidthRatio>0&&a.windowHeightRatio>0))return style;
  const bayWidth=face.width/bays;
  const width=Math.max(.35,Math.min(bayWidth-.34,bayWidth*a.windowWidthRatio));
  const windowHeight=Math.max(.55,Math.min(floorHeight-.5,floorHeight*a.windowHeightRatio));
  if(width<.4||bayWidth<.8)return style;
  Object.assign(style,{floors,bays,groundHeight,floorHeight,window:{width:round(width),height:round(windowHeight),sill:round(Math.max(.2,(floorHeight-windowHeight)*.42)),recess:round(Math.max(.12,Math.min(.4,floorHeight*(a.recessDepthRatio||.06)))),mullions:Math.max(0,Math.min(5,Math.floor(width/1.3)-1))}});
  if(a.bayWidthRatios?.length===bays){style.bayWidthRatios=a.bayWidthRatios;style.window.widthRatio=a.windowWidthRatio;}
  if(a.curtainWall)style.curtainWall=true;
  if(/arch/.test(a.windowShape||'')||a.archedWindows)style.window.arch=true;
  if(a.balconyBays?.length&&a.balconyFloors?.length)style.balconies={bays:a.balconyBays.filter(b=>b>=0&&b<bays),floors:a.balconyFloors.filter(f=>f>0&&f<floors),depth:round(Math.max(.55,Math.min(1.8,floorHeight*(a.balconyDepthRatio||.30)))),width:round(Math.min(bayWidth-.16,width+.75)),rail:a.balconyRail||'metal',continuous:!!a.continuousBalconies,shape:a.balconyShape||'rectangular'};
  if(style.balconies&&a.balconyShapeByBay)style.balconies.shapesByBay=a.balconyShapeByBay;
  if(style.balconies&&!a.balconyRail&&/glass|transparent/.test(String(observation.observed?.balconies||'').toLowerCase()))style.balconies.rail='glass';
  if(a.storefrontBays?.length)style.storefront={bays:a.storefrontBays.filter(b=>b>=0&&b<bays),shutter:!!a.storefrontShutter,canopyDepth:a.canopyDepth||0};
  if(a.verticalPiers)style.verticalPiers=true;
  if(a.floorBands||a.continuousBalconies)style.floorBands=true;
  const roof=JSON.stringify(observation.observed?.roof||'').toLowerCase();
  if(/parapet/.test(roof))style.parapet={height:.45};
  if(/cornice|projecting.*eave|deep.*eave/.test(roof))style.cornice={height:.2,depth:.24};
  style.dimensionStatus='Estimated from inspected photo proportions fitted to retained CAD geometry.';
  return style;
}

function observationsFor(photo) {
  if(!photo)return [];
  return [photo,...(photo.alternateReviews||[])].filter(p=>p.review&&p.architecture?.floorsObserved&&p.architecture?.baysObserved&&['observed','partial','photo-reviewed','reviewed'].includes(p.review.status));
}

function applyReviewedArchitecture(record,photo,sources) {
  for(const face of record.facades){face.review={status:'unobserved',sourceIds:[]};face.style={};}
  for(const observation of observationsFor(photo).reverse()) {
    const sourceId=observation.review.sourceIds?.[0],source=sources[sourceId]||(photo?.photo?.imageId===sourceId?photo.photo:null);
    if(!source?.camera)continue;
    let best=null;
    for(const face of record.facades) {
      const dx=source.camera[0]-face.center[0],dz=source.camera[2]-face.center[1],distance=Math.hypot(dx,dz);
      const cosine=(dx*face.normal[0]+dz*face.normal[1])/Math.max(1,distance);
      if(cosine<.18)continue;
      const target=source.targetFacadeCenter;
      const score=target?-Math.hypot(face.center[0]-target[0],face.center[1]-target[1]):cosine*Math.sqrt(face.width*(face.top-face.base))/Math.sqrt(Math.max(1,distance));
      if(!best||score>best.score)best={face,score};
    }
    if(!best)continue;
    best.face.review=observation.review;
    best.face.observed=observation.observed;
    best.face.architecture=observation.architecture;
    best.face.style=styleFromObservation(best.face,observation);
  }
  record.review=photo?.review||{status:'unobserved',sourceIds:[]};
}

export async function prepareBlissArchitecture() {
  const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
  const [corridor,manifest,buildings,ground]=await Promise.all(['public/data/bliss-street.json','public/data/manifest.json','public/data/buildings.json','public/data/building-ground.json'].map(read));
  let photos={buildings:{}};
  try{photos=await read('public/assets/world/bliss/facades.json');}catch{}
  const selected=new Map(corridor.buildings.map(b=>[b.id,b]));
  const lookup=createBuildingIndex(buildings,64,ground),planes=new Map(),buildingPlanes=new Map();
  await Promise.all([MeshoptDecoder.ready,RAPIER.init()]);
  const terrain=new RAPIER.World({x:0,y:0,z:0});
  for(const tile of manifest.tiles) {
    if(!corridor.buildings.some(b=>{const box=buildings[b.id];return box[0]<=tile.bounds[3]&&box[2]>=tile.bounds[0]&&box[1]<=tile.bounds[5]&&box[3]>=tile.bounds[2];}))continue;
    const file=await fs.readFile(`public/data/tiles/${tile.id}.0.mesh`);
    const nv=file.readUInt32LE(4),ni=file.readUInt32LE(8),vb=file.readUInt32LE(12),packed=new Uint8Array(nv*20),bytes=new Uint8Array(ni*4);
    MeshoptDecoder.decodeVertexBuffer(packed,nv,20,file.subarray(20,20+vb));MeshoptDecoder.decodeIndexBuffer(bytes,ni,4,file.subarray(20+vb));
    const view=new DataView(packed.buffer),position=new Float32Array(nv*3),index=new Uint32Array(bytes.buffer);
    for(let i=0;i<nv;i++)for(let j=0;j<3;j++)position[i*3+j]=view.getFloat32(i*20+j*4,true);
    const terrainIndices=[];
    for(let i=0;i<ni;i+=3)if([1,3].includes(packed[index[i]*20+15]))terrainIndices.push(index[i],index[i+1],index[i+2]);
    if(terrainIndices.length)terrain.createCollider(RAPIER.ColliderDesc.trimesh(position,new Uint32Array(terrainIndices)));
    for(let i=0;i<ni;i+=3) {
      const a=index[i],b=index[i+1],c=index[i+2];
      if(packed[a*20+15]!==5)continue;
      const source=lookup.triangleAt(position,a,b,c);if(!source||!selected.has(source[7]))continue;
      const vertices=[a,b,c].map(v=>[position[v*3],position[v*3+1],position[v*3+2]]);
      const u=vertices[1].map((v,i)=>v-vertices[0][i]),v=vertices[2].map((v,i)=>v-vertices[0][i]);
      let nx=u[1]*v[2]-u[2]*v[1],ny=u[2]*v[0]-u[0]*v[2],nz=u[0]*v[1]-u[1]*v[0];
      const length=Math.hypot(nx,ny,nz);if(length<.001||Math.abs(ny/length)>.04)continue;
      const norm=Math.hypot(nx,nz);nx/=norm;nz/=norm;
      const cx=vertices.reduce((sum,p)=>sum+p[0],0)/3,cz=vertices.reduce((sum,p)=>sum+p[2],0)/3;
      if(nx*(cx-(source[0]+source[2])/2)+nz*(cz-(source[1]+source[3])/2)<0){nx=-nx;nz=-nz;}
      // Rounded source vertices can give two triangles of one wall slightly
      // different normals. Cluster by their actual shared plane, not a hash
      // boundary that would create a diagonal seam through the architecture.
      if(!buildingPlanes.has(source[7]))buildingPlanes.set(source[7],[]);
      const candidates=buildingPlanes.get(source[7]);
      let face=candidates.find(f=>nx*f.normal[0]+nz*f.normal[1]>.999998&&vertices.every(p=>Math.abs(p[0]*f.normal[0]+p[2]*f.normal[1]-f.plane)<.12));
      if(!face){
        face={id:source[7],normal:[nx,nz],tangent:[-nz,nx],plane:vertices.reduce((s,p)=>s+p[0]*nx+p[2]*nz,0)/3,triangles:[]};
        candidates.push(face);planes.set(`${source[7]}:${candidates.length}`,face);
      }
      face.triangles.push(vertices.map(p=>[p[0]*face.tangent[0]+p[2]*face.tangent[1],p[1]]));
    }
  }
  terrain.step();
  const streetGround=(center,normal,fallback)=>{
    for(const offset of [1,2.5,4]){
      const ray=new RAPIER.Ray({x:center[0]+normal[0]*offset,y:250,z:center[1]+normal[1]*offset},{x:0,y:-1,z:0});
      const hit=terrain.castRay(ray,260,true);
      if(hit&&250-hit.timeOfImpact>-5)return 250-hit.timeOfImpact;
    }
    return fallback;
  };
  const records=new Map(corridor.buildings.map(b=>[b.id,{id:b.id,bounds:buildings[b.id],station:b.station,side:b.side,ground:b.ground,facades:[]}]));
  for(const plane of planes.values())for(const raw of boundaryLoops(plane.triangles)) {
    const min=Math.min(...raw.map(p=>p[0])),max=Math.max(...raw.map(p=>p[0])),top=Math.max(...raw.map(p=>p[1]));
    const width=max-min;if(width<2)continue;
    const mid=(min+max)/2,center=[plane.normal[0]*plane.plane+plane.tangent[0]*mid,plane.normal[1]*plane.plane+plane.tangent[1]*mid];
    const nearest=nearestStreet(center,corridor.segments);
    if(!nearest||nearest.distance>100)continue;
    const facing=plane.normal[0]*(nearest.point[0]-center[0])+plane.normal[1]*(nearest.point[1]-center[1]);
    if(facing<1||facing/Math.max(1,nearest.distance)<.15)continue;
    const base=streetGround(center,plane.normal,ground[plane.id]);const polygon=clipAbove(raw,base);
    if(polygon.length<3||Math.abs(signedArea(polygon))<6||top-base<2.6)continue;
    const record=records.get(plane.id),photo=Array.isArray(photos.buildings)?photos.buildings.find(p=>p?.id===plane.id):photos.buildings[plane.id];
    const review=photo?.review||{status:'unobserved',sourceIds:[]};
    record.review=review;
    const style=photo?.style?structuredClone(photo.style):{};
    const face={id:`${plane.id}-${record.facades.length}`,center:center.map(n=>round(n)),normal:plane.normal.map(n=>round(n,6)),tangent:plane.tangent.map(n=>round(n,6)),width:round(width),base:round(base),baseSource:'Facade-local raycast against road/sidewalk mesh; building median only if no ground hit.',top:round(top),polygon:polygon.map(([x,y])=>[round(x-mid),round(y-base)]),station:round(nearest.station),distance:round(nearest.distance),review,style};
    record.facades.push(face);
  }
  terrain.free();
  const rows=[...records.values()];
  for(const record of rows){const photo=Array.isArray(photos.buildings)?photos.buildings.find(p=>p?.id===record.id):photos.buildings[record.id];applyReviewedArchitecture(record,photo,photos.sources||{});}
  let replacements=[];
  try{replacements=(await read('public/data/bliss-landmarks.json')).replacementBuildingIds||[];}catch{}
  for(const id of replacements){const record=records.get(id);if(record){record.sourceFacades=record.facades;record.facades=[];record.replacedBy='bliss-landmarks';}}
  try{
    const heritage=await read('public/data/bliss-heritage.json');
    for(const id of heritage.replacementBuildingIds||[]){const record=records.get(id);if(record){record.sourceFacades=record.facades;record.facades=[];record.replacedBy='bliss-heritage';}}
  }catch{}
  for(const record of rows)if(!record.facades.length&&!record.replacedBy)record.omissionReason='No source wall remains at least 2.6m tall above local measured street terrain.';
  const output={version:1,name:'Bliss Street',registrationVersion:2,geometrySource:'Existing full-resolution CAD wall triangle boundaries; replacement landmarks have independent footprint records.',sources:['/data/bliss-street.json','/assets/world/bliss/facades.json'],buildings:rows,summary:{corridorBuildings:rows.length,buildingsWithPlanes:rows.filter(b=>b.facades.length).length,facades:rows.reduce((s,b)=>s+b.facades.length,0),reviewedBuildings:rows.filter(b=>b.facades.some(f=>f.style.window)).length,geometryConflicts:rows.filter(b=>b.facades.some(f=>f.style.geometryConflict)).map(b=>b.id)}};
  await fs.writeFile('public/data/bliss-architecture.json',JSON.stringify(output));
  console.log(JSON.stringify(output.summary));
  return output;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await prepareBlissArchitecture();
