import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP=new THREE.Vector3(0,1,0);
const PALETTE={stone:0xb4ab91,stone1:0xbcb29a,stone2:0xc4baa2,stone3:0xada58e,mortar:0x8b8878,trim:0xc7b281,iron:0x252824,glass:0x354342,roof:0x99543d,roofLight:0xaf6549,plaque:0xe0dbc6};
const box=(w,h,d,x,y,z)=>new THREE.BoxGeometry(w,h,d).translate(x,y,z);
const translated=(geometry,x,y,z)=>geometry.translate(x,y,z);
function batch(){
 const parts=new Map();
 return {
  add(key,geometry){if(!parts.has(key))parts.set(key,[]);parts.get(key).push(geometry);},
  finish(group){for(const [key,items] of parts){
   const geometry=mergeGeometries(items.map(g=>g.index?g.toNonIndexed():g));
   for(const g of items)g.dispose();
   const material=new THREE.MeshStandardMaterial({color:PALETTE[key],roughness:key==='iron'?.6:.9,metalness:key==='iron'?.25:0});
   const mesh=new THREE.Mesh(geometry,material);mesh.name=key;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }}
 };
}
function rect(x,y,w,h){const p=new THREE.Path();p.moveTo(x-w/2,y);p.lineTo(x-w/2,y+h);p.lineTo(x+w/2,y+h);p.lineTo(x+w/2,y);p.closePath();return p;}
function horseshoe(x,base,spring,radius){
 const neck=radius/Math.sqrt(2),p=new THREE.Path();
 p.moveTo(x-neck,base);p.lineTo(x-neck,spring-neck);
 p.absarc(x,spring,radius,Math.PI*1.25,-Math.PI*.25,true);p.lineTo(x+neck,base);p.closePath();return p;
}
function roundArch(x,base,w,h){const p=new THREE.Path(),r=w/2;p.moveTo(x-r,base);p.lineTo(x-r,base+h-r);p.absarc(x,base+h-r,r,Math.PI,0,true);p.lineTo(x+r,base);p.closePath();return p;}
function panel(width,height,depth,holes=[]){
 const shape=new THREE.Shape();shape.moveTo(-width/2,0);shape.lineTo(width/2,0);shape.lineTo(width/2,height);shape.lineTo(-width/2,height);shape.closePath();shape.holes=holes;
 return new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:28});
}
function ring(x,y,inner,outer,depth,start=0,end=Math.PI*2){
 const shape=new THREE.Shape();shape.absarc(x,y,outer,start,end,false);shape.absarc(x,y,inner,end,start,true);shape.closePath();
 return new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:32});
}
function rod(a,b,r=.025){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av);return new THREE.CylinderGeometry(r,r,v.length(),6).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,v.normalize())).translate(...av.add(bv).multiplyScalar(.5).toArray());}
function tileRoof(parts,width,depth,eave,rise,x=0,z=0){
 const half=depth/2,run=Math.hypot(half,rise);
 for(const side of [-1,1]){
  const roof=new THREE.BoxGeometry(width,.13,run);roof.rotateX(side*Math.atan2(rise,half)).translate(x,eave+rise/2,z+side*half/2);parts.add('roof',roof);
  // Shallow raised rows keep the photographed red-tile roof legible in profile.
  const rows=Math.ceil(run/.3),cols=Math.ceil(width/.24);
  for(let c=0;c<=cols;c++){
   const xx=x-width/2+c*width/cols;
   parts.add(c%4===0?'roofLight':'roof',rod([xx,eave+rise+.09,z],[xx,eave+.09,z+side*half],.044));
  }
  for(let r=1;r<rows;r++){
   const t=r/rows;parts.add('roofLight',box(width,.033,.055,x,eave+rise*(1-t)+.10,z+side*half*t));
  }
 }
 parts.add('roofLight',rod([x-width/2,eave+rise+.16,z],[x+width/2,eave+rise+.16,z],.105));
}
function courses(parts,{width,height,x=0,z,skip=()=>false,seed=0}){
 const h=.40,w=.74;
 for(let row=0;row<Math.ceil(height/h);row++){
  const y=row*h+.015,top=Math.min(height,y+h-.025);if(top<=y)continue;
  const offset=(row%2)*w/2;
  for(let col=-1;col<Math.ceil(width/w)+1;col++){
   const left=Math.max(-width/2,-width/2+col*w+offset),right=Math.min(width/2,-width/2+(col+1)*w+offset-.022);
   if(right-left<.08)continue;
   const bounds={left:left+x,right:right+x,bottom:y,top};
   if(skip(bounds))continue;
   const shade=['stone','stone1','stone2','stone3'][(row*13+col*7+seed+1000)%4];
   parts.add(shade,box(right-left,top-y,.07,(left+right)/2+x,(y+top)/2,z));
  }
 }
}
const overlaps=(b,x,y,w,h)=>b.right>x-w/2&&b.left<x+w/2&&b.top>y&&b.bottom<y+h;
function archTrim(parts,x,base,w,h,z){
 const r=w/2,spring=base+h-r;
 parts.add('trim',translated(ring(x,spring,r,r+.16,.16,0,Math.PI),0,0,z));
 for(const side of [-1,1])parts.add('trim',box(.16,h-r,.17,x+side*(r+.08),base+(h-r)/2,z+.08));
 parts.add('trim',box(w+.44,.13,.25,x,base-.03,z+.05));
}
function plaque(group,x,y,z,arabic=false){
 if(typeof document==='undefined')return;
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=512;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 ctx.fillStyle='#d8d4c0';ctx.fillRect(0,0,256,512);ctx.strokeStyle='#898b7d';ctx.lineWidth=3;ctx.strokeRect(15,16,226,480);
 ctx.fillStyle='#555953';ctx.textAlign='center';ctx.textBaseline='middle';
 const lines=arabic?['الجامعة','الأمريكية','في بيروت','١٨٦٦']:['AMERICAN','UNIVERSITY','OF BEIRUT','1866'];
 ctx.font=arabic?'28px serif':'23px serif';lines.forEach((line,i)=>ctx.fillText(line,128,108+i*80));
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.04,1.93),new THREE.MeshStandardMaterial({map:texture,roughness:1}));mesh.position.set(x,y,z);mesh.name='University dedication plaque';group.add(mesh);
}
function gatehouse(record){
 const group=new THREE.Group();group.name=record.name;group.position.fromArray(record.position);group.rotation.y=record.rotationY;
 group.userData={landmarkId:record.id,sources:record.sources,confidence:record.confidence};
 const parts=batch(),W=record.width,D=record.depth,front=D/2,centerW=W*.435,towerW=(W-centerW)/2;
 const centerH=8.6,towerH=9.65,r=record.archWidth/2,spring=record.archSpring,neck=r/Math.sqrt(2);
 const mainHole=()=>horseshoe(0,-.05,spring,r);
 const doors=[-centerW*.375,centerW*.375];
 const centerHoles=()=>[mainHole(),...doors.map(x=>rect(x,0,1.12,2.75)),...[-2.05,0,2.05].map(x=>rect(x,7.25,.92,.84))];
 // Separate front and rear panels plus an open central passage, not a solid box.
 for(const face of [-1,1]){
  const z=face===1?front-.48:-front;
  parts.add('mortar',translated(panel(centerW,centerH,.48,centerHoles()),0,0,z));
  courses(parts,{width:centerW,height:centerH,z:face===1?front+.018:-front-.018,skip:b=>overlaps(b,0,0,record.archWidth+.7,spring+r+.1)||doors.some(x=>overlaps(b,x,0,1.35,3.0))||[-2.05,0,2.05].some(x=>overlaps(b,x,7.10,1.12,1.1))});
  // Receding golden sandstone border follows the exact horseshoe aperture.
  parts.add('trim',translated(ring(0,spring,r+.015,r+.51,.16,-Math.PI*.25,Math.PI*1.25),0,0,face===1?front+.04:-front-.2));
  for(const side of [-1,1])parts.add('trim',box(.54,spring-neck,.62,side*(neck+.27),(spring-neck)/2,face===1?front-.16:-front+.16));
  parts.add('trim',box(centerW,.23,.72,0,6.85,face===1?front-.11:-front+.11));
  for(const x of doors){parts.add('iron',box(1.1,2.72,.10,x,1.36,face===1?front-.22:-front+.22));parts.add('trim',box(1.45,.19,.67,x,2.83,face===1?front-.15:-front+.15));}
  for(const x of [-2.05,0,2.05]){parts.add('glass',box(.89,.82,.07,x,7.67,face===1?front-.24:-front+.24));parts.add('iron',box(.05,.86,.09,x,7.67,face===1?front-.17:-front+.17));}
 }
 // Solid upper passage ceiling and edge piers leave a real arch opening.
 parts.add('stone',box(centerW,.25,D,0,centerH-.1,0));
 for(const side of [-1,1])parts.add('stone',box(.42,centerH,D,side*(centerW/2-.21),centerH/2,0));
 for(const side of [-1,1]){
  const x=side*(centerW/2+towerW/2),windows=[x-.68,x+.68];
  const holes=()=>[...windows.map(wx=>roundArch(wx-x,3.1,.93,1.86)),...windows.map(wx=>rect(wx-x,7.1,.91,1.54))];
  for(const face of [-1,1]){
   const z=face===1?front+.03:-front-.1;
   parts.add('mortar',translated(panel(towerW,towerH,.54,holes()),x,0,face===1?front-.51:-front-.1));
   courses(parts,{width:towerW,height:towerH,x,z,seed:side+2,skip:b=>windows.some(wx=>overlaps(b,wx,2.95,1.24,2.2)||overlaps(b,wx,6.94,1.15,1.9))});
   for(const wx of windows){
    parts.add('glass',translated(new THREE.ShapeGeometry(new THREE.Shape(roundArch(wx,3.1,.93,1.86).getPoints(28))),0,0,face===1?front-.24:-front+.24));
    archTrim(parts,wx,3.1,.93,1.86,face===1?front+.02:-front-.17);
    parts.add('glass',box(.90,1.52,.07,wx,7.86,face===1?front-.25:-front+.25));
    for(const sx of [-1,1])parts.add('trim',box(.13,1.68,.24,wx+sx*.51,7.86,z+.03));
    parts.add('trim',box(1.22,.14,.33,wx,7.03,z+.03));
    for(const y of [3.85,4.55,7.85])parts.add('iron',box(.90,.045,.10,wx,y,face===1?front-.1:-front+.1));
    parts.add('iron',box(.05,1.58,.10,wx,7.88,face===1?front-.1:-front+.1));
   }
  }
  for(const sx of [-1,1])parts.add('stone',box(.5,towerH,D,x+sx*(towerW/2-.25),towerH/2,0));
  for(const [y,w,d,h] of [[6.82,towerW+.14,D+.22,.18],[9.2,towerW+.3,D+.35,.20],[9.45,towerW+.8,D+.80,.20],[9.74,towerW+.32,D+.3,.38],[10.01,towerW+.52,D+.50,.16]])parts.add('trim',box(w,h,d,x,y,0));
  parts.add('stone',box(towerW,.18,D,x,9.56,0));
  // Modillion blocks underneath each tower cornice are visible in the AUB photo.
  for(let j=0;j<8;j++)for(const face of [-1,1])parts.add('trim',box(.26,.29,.34,x-towerW/2+.36+j*(towerW-.72)/7,9.1,face*(front+.1)));
 }
 tileRoof(parts,centerW+.65,D+.72,centerH+.10,record.roofRise);
 // Fanlight and mirrored scrolling ironwork in the central horseshoe opening.
 const ironZ=front-.24;
 parts.add('iron',translated(ring(0,spring,r-.11,r-.055,.055,-Math.PI*.25,Math.PI*1.25),0,0,ironZ));
 for(let n=-6;n<=6;n++){
  const x=n*.23,maxY=spring+Math.sqrt(Math.max(0,(r-.16)**2-x*x));
  parts.add('iron',rod([x,2.95,ironZ],[x,maxY,ironZ],.018));
 }
 for(const y of [2.96,3.35])parts.add('iron',box(record.archWidth-.85,.055,.07,0,y,ironZ));
 for(let n=0;n<9;n++){
  const angle=Math.PI*n/8,cx=Math.cos(angle)*1.02,cy=spring+Math.sin(angle)*1.02;
  parts.add('iron',new THREE.TorusGeometry(.21,.018,5,16).translate(cx,cy,ironZ));
 }
 parts.add('iron',new THREE.TorusGeometry(.32,.024,6,24).translate(0,spring,ironZ));
 for(const side of [-1,1]){
  const x=side*centerW*.375;
  parts.add('trim',box(1.45,2.36,.18,x,4.6,front+.07));parts.add('plaque',box(1.13,2.01,.06,x,4.6,front+.18));
  plaque(group,x,4.6,front+.218,side<0);
 }
 parts.add('stone',box(centerW,.06,D,0,.025,0));
 if(record.foundationDepth>0)parts.add('stone',box(W,record.foundationDepth,D,0,-record.foundationDepth/2,0));
 parts.finish(group);return group;
}
function campusWall(record){
 const [ax,ay,az]=record.a,[bx,by,bz]=record.b,dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz),dy=by-ay;
 const group=new THREE.Group();group.name=record.id;group.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);group.rotation.y=-Math.atan2(dz,dx);
 const parts=batch(),h=record.height,d=record.thickness,slope=dy/length;
 // A sheared box follows the real sampled ground slope at both ends.
 const sloped=(w,height,depth,x,y,z)=>{const g=box(w,height,depth,x,y,z),p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+p.getX(i)*slope);g.computeVertexNormals();return g;};
 parts.add('mortar',sloped(length,h,d,0,h/2,0));
 const rows=Math.ceil(h/.36),cols=Math.ceil(length/.86);
 for(let row=0;row<rows;row++)for(let col=-1;col<=cols;col++){
  const left=Math.max(-length/2,-length/2+col*.86+(row%2)*.43),right=Math.min(length/2,-length/2+(col+1)*.86+(row%2)*.43-.016);
  if(right-left<.06)continue;
  const height=Math.min(.345,h-row*.36-.015);if(height<=0)continue;
  const color=['stone','stone1','stone2','stone3'][(row*13+col*7+1000)%4];
  for(const face of [-1,1])parts.add(color,sloped(right-left,height,.06,(left+right)/2,row*.36+height/2,face*(d/2+.02)));
 }
 parts.add('trim',sloped(length+.01,.12,d+.18,0,h+.06,0));
 parts.finish(group);return group;
}


