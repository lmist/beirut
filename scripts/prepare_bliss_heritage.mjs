/** Retain source CAD footprints and rebuild three photo-reviewed historic masses.
 * Dimensions are explicit estimates from the cited 2023 photos, not a survey.
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { createBuildingIndex } from '../src/world/building-index.js';
import { boundaryLoops, signedArea } from './prepare_bliss_architecture.mjs';
import { photoCamera } from '../src/world/photo-projection.js';
const IDS=[360,640,359],round=n=>Number(n.toFixed(4));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export function simplifyFootprint(points,tolerance=.008){
 let result=points.slice(),changed=true;
 while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){
  const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length];
  const length=Math.hypot(c[0]-a[0],c[1]-a[1]);
  if(length&&Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/length<tolerance){result.splice(i,1);changed=true;break;}
 }}return result;
}
export async function extractHeritageFootprints(buildings,manifest){
 const lookup=createBuildingIndex(buildings),triangles=new Map(IDS.map(id=>[id,[]]));await MeshoptDecoder.ready;
 for(const tile of manifest.tiles){
  if(!IDS.some(id=>{const b=buildings[id];return b[0]<=tile.bounds[3]&&b[2]>=tile.bounds[0]&&b[1]<=tile.bounds[5]&&b[3]>=tile.bounds[2];}))continue;
  const file=await fs.readFile(`public/data/tiles/${tile.id}.0.mesh`),nv=file.readUInt32LE(4),ni=file.readUInt32LE(8),vb=file.readUInt32LE(12),packed=new Uint8Array(nv*20),bytes=new Uint8Array(ni*4);
  MeshoptDecoder.decodeVertexBuffer(packed,nv,20,file.subarray(20,20+vb));MeshoptDecoder.decodeIndexBuffer(bytes,ni,4,file.subarray(20+vb));
  const view=new DataView(packed.buffer),position=new Float32Array(nv*3),index=new Uint32Array(bytes.buffer);
  for(let i=0;i<nv;i++)for(let j=0;j<3;j++)position[i*3+j]=view.getFloat32(i*20+j*4,true);
  for(let i=0;i<ni;i+=3){
   const a=index[i],b=index[i+1],c=index[i+2];if(packed[a*20+15]!==5)continue;
   const source=lookup.triangleAt(position,a,b,c);if(!source||!triangles.has(source[7]))continue;
   const vertices=[a,b,c].map(k=>[position[k*3],position[k*3+1],position[k*3+2]]);
   if(vertices.every(p=>Math.abs(p[1]-source[5])<.08))triangles.get(source[7]).push(vertices.map(p=>[p[0],p[2]]));
  }
 }
 return new Map([...triangles].map(([id,triangles])=>{
  const loops=boundaryLoops(triangles).sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)));
  if(!loops.length)throw new Error(`No retained roof boundary for heritage building ${id}`);
  return [id,simplifyFootprint(loops[0]).map(p=>p.map(round))];
 }));
}
export function footprintWalls(footprint,source,ground){
 const clockwise=signedArea(footprint)<0;
 return footprint.map((a,i)=>{
  const b=footprint[(i+1)%footprint.length],dx=b[0]-a[0],dz=b[1]-a[1],width=Math.hypot(dx,dz);
  const normal=clockwise?[-dz/width,dx/width]:[dz/width,-dx/width],center=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const candidates=source.facades.filter(f=>f.normal[0]*normal[0]+f.normal[1]*normal[1]>.999);
  const nearest=candidates.sort((a,b)=>Math.hypot(a.center[0]-center[0],a.center[1]-center[1])-Math.hypot(b.center[0]-center[0],b.center[1]-center[1]))[0];
  return {id:`${source.id}-heritage-${i}`,sourceFacadeId:nearest?.id??null,a,b,center:center.map(round),normal:normal.map(round),width:round(width),base:nearest?.base??ground,observed:!!nearest};
 });
}
/** Intersect the photograph's actual camera ray with the retained wall planes. */
export function photoWallPoint(camera,walls,u,v=.5){
 const direction=camera.forward.map((n,i)=>n+(u-.5)*2*camera.tangent*camera.right[i]+(.5-v)*2*camera.tangent*camera.up[i]);
 let hit=null;
 for(const wall of walls){
  const denominator=direction[0]*wall.normal[0]+direction[2]*wall.normal[1];if(denominator>=-.001)continue;
  const t=((wall.center[0]-camera.position[0])*wall.normal[0]+(wall.center[1]-camera.position[2])*wall.normal[1])/denominator;
  if(t<=0)continue;
  const point=[camera.position[0]+direction[0]*t,camera.position[2]+direction[2]*t];
  const x=(point[0]-wall.center[0])*wall.normal[1]-(point[1]-wall.center[1])*wall.normal[0];
  if(Math.abs(x)>wall.width/2+.03)continue;
  if(!hit||t<hit.t)hit={wall,point,x,t};
 }return hit;
}
function openingsFromPhoto(camera,walls,specs){
 const result=[];
 for(const spec of specs){
  const [px,py,pw,bottom,height,kind='rect',shutters=true]=spec;
  const center=photoWallPoint(camera,walls,px/640,py/640);if(!center)continue;
  const left=photoWallPoint(camera,walls,(px-pw/2)/640,py/640),right=photoWallPoint(camera,walls,(px+pw/2)/640,py/640);
  let width=left&&right?Math.hypot(left.point[0]-right.point[0],left.point[1]-right.point[1]):1.2;
  width=Math.max(.65,Math.min(2.6,width));
  result.push({wallId:center.wall.id,center:center.point.map(round),normal:center.wall.normal,width:round(width),bottom,height,kind,shutters,sourcePixel:[px,py,pw],dimensionStatus:'Horizontal position/width from source camera ray; vertical dimensions estimated from visible floor proportions.'});
 }return result;
}
function spanFromPhoto(camera,walls,left,right,y,bottom,depth){
 const a=photoWallPoint(camera,walls,left/640,y/640),b=photoWallPoint(camera,walls,right/640,y/640);
 return a&&b?{a:a.point.map(round),b:b.point.map(round),bottom,depth}:null;
}
export async function prepareBlissHeritage(){
 const [buildings,manifest,architecture,photos,registration]=await Promise.all(['public/data/buildings.json','public/data/manifest.json','public/data/bliss-architecture.json','public/assets/world/bliss/facades.json','public/data/registration.json'].map(read));
 const footprints=await extractHeritageFootprints(buildings,manifest),records=[];
 for(const id of IDS){
  const source=structuredClone(architecture.buildings.find(b=>b.id===id));source.facades=source.sourceFacades||source.facades;
  const photo=photos.buildings[id].photo,primary=source.facades.find(f=>f.review?.sourceIds?.includes(`bliss-${id}`));
  if(!primary)throw new Error(`Missing reviewed wall for ${id}`);
  const footprint=footprints.get(id),ground=primary.base,walls=footprintWalls(footprint,source,ground),camera=photoCamera(photo,registration);
  const record={id,name:id===360?'Gabled Bliss One and Mini Malik shop row with adjacent cream tower':id===640?'Cream historic house over Dunkin and Le Sam':'Bubbles low frontage',kind:id===360?'gabled-row':id===640?'arched-house':'bubbles',footprint,walls,ground,sourceFacade:primary,sourceIds:[`bliss-${id}`],sourcePhoto:photo.url,originalBounds:buildings[id],floorCount:id===640?3:2,height:id===640?12.6:id===359?8.05:8.1,dimensionStatus:'Photo-estimated heights, openings and ornament; horizontal footprint retained from original CAD roof triangles.',unobserved:'Rear and unphotographed walls are closed plain masonry; room interiors and unseen openings are not reconstructed.'};
  if(id===640){
   record.openings=openingsFromPhoto(camera,walls,[
    [139,221,48,4.55,2.85,'rect'],[236,224,42,4.55,2.85,'rect'],[532,276,35,4.55,2.85,'rect'],
    [328,231,50,4.35,3.35,'pointed',false],[387,246,47,4.35,3.35,'pointed',false],[451,257,46,4.35,3.35,'pointed',false],
    [161,77,39,8.70,2.45,'rect'],[252,93,36,8.70,2.45,'rect'],[547,182,26,8.70,2.45,'rect'],
    [305,102,23,8.50,2.90,'pointed',false],[344,113,29,8.50,2.90,'pointed',false],[389,128,33,8.50,2.90,'pointed',false],[431,143,30,8.50,2.90,'pointed',false],[467,153,22,8.50,2.90,'pointed',false],
   ]);
   record.balconies=[spanFromPhoto(camera,walls,282,514,288,4.20,1.1),spanFromPhoto(camera,walls,284,515,158,8.32,1.05)].filter(Boolean);
   record.groundArches=openingsFromPhoto(camera,walls,[[329,363,54,2.55,1.55,'pointed',false],[403,380,58,2.55,1.55,'pointed',false],[472,388,52,2.55,1.55,'pointed',false]]);
   record.roofRailing=true;record.topArchObservation='Five small pointed upper fanlights are visible above the upper balcony; the lower balcony has three taller arches.';
  }else if(id===359){
   record.openings=openingsFromPhoto(camera,walls,[[274,311,30,4.35,2.60,'rect'],[350,302,36,4.35,2.60,'rect'],[426,299,33,4.35,2.60,'rect']]);
   record.balconies=[];record.awningSpan=spanFromPhoto(camera,walls,175,454,373,3.55,1.25);
   record.weatheredPlaster=true;
  }else{
   // The source CAD box combines the historic row and the neighboring tower.
   // Split at their observed junction; never stretch the gables across both.
   const junction=photoWallPoint(camera,walls,.686,.43),face=primary;
   const rowTangent=[face.normal[1],-face.normal[0]],project=p=>(p[0]-face.center[0])*rowTangent[0]+(p[1]-face.center[1])*rowTangent[1];
   const rowLeft=-face.width/2,rowRight=project(junction.point),depth=Math.abs(signedArea(footprint))/face.width;
   record.row={center:face.center,normal:face.normal,left:round(rowLeft),right:round(rowRight),depth:round(depth),eave:8.1,ridge:11.35,gables:3};
   record.tower={left:round(rowRight),right:round(face.width/2),height:23.4,floors:7,confidence:'Approximate six residential levels above retail visible in photo; roof and remaining width run out of frame. Full plan extent comes from retained CAD footprint.'};
   record.openings=openingsFromPhoto(camera,walls,[[35,272,17,4.4,2.48,'rect',false],[65,268,16,4.4,2.48,'rect'],[105,265,15,4.4,2.48,'rect'],[142,264,18,4.4,2.48,'rect',false],[185,263,17,4.4,2.48,'rect',false],[221,259,17,4.4,2.48,'rect'],[274,257,18,4.4,2.48,'rect'],[315,263,19,4.4,2.48,'rect',false],[363,260,19,4.4,2.48,'rect',false],[405,254,19,4.4,2.48,'rect']]);
   record.balconies=[{a:[face.center[0]+rowTangent[0]*(rowLeft+.2),face.center[1]+rowTangent[1]*(rowLeft+.2)].map(round),b:[face.center[0]+rowTangent[0]*(rowRight-.2),face.center[1]+rowTangent[1]*(rowRight-.2)].map(round),bottom:4.15,depth:.88}];
   record.height=record.tower.height;record.floorCount=2;
  }
  records.push(record);
 }
 const output={version:1,registrationVersion:registration.version,title:'Photo-reviewed Bliss Street heritage masses',replacementBuildingIds:IDS,sources:IDS.map(id=>({id:`bliss-${id}`,path:`data/bliss-street/imagery-collected/${id}.jpg`,url:photos.buildings[id].photo.url,date:photos.buildings[id].photo.date,copyright:photos.buildings[id].photo.copyright})),limitations:['Heights, depth of reveals and ornamental dimensions are visual estimates, not architectural surveys.','The full horizontal footprint comes from retained CAD; a single CAD mass may encompass more than one photographed property.','The visible 360 junction splits the historic shop row from the cream tower; unseen tower roof geometry is conservative.','No AI generated facade imagery is used.'],buildings:records};
 await fs.writeFile('public/data/bliss-heritage.json',JSON.stringify(output));
 console.log(JSON.stringify({buildings:records.length,walls:records.reduce((s,b)=>s+b.walls.length,0),openings:records.reduce((s,b)=>s+b.openings.length,0),replacementBuildingIds:IDS}));return output;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await prepareBlissHeritage();
