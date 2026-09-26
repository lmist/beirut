import * as THREE from 'three';
import { createPhotographicMaterials } from './photographic.js';
import { SUN_DIRECTION } from './lighting.js';

const vertexShader = `
  #include <common>
  #include <shadowmap_pars_vertex>
  in vec3 color;
  in float surface;
  in float ao;
  in float baseHeight;
  in float photoSlot;
  in float buildingSeed;
  in vec3 buildingFrame;
  in float architecture;
  uniform sampler2D uPhotoMetadata;
  uniform float uPhotoReady;
  out vec3 vPosition;
  out vec3 vNormal;
  out vec3 vColor;
  out float vSurface;
  out float vAO;
  out float vHeight;
  out vec3 vPhotoProjection;
  out float vPhotoWeight;
  flat out vec4 vPhotoCell;
  flat out float vBuildingSeed;
  flat out vec3 vBuildingFrame;
  flat out float vArchitecture;
  void main() {
    vPosition=position; vNormal=normal; vColor=color;
    vSurface=surface; vAO=ao; vHeight=position.y-baseHeight;
    vBuildingSeed=buildingSeed;
    vBuildingFrame=buildingFrame;
    vArchitecture=architecture;
    vPhotoProjection=vec3(0.0,0.0,1.0);vPhotoWeight=0.0;vPhotoCell=vec4(0.0);
    if(photoSlot>.5&&uPhotoReady>.5) {
      int slot=int(photoSlot+.5);
      vec4 camera=texelFetch(uPhotoMetadata,ivec2(0,slot),0);
      vec4 right=texelFetch(uPhotoMetadata,ivec2(1,slot),0);
      vec3 forward=texelFetch(uPhotoMetadata,ivec2(2,slot),0).xyz;
      vec3 up=texelFetch(uPhotoMetadata,ivec2(3,slot),0).xyz;
      vec3 delta=position-camera.xyz;
      float depth=dot(delta,forward);
      vPhotoProjection=vec3((depth+dot(delta,right.xyz)/max(.01,right.w))*.5,(depth-dot(delta,up)/max(.01,right.w))*.5,depth);
      vPhotoWeight=smoothstep(.08,.32,dot(normalize(normal),normalize(-delta)))*smoothstep(.25,.5,camera.w);
      vPhotoCell=texelFetch(uPhotoMetadata,ivec2(4,slot),0);
    }
    vec4 worldPosition=modelMatrix*vec4(position,1.0);
    vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
    vec3 transformedNormal=normalMatrix*normal;
    #include <shadowmap_vertex>
    gl_Position=projectionMatrix*mvPosition;
  }
`;

const colorFunctions = `
  uniform float uRetro;
  // Keep city, water and sky in the same linear-light / tone-mapping pipeline
  // as Three's standard materials. SRGB texture decoding happens on sampling.
  vec4 outputRadiance(vec3 value) {
    value=max(value,vec3(0.0));
    #ifdef TONE_MAPPING
      value=toneMapping(value);
    #endif
    vec4 outputColor=linearToOutputTexel(vec4(value,1.0));
    if(uRetro>.5){float dither=mod(gl_FragCoord.x+mod(gl_FragCoord.y,2.0)*2.0,4.0)/4.0;outputColor.rgb=floor(outputColor.rgb*64.0+dither)/64.0;}
    return outputColor;
  }
  float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  vec3 diffuseTile(vec2 uv,float layer) { return texture(uAtlas,vec3(uv.x,1.0-uv.y,layer)).rgb; }
`;

