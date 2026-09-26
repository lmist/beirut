import * as THREE from 'three';

// The visible sun, city material, water highlights and actor shadows share this
// direction. It is an art-directed late-afternoon setup, not a solar ephemeris.
export const SUN_DIRECTION = new THREE.Vector3(-.68,.46,.57).normalize();

function createEnvironment(renderer) {
  const environmentScene=new THREE.Scene();
  const geometry=new THREE.SphereGeometry(40,48,24);
  const position=geometry.getAttribute('position');
  const colors=new Float32Array(position.count*3);
  const direction=new THREE.Vector3(),color=new THREE.Color();
  const horizon=new THREE.Color().setRGB(.64,.70,.73);
  const zenith=new THREE.Color().setRGB(.18,.35,.60);
  const ground=new THREE.Color().setRGB(.16,.13,.10);
  for(let i=0;i<position.count;i++) {
    direction.fromBufferAttribute(position,i).normalize();
    if(direction.y>=0)color.copy(horizon).lerp(zenith,Math.pow(direction.y,.55));
    else color.copy(horizon).lerp(ground,Math.min(1,-direction.y*5));
    const glow=Math.pow(Math.max(0,direction.dot(SUN_DIRECTION)),64)*1.8;
    color.r+=glow;color.g+=glow*.79;color.b+=glow*.52;
    color.toArray(colors,i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,toneMapped:false});
  environmentScene.add(new THREE.Mesh(geometry,material));
  const generator=new THREE.PMREMGenerator(renderer);
  const environment=generator.fromScene(environmentScene,.04,.1,100);
  generator.dispose();geometry.dispose();material.dispose();
  return environment;
}

/** A single, bounded shadow pass follows street play; aerial view reuses it. */
export function createDaylight(scene,renderer,uniforms) {
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFShadowMap;

  const sun=new THREE.DirectionalLight('#ffead0',2.1);
  sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-220,right:220,top:220,bottom:-220,near:10,far:1200});
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias=-.00015;
  sun.shadow.normalBias=.28;
  sun.shadow.radius=2.0;
  // Allocate a valid shadow target on the first aerial frame as well. Three's
  // lit material bindings need it before the first street-level shadow pass.
  sun.shadow.needsUpdate=true;
  const hemisphere=new THREE.HemisphereLight('#d5e6f4','#988675',1.35);
  scene.add(sun,sun.target,hemisphere);
  const environment=createEnvironment(renderer);
  scene.environment=environment.texture;
  scene.environmentIntensity=.65;
  scene.fog=new THREE.Fog(uniforms.uFogColor.value,uniforms.uFogNear.value,uniforms.uFogFar.value);
  uniforms.uSunDirection?.value.copy(SUN_DIRECTION);
  const center=new THREE.Vector3();
  const shadowRight=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),SUN_DIRECTION).normalize();
  const shadowUp=new THREE.Vector3().crossVectors(SUN_DIRECTION,shadowRight).normalize();
  let quality='auto',wasActive=false;

  function setQuality(value) {
    quality=value;
    const size=value==='performance'?1024:2048;
    if(sun.shadow.mapSize.x!==size) {
      sun.shadow.mapSize.set(size,size);
      sun.shadow.map?.dispose();
      sun.shadow.map=null;
      sun.shadow.needsUpdate=true;
    }
    if(uniforms.uRetro)uniforms.uRetro.value=Number(value==='ps2');
  }

  function update(position,overview=false) {
    const active=!overview&&quality!=='ps2';
    // Snap in the light's projection plane to keep shadow texels stationary
    // across camera movement, including diagonal streets and sloped terrain.
    // Shadow rendering itself is frustum-culled by Three to this 440m box.
    if(active) {
      const texel=440/sun.shadow.mapSize.x;
      center.copy(position);
      const x=center.dot(shadowRight),y=center.dot(shadowUp);
      center.addScaledVector(shadowRight,Math.round(x/texel)*texel-x);
      center.addScaledVector(shadowUp,Math.round(y/texel)*texel-y);
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(SUN_DIRECTION,650);
      uniforms.uShadowCenter?.value.copy(center);
    } else if(!wasActive) {
      sun.position.copy(center).addScaledVector(SUN_DIRECTION,650);
    }
    sun.shadow.autoUpdate=active;
    if(active&&!wasActive)sun.shadow.needsUpdate=true;
    if(uniforms.uShadowStrength)uniforms.uShadowStrength.value=Number(active);
    scene.fog.color.copy(uniforms.uFogColor.value);
    scene.fog.near=uniforms.uFogNear.value;
    scene.fog.far=uniforms.uFogFar.value;
    wasActive=active;
  }

  update(center,true);
  return {
    sun,hemisphere,update,setQuality,
    dispose(){scene.remove(sun,sun.target,hemisphere);sun.dispose();environment.dispose();if(scene.environment===environment.texture)scene.environment=null;},
  };
}
