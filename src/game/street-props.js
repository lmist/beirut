import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { StreetDetailLayout, streetSeed, selectStreetSamples } from './street-detail.js';

const CAPACITY=64;
const UP=new THREE.Vector3(0,1,0);
const material=(color,options={})=>new THREE.MeshStandardMaterial({color,roughness:.86,...options});
const box=(w,h,d,x=0,y=0,z=0)=>new THREE.BoxGeometry(w,h,d).translate(x,y,z);
const cylinder=(top,bottom,height,x=0,y=0,z=0,sides=12)=>new THREE.CylinderGeometry(top,bottom,height,sides).translate(x,y,z);
function merge(parts) {
  const geometry=mergeGeometries(parts);
  for(const part of parts)part.dispose();
  return geometry;
}
function branch(from,to,radius) {
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),direction=b.clone().sub(a);
  const geometry=new THREE.CylinderGeometry(radius*.65,radius,direction.length(),8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,direction.normalize()));
  return geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
}
function foliageGeometry(shrub=false) {
  const pieces=[];
  const count=shrub?22:38;
  for(let i=0;i<count;i++) {
    const angle=i*2.399963,ring=Math.sqrt((i+.5)/count),radius=(shrub?.51:1.32)*ring;
    const height=(shrub?1.08:3.65)+(shrub?.48:1.1)*Math.sqrt(1-ring*ring)+Math.sin(i*2.8)*(shrub?.09:.25);
    const size=(shrub?.23:.45)*(1+Math.sin(i*1.8)*.22);
    const geometry=new THREE.IcosahedronGeometry(size,1),position=geometry.getAttribute('position');
    const colors=[];
    for(let j=0;j<position.count;j++) {
      const x=position.getX(j),y=position.getY(j),z=position.getZ(j);
      const uneven=1+Math.sin(x*37+y*43+z*21+i)*.13;
      position.setXYZ(j,x*uneven,y*.82*uneven,z*uneven);
      const light=.73+(Math.sin(j*3.17+i)*.5+.5)*.2+(y/size)*.08;
      colors.push(light,light,light*.97);
    }
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();geometry.translate(Math.cos(angle)*radius,height,Math.sin(angle)*radius);pieces.push(geometry);
  }
  return merge(pieces);
}
function palmFronds() {
  const vertices=[],colors=[],uv=[];
  const point=(angle,length,t,side=0)=>{
    const r=length*t,spread=side;
    return [Math.sin(angle)*r+Math.cos(angle)*spread,5.5+Math.sin(t*Math.PI*.88)*1.18-t*.62,Math.cos(angle)*r-Math.sin(angle)*spread];
  };
  const triangle=(a,b,c,light)=>{
    vertices.push(...a,...b,...c);uv.push(0,0,.5,1,1,0);
    for(let i=0;i<3;i++)colors.push(light*.81,light,light*.72);
  };
  for(let f=0;f<13;f++) {
    const angle=f*2.399963,length=2.45+(f%4)*.2;
    for(let n=0;n<12;n++) {
      const t=.08+n*.071,next=t+.08,width=(.13+Math.sin(t*Math.PI)*.46)*(1-t*.6);
      const a=point(angle,length,t,-.028),b=point(angle,length,t,.028),end=point(angle,length,next);
      triangle(a,b,end,.73+(f%3)*.09);
      for(const side of [-1,1]) {
        const root=point(angle,length,t),tip=point(angle,length,t+.13,width*side),heel=point(angle,length,t+.043);
        tip[1]-=.15+t*.13;
        triangle(root,tip,heel,.7+((n+f)%5)*.05);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();
  return geometry;
}
function barkGeometry(palm=false) {
  const parts=[cylinder(palm?.13:.12,palm?.24:.19,palm?5.5:2.8,0,palm?2.75:1.4,0)];
  if(palm) {
    for(let i=0;i<23;i++) {
      const ring=new THREE.TorusGeometry(.218-i*.0036,.025,4,10);ring.rotateX(Math.PI/2).translate(0,.4+i*.22,0);parts.push(ring);
    }
  } else for(let i=0;i<5;i++) {
    const angle=i*2.399963;
    parts.push(branch([0,1.7+i*.12,0],[Math.sin(angle)*.9,3.6,Math.cos(angle)*.9],.07));
  }
  return merge(parts);
}
function lampGeometry() {
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,5.8,0),new THREE.Vector3(0,6.04,.35),new THREE.Vector3(0,6.02,.85)]);
  return merge([cylinder(.045,.085,5.85,0,2.925,0),cylinder(.12,.14,.24,0,.12,0),
    new THREE.TubeGeometry(curve,12,.043,8,false),box(.27,.11,.68,0,6,.97)]);
}
function benchGeometry(wood) {
  const parts=[];
  if(wood) {
    for(let i=0;i<5;i++)parts.push(box(1.95,.06,.095,0,.48,-.22+i*.11));
    for(let i=0;i<4;i++)parts.push(box(1.95,.09,.055,0,.68+i*.12,-.28));
  } else {
    for(const side of [-1,1]) {
      const x=side*.73;
      parts.push(box(.055,.45,.48,x,.225,0),box(.055,.6,.055,x,.72,-.29),box(.065,.055,.51,x,.47,0),
        branch([x,.48,.23],[x,.74,.23],.025),branch([x,.74,.23],[x,.77,-.26],.025));
    }
    parts.push(box(1.45,.065,.055,0,.25,-.15));
  }
  return merge(parts);
}