const fragmentShader = `
  precision highp sampler2DArray;
  #include <common>
  #include <packing>
  #include <shadowmap_pars_fragment>
  uniform bool receiveShadow;
  #include <shadowmask_pars_fragment>
  uniform vec3 uSunDirection;
  uniform vec3 uShadowCenter;
  uniform float uShadowRadius;
  uniform float uShadowStrength;
  uniform sampler2DArray uAtlas;
  uniform vec3 uEye;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFacades;
  uniform float uTextures;
  uniform float uTime;
  uniform float uPhotographs;
  uniform sampler2D uOverview;
  uniform vec4 uOverviewBounds;
  uniform float uOverviewReady;
  uniform sampler2D uSatellite;
  uniform vec4 uSatelliteBounds;
  uniform float uSatelliteReady;
  uniform sampler2D uPhotoAtlas;
  uniform float uPhotoReady;
  uniform sampler2DArray uReferenceFacades;
  uniform vec2 uReferenceSizes[16];
  uniform float uReferenceReady;
  in vec3 vPosition;
  in vec3 vNormal;
  in vec3 vColor;
  in float vSurface;
  in float vAO;
  in float vHeight;
  in vec3 vPhotoProjection;
  in float vPhotoWeight;
  flat in vec4 vPhotoCell;
  flat in float vBuildingSeed;
  flat in vec3 vBuildingFrame;
  flat in float vArchitecture;
  out vec4 outColor;
  ${colorFunctions}
  void main() {
    vec3 n=normalize(vNormal);
    if(!gl_FrontFacing)n=-n;
    float d=distance(vPosition,uEye);
    float horizontal=abs(n.y);
    vec3 base;
    if(vSurface>4.5) {
      float seed=vBuildingSeed*.993+.003;
      if(horizontal>.64) {
        // Actual registered aerial pixels are applied below. A neutral roof
        // remains when imagery is disabled or unavailable.
        base=vec3(.34,.33,.30);
      } else {
        vec2 tangent=normalize(vec2(n.z,-n.x));
        float across=dot(vPosition.xz-vBuildingFrame.xy,tangent);
        float buildingHeight=max(3.2,vBuildingFrame.z-vPosition.y+vHeight);
        bool hasRetail=buildingHeight>7.0&&fract(seed*17.27)<.55;
        bool retail=vHeight<3.4&&hasRetail;
        base=vec3(.54,.50,.41);
        if(uReferenceReady>.5&&vArchitecture<1.5) {
          // Shutter and plain plaster samples are ground-level materials;
          // using them on upper stories erases the building's floor rhythm.
          int reference=int(floor(seed*10.0));
          if(retail)reference=12+int(floor(fract(seed*23.0)*4.0));
          vec2 span=uReferenceSizes[reference];
          float upperHeight=buildingHeight-(hasRetail?3.4:0.0);
          float floors=max(1.0,floor(upperHeight/3.2+.5));
          float floorScale=upperHeight/(floors*3.2);
          vec2 wallUV=vec2(across/span.x,(vHeight-(hasRetail?3.4:0.0))/(span.y*floorScale));
          if(retail)wallUV.y=clamp(vHeight/3.4,.008,.992);
          base=texture(uReferenceFacades,vec3(wallUV.x,1.0-wallUV.y,float(reference))).rgb;
        }
        float bottomStain=1.0-.23*(1.0-smoothstep(0.0,1.3,vHeight));
        base*=bottomStain;
        if(uFacades<.5)base=vec3(.54,.50,.41);
      }
    } else if(vSurface<1.5) {
      if(horizontal>.55) {
        vec2 uv=vPosition.xz/.72;
        base=mix(diffuseTile(uv,8.0),diffuseTile(uv.yx*.61+vec2(13.1,7.8),8.0),.28);
        // The source contains coarse aggregate; sample at paving-scale and
        // soften its contrast so a road reads as asphalt, not loose gravel.
        base=mix(base,vec3(.055,.058,.060),.48);
      } else {
        vec2 tangent=normalize(vec2(n.z,-n.x));
        base=diffuseTile(vec2(dot(vPosition.xz,tangent),vPosition.y)/3.2,12.0);
      }
    } else if(vSurface<2.5) {
      vec2 uv=vPosition.xz/22.0+vec2(uTime*.007,uTime*.003);
      base=mix(diffuseTile(uv,15.0),diffuseTile(uv*1.31-vec2(uTime*.009,0.0),15.0),.5)*.76;
    } else if(vSurface<3.5) {
      if(horizontal>.55)base=diffuseTile(vPosition.xz/2.2,9.0);
      else {
        vec2 tangent=normalize(vec2(n.z,-n.x));
        base=diffuseTile(vec2(dot(vPosition.xz,tangent)/3.0,vPosition.y/1.5),11.0);
      }
    } else {
      if(horizontal>.6)base=diffuseTile(vPosition.xz/5.5,8.0)*1.13;
      else {
        vec2 tangent=normalize(vec2(n.z,-n.x));
        base=diffuseTile(vec2(dot(vPosition.xz,tangent)/4.0,vPosition.y/3.0),11.0);
      }
    }
    if(uPhotographs>.5) {
      if((horizontal>.64&&vSurface>4.5)||(horizontal>.75&&vSurface<4.5&&(vSurface<1.5||vSurface>2.5))) {
        vec4 bounds=uSatelliteReady>.5?uSatelliteBounds:uOverviewBounds;
        vec2 uv=(vPosition.xz-bounds.xy)/(bounds.zw-bounds.xy);
        if(uOverviewReady>.5&&all(greaterThanEqual(uv,vec2(0.0)))&&all(lessThanEqual(uv,vec2(1.0)))) {
          vec3 photo=uSatelliteReady>.5?texture(uSatellite,uv).rgb:texture(uOverview,uv).rgb;
          float amount=vSurface>4.5?.90:mix(.04,.80,smoothstep(75.0,420.0,d));
          base=mix(base,photo,amount);
        }
      } else if(vSurface>4.5&&vArchitecture<.5&&uFacades>.5&&uPhotoReady>.5&&vPhotoProjection.z>.5) {
        vec2 uv=vPhotoProjection.xy/vPhotoProjection.z;
        float edge=min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y));
        float amount=smoothstep(.005,.04,edge)*vPhotoWeight*(1.0-smoothstep(650.0,1000.0,d));
        vec2 atlasUV=vPhotoCell.xy+clamp(uv,vec2(0.0),vec2(1.0))*vPhotoCell.zw;
        vec2 atlasSize=vec2(textureSize(uPhotoAtlas,0));
        float footprint=max(length(dFdx(atlasUV)*atlasSize),length(dFdy(atlasUV)*atlasSize));
        // Four-pixel gutters isolate neighboring camera frames through mip 2.
        vec3 photo=textureLod(uPhotoAtlas,atlasUV,clamp(log2(max(1.0,footprint)),0.0,2.0)).rgb;
        base=mix(base,photo,amount);
      }
    }
    if(uTextures<.5)base=pow(vColor,vec3(2.2));
    // Derivative bump from the sampled aggregate/paving adds centimetre-scale
    // relief without changing registered geometry or its collision surface.
    if(uTextures>.5&&horizontal>.75&&vSurface<4.5&&(vSurface<1.5||vSurface>2.5)) {
      float height=dot(base,vec3(.2126,.7152,.0722))*.009;
      vec3 dx=dFdx(vPosition),dy=dFdy(vPosition);
      vec3 r1=cross(dy,n),r2=cross(n,dx);
      float determinant=dot(dx,r1);
      if(abs(determinant)>.000001)n=normalize(abs(determinant)*n-sign(determinant)*(dFdx(height)*r1+dFdy(height)*r2));
    }
    float sun=max(dot(n,uSunDirection),0.0);
    float shadowFade=1.0-smoothstep(uShadowRadius*.62,uShadowRadius,distance(vPosition.xz,uShadowCenter.xz));
    float visibility=1.0;
    // The aerial opening intentionally has no shadow pass yet. Do not sample
    // its uninitialized map: mixing a NaN shadow with zero still yields NaN.
    if(uShadowStrength>.5&&shadowFade>.001)visibility=mix(1.0,getShadowMask(),shadowFade);
    // Warm direct light and a cool sky fill keep the photographic surfaces
    // and nearby street objects anchored in the same lighting setup.
    vec3 skyFill=mix(vec3(.22,.205,.18),vec3(.46,.56,.68),n.y*.5+.5);
    vec3 lighting=skyFill+vec3(1.30,1.10,.82)*sun*visibility;
    float contact=mix(.68,1.0,vAO);
    if(vSurface>4.5&&horizontal<.64)contact*=mix(.86,1.0,smoothstep(0.0,3.5,vHeight));
    // Photographs already carry exposure and baked shading. Keep the city's
    // live shadows without multiplying a second full lighting pass into them.
    if(uTextures>.5&&vSurface>4.5&&((horizontal<.64&&uReferenceReady>.5)||(horizontal>.64&&uPhotographs>.5&&uOverviewReady>.5)))lighting=mix(vec3(.88),lighting,.5);
    base*=lighting*contact;
    float fog=smoothstep(uFogNear,uFogFar,d);
    outColor=outputRadiance(mix(base,uFogColor,fog));
  }
`;