function footprintBody(record,parts){
 const [cx,,cz]=record.position,shape=new THREE.Shape();
 record.footprint.forEach(([x,z],i)=>i?shape.lineTo(x-cx,-(z-cz)):shape.moveTo(x-cx,-(z-cz)));shape.closePath();
 const g=new THREE.ExtrudeGeometry(shape,{depth:record.height,bevelEnabled:false});g.rotateX(-Math.PI/2);parts.add('stone',g);
}
function triangularFace(parts,key,vertices){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...vertices.flat(),...vertices.slice().reverse().flat()],3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Array(12).fill(0),2));g.computeVertexNormals();parts.add(key,g);}
function transformedBatch(parts,matrix){return{add:(key,geometry)=>parts.add(key,geometry.applyMatrix4(matrix))};}
function religiousBuilding(record){
 const group=new THREE.Group();group.name=record.name;group.position.fromArray(record.position);group.userData={landmarkId:record.id,replacementBuildingId:record.replacementBuildingId,sources:record.sources,confidence:record.confidence};
 const parts=batch(),[cx,,cz]=record.position,points=record.footprint.map(([x,z])=>[x-cx,z-cz]);
 footprintBody(record,parts);
 if(record.kind==='assembly-hall'){
  const west=[(points[3][0]+points[5][0])/2,(points[3][1]+points[5][1])/2];
  const dx=points[2][0]-points[3][0],dz=points[2][1]-points[3][1],yaw=-Math.atan2(dz,dx);
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3(west[0],0,west[1]),new THREE.Quaternion().setFromAxisAngle(UP,yaw),new THREE.Vector3(1,1,1));
  const roof=transformedBatch(parts,matrix),eave=record.height,rise=record.roofRise;
  tileRoof(roof,33.4,13.6,eave,rise,16.1,0);
  const crossMatrix=matrix.clone().multiply(new THREE.Matrix4().makeTranslation(25.65,0,0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI/2));
  tileRoof(transformedBatch(parts,crossMatrix),25.2,14.0,eave,rise);
  for(const x of [0,32.5])triangularFace(roof,'stone',[[x,eave,-6.45],[x,eave,6.45],[x,eave+rise,0]]);
  for(const z of [-12.1,12.1])triangularFace(roof,'stone',[[19,eave,z],[32.3,eave,z],[25.65,eave+rise,z]]);
  // Polygonal east apse has a low fan-shaped red roof.
  const apse=points.slice(9,15),peak=[(points[10][0]+points[13][0])/2,eave+3,(points[10][1]+points[13][1])/2];
  for(let i=0;i<apse.length;i++)triangularFace(parts,'roof',[[apse[i][0],eave,apse[i][1]],peak,[apse[(i+1)%apse.length][0],eave,apse[(i+1)%apse.length][1]]]);
  const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0),sign=area>0?-1:1;
  for(let e=0;e<points.length;e++){
   const a=points[e],b=points[(e+1)%points.length],vx=b[0]-a[0],vz=b[1]-a[1],length=Math.hypot(vx,vz);
   if(length<5)continue;
   const normal=[sign*-vz/length,sign*vx/length],angle=Math.atan2(normal[0],normal[1]);
   const wallMatrix=new THREE.Matrix4().compose(new THREE.Vector3((a[0]+b[0])/2,0,(a[1]+b[1])/2),new THREE.Quaternion().setFromAxisAngle(UP,angle),new THREE.Vector3(1,1,1));
   const wall=transformedBatch(parts,wallMatrix),count=Math.max(1,Math.floor(length/3.3));
   for(let i=0;i<count;i++){
    const x=-length/2+(i+.5)*length/count;
    const window=new THREE.Shape(roundArch(x,2.3,1.05,3.65).getPoints(28));wall.add('glass',translated(new THREE.ShapeGeometry(window),0,0,.035));
    archTrim(wall,x,2.3,1.05,3.65,.06);
    for(const xx of [-.27,.27])wall.add('iron',box(.035,3.05,.12,x+xx,3.84,.1));
    for(const yy of [3.25,4.25,5.15])wall.add('iron',box(1.03,.04,.12,x,yy,.1));
   }
   for(let i=0;i<=count;i++){
    const x=-length/2+i*length/count;
    wall.add('trim',box(.42,eave-.6,.54,x,(eave-.6)/2,.17));wall.add('trim',box(.60,.2,.75,x,eave-.7,.23));
   }
   wall.add('trim',box(length,.16,.3,0,.45,.11));wall.add('trim',box(length,.23,.32,0,eave-.2,.12));
  }
  // A rose window is visible at the western gable of the actual hall.
  const roseMatrix=matrix.clone().multiply(new THREE.Matrix4().makeTranslation(-.09,8.3,0)).multiply(new THREE.Matrix4().makeRotationY(-Math.PI/2));
  const rose=transformedBatch(parts,roseMatrix);
  rose.add('glass',new THREE.CircleGeometry(.95,36));rose.add('trim',ring(0,0,.94,1.17,.17));
  for(let i=0;i<8;i++){const angle=i*Math.PI/4;rose.add('trim',rod([0,0,.18],[Math.cos(angle)*.92,Math.sin(angle)*.92,.18],.036));}
  rose.add('trim',new THREE.TorusGeometry(.29,.05,8,24).translate(0,0,.18));
 }else{
  // The street face is the mapped edge from the north-west to north-east corner.
  const a=points[0],b=points[5],dx=b[0]-a[0],dz=b[1]-a[1],width=Math.hypot(dx,dz),yaw=-Math.atan2(dz,dx);
  // Reverse the edge so local +Z faces the road, north of the mosque.
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3((a[0]+b[0])/2,0,(a[1]+b[1])/2),new THREE.Quaternion().setFromAxisAngle(UP,yaw+Math.PI),new THREE.Vector3(1,1,1));
  const front=transformedBatch(parts,matrix);
  front.add('iron',box(width+.36,.2,1.05,0,4.15,.25));
  for(let i=0;i<5;i++){
   const x=(i-2)*width/5,w=width/5-.36;
   front.add('iron',translated(new THREE.ShapeGeometry(new THREE.Shape(roundArch(x,.7,w,2.8).getPoints(24))),0,0,.03));
   archTrim(front,x,.7,w,2.8,.07);
   front.add('trim',box(.22,3.47,.42,x-w/2-.12,1.735,.10));
   for(let rail=0;rail<6;rail++)front.add('iron',box(.025,.9,.06,x-w/2+(rail+.5)*w/6,1.18,.14));
   for(const y of [.74,1.63])front.add('iron',box(w,.035,.07,x,y,.14));
  }
  front.add('trim',box(width+.2,.18,.60,0,.15,.07));
  // Minaret position uses the photo bearing and mapped rear area; it is labeled
  // as an estimate in data rather than represented as an independent survey.
  const minaret=record.minaret,mx=minaret.position[0]-cx,mz=minaret.position[1]-cz,shaft=12.9,r=minaret.radius;
  parts.add('trim',new THREE.CylinderGeometry(r,r*1.12,shaft,24).translate(mx,shaft/2,mz));
  for(const [height,radius,thick] of [[.3,.86,.3],[11.8,.84,.26],[12.15,1.02,.3],[12.55,1.17,.3],[12.9,1.21,.18],[14.0,1.16,.12]])parts.add('trim',new THREE.CylinderGeometry(radius,radius,thick,24).translate(mx,height,mz));
  for(let i=0;i<24;i++){const angle=i*Math.PI/12;parts.add('trim',box(.055,1.0,.055,mx+Math.cos(angle)*1.08,13.47,mz+Math.sin(angle)*1.08));}
  parts.add('stone',new THREE.CylinderGeometry(.57,.68,2.75,12).translate(mx,14.56,mz));
  for(let i=0;i<8;i++){
   const angle=i*Math.PI/4;
   parts.add('iron',box(.35,1.36,.08,0,0,0).rotateY(angle).translate(mx+Math.sin(angle)*.588,14.7,mz+Math.cos(angle)*.588));
  }
  parts.add('trim',new THREE.CylinderGeometry(.73,.73,.2,16).translate(mx,16.05,mz));
  parts.add('trim',new THREE.ConeGeometry(.77,1.72,12).translate(mx,17.01,mz));
  parts.add('iron',rod([mx,17.85,mz],[mx,minaret.height-.14,mz],.035));
  parts.add('trim',new THREE.SphereGeometry(.10,8,6).translate(mx,minaret.height-.06,mz));
 }
 parts.finish(group);return group;
}


