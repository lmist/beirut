import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP=new THREE.Vector3(0,1,0);
const COLORS={stone:0xc4bda2,stoneLight:0xcec5aa,stoneDark:0xb5ae97,plaster:0xd6cfb5,weathered:0xc8c9ba,patch:0xa8a892,trim:0xddd5bc,glass:0x4b6263,dark:0x303a38,iron:0x394240,shutter:0x829baa,frame:0xb1b7ad,roof:0x777469,orange:0xb78161,cream:0xd1ccaf};
const box=(w,h,d,x,y,z)=>new THREE.BoxGeometry(w,h,d).translate(x,y,z);
function batch(){
 const buckets=new Map();return{
  add(key,geometry){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(geometry);},
  finish(group){for(const [key,geometries]of buckets){
   const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),merged=mergeGeometries(normalized);
   normalized.forEach(g=>g.dispose());geometries.forEach(g=>g.dispose());
   if(!merged)throw new Error(`Unable to batch ${key} heritage geometry`);
   const mesh=new THREE.Mesh(merged,new THREE.MeshStandardMaterial({color:COLORS[key],roughness:key==='glass'?.44:.9,metalness:key==='iron'?.28:0,side:key==='roof'?THREE.DoubleSide:THREE.FrontSide}));
   mesh.name=key;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }}
 };
}
function transformed(parts,matrix){return{add:(key,geometry)=>parts.add(key,geometry.applyMatrix4(matrix))};}
function facadeMatrix(wall,origin){return new THREE.Matrix4().compose(new THREE.Vector3(wall.center[0]-origin[0],wall.base-origin[1],wall.center[1]-origin[2]),new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(wall.normal[0],wall.normal[1])),new THREE.Vector3(1,1,1));}
function rod(a,b,r=.025){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);return new THREE.CylinderGeometry(r,r,delta.length(),6).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,delta.normalize())).translate(...av.add(bv).multiplyScalar(.5).toArray());}
function path(x,y,width,height,kind='rect'){
 const p=new THREE.Path(),r=width/2;p.moveTo(x-r,y);p.lineTo(x-r,y+height-(kind==='pointed'?width*.65:0));
 if(kind==='pointed'){
  const spring=y+height-width*.65;
  p.quadraticCurveTo(x-r*.88,spring+width*.38,x,y+height);
  p.quadraticCurveTo(x+r*.88,spring+width*.38,x+r,spring);
 }else p.lineTo(x+r,y+height);
 p.lineTo(x+r,y);p.closePath();return p;
}
function openingTop(opening,x){
 const r=opening.width/2,local=(x-opening.x)/r;
 if(opening.kind!=='pointed')return opening.bottom+opening.height;
 // The profile is sampled for the masonry opening; trim uses a matching
 // pointed quadratic arch and conceals the 1–2 cm approximation at the cusp.
 return opening.bottom+opening.height-opening.width*.65*(1-Math.sqrt(Math.max(0,1-Math.abs(local))));
}
function wallPiece(x0,x1,b0,b1,t0,t1,depth=.46){
 if(Math.max(t0-b0,t1-b1)<.005)return null;
 const s=new THREE.Shape();s.moveTo(x0,b0);s.lineTo(x1,b1);s.lineTo(x1,t1);s.lineTo(x0,t0);s.closePath();
 return new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false}).translate(0,0,-depth);
}
/** Build real masonry around openings, including openings straddling a curved
 * source-wall boundary. No solid cuboid is hidden behind the window recesses. */
