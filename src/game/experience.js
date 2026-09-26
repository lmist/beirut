import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { findOpenPoint } from '../metrics.js';
import { CourierMission, dampAngle } from './mission.js';
import { StreetNavigation } from './navigation.js';
import { CityMap } from './city-map.js';
import { StreetProps } from './street-props.js';
import { DriveSound } from './sound.js';
import { prepareVehicleMaterials } from './vehicle-materials.js';
import { addVehicleWheels } from './vehicle-wheels.js';
import { ResidentPaths, residentObstructed } from './residents.js';
import { JOURNEY_STOPS } from './journey.js';

const SAVE_KEY='beirut-cassette-route-v1';

const $=id=>document.getElementById(id);
export class GameExperience {
  constructor({scene,camera,physics,buildings,prepareLocation,toast,worldMaterials}) {
    this.scene=scene;this.camera=camera;this.physics=physics;this.buildings=buildings;this.prepareLocation=prepareLocation;this.toast=toast;
    this.buildingGrid=new Map();
    for (const b of buildings) for(let x=Math.floor((b[0]-1)/64);x<=Math.floor((b[2]+1)/64);x++) for(let z=Math.floor((b[1]-1)/64);z<=Math.floor((b[3]+1)/64);z++){const key=`${x},${z}`;if(!this.buildingGrid.has(key))this.buildingGrid.set(key,[]);this.buildingGrid.get(key).push(b);}
    this.templates=new Map();this.carModels=[];this.pedModels=[];this.vehicleMeshes=new Map();this.vehicles=[];this.pedestrians=[];
    this.player=null;this.playerHealth=100;this.vehicle=null;this.started=false;this.initialized=false;this.hasPopulated=false;
    this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();this.pedBounds=new THREE.Sphere(new THREE.Vector3(),2.2);
    this.lastLocation=new THREE.Vector3();this.playerPosition=new THREE.Vector3();this.playerHeading=0;this.speed=0;this.cameraInitialized=false;
    this.groundRequests=new Map();this.requestId=0;this.lastHud=0;this.time=0;this.cash=250;this.pedGroundPending=false;this.cameraFocus=new THREE.Vector3();this.populationCenter=null;this.populationBusy=false;this.lastPedGround=0;
    this.sound=new DriveSound();this.props=new StreetProps(scene);
    if(worldMaterials)this.props.applyWorldTextures(worldMaterials.uniforms);
    this.navigation=new StreetNavigation(buildings);this.route=[];this.lastRoute=0;this.mission=new CourierMission();
    this.marker=new THREE.Group();
    const ring=new THREE.Mesh(new THREE.TorusGeometry(5.5,.16,6,40),new THREE.MeshBasicMaterial({color:'#ffc363'}));ring.rotation.x=Math.PI/2;this.marker.add(ring);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(5,5,12,16,1,true),new THREE.MeshBasicMaterial({color:'#ffc363',transparent:true,opacity:.13,depthWrite:false,side:THREE.DoubleSide}));beam.position.y=6;this.marker.add(beam);this.marker.visible=false;scene.add(this.marker);
    this.shadowTexture=this.makeShadow();
    $('interact').onclick=()=>this.interact();$('talk').onclick=()=>this.talk();$('reset-car').onclick=()=>this.resetVehicle();
    $('map-close').onclick=()=>this.map?.toggle();$('map-open').onclick=()=>this.map?.toggle();
    $('sound-toggle').onclick=()=>{$('sound-toggle').textContent=this.sound.toggle()?'SOUND ON':'SOUND OFF';};
  }
  makeShadow(){const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(32,32,5,32,32,30);g.addColorStop(0,'rgba(0,0,0,.16)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
  shadow(width,depth){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));mesh.rotation.x=-Math.PI/2;mesh.position.y=.04;return mesh;}
  async init() {
    const [modelResponse,geoResponse]=await Promise.all([fetch('/assets/game/models.json'),fetch('/data/city-locations.json')]);
    if(!modelResponse.ok)throw new Error('The game models are still being prepared.');
    const assets=await modelResponse.json();this.carModels=[...assets.cars].sort((a,b)=>Number(b.id==='w124_e500')-Number(a.id==='w124_e500'));this.pedModels=assets.peds;
    const geo=geoResponse.ok?await geoResponse.json():{};
    this.map=new CityMap(geo,this.buildings);
    this.props.setContext({roads:geo.roads||[],buildings:this.buildings});
    this.residentPaths=new ResidentPaths(geo.roads||[],this.buildings);
    this.map.onToggle=expanded=>{if(expanded){$('drive-pedal').value='0';$('drive-steering').value='0';}this.physics.postMessage({type:'active',value:!expanded&&this.currentMode==='walk'});};
    const loader=new GLTFLoader();
    await Promise.all([...this.carModels,...this.pedModels].map(async asset=>{
      const gltf=await loader.loadAsync(asset.url);
      const carIndex=this.carModels.findIndex(c=>c.id===asset.id);
      if(carIndex>=0)prepareVehicleMaterials(gltf.scene,asset,carIndex);
      else gltf.scene.traverse(o=>{if(o.isMesh){o.frustumCulled=!o.isSkinnedMesh;const materials=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{if(m.map){m.map.magFilter=THREE.LinearFilter;m.map.anisotropy=4;}return new THREE.MeshStandardMaterial({name:m.name,map:m.map,color:m.color,vertexColors:m.vertexColors,roughness:.88,metalness:0,alphaTest:/hair|lash|brow/i.test(m.name)?.4:0});});o.material=Array.isArray(o.material)?materials:materials[0];}});
      gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      this.templates.set(asset.id,{scene:gltf.scene,animations:gltf.animations,asset});
    }));
    const playerAsset=this.pedModels.find(a=>a.player)||this.pedModels.find(a=>a.id==='urban_male_bmybu')||this.pedModels[0];
    this.player=this.createPed(playerAsset.id);this.player.group.visible=false;
    this.initialized=true;
    this.configureMission(geo);
  }
  configureMission(geo) {
    const preferred=JOURNEY_STOPS;
    const available=[...(geo.landmarks||[]),...(geo.areas||[])];
    const chosen=preferred.map(term=>available.find(p=>p.name?.toLowerCase().includes(term.toLowerCase()))).filter(Boolean);
    const generic=[{name:'Hamra',x:-2458,z:-972.6},{name:'El Wardieh',x:-1914.8,z:-1073.7},{name:'Clémenceau',x:-1822,z:-1260}];
    const lore=["Hamra. A copy for the record shop; the original goes on to Wardieh.","Wardieh. The café owner remembers the song. Take the last copy to Clémenceau.","Clémenceau. The tape is home. Take your time on the way back."];
    const stops=(chosen.length>=3?chosen:generic).map((p,i)=>{
      const open=findOpenPoint(p.x,p.z,this.buildings,4);
      const close=this.buildings.reduce((best,b)=>{const d=Math.hypot((b[0]+b[2])/2-open.x,(b[1]+b[3])/2-open.z);return d<best.d?{d,y:b[4]}:best;},{d:Infinity,y:40});
      return {...p,...open,y:close.y+.15,lore:lore[i]};
    });
    this.mission=new CourierMission(stops);
    try{this.mission.restore(JSON.parse(localStorage.getItem(SAVE_KEY)));}catch{}
    if($('restart-mission'))$('restart-mission').onclick=()=>this.restartMission();
  }
  saveMission(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(this.mission.serialize()));}catch{}}
  restartMission(){this.mission.restart();if(this.vehicle)this.mission.startDriving();this.route=[];this.lastRoute=-Infinity;this.saveMission();this.toast('The Last Cassette · A fresh route through Hamra, Wardieh and Clémenceau.');}
  createPed(id) {
    const template=this.templates.get(id);if(!template)return null;
    const group=new THREE.Group(),model=clone(template.scene);group.add(model);group.add(this.shadow(1.2,.95));this.scene.add(group);
    const mixer=new THREE.AnimationMixer(model),actions={};
    for(const clip of template.animations)actions[clip.name.toLowerCase()]=mixer.clipAction(clip);
    const idle=Object.keys(actions).find(n=>n.includes('idle'));
    if(idle)actions[idle].play();
    return {group,model,mixer,actions,current:idle||'',heading:0};
  }
  animatePed(ped,moving,dt,running=false) {
    if(!ped)return;
    const key=Object.keys(ped.actions).find(n=>n.includes(moving?(running?'run':'walk'):'idle'))||Object.keys(ped.actions).find(n=>n.includes(moving?'walk':'idle'));
    if(key&&key!==ped.current){ped.actions[ped.current]?.fadeOut(.18);ped.actions[key].reset().fadeIn(.18).play();ped.current=key;}
    ped.mixer.update(dt);
  }
  async start(position,yaw) {
    this.started=true;this.cameraInitialized=false;this.focusInitialized=false;this.sound.unlock();
    if(this.player)this.player.group.visible=true;
    this.playerPosition.copy(position);this.lastLocation.copy(position);this.playerHeading=yaw;
    if(this.hasPopulated)return;
    this.hasPopulated=true;
    this.navigation.connect(position);
    for(const stop of this.mission.stops)Object.assign(stop,this.navigation.point(this.navigation.nearest(stop,this.navigation.reachable)));
    await Promise.all(this.mission.stops.map(p=>this.prepareLocation(p.x,p.z)));
    const stopGround=await this.sampleGround(this.mission.stops);
    stopGround.forEach((p,i)=>{if(p.y!=null)this.mission.stops[i].y=p.y+.15;});
    this.populationCenter={x:position.x,z:position.z};
    const candidates=[];
    const parkedModels=this.carModels.slice(0,4);
    // Keep the opening route ahead of the hero car clear. Supporting cars sit
    // along the street behind arrival, where conservative CAD bounds may move them.
    const offsets=parkedModels.map((_,i)=>i===0?[0,4]:[i%2?6:-6,-18-Math.floor((i-1)/2)*14]);
    offsets.forEach(([s,f],i)=>{
      const p=findOpenPoint(position.x+Math.cos(yaw)*s-Math.sin(yaw)*f,position.z-Math.sin(yaw)*s-Math.cos(yaw)*f,this.buildings,3);
      candidates.push({...this.carModels[i%this.carModels.length],id:`mercedes-${i}`,model:this.carModels[i%this.carModels.length].id,...p,yaw});
    });
    await Promise.all(candidates.map(p=>this.prepareLocation(p.x,p.z)));
    this.physics.postMessage({type:'spawn-vehicles',candidates});
    const pedestrians=this.residentPaths.candidates(position,256,145);
    const props=this.props.candidates(position,{radius:145,limit:48,sampleAlternatives:true});
    const residentsReady=this.sampleResidents(pedestrians).then(points=>{
      for(const [i,p] of points.entries())if(p.y!=null&&p.y>-3){
        const ped=this.createPed(this.pedModels[i%this.pedModels.length].id);if(!ped)continue;
        ped.group.position.set(p.x,p.y,p.z);ped.path=p.path;ped.groundY=p.y;ped.walkSpeed=.8+(i%5)*.095;ped.pause=i%4===0?2.5:0;this.pedestrians.push(ped);
      }
    }).catch(()=>{});
    const propsReady=this.sampleGround(props).then(points=>this.props.populate(points,{vehicles:this.vehicles})).catch(()=>{});
    await Promise.all([residentsReady,propsReady]);
    this.toast('Back in Beirut. Your Mercedes is waiting. Press F to get in.');
  }
  sampleGround(points){if(points.length>128){const batches=[];for(let i=0;i<points.length;i+=128)batches.push(this.sampleGround(points.slice(i,i+128)));return Promise.all(batches).then(result=>result.flat());}const requestId=++this.requestId;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.groundRequests.delete(requestId);reject(new Error('Ground lookup timed out'));},15000);this.groundRequests.set(requestId,{resolve:(p)=>{clearTimeout(timeout);resolve(p);}});this.physics.postMessage({type:'sample-ground',requestId,points});});}
  async sampleResidents(candidates) {
    const samples=await this.sampleGround(candidates), selected=[];
    for(const p of samples){
      if(p.surface!==3||p.y==null||p.y<-3||selected.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<7))continue;
      selected.push(p);if(selected.length===24)break;
    }
    const probes=[];
    selected.forEach((point,id)=>{if(point.path)for(let i=0;i<=8;i++)probes.push({x:point.path.a.x+(point.path.b.x-point.path.a.x)*i/8,z:point.path.a.z+(point.path.b.z-point.path.a.z)*i/8,id});});
    if(probes.length){
      const surfaces=await this.sampleGround(probes);
      for(const probe of surfaces)if(probe.surface!==3||probe.y==null||Math.abs(probe.y-selected[probe.id].y)>2)selected[probe.id].path=null;
    }
    return selected;
  }
  async refreshPopulation(position) {
    if(this.populationBusy)return;
    this.populationBusy=true;this.populationCenter={x:position.x,z:position.z};
    try {
      const candidates=await this.sampleResidents(this.residentPaths.candidates(position,256,145));
      const kept=this.pedestrians.filter(ped=>Math.hypot(ped.group.position.x-position.x,ped.group.position.z-position.z)<70);
      const available=candidates.filter(point=>!kept.some(ped=>Math.hypot(point.x-ped.group.position.x,point.z-ped.group.position.z)<7));
      let next=0;
      for(const [i,ped] of this.pedestrians.entries()){
        if(kept.includes(ped))continue;
        const point=available[next++];if(!point)continue;
        ped.path=point.path;ped.groundY=point.y;ped.pause=1+i%3;ped.group.position.set(point.x,point.y,point.z);
      }
      const propPoints=await this.sampleGround(this.props.candidates(position,{radius:145,limit:48,sampleAlternatives:true}));
      this.props.populate(propPoints,{vehicles:this.vehicles});
    } catch {} finally {this.populationBusy=false;}
  }
  onPhysics(data) {
    if(data.type==='ground-samples'){this.groundRequests.get(data.requestId)?.resolve(data.points);this.groundRequests.delete(data.requestId);}
    if(data.vehicles)this.vehicles=data.vehicles;
    if(data.cameraDistance!=null)this.cameraDistance=data.cameraDistance;
    if(data.playerHealth!=null)this.playerHealth=data.playerHealth;
    else if(data.health!=null&&data.type==='position')this.playerHealth=data.health;
    if(data.type==='position'||data.vehicle?.occupied)this.vehicle=data.vehicle?.occupied?data.vehicle:null;
    if(data.type==='vehicle-entered'){
      this.vehicle=data.vehicle;this.cameraInitialized=false;const beginning=this.mission.startDriving();this.saveMission();
      this.toast(this.mission.complete?'Route complete. The afternoon is yours.':beginning?'The Last Cassette · First stop: Hamra. Follow the gold route and stop inside the marker.':`Route resumed · Next stop: ${this.mission.target?.name||'Hamra'}.`);
    }
    if(data.type==='vehicle-exit-denied')this.toast('Stop the car before getting out.');
    if(data.type==='vehicle-reset'||data.type==='vehicle-exited'||data.type==='vehicle-entered'){document.getElementById('drive-pedal').value='0';document.getElementById('drive-steering').value='0';}
    if(data.type==='vehicle-exited'){this.vehicle=null;this.cameraInitialized=false;}
    if(data.type==='vehicle-unavailable'||data.type==='vehicle-enter-denied')this.toast(data.message||'Walk closer to a Mercedes.');
    if(data.type==='damage'||data.type==='vehicle-impact'){this.playerHealth=data.playerHealth??this.playerHealth;document.body.classList.remove('damage');void document.body.offsetWidth;document.body.classList.add('damage');}
    if(data.type==='vehicles'||data.type==='vehicles-spawned')this.syncVehicles();
  }
  syncVehicles() {
    for(const state of this.vehicles) {
      if(this.vehicleMeshes.has(state.id))continue;
      const template=this.templates.get(state.model)||this.templates.get(this.carModels[0]?.id);if(!template)continue;
      const group=new THREE.Group(),model=clone(template.scene);group.add(model);group.add(this.shadow(2.9,5.5));this.scene.add(group);
      group.position.set(state.position.x,state.position.y,state.position.z);group.rotation.y=state.yaw;
      const wheels=addVehicleWheels(model,group,template.asset);
      this.vehicleMeshes.set(state.id,{group,model,wheels});
    }
  }
  interact(){if(!this.started)return;this.sound.unlock();this.physics.postMessage({type:this.vehicle?'exit-vehicle':'enter-vehicle'});}
  talk(){
    if(this.vehicle)return;
    const nearby=this.pedestrians.find(p=>p.group.position.distanceTo(this.playerPosition)<6);
    if(!nearby)return;
    const i=this.pedestrians.indexOf(nearby);
    const lines=[['Nour','The shop changed its sign again. I still call it by the old name.'],['Rami','That cassette? Ask around Hamra. Someone always remembers a song.'],['Maya','A whole city of shortcuts, and I still take the long way home.'],['Karim','The café closes when the conversation ends. Tonight might take a while.']];
    const [name,line]=lines[i%lines.length];nearby.pause=6;this.toast(`${name}: “${line}”`);
  }
  resetVehicle(){this.physics.postMessage({type:'reset-vehicle'});this.toast('Returning the car to the last clear spot.');}
  update(dt,now,{position,yaw,pitch,mode,forward=0,strafe=0,sprint=false}) {
    this.currentMode=mode;
    if(this.map?.expanded)dt=0;
    this.time+=dt;this.syncVehicles();
    for(const state of this.vehicles){const render=this.vehicleMeshes.get(state.id);if(!render)continue;render.group.visible=mode!=='overview'&&render.group.position.distanceToSquared(position)<180*180;render.group.position.lerp(new THREE.Vector3(state.position.x,state.position.y,state.position.z),1-Math.exp(-dt*18));const casting=mode==='walk'&&render.group.position.distanceToSquared(position)<60*60;if(render.casting!==casting){render.casting=casting;render.model.traverse(o=>{if(o.isMesh)o.castShadow=casting;});}if(state.rotation)render.group.quaternion.slerp(new THREE.Quaternion(state.rotation.x,state.rotation.y,state.rotation.z,state.rotation.w),1-Math.exp(-dt*18));else render.group.rotation.y=state.yaw;render.wheels.forEach((wheel,i)=>{const pose=state.wheels?.[i];if(pose){wheel.steering.position.set(pose.x,pose.y,pose.z);wheel.steering.rotation.y=pose.steering;wheel.spin.rotation.x=pose.rotation;}});}
    const driving=!!this.vehicle;
    if(this.player){
      this.player.group.visible=mode==='walk'&&!driving;
      if(mode==='walk') {
        this.playerPosition.copy(position);
        const feetY=position.y-1.62;
        this.player.group.position.set(position.x,feetY,position.z);
        const moved=Math.hypot(position.x-this.lastLocation.x,position.z-this.lastLocation.z);
        if(moved>.002)this.playerHeading=Math.atan2(-(position.x-this.lastLocation.x),-(position.z-this.lastLocation.z));
        this.player.group.rotation.y=dampAngle(this.player.group.rotation.y,this.playerHeading,1-Math.exp(-dt*15));
        this.animatePed(this.player,moved>.004,dt,sprint);this.lastLocation.copy(position);
        const distance=driving?9:5.4,focus=new THREE.Vector3(position.x,position.y-(driving ? .1 : .4),position.z);
        let heading=yaw;
        if(driving){heading=this.vehicle.yaw;this.speed=this.vehicle.speed||0;focus.set(this.vehicle.position.x,this.vehicle.position.y+1.0,this.vehicle.position.z);}
        const height=driving?2.4:1.2+Math.sin(-pitch)*2.5;
        const safeDistance=Math.min(distance,this.cameraDistance||distance);
        const desired=new THREE.Vector3(focus.x+Math.sin(heading)*safeDistance,focus.y+height*(driving?safeDistance/distance:1),focus.z+Math.cos(heading)*safeDistance);
        if(!this.cameraInitialized){this.camera.position.copy(desired);this.cameraInitialized=true;}
        else this.camera.position.lerp(desired,1-Math.exp(-dt*(driving?7:16)));
        if(!this.focusInitialized){this.cameraFocus.copy(focus);this.focusInitialized=true;}
        this.cameraFocus.lerp(focus,1-Math.exp(-dt*(driving?10:20)));
        this.camera.lookAt(this.cameraFocus);
        const desiredFov=driving?56+Math.min(5,Math.abs(this.speed)*.18):55;
        if(Math.abs(this.camera.fov-desiredFov)>.01){this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,desiredFov,1-Math.exp(-dt*3));this.camera.updateProjectionMatrix();}
      }
    }
    if(mode==='walk'&&this.populationCenter&&Math.hypot(position.x-this.populationCenter.x,position.z-this.populationCenter.z)>125)this.refreshPopulation(position);
    if(mode==='walk'&&!this.pedGroundPending&&now-this.lastPedGround>800&&this.pedestrians.length){
      this.lastPedGround=now;this.pedGroundPending=true;
      this.sampleGround(this.pedestrians.map(p=>({x:p.group.position.x,z:p.group.position.z}))).then(points=>points.forEach((p,i)=>{if(p.y!=null&&this.pedestrians[i])this.pedestrians[i].groundY=p.y;})).catch(()=>{}).finally(()=>{this.pedGroundPending=false;});
    }
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse));
    for(const [i,ped] of this.pedestrians.entries()) {
      if(ped.groundY!=null)ped.group.position.y=THREE.MathUtils.lerp(ped.group.position.y,ped.groundY,1-Math.exp(-dt*9));
      const near=ped.group.position.distanceToSquared(position)<180*180;ped.group.visible=near;
      const casting=mode==='walk'&&ped.group.position.distanceToSquared(position)<60*60;if(ped.casting!==casting){ped.casting=casting;ped.model.traverse(o=>{if(o.isMesh)o.castShadow=casting;});}
      if(!near)continue;
      let moving=false;
      if(mode==='walk'&&ped.path&&dt>0){
        if(ped.pause>0)ped.pause=Math.max(0,ped.pause-dt);
        else{
          const path=ped.path,length=Math.hypot(path.b.x-path.a.x,path.b.z-path.a.z);
          const t=THREE.MathUtils.clamp(path.t+path.direction*ped.walkSpeed*dt/Math.max(1,length),0,1);
          const next={x:path.a.x+(path.b.x-path.a.x)*t,z:path.a.z+(path.b.z-path.a.z)*t,y:ped.group.position.y};
          const neighbours=this.pedestrians.filter(other=>other!==ped&&other.group.position.distanceToSquared(ped.group.position)<4).map(other=>other.group.position);
          const blocked=!this.residentPaths.clear(next.x,next.z)||residentObstructed(next,driving?null:this.playerPosition,this.vehicles,neighbours);
          if(!blocked){path.t=t;ped.group.position.x=next.x;ped.group.position.z=next.z;moving=true;}
          else ped.pause=.5;
          const heading=Math.atan2(-(path.b.x-path.a.x)*path.direction,-(path.b.z-path.a.z)*path.direction);
          ped.group.rotation.y=dampAngle(ped.group.rotation.y,heading,1-Math.exp(-dt*6));
          if(t===0||t===1){path.direction*=-1;ped.pause=1.2+(i%4)*.65;}
        }
      }
      this.pedBounds.center.copy(ped.group.position);this.pedBounds.center.y+=.9;
      ped.group.visible=this.frustum.intersectsSphere(this.pedBounds);
      if(ped.group.visible)this.animatePed(ped,moving,dt);
    }
    const target=this.mission.target;
    if(target&&mode==='walk'&&now-this.lastRoute>1800){this.lastRoute=now;this.route=this.navigation.route(position,target);}
    this.marker.visible=mode==='walk'&&!!target;
    if(target){this.marker.position.set(target.x,target.y,target.z);this.marker.rotation.y=this.time*.3;}
    if(mode==='walk') {
      const arrived=driving&&this.vehicle.grounded&&Math.abs(this.vehicle.position.y-(target?.y||0))<4?this.mission.arrive(position.x,position.z,this.speed):null;
      if(arrived){this.saveMission();this.route=[];this.lastRoute=-Infinity;this.toast(arrived.lore);$('mission-banner').textContent=arrived.complete?'ROUTE COMPLETE · +$650':'TAPE DELIVERED · +$150';$('mission-banner').classList.remove('show');void $('mission-banner').offsetWidth;$('mission-banner').classList.add('show');}
    }
    this.sound.update(this.speed,driving&&mode==='walk',forward>0,{active:mode==='walk'&&!this.map?.expanded});
    if(now-this.lastHud>100){this.lastHud=now;this.updateHud(position,yaw,mode);}
  }
  updateHud(position,yaw,mode) {
    const driving=!!this.vehicle,target=this.mission.target;
    document.body.classList.toggle('driving',driving&&mode==='walk');
    $('game-hud').hidden=mode==='overview';
    const health=Math.round(Math.max(0,Math.min(100,this.playerHealth)));$('health-fill').style.width=`${health}%`;$('health-number').textContent=health;$('health-meter').setAttribute('aria-valuenow',health);
    $('cash').textContent=`$${String(this.mission.cash).padStart(6,'0')}`;
    const minutes=17*60+20+Math.floor(this.time/60);$('game-clock').textContent=`${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
    $('mission-title').textContent=this.mission.title;
    $('mission-detail').textContent=this.mission.complete?'Route saved · explore Beirut at your own pace':target?`Take the cassette to ${target.name}`:'Get into the Mercedes. Someone left a tape on the seat.';
    const next=this.route[1]||target;
    if(next&&driving){const bearing=Math.atan2(-(next.x-position.x),-(next.z-position.z));const angle=Math.atan2(Math.sin(bearing-this.vehicle.yaw),Math.cos(bearing-this.vehicle.yaw))*180/Math.PI;$('route-direction').textContent=`${Math.abs(angle)<3?'Straight':angle>0?'Left '+Math.round(angle)+'°':'Right '+Math.round(-angle)+'°'} · ${Math.round(Math.hypot(next.x-position.x,next.z-position.z))} m to next turn`;}else $('route-direction').textContent='';
    $('objective-distance').textContent=target?`${Math.round(Math.hypot(position.x-target.x,position.z-target.z))} m`:'';
    $('speedometer').hidden=!driving||mode!=='walk';$('speed-number').textContent=String(Math.round(Math.abs(this.speed)*3.6)).padStart(3,'0');
    $('car-name').textContent=driving?(this.carModels.find(c=>c.id===this.vehicle.model)?.name||'Mercedes-Benz'):'';
    $('car-health-fill').style.width=`${this.vehicle?.health??100}%`;
    $('reset-car').hidden=!driving;
    const near=this.vehicles.find(v=>Math.hypot(v.position.x-position.x,v.position.z-position.z)<5.5&&Math.abs(v.position.y-position.y)<3.5);
    $('interact').hidden=mode!=='walk'||(!driving&&!near);
    $('talk').hidden=mode!=='walk'||driving||!!near||!this.pedestrians.some(p=>p.group.position.distanceTo(position)<6);
    $('interact-label').textContent=driving?'EXIT MERCEDES':`ENTER ${near?(this.carModels.find(c=>c.id===near.model)?.name||'MERCEDES').toUpperCase():'MERCEDES'}`;
    this.map?.draw(position,driving?this.vehicle.yaw:yaw,{vehicles:this.vehicles,target,driving,overview:mode==='overview',route:this.route});
  }
  diagnostics(){return{started:this.started,cars:this.vehicles.length,carModels:this.carModels.length,pedModels:this.pedModels.length,pedestrians:this.pedestrians.length,residentPaths:this.pedestrians.filter(p=>p.path).length,savedProgress:this.mission.index>=0,driving:!!this.vehicle,speed:this.speed,playerHealth:this.playerHealth,vehicleHealth:this.vehicle?.health??null,missionStage:this.mission.index,missionComplete:this.mission.complete,location:this.map?.locate(this.playerPosition.x,this.playerPosition.z)};}
}