function canopyTemplate(kind){
 const geometries=[],narrow=kind==='cypress';
 const colored=(geometry,color,jitter=.08)=>{
  const c=new THREE.Color(color),p=geometry.attributes.position,colors=[];
  for(let i=0;i<p.count;i++){const variation=1+jitter*Math.sin(p.getX(i)*17+p.getY(i)*13+p.getZ(i)*7);colors.push(c.r*variation,c.g*variation,c.b*variation);}
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometries.push(geometry.index?geometry.toNonIndexed():geometry);
 };
 colored(new THREE.CylinderGeometry(narrow?.12:.19,narrow?.25:.34,6,10).translate(0,3,0),0x6d6250,.09);
 for(let i=0;i<7;i++){
  const angle=i*2.399963,height=3.3+i*.34,length=narrow?.7:2.4;
  colored(rod([0,height,0],[Math.sin(angle)*length,height+2.2,Math.cos(angle)*length],narrow?.075:.12),0x625847,.05);
 }
 const count=narrow?70:138;
 for(let i=0;i<count;i++){
  const angle=i*2.399963,t=(i+.5)/count;
  let x,y,z,size;
  if(narrow){const radius=Math.sin(t*Math.PI)**.8*1.07;x=Math.cos(angle)*radius;y=2.7+t*9.5;z=Math.sin(angle)*radius;size=.46+Math.sin(t*Math.PI)*.22;}
  else{const vertical=1-2*t,radius=Math.sqrt(1-vertical*vertical);x=Math.cos(angle)*radius*4.95;y=8.0+vertical*3.1;z=Math.sin(angle)*radius*4.65;size=.82+(i%5)*.065;}
  const geometry=new THREE.IcosahedronGeometry(size,1);geometry.scale(1,.78,1);geometry.rotateY(angle).translate(x,y,z);
  colored(geometry,[0x3f5c32,0x476837,0x526e3a,0x38592e,0x597640][i%5],.12);
 }
 const merged=mergeGeometries(geometries);geometries.forEach(geometry=>geometry.dispose());return merged;
}
/** Instance shared geometry for the photographed campus canopy, never a
 * residential street-tree distribution. Locations are explicit in the data. */
