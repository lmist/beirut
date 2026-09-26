import * as THREE from 'three';
import { distanceToTile } from '../metrics.js';
import { photoMetadata,validatePhotoRegistration } from './photo-projection.js';

export const PHOTO_MEMORY_BUDGET=192*1024*1024;
const textureBytes=record=>record?record.width*record.height*4*4/3:0;

export function selectPhotoTiles(tiles,position,mode,satellite,facades,budget=PHOTO_MEMORY_BUDGET) {
  if(mode==='overview'&&position.y>1100)return [];
  const near=tiles.map(tile=>({tile,distance:distanceToTile(position.x,position.z,tile.bounds)})).filter(row=>row.distance<850).sort((a,b)=>a.distance-b.distance);
  const selected=[];
  let bytes=0;
  for(const {tile} of near) {
    const size=textureBytes(satellite.tiles[tile.id])+textureBytes(facades.tiles[tile.id]);
    if(bytes+size>budget)continue;
    bytes+=size;selected.push(tile.id);
    if(selected.length===12)break;
  }
  return selected;
}

/** Geographic overview stays resident; detailed roof and facade tiles share a budget. */
export function createPhotographicMaterials(city,{anisotropy=8}={}) {
  const empty=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);
  empty.colorSpace=THREE.SRGBColorSpace;empty.needsUpdate=true;
  const emptyMetadata=new THREE.DataTexture(new Float32Array(24),6,1,THREE.RGBAFormat,THREE.FloatType);
  emptyMetadata.needsUpdate=true;
  const emptyReference=new THREE.DataArrayTexture(new Uint8Array([128,128,128,255]),1,1,1);
  emptyReference.colorSpace=THREE.SRGBColorSpace;emptyReference.needsUpdate=true;
  const referenceSizes=Array.from({length:16},()=>new THREE.Vector2(4,3.2));
  const shared={uPhotographs:{value:1},uOverview:{value:empty},uOverviewBounds:{value:new THREE.Vector4(0,0,1,1)},uOverviewReady:{value:0},uReferenceFacades:{value:emptyReference},uReferenceSizes:{value:referenceSizes},uReferenceReady:{value:0}};
  const defaults=()=>({uSatellite:{value:empty},uSatelliteBounds:{value:new THREE.Vector4(0,0,1,1)},uSatelliteReady:{value:0},uPhotoAtlas:{value:empty},uPhotoMetadata:{value:emptyMetadata},uPhotoReady:{value:0}});
  Object.assign(city.uniforms,shared,defaults());
  const entries=new Map(),failures=new Map(),loader=new THREE.TextureLoader(),idleWaiters=[];
  let satellite=null,facades=null,registration=null,available=false,active=0,wanted=new Set(),lastPosition=null,lastMode='overview',allTiles=[];
  async function loadTexture(url) {
    const texture=await loader.loadAsync(url);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.flipY=false;
    texture.magFilter=THREE.LinearFilter;texture.anisotropy=anisotropy;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps=true;
    return texture;
  }
  async function loadReferenceFacades() {
    const response=await fetch('/assets/world/photographic/facade-materials.json');
    if(!response.ok)throw new Error('Beirut facade materials unavailable');
    const meta=await response.json();
    const imageResponse=await fetch(meta.url);
    if(!imageResponse.ok)throw new Error('Beirut facade texture unavailable');
    const bitmap=await createImageBitmap(await imageResponse.blob());
    const size=meta.tileSize||128,canvas=new OffscreenCanvas(size,size),context=canvas.getContext('2d',{willReadFrequently:true});
    const pixels=new Uint8Array(size*size*4*meta.patches.length);
    for(const [layer,patch] of meta.patches.entries()) {
      referenceSizes[layer].set(patch.widthMeters||4,patch.heightMeters||3.2);
      const [u,v,w,h]=patch.rect;
      context.clearRect(0,0,size,size);
      context.drawImage(bitmap,u*meta.width,v*meta.height,w*meta.width,h*meta.height,0,0,size,size);
      pixels.set(context.getImageData(0,0,size,size).data,layer*size*size*4);
    }
    bitmap.close();
    const texture=new THREE.DataArrayTexture(pixels,size,size,meta.patches.length);
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=THREE.LinearFilter;texture.anisotropy=anisotropy;texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps=true;texture.needsUpdate=true;
    shared.uReferenceFacades.value=texture;shared.uReferenceReady.value=1;emptyReference.dispose();
  }
  function metadata(entry) {
    if(!available||entry.metadata)return;
    const record=facades.tiles[entry.id];
    if(!record)return;
    const data=photoMetadata(record,facades.buildings,registration);
    entry.metadata=new THREE.DataTexture(data.pixels,data.width,data.height,THREE.RGBAFormat,THREE.FloatType);
    entry.metadata.needsUpdate=true;
    entry.material.uniforms.uPhotoMetadata.value=entry.metadata;
  }
  function materialForTile(id) {
    if(entries.has(id))return entries.get(id).material;
    const material=city.clone();
    material.uniforms={...city.uniforms,...defaults()};
    const entry={id,material,textures:null,loading:false,metadata:null};
    entries.set(id,entry);metadata(entry);
    return material;
  }
  function release(entry) {
    if(!entry.textures)return;
    entry.textures.forEach(texture=>texture?.dispose());entry.textures=null;
    const u=entry.material.uniforms;
    u.uSatellite.value=u.uPhotoAtlas.value=empty;
    u.uSatelliteReady.value=u.uPhotoReady.value=0;
  }
  function drain() {
    if(!available)return;
    for(const id of wanted) {
      if(active>=2)return;
      const entry=entries.get(id);
      if(!entry||entry.textures||entry.loading||failures.has(id))continue;
      entry.loading=true;active++;
      const aerial=satellite.tiles[id],wall=facades.tiles[id];
      Promise.allSettled([aerial?loadTexture(aerial.url):null,wall?loadTexture(wall.url):null]).then(results=>{
        const textures=results.map(result=>result.status==='fulfilled'?result.value:null);
        const failed=results.find(result=>result.status==='rejected');
        if(failed)failures.set(id,String(failed.reason));
        if(!wanted.has(id)){textures.forEach(texture=>texture?.dispose());return;}
        entry.textures=textures;
        const u=entry.material.uniforms;
        if(textures[0]){u.uSatellite.value=textures[0];u.uSatelliteBounds.value.fromArray(aerial.bounds);u.uSatelliteReady.value=1;}
        if(textures[1]){u.uPhotoAtlas.value=textures[1];u.uPhotoReady.value=1;}
      }).finally(()=>{entry.loading=false;active--;drain();if(active===0)idleWaiters.splice(0).forEach(resolve=>resolve());});
    }
  }
  function update(position,mode,tiles) {
    lastPosition={x:position.x,y:position.y,z:position.z};lastMode=mode;allTiles=tiles;
    if(!available)return;
    wanted=new Set(shared.uPhotographs.value?selectPhotoTiles(tiles,position,mode,satellite,facades):[]);
    for(const entry of entries.values())if(!wanted.has(entry.id))release(entry);
    drain();
  }
  const ready=(async()=>{
    const urls=['/assets/world/photographic/satellite.json','/assets/world/photographic/facades.json','/data/registration.json'];
    [satellite,facades,registration]=await Promise.all(urls.map(async url=>{
      const response=await fetch(url);if(!response.ok)throw new Error(`Photographic data unavailable: ${url}`);return response.json();
    }));
    validatePhotoRegistration(satellite,registration);validatePhotoRegistration(facades,registration);
    const [overview]=await Promise.all([loadTexture(satellite.overview.url),loadReferenceFacades()]);
    shared.uOverview.value=overview;shared.uOverviewBounds.value.fromArray(satellite.overview.bounds);shared.uOverviewReady.value=1;
    available=true;
    for(const entry of entries.values())metadata(entry);
    if(lastPosition)update(lastPosition,lastMode,allTiles);
  })().catch(error=>{failures.set('initialization',error.message);console.warn(error.message);});
  return {
    ready,materialForTile,update,uniforms:shared,
    async settle(){await ready;if(active)await new Promise(resolve=>idleWaiters.push(resolve));},
    diagnostics(){
      const resident=[...entries.values()].filter(entry=>entry.textures);
      const reference=shared.uReferenceFacades.value.image;
      return {available,enabled:shared.uPhotographs.value===1,referenceFacades:shared.uReferenceReady.value?16:0,residentTiles:resident.length,loading:active,wantedTiles:wanted.size,estimatedGpuMiB:Math.round((resident.reduce((sum,entry)=>sum+entry.textures.reduce((bytes,texture)=>bytes+(texture?texture.image.width*texture.image.height*4*4/3:0),0),0)+textureBytes(satellite?.overview)+reference.width*reference.height*reference.depth*4*4/3)/1024/1024),facadeBuildings:facades?.buildings.filter(Boolean).length||0,errors:[...failures.entries()]};
    },
  };
}