function piercedWall(parts,width,height,openings,material='plaster'){
 const cuts=[-width/2,width/2];
 for(const o of openings){
  const samples=o.kind==='pointed'?20:1;
  for(let i=0;i<=samples;i++){const x=o.x-o.width/2+o.width*i/samples;if(x>-width/2&&x<width/2)cuts.push(x);}
 }
 cuts.sort((a,b)=>a-b);
 for(let i=0;i<cuts.length-1;i++){
  const left=cuts[i],right=cuts[i+1],mid=(left+right)/2;if(right-left<.001)continue;
  const active=openings.filter(o=>Math.abs(mid-o.x)<o.width/2-.0001).sort((a,b)=>a.bottom-b.bottom);
  let loL=0,loR=0;
  for(const o of active){
   const piece=wallPiece(left,right,loL,loR,Math.min(height,o.bottom),Math.min(height,o.bottom));if(piece)parts.add(material,piece);
   loL=Math.max(loL,Math.min(height,openingTop(o,left)));loR=Math.max(loR,Math.min(height,openingTop(o,right)));
  }
  const piece=wallPiece(left,right,loL,loR,height,height);if(piece)parts.add(material,piece);
 }
}
function window(parts,o){
 const {x,bottom:y,width:w,height:h,kind}=o,z=-.39;
 const shape=new THREE.Shape(path(x,y,w,h,kind).getPoints(24));
 parts.add('dark',new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:false}).translate(0,0,-.52));
 parts.add('glass',new THREE.ShapeGeometry(shape).translate(0,0,z));
 const frame=new THREE.Shape(path(x,y-.085,w+.18,h+.17,kind).getPoints(24));frame.holes.push(path(x,y+.02,w-.09,h-.08,kind));
 parts.add('trim',new THREE.ExtrudeGeometry(frame,{depth:.17,bevelEnabled:false,curveSegments:24}).translate(0,0,-.06));
 const rectangleH=kind==='pointed'?h-w*.65:h;
 for(const xx of [-w/2+.06,0,w/2-.06])parts.add('frame',box(.06,rectangleH,.085,x+xx,y+rectangleH/2,z+.065));
 for(const yy of [y+.05,y+rectangleH*.5,y+rectangleH-.025])parts.add('frame',box(w,.055,.085,x,yy,z+.065));
 parts.add('trim',box(w+.34,.13,.45,x,y-.055,.06));
 if(kind==='pointed'){
  // The pierced central fanlights and scrolls are conspicuous in source 640.
  const fanY=y+h-w*.43,r=w*.145;
  for(const [dx,dy]of [[0,r*.65],[-r*.7,-r*.25],[r*.7,-r*.25]])parts.add('frame',new THREE.TorusGeometry(r,.018,5,20).translate(x+dx,fanY+dy,z+.11));
  for(let i=0;i<7;i++){
   const angle=i*Math.PI/6;parts.add('frame',rod([x,fanY-.11,z+.1],[x+Math.cos(angle)*w*.36,fanY+Math.sin(angle)*w*.27,z+.1],.015));
  }
 }
 if(o.shutters){
  const sw=Math.min(.69,w*.47),sh=h*.96;
  for(const side of [-1,1]){
   const sx=x+side*(w/2+sw*.54+.1),depth=.14;
   parts.add('shutter',box(sw,sh,depth,sx,y+sh/2,.07));
   for(let i=0;i<Math.floor(sh/.105);i++)parts.add('frame',box(sw-.075,.025,.065,sx,y+.085+i*.105,.162));
   for(const xx of [-sw/2+.025,sw/2-.025])parts.add('shutter',box(.055,sh+.07,.08,sx+xx,y+sh/2,.20));
   for(const yy of [y+.04,y+sh/2,y+sh-.025])parts.add('shutter',box(sw,.065,.085,sx,yy,.21));
   for(const yy of [y+.25,y+sh-.28])parts.add('iron',box(.07,.15,.22,x+side*(w/2+.035),yy,.055));
  }
 }
}
function stoneCourses(parts,width,height,openings){
 const course=.36,block=.8;
 for(let row=0;row<Math.ceil(height/course);row++)for(let col=-1;col<Math.ceil(width/block)+1;col++){
  const left=Math.max(-width/2,-width/2+col*block+(row%2)*block/2),right=Math.min(width/2,left+block-.025),bottom=row*course+.012,top=Math.min(height,bottom+course-.024);
  if(right-left<.08||top<=bottom||openings.some(o=>right>o.x-o.width/2-.12&&left<o.x+o.width/2+.12&&top>o.bottom-.1&&bottom<o.bottom+o.height+.1))continue;
  parts.add(['stone','stoneLight','stoneDark'][(row*7+col+1002)%3],box(right-left,top-bottom,.045,(left+right)/2,(top+bottom)/2,.015));
 }
}
function bracket(parts,x,y,depth){
 const shape=new THREE.Shape();shape.moveTo(-.095,y);shape.lineTo(-.095,y-.68);shape.quadraticCurveTo(.06,y-.32,depth-.13,y-.15);shape.lineTo(depth-.13,y);shape.closePath();
 // Shape X is the projection from the wall; rotate its extrusion to the bay.
 const g=new THREE.ExtrudeGeometry(shape,{depth:.19,bevelEnabled:false,curveSegments:10});g.rotateY(-Math.PI/2).translate(x+.095,0,0);parts.add('trim',g);
}
function balcony(parts,x,width,bottom,depth,ornate=false){
 parts.add('trim',box(width+.10,.19,depth+.1,x,bottom-.04,depth/2-.01));
 parts.add('stoneDark',box(width+.11,.07,.11,x,bottom-.14,depth+.04));
 const count=Math.ceil(width/.20),railY=bottom+1.02;
 for(const yy of [bottom+.13,railY])parts.add('iron',box(width,.05,.05,x,yy,depth));
 for(let i=0;i<=count;i++)parts.add('iron',box(.028,.92,.035,x-width/2+i*width/count,bottom+.565,depth));
 for(const side of [-1,1]){
  parts.add('iron',box(.04,.05,depth,x+side*width/2,railY,depth/2));
  for(let i=0;i<Math.ceil(depth/.2);i++)parts.add('iron',box(.03,.92,.03,x+side*width/2,bottom+.565,i*.2));
 }
 if(ornate)for(let i=0;i<Math.floor(width/.75);i++){
  const sx=x-width/2+.45+i*.75;
  parts.add('iron',new THREE.TorusGeometry(.20,.018,5,16).scale(.7,1,1).translate(sx,bottom+.57,depth+.018));
 }
 for(let i=0;i<Math.ceil(width/2.5);i++)bracket(parts,x-width/2+(i+.5)*width/Math.ceil(width/2.5),bottom-.12,depth);
}
function localOpening(o,wall){return{...o,x:(o.center[0]-wall.center[0])*wall.normal[1]-(o.center[1]-wall.center[1])*wall.normal[0]};}
function wallOpenings(record,wall){
 return record.openings.filter(o=>{
  const facing=o.normal[0]*wall.normal[0]+o.normal[1]*wall.normal[1];
  const plane=(o.center[0]-wall.center[0])*wall.normal[0]+(o.center[1]-wall.center[1])*wall.normal[1];
  const x=(o.center[0]-wall.center[0])*wall.normal[1]-(o.center[1]-wall.center[1])*wall.normal[0];
  return facing>.99&&Math.abs(plane)<.14&&Math.abs(x)<wall.width/2+o.width/2;
 }).map(o=>({...localOpening(o,wall),bottom:o.bottom+record.ground-wall.base}));
}
function spanOnWall(span,wall){
 const dx=span.b[0]-span.a[0],dz=span.b[1]-span.a[1],length=Math.hypot(dx,dz);
 if(length<.5)return null;
 const facing=Math.abs((dx*wall.normal[1]-dz*wall.normal[0])/length);if(facing<.985)return null;
 const distance=Math.abs((wall.center[0]-span.a[0])*dz-(wall.center[1]-span.a[1])*dx)/length;if(distance>1.0)return null;
 const project=p=>(p[0]-wall.center[0])*wall.normal[1]-(p[1]-wall.center[1])*wall.normal[0];
 const aa=project(span.a),bb=project(span.b),left=Math.max(-wall.width/2,Math.min(aa,bb)),right=Math.min(wall.width/2,Math.max(aa,bb));
 return right-left>.08?{x:(left+right)/2,width:right-left}:null;
}
export function clipFootprint(points,center,axis,threshold,keepGreater){
 const result=[],value=p=>(p[0]-center[0])*axis[0]+(p[1]-center[1])*axis[1]-threshold;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],va=value(a),vb=value(b),insideA=keepGreater?va>=0:va<=0,insideB=keepGreater?vb>=0:vb<=0;
  if(insideA)result.push(a);
  if(insideA!==insideB){const t=va/(va-vb);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
 }return result;
}
function slab(parts,points,origin,height,thickness=.18,key='roof'){
 if(points.length<3)return;
 const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x-origin[0],-(z-origin[2])):shape.moveTo(x-origin[0],-(z-origin[2])));shape.closePath();
 parts.add(key,new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,height-thickness,0));
}
function gabledRoof(record,parts,origin){
 const row=record.row,wall={center:row.center,base:record.ground,normal:row.normal},p=transformed(parts,facadeMatrix(wall,origin)),width=(row.right-row.left)/3,depth=row.depth,eave=row.eave,rise=row.ridge-row.eave;
 for(let i=0;i<3;i++){
  const cx=row.left+(i+.5)*width,shape=new THREE.Shape();shape.moveTo(cx-width/2,eave);shape.lineTo(cx+width/2,eave);shape.lineTo(cx,eave+rise);shape.closePath();
  const ventY=eave+rise*.53,vent=new THREE.Path();vent.moveTo(cx-.12,ventY-.18);vent.absarc(cx-.13,ventY-.01,.14,Math.PI*1.3,Math.PI*.33,false);vent.absarc(cx,ventY+.14,.15,Math.PI,0,true);vent.absarc(cx+.13,ventY-.01,.14,Math.PI*.7,-Math.PI*.3,true);vent.lineTo(cx+.12,ventY-.18);vent.closePath();shape.holes.push(vent);
  p.add('stone',new THREE.ExtrudeGeometry(shape,{depth:.46,bevelEnabled:false,curveSegments:16}).translate(0,0,-.46));
  p.add('dark',new THREE.PlaneGeometry(.68,.72).translate(cx,ventY,-.48));
  for(const side of [-1,1]){
   const a=[cx,eave+rise+.05,.015],b=[cx+side*width/2,eave+.05,.015];p.add('stoneDark',rod(a,b,.085));
   const positions=[cx,eave+rise,-depth,cx+side*width/2,eave,-depth,cx+side*width/2,eave,.02,cx,eave+rise,-depth,cx+side*width/2,eave,.02,cx,eave+rise,.02];
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1],2));g.computeVertexNormals();p.add('roof',g);
  }
  // Attic rear closes the original footprint; its unobserved material is plain.
  const rear=new THREE.Shape();rear.moveTo(cx-width/2,eave);rear.lineTo(cx+width/2,eave);rear.lineTo(cx,eave+rise);rear.closePath();p.add('stone',new THREE.ShapeGeometry(rear).rotateY(Math.PI).translate(2*cx,0,-depth));
  for(let course=0;course<Math.floor(rise/.38);course++){
   const yy=eave+course*.38,span=width*(1-course*.38/rise);
   p.add('stoneDark',box(span,.022,.04,cx,yy,.032));
  }
 }
}
function frontTower(record,parts,origin){
 const {row,tower}=record,wall={center:row.center,normal:row.normal,base:record.ground},p=transformed(parts,facadeMatrix(wall,origin)),width=tower.right-tower.left,cx=(tower.left+tower.right)/2;
 p.add('orange',box(width*.15,tower.height-.2,.05,cx, tower.height/2,.025));
 for(let floor=1;floor<tower.floors;floor++){
  const bottom=3.9+(floor-1)*3.15;
  for(const side of [-1,1]){
   const x=cx+side*width*.245,w=Math.min(2.1,width*.17),h=1.5;
   p.add('dark',box(w,h,.16,x,bottom+.75,.01));
   p.add('glass',box(w-.14,h-.16,.07,x,bottom+.75,.105));
   for(const xx of [-w/2,0,w/2])p.add('frame',box(.07,h+.12,.20,x+xx,bottom+.75,.13));
   for(const yy of [bottom-.06,bottom+1.55])p.add('trim',box(w+.3,.14,.25,x,yy,.1));
  }
 }
 p.add('trim',box(width,.23,.54,cx,3.55,.16));
}
function recordMeshes(record){
 const origin=[(record.originalBounds[0]+record.originalBounds[2])/2,record.ground,(record.originalBounds[1]+record.originalBounds[3])/2],group=new THREE.Group();
 group.name=record.name;group.position.fromArray(origin);group.userData={buildingId:record.id,sourceIds:record.sourceIds,dimensionStatus:record.dimensionStatus,modeledOpenings:record.openings.length};
 const parts=batch(),row=record.row,axis=row?[row.normal[1],-row.normal[0]]:null;
 const wallHeight=p=>row&&((p[0]-row.center[0])*axis[0]+(p[1]-row.center[1])*axis[1])<=row.right+.001?row.eave:record.height;
 for(const originalWall of record.walls){
  let segments=[originalWall];
  if(row){
   const pa=(originalWall.a[0]-row.center[0])*axis[0]+(originalWall.a[1]-row.center[1])*axis[1],pb=(originalWall.b[0]-row.center[0])*axis[0]+(originalWall.b[1]-row.center[1])*axis[1];
   if((pa-row.right)*(pb-row.right)<-.001){
    const t=(row.right-pa)/(pb-pa),point=[originalWall.a[0]+t*(originalWall.b[0]-originalWall.a[0]),originalWall.a[1]+t*(originalWall.b[1]-originalWall.a[1])];
    segments=[[originalWall.a,point],[point,originalWall.b]].map(([a,b])=>({...originalWall,a,b,center:[(a[0]+b[0])/2,(a[1]+b[1])/2],width:Math.hypot(a[0]-b[0],a[1]-b[1])}));
   }
  }
  for(const wall of segments){
   const height=record.ground+wallHeight(wall.center)-wall.base,p=transformed(parts,facadeMatrix(wall,origin)),openings=wallOpenings(record,wall),material=record.kind==='gabled-row'&&wallHeight(wall.center)===row.eave?'stone':record.kind==='bubbles'?'weathered':record.kind==='gabled-row'?'cream':'plaster';
   piercedWall(p,wall.width,height,openings,material);
   if(material==='stone'&&wall.normal[0]*row.normal[0]+wall.normal[1]*row.normal[1]>.99)stoneCourses(p,wall.width,height,openings);
   p.add('trim',box(wall.width+.025,.16,.37,0,height-.08,.045));
   if(record.kind!=='gabled-row'){
    p.add('trim',box(wall.width+.035,.16,.58,0,height-.34,.09));
    p.add('stoneDark',box(wall.width+.02,.055,.26,0,height-.48,.015));
    for(const y of record.kind==='arched-house'?[4.0,8.05]:[3.87])p.add('trim',box(wall.width,.105,.22,0,y+record.ground-wall.base,.03));
   }
   for(const span of record.balconies){const segment=spanOnWall(span,wall);if(segment)balcony(p,segment.x,segment.width,span.bottom+record.ground-wall.base,span.depth,record.kind==='arched-house');}
   if(record.roofRailing){
    for(const y of [height+.18,height+.69])p.add('iron',box(wall.width,.035,.035,0,y,.01));
    const n=Math.ceil(wall.width/1.3);for(let i=0;i<=n;i++)p.add('iron',box(.033,.77,.035,-wall.width/2+i*wall.width/n,height+.37,.01));
   }
   if(record.kind==='bubbles'&&openings.length){
    // Distinct peeling patches sit at the photographed roof seam, not a
    // repeated citywide noise overlay.
    for(const [fraction,w,h]of [[-.42,1.2,.32],[-.16,2.1,.22],[.09,.74,.49],[.32,1.58,.3]]){
     const s=new THREE.Shape(),x=fraction*wall.width,y=height-.62;s.moveTo(x-w/2,y);s.lineTo(x-w*.39,y-h*.7);s.lineTo(x-w*.1,y-h*.36);s.lineTo(x+w*.18,y-h);s.lineTo(x+w/2,y-h*.24);s.lineTo(x+w*.31,y+.1);s.closePath();p.add('patch',new THREE.ShapeGeometry(s).translate(0,0,.012));
    }
   }
  }
 }
 for(const opening of record.openings){
  const wall=record.walls.find(w=>w.id===opening.wallId),p=transformed(parts,facadeMatrix(wall,origin));window(p,{...localOpening(opening,wall),bottom:opening.bottom+record.ground-wall.base});
 }
 for(const opening of record.groundArches||[]){
  const wall=record.walls.find(w=>w.id===opening.wallId),p=transformed(parts,facadeMatrix(wall,origin)),o={...localOpening(opening,wall),bottom:opening.bottom+record.ground-wall.base};
  p.add('dark',new THREE.ShapeGeometry(new THREE.Shape(path(o.x,o.bottom,o.width,o.height,'pointed').getPoints(24))).translate(0,0,.035));
 }
 slab(parts,record.footprint,origin,.10,.2,'stoneDark');
 if(row){
  const low=clipFootprint(record.footprint,row.center,axis,row.right,false),high=clipFootprint(record.footprint,row.center,axis,row.right,true);
  slab(parts,low,origin,row.eave);slab(parts,high,origin,record.tower.height);gabledRoof(record,parts,origin);frontTower(record,parts,origin);
  // Shared party wall seals the tower above the gabled roof's right end.
  const a=high.find(p=>Math.abs((p[0]-row.center[0])*axis[0]+(p[1]-row.center[1])*axis[1]-row.right)<.01),others=high.filter(p=>Math.abs((p[0]-row.center[0])*axis[0]+(p[1]-row.center[1])*axis[1]-row.right)<.01);
  if(a&&others.length>1){const b=others[1],w={center:[(a[0]+b[0])/2,(a[1]+b[1])/2],normal:[-axis[0],-axis[1]],width:Math.hypot(a[0]-b[0],a[1]-b[1]),base:record.ground};const p=transformed(parts,facadeMatrix(w,origin));p.add('cream',box(w.width,record.tower.height-row.eave,.4,0,(record.tower.height+row.eave)/2,-.2));}
 }else slab(parts,record.footprint,origin,record.height);
 parts.finish(group);return group;
}
/** Fixed wall boxes follow the actual retained footprint, rather than a broad
 * AABB that blocks the curved sidewalk or side-street recesses. */