function campusCanopy(records){
 const group=new THREE.Group();group.name='AUB photographed campus canopy';
 for(const kind of ['broadleaf','cypress']){
  const trees=records.filter(record=>record.kind===kind);if(!trees.length)continue;
  const geometry=canopyTemplate(kind),material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
  const mesh=new THREE.InstancedMesh(geometry,material,trees.length),dummy=new THREE.Object3D();mesh.name=`AUB ${kind} canopy`;mesh.castShadow=true;mesh.receiveShadow=true;
  trees.forEach((tree,index)=>{
   dummy.position.fromArray(tree.position);dummy.rotation.set(0,tree.rotationY??0,0);
   dummy.scale.set(tree.crownDiameter/(kind==='cypress'?3.3:12),tree.height/12.5,tree.crownDiameter/(kind==='cypress'?3.3:12));dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);
 }
 group.userData={treeCount:records.length,mappedTrees:records.filter(tree=>tree.placement==='mapped').length,confidence:'Canopy extents and all estimated-group placements are visual approximations; exact mapped trunks are labeled separately.'};return group;
}

/** Georeferenced architecture independent of renderer, global scene and DOM.
 * Source details and approximation caveats stay attached as inspectable data. */
export function createBlissLandmarks(data){
 const group=new THREE.Group();group.name='Bliss Street — AUB architecture';group.userData={sources:data.sources??[],registrationVersion:data.registrationVersion};
 for(const landmark of data.landmarks??[]){if(landmark.kind==='gatehouse')group.add(gatehouse(landmark));else if(['assembly-hall','mosque'].includes(landmark.kind))group.add(religiousBuilding(landmark));}
 // Collapse the wall pieces into material batches after baking their transforms.
 // This keeps 130 short, terrain-following spans to five draw calls.
 const wallParts=new Map();
 for(const record of data.walls??[]){const wall=campusWall(record);wall.updateMatrixWorld(true);for(const mesh of wall.children){
  mesh.geometry.applyMatrix4(mesh.matrixWorld);const key=mesh.name;
  if(!wallParts.has(key))wallParts.set(key,{material:mesh.material,geometries:[]});else mesh.material.dispose();
  wallParts.get(key).geometries.push(mesh.geometry);
 }}
 const wallGroup=new THREE.Group();wallGroup.name='AUB campus boundary';
 for(const [key,{material,geometries}] of wallParts){const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,material);mesh.name=key;mesh.castShadow=true;mesh.receiveShadow=true;wallGroup.add(mesh);}
 if(wallGroup.children.length)group.add(wallGroup);
 if(data.trees?.length)group.add(campusCanopy(data.trees));
 group.userData.colliders=landmarkColliders(data);
 group.userData.stats={gatehouses:(data.landmarks??[]).filter(record=>record.kind==='gatehouse').length,replacementBuildings:(data.replacementBuildingIds??[]).length,canopyTrees:(data.trees??[]).length,wallSegments:(data.walls??[]).length,wallLengthMetres:(data.walls??[]).reduce((n,w)=>n+Math.hypot(w.b[0]-w.a[0],w.b[2]-w.a[2]),0)};
 return group;
}
export function disposeBlissLandmarks(group){group.traverse(object=>{if(object.isInstancedMesh)object.dispose();object.geometry?.dispose();if(object.material){for(const material of Array.isArray(object.material)?object.material:[object.material]){material.map?.dispose();material.dispose();}}});group.removeFromParent();}