function fallbackAtlas() {
  const colors=[[202,188,159],[197,176,128],[154,150,136],[186,131,112],[154,157,128],[154,128,103],[118,138,143],[119,139,116],[78,79,77],[188,180,157],[144,140,131],[164,161,147],[164,157,135],[168,103,66],[109,124,75],[52,111,127]];
  const bytes=new Uint8Array(16*4);colors.forEach((c,i)=>bytes.set([...c,255],i*4));
  const texture=new THREE.DataArrayTexture(bytes,1,1,16);
  texture.format=THREE.RGBAFormat;texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}

export function createWorldMaterials(shared,{anisotropy=8}={}) {
  const fallback=fallbackAtlas();
  Object.assign(shared,{
    uRetro:{value:0},
    uSunDirection:{value:SUN_DIRECTION.clone()},
    uShadowCenter:{value:new THREE.Vector3()},
    uShadowRadius:{value:175},
    uShadowStrength:{value:0},
  });
  const uniforms={...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),...shared,uAtlas:{value:fallback},uTextures:{value:1}};
  shared.uFogColor.value.set('#c2ced4');
  const city=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,lights:true,side:THREE.DoubleSide,vertexShader,fragmentShader});
  const photos=createPhotographicMaterials(city,{anisotropy});
  const sea=new THREE.ShaderMaterial({
    glslVersion:THREE.GLSL3,uniforms,
    vertexShader:`out vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`
      precision highp sampler2DArray;
      uniform sampler2DArray uAtlas;uniform vec3 uEye;uniform vec3 uFogColor;uniform vec3 uSunDirection;uniform float uTime;uniform float uTextures;uniform float uFogNear;uniform float uFogFar;
      in vec3 vP;out vec4 outColor;
      ${colorFunctions}
      void main(){
        float d=distance(vP,uEye);
        vec3 view=normalize(uEye-vP);
        // Four analytic wave slopes: no fixed screen-space sparkle pattern.
        float a=dot(vP.xz,vec2(.13,.08))+uTime*.54;
        float b=dot(vP.xz,vec2(-.21,.17))-uTime*.73;
        float c=dot(vP.xz,vec2(.57,.36))+uTime*.91;
        float detail=1.0-smoothstep(250.0,1800.0,d);
        vec3 normal=normalize(vec3(cos(a)*.035+cos(b)*.028+cos(c)*.018*detail,1.0,sin(a)*.028+sin(b)*.023));
        float fresnel=.025+.975*pow(1.0-max(dot(normal,view),0.0),5.0);
        vec3 reflected=reflect(-view,normal);
        vec3 sky=mix(uFogColor,vec3(.20,.39,.63),smoothstep(0.0,.8,max(reflected.y,0.0)));
        vec2 uv=vP.xz/55.0+vec2(uTime*.0017,uTime*.0011);
        vec3 textureColor=diffuseTile(uv,15.0);
        vec3 water=mix(vec3(.022,.105,.135),textureColor*.48,.25*uTextures);
        water=mix(water,sky,fresnel*.85);
        float highlight=pow(max(dot(reflect(-uSunDirection,normal),view),0.0),180.0);
        water+=vec3(2.0,1.57,.91)*highlight*.66;
        outColor=outputRadiance(mix(water,uFogColor,smoothstep(uFogNear,uFogFar,d)));
      }
    `,
  });
  const skyMaterial=new THREE.ShaderMaterial({
    glslVersion:THREE.GLSL3,uniforms,side:THREE.BackSide,depthWrite:false,
    vertexShader:`out vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`
      precision highp sampler2DArray;
      uniform sampler2DArray uAtlas;uniform vec3 uFogColor;uniform vec3 uSunDirection;uniform float uTime;in vec3 vDirection;out vec4 outColor;
      ${colorFunctions}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec3 dir=normalize(vDirection);float elevation=max(dir.y,0.0);
        float sunDot=max(dot(dir,uSunDirection),0.0);
        vec3 sky=mix(uFogColor,vec3(.18,.35,.60),pow(smoothstep(0.0,.85,elevation),.65));
        // Mediterranean coastal haze: a soft warm horizon and very thin cloud.
        sky+=vec3(.16,.10,.035)*pow(sunDot,8.0)*(1.0-elevation*.55);
        vec2 uv=dir.xz/max(.16,dir.y)*1.8+vec2(uTime*.0005,0.0);
        float cloud=noise(uv)*.57+noise(uv*2.17)*.28+noise(uv*4.09)*.15;
        float cover=smoothstep(.62,.82,cloud)*smoothstep(.04,.22,elevation)*.20;
        sky=mix(sky,vec3(.81,.83,.80),cover);
        float halo=pow(sunDot,80.0)*.24;
        float disk=smoothstep(cos(.006),cos(.0045),sunDot);
        sky+=vec3(1.0,.80,.52)*(halo+disk*5.0);
        outColor=outputRadiance(sky);
      }
    `,
  });
  const sky=new THREE.Mesh(new THREE.SphereGeometry(16000,24,12),skyMaterial);sky.renderOrder=1000;sky.frustumCulled=false;
  const ready=(async()=>{
    const metaResponse=await fetch('/assets/world/materials.json');if(!metaResponse.ok)throw new Error('World material manifest unavailable');
    const meta=await metaResponse.json();
    const imageResponse=await fetch(meta.atlas);if(!imageResponse.ok)throw new Error('World material atlas unavailable');
    const bitmap=await createImageBitmap(await imageResponse.blob());
    const size=meta.tileSize,canvas=new OffscreenCanvas(size,size),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const pixels=new Uint8Array(size*size*4*16);
    for(let row=0;row<4;row++)for(let col=0;col<4;col++){
      const x=meta.columns[col],y=meta.rows[row],w=meta.columns[col+1]-x,h=meta.rows[row+1]-y;
      ctx.clearRect(0,0,size,size);ctx.drawImage(bitmap,x+1,y+1,w-2,h-2,0,0,size,size);
      pixels.set(ctx.getImageData(0,0,size,size).data,(row*4+col)*size*size*4);
    }
    bitmap.close();
    const atlas=new THREE.DataArrayTexture(pixels,size,size,16);
    atlas.colorSpace=THREE.SRGBColorSpace;atlas.format=THREE.RGBAFormat;
    atlas.wrapS=atlas.wrapT=THREE.RepeatWrapping;
    atlas.magFilter=THREE.LinearFilter;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.anisotropy=anisotropy;
    atlas.generateMipmaps=true;atlas.needsUpdate=true;
    uniforms.uAtlas.value=atlas;fallback.dispose();
    return {layers:16,size,gpuBytes:size*size*4*16*4/3};
  })();
  return {city,sea,sky,uniforms,photos,ready:Promise.all([ready,photos.ready])};
}
