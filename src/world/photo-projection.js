import { fromEastNorth } from '../game/georeference.js';

export function validatePhotoRegistration(manifest,registration) {
  if(manifest.registrationVersion!==registration.version)throw new Error('Rebuild photographic textures for the current geographic registration.');
  const source=manifest.registration;
  if(source&&['angleDeg','translationEast','translationNorth','scale','zSign','anchorLat','anchorLon'].some(key=>source[key]!==registration[key])) {
    throw new Error('Photographic textures use a different geographic transform.');
  }
}

export function photoSlots(tile) {
  return new Map(Object.keys(tile?.cells || {}).map(Number).sort((a,b)=>a-b).map((id,i)=>[id,i+1]));
}

/** A square pinhole camera. Street View heading is geographic, pitch is upward. */
export function photoCamera(record, registration) {
  const heading=record.headingDeg*Math.PI/180, pitch=record.pitchDeg*Math.PI/180;
  const direction=fromEastNorth(registration.translationEast+Math.sin(heading),registration.translationNorth+Math.cos(heading),registration);
  const length=Math.hypot(direction.x,direction.z), x=direction.x/length,z=direction.z/length;
  return {
    position:record.camera,
    right:[-z,0,x],
    forward:[x*Math.cos(pitch),Math.sin(pitch),z*Math.cos(pitch)],
    up:[-x*Math.sin(pitch),Math.cos(pitch),-z*Math.sin(pitch)],
    tangent:Math.tan(record.fovDeg*Math.PI/360),
  };
}

export function projectPhoto(point, camera) {
  const delta=point.map((v,i)=>v-camera.position[i]);
  const dot=v=>v.reduce((sum,x,i)=>sum+x*delta[i],0);
  const depth=dot(camera.forward);
  return [.5+.5*dot(camera.right)/(camera.tangent*depth),.5-.5*dot(camera.up)/(camera.tangent*depth),depth];
}

export function photoMetadata(tile, buildings, registration) {
  const slots=photoSlots(tile), height=slots.size+1;
  const pixels=new Float32Array(6*height*4);
  for(const [id,slot] of slots) {
    const source=buildings[id];
    if(!source)continue;
    const camera=photoCamera(source,registration), start=slot*24;
    pixels.set([...camera.position,source.confidence??1],start);
    pixels.set([...camera.right,camera.tangent],start+4);
    pixels.set([...camera.forward,0],start+8);
    pixels.set([...camera.up,0],start+12);
    pixels.set(tile.cells[id],start+16);
    pixels.set([...(source.color||[1,1,1]),1],start+20);
  }
  return {pixels,width:6,height};
}