/** Conservative fixed colliders for the actual wall and gate piers. The center
 * of the pedestrian passage is deliberately absent from the lower colliders. */
export function landmarkColliders(data){
 const colliders=[];
 for(const gate of data.landmarks??[])if(gate.kind==='gatehouse'){
  const neck=gate.archWidth/(2*Math.sqrt(2)),width=gate.width/2-neck;
  const transform=(x,y,z)=>[gate.position[0]+x*Math.cos(gate.rotationY)+z*Math.sin(gate.rotationY),gate.position[1]+y,gate.position[2]-x*Math.sin(gate.rotationY)+z*Math.cos(gate.rotationY)];
  for(const side of [-1,1])colliders.push({id:`${gate.id}-pier-${side}`,center:transform(side*(neck+width/2),gate.height/2,0),halfExtents:[width/2,gate.height/2,gate.depth/2],yaw:gate.rotationY});
  const archTop=gate.archSpring+gate.archWidth/2;
  colliders.push({id:`${gate.id}-arch`,center:transform(0,(gate.height+archTop)/2,0),halfExtents:[neck,(gate.height-archTop)/2,gate.depth/2],yaw:gate.rotationY});
 }
 for(const record of data.landmarks??[])if(['assembly-hall','mosque'].includes(record.kind)){
  const footprint=record.footprint,minX=Math.min(...footprint.map(p=>p[0])),maxX=Math.max(...footprint.map(p=>p[0]));
  // A metre-wide vertical strip decomposition stays inside the mapped polygon.
  for(let x=minX+.35;x<maxX;x+=.7){
   const intersections=[];
   for(let i=0;i<footprint.length;i++){const a=footprint[i],b=footprint[(i+1)%footprint.length];if((a[0]<=x&&b[0]>x)||(b[0]<=x&&a[0]>x))intersections.push(a[1]+(x-a[0])/(b[0]-a[0])*(b[1]-a[1]));}
   intersections.sort((a,b)=>a-b);
   for(let i=0;i+1<intersections.length;i+=2){const a=intersections[i],b=intersections[i+1];if(b-a>.1)colliders.push({id:`${record.id}-${x.toFixed(1)}`,center:[x,record.position[1]+record.height/2,(a+b)/2],halfExtents:[.35,record.height/2,(b-a)/2],yaw:0});}
  }
 }
 for(const tree of data.trees??[])colliders.push({id:tree.id,center:[tree.position[0],tree.position[1]+2,tree.position[2]],halfExtents:[.27,2,.27],yaw:0});
 for(const wall of data.walls??[]){
  const dx=wall.b[0]-wall.a[0],dy=wall.b[1]-wall.a[1],dz=wall.b[2]-wall.a[2];
  colliders.push({id:wall.id,center:[(wall.a[0]+wall.b[0])/2,(wall.a[1]+wall.b[1])/2+wall.height/2,(wall.a[2]+wall.b[2])/2],halfExtents:[Math.hypot(dx,dz)/2,(wall.height+Math.abs(dy))/2,wall.thickness/2+.05],yaw:-Math.atan2(dz,dx)});
 }
 return colliders;
}