export function heritageColliders(data){
 const colliders=[];
 for(const record of data.buildings)for(const wall of record.walls){
  let segments=[{...wall,height:record.height}];
  if(record.row){
   const row=record.row,axis=[row.normal[1],-row.normal[0]],project=p=>(p[0]-row.center[0])*axis[0]+(p[1]-row.center[1])*axis[1];
   const pa=project(wall.a),pb=project(wall.b);
   if((pa-row.right)*(pb-row.right)<-.001){
    const t=(row.right-pa)/(pb-pa),point=[wall.a[0]+t*(wall.b[0]-wall.a[0]),wall.a[1]+t*(wall.b[1]-wall.a[1])];
    segments=[[wall.a,point],[point,wall.b]].map(([a,b],i)=>({...wall,id:`${wall.id}-${i}`,center:[(a[0]+b[0])/2,(a[1]+b[1])/2],width:Math.hypot(a[0]-b[0],a[1]-b[1]),height:project([(a[0]+b[0])/2,(a[1]+b[1])/2])<row.right?row.eave:record.height}));
   }else segments[0].height=project(wall.center)<row.right?row.eave:record.height;
  }
  for(const segment of segments){const height=record.ground+segment.height-wall.base;colliders.push({id:`heritage-${segment.id}`,buildingId:record.id,center:[segment.center[0]-wall.normal[0]*.22,wall.base+height/2,segment.center[1]-wall.normal[1]*.22],halfExtents:[segment.width/2,height/2,.24],yaw:Math.atan2(wall.normal[0],wall.normal[1])});}
 }
 return colliders;
}

export function createBlissHeritage(data){
 const group=new THREE.Group();group.name='Bliss Street photo-reviewed heritage';
 for(const record of data.buildings)group.add(recordMeshes(record));
 group.userData={replacementBuildingIds:[...data.replacementBuildingIds],colliders:heritageColliders(data),sources:data.sources,stats:{buildings:data.buildings.length,openings:data.buildings.reduce((s,b)=>s+b.openings.length,0)}};
 return group;
}
export function disposeBlissHeritage(group){group.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}