export class StreetProps {
  constructor(scene) {
    this.group=new THREE.Group();this.group.name='Beirut street furniture';scene.add(this.group);
    this.signs=new THREE.Group();this.group.add(this.signs);
    this.dummy=new THREE.Object3D();this.pools={};this.count=0;
    const pool=(name,geometry,mat)=>{
      const mesh=new THREE.InstancedMesh(geometry,mat,CAPACITY);mesh.name=`Street ${name}`;mesh.count=0;
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);this.pools[name]=mesh;return mesh;
    };
    this.trunks=pool('tree-trunks',barkGeometry(),material('#6e5e46'));
    this.leaves=pool('tree-leaves',foliageGeometry(),material('#647747',{vertexColors:true,roughness:1}));
    pool('palm-trunks',barkGeometry(true),material('#8b765b'));
    pool('palm-fronds',palmFronds(),material('#66764b',{vertexColors:true,side:THREE.DoubleSide,roughness:1}));
    this.planterEdges=pool('planters',merge([cylinder(.83,.77,.4,0,.2,0,16),cylinder(.85,.85,.09,0,.41,0,16)]),material('#bab6a4'));
    this.groundCover=pool('soil',cylinder(.72,.72,.025,0,.465,0,16),material('#52483b'));
    pool('pots',merge([cylinder(.47,.32,.55,0,.275,0,16),cylinder(.5,.5,.085,0,.535,0,16)]),material('#ad7054'));
    pool('shrubs',foliageGeometry(true),material('#6e7c49',{vertexColors:true,roughness:1}));
    this.poles=pool('lamps',lampGeometry(),material('#515b5b',{metalness:.7,roughness:.44}));
    this.lights=pool('lamp-glass',box(.2,.025,.54,0,5.94,1),material('#ffe8ba',{emissive:'#ffdca0',emissiveIntensity:.8,roughness:.35}));
    pool('bench-wood',benchGeometry(true),material('#967550'));
    pool('bench-frame',benchGeometry(false),material('#384f4a',{metalness:.6,roughness:.53}));
    this.signFace=new THREE.PlaneGeometry(2.5,.79);
    this.signBoard=new THREE.BoxGeometry(2.56,.85,.055);
    this.signPost=new THREE.CylinderGeometry(.034,.048,2.9,10);
    this.signFrameMaterial=material('#cad0c2',{metalness:.65,roughness:.48});
    this.signPostMaterial=material('#68756f',{metalness:.65,roughness:.46});
  }
  setContext(context){this.layout=new StreetDetailLayout(context);}
  candidates(position,options){return this.layout?.candidates(position,options)||[];}
  populate(points,{vehicles=[]}={}) {
    for(const mesh of Object.values(this.pools))mesh.count=0;
    this.clearSigns();
    const good=selectStreetSamples(points,{limit:CAPACITY,vehicles});
    const add=(name,p,scale=1)=>{
      const mesh=this.pools[name];if(mesh.count>=CAPACITY)return;
      this.dummy.position.set(p.x,p.y+.025,p.z);this.dummy.rotation.set(0,p.yaw||0,0);this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();mesh.setMatrixAt(mesh.count++,this.dummy.matrix);
    };
    const named=new Set();
    for(const p of good) {
      const seed=p.seed??streetSeed(`${p.x.toFixed(1)}:${p.z.toFixed(1)}`),kind=p.kind||['tree','lamp','shrub','bench','palm'][seed%5];
      const scale=.92+(seed%17)/100;
      if(kind==='lamp') {add('lamps',p);add('lamp-glass',p);}
      if(kind==='bench') {add('bench-wood',p);add('bench-frame',p);}
      if(kind==='shrub') {add('pots',p,scale);add('shrubs',p,scale);}
      if(kind==='tree'||kind==='palm') {
        add('planters',p);add('soil',p);
        add(kind==='tree'?'tree-trunks':'palm-trunks',p,scale);add(kind==='tree'?'tree-leaves':'palm-fronds',p,scale);
      }
      if(kind==='lamp'&&p.street&&!named.has(p.street)&&named.size<4) {
        // Mount to the lamp instead of adding a second obstacle to the sidewalk.
        this.addSign(p,p.street,p.streetAr,{post:false});named.add(p.street);
      }
    }
    for(const mesh of Object.values(this.pools)){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
    this.count=good.length;
  }
  applyWorldTextures(uniforms) {
    const treatments=[
      [this.planterEdges,'concrete','diffuseColor.rgb*=mix(vec3(1.0),texture(uWorldAtlas,vec3(vTexturePos.xz*.55,11.0)).rgb*1.7,.32);'],
      [this.trunks,'bark','diffuseColor.rgb*=.88+.12*sin(vTexturePos.y*19.0+vTexturePos.x*24.0);'],
      [this.pools['palm-trunks'],'palm-bark','diffuseColor.rgb*=.84+.16*sin(vTexturePos.y*25.0);'],
      [this.pools['bench-wood'],'wood','diffuseColor.rgb*=.87+.13*sin(vTexturePos.x*2.0+sin(vTexturePos.z*39.0)*4.0);'],
    ];
    for(const [mesh,key,body] of treatments) {
      mesh.material.onBeforeCompile=shader=>{
        shader.uniforms.uWorldAtlas=uniforms.uAtlas;shader.uniforms.uWorldTextures=uniforms.uTextures;
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vTexturePos;').replace('#include <begin_vertex>','#include <begin_vertex>\nvTexturePos=position;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vTexturePos;uniform highp sampler2DArray uWorldAtlas;uniform float uWorldTextures;').replace('#include <color_fragment>',`#include <color_fragment>\nif(uWorldTextures>.5){${body}}`);
      };
      mesh.material.customProgramCacheKey=()=>`beirut-street-surface-${key}`;mesh.material.needsUpdate=true;
    }
  }
  clearSigns() {
    for(const sign of [...this.signs.children]) {
      sign.userData.faceMaterial.map.dispose();sign.userData.faceMaterial.dispose();this.signs.remove(sign);
    }
  }
  addSign(point,text,arabic='',{post=true}={}) {
    if(this.signs.children.length>=6)return;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;
    const c=canvas.getContext('2d');
    c.fillStyle='#203f3c';c.fillRect(0,0,1024,320);
    c.strokeStyle='#d6dcc7';c.lineWidth=7;c.strokeRect(17,17,990,286);
    c.fillStyle='#f3eee0';c.textAlign='center';c.textBaseline='middle';
    const fit=(label,y,size)=>{c.font=`500 ${size}px Arial, sans-serif`;while(c.measureText(label).width>922&&size>25)c.font=`500 ${--size}px Arial, sans-serif`;c.fillText(label,512,y);};
    if(arabic){c.direction='rtl';fit(arabic,100,62);c.direction='ltr';fit(text,211,48);}
    else fit(text,160,58);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=4;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
    const faceMaterial=material('#ffffff',{map:texture,roughness:.6});
    const sign=new THREE.Group();sign.position.set(point.x,point.y+.025,point.z);sign.rotation.y=point.yaw||0;
    const backing=new THREE.Mesh(this.signBoard,this.signFrameMaterial);backing.position.set(0,2.65,.1);backing.castShadow=true;sign.add(backing);
    for(const side of [-1,1]) {
      const face=new THREE.Mesh(this.signFace,faceMaterial);face.position.set(0,2.65,.1+side*.031);face.rotation.y=side===1?0:Math.PI;sign.add(face);
    }
    if(post){const pole=new THREE.Mesh(this.signPost,this.signPostMaterial);pole.position.y=1.45;pole.castShadow=true;sign.add(pole);}
    sign.userData.faceMaterial=faceMaterial;this.signs.add(sign);
    return sign;
  }
}
