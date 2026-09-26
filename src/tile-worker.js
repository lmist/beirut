import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { createBuildingIndex, buildingBaseHeights, buildingPhotoSlots } from './world/building-index.js';
import { photoSlots } from './world/photo-projection.js';

const buildingIndexReady=Promise.all(['/data/buildings.json','/data/building-ground.json'].map(async url=>{const response=await fetch(url);if(!response.ok)throw new Error('Building metadata unavailable');return response.json();})).then(([buildings,ground])=>createBuildingIndex(buildings,64,ground));
const photographsReady=fetch('/assets/world/photographic/facades.json').then(response=>response.ok?response.json():{tiles:{}}).catch(()=>({tiles:{}}));
const architectureReady=Promise.all(['/data/bliss-street.json','/data/bliss-landmarks.json','/data/bliss-heritage.json'].map(url=>fetch(url).then(response=>response.ok?response.json():{}).catch(()=>({})))).then(([street,landmarks,heritage])=>({ids:new Set((street.buildings||[]).map(b=>b.id)),replacements:new Set([...(landmarks.replacementBuildingIds||[]),...(heritage.replacementBuildingIds||[])])}));

self.onmessage = async ({ data: { id, url } }) => {
  try {
    const [response,,buildingIndex,photographs,architectural] = await Promise.all([fetch(url), MeshoptDecoder.ready, buildingIndexReady,photographsReady,architectureReady]);
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    const file = await response.arrayBuffer();
    const [magic, nv, ni, vbSize, ibSize] = new Uint32Array(file, 0, 5);
    if (magic !== 0x42525431 || file.byteLength !== 20 + vbSize + ibSize) throw new Error('Invalid map tile');
    const vertices = new Uint8Array(nv * 20);
    const indices = new Uint8Array(ni * 4);
    MeshoptDecoder.decodeVertexBuffer(vertices, nv, 20, new Uint8Array(file, 20, vbSize));
    MeshoptDecoder.decodeIndexBuffer(indices, ni, 4, new Uint8Array(file, 20 + vbSize, ibSize));
    const position = new Float32Array(nv * 3), normal = new Int8Array(nv * 3), color = new Uint8Array(nv * 3), surface = new Uint8Array(nv), ao = new Uint8Array(nv);
    const floats = new DataView(vertices.buffer);
    for (let i = 0; i < nv; i++) {
      for (let j = 0; j < 3; j++) {
        position[i * 3 + j] = floats.getFloat32(i * 20 + j * 4, true);
        normal[i * 3 + j] = vertices[i * 20 + 12 + j];
        color[i * 3 + j] = vertices[i * 20 + 16 + j];
      }
      surface[i] = vertices[i * 20 + 15];
      ao[i] = vertices[i * 20 + 19];
    }
    const baseHeight=buildingBaseHeights(position,surface,new Uint32Array(indices.buffer),buildingIndex);
    const tileId=url.split('/').at(-1).split('.')[0];
    const buildingSeed=new Uint8Array(nv);
    const buildingFrame=new Float32Array(nv*3);
    const architecture=new Uint8Array(nv);
    const photoSlot=buildingPhotoSlots(position,surface,new Uint32Array(indices.buffer),buildingIndex,photoSlots(photographs.tiles[tileId]),buildingSeed,buildingFrame,architecture,architectural.ids,architectural.replacements);
    const originalIndices=new Uint32Array(indices.buffer),retained=[];
    for(let i=0;i<originalIndices.length;i+=3)if(architecture[originalIndices[i]]!==2)retained.push(originalIndices[i],originalIndices[i+1],originalIndices[i+2]);
    const indexBuffer=retained.length===originalIndices.length?indices.buffer:new Uint32Array(retained).buffer;
    const buffers = { architecture:architecture.buffer,buildingFrame:buildingFrame.buffer,buildingSeed:buildingSeed.buffer,photoSlot:photoSlot.buffer,baseHeight:baseHeight.buffer, position: position.buffer, normal: normal.buffer, color: color.buffer, surface: surface.buffer, ao: ao.buffer, index: indexBuffer };
    self.postMessage({ id, buffers }, Object.values(buffers));
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
