const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const yawRotation = yaw => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
export function rotateVector(v, q) {
  const tx=2*(q.y*v.z-q.z*v.y), ty=2*(q.z*v.x-q.x*v.z), tz=2*(q.x*v.y-q.y*v.x);
  return {x:v.x+q.w*tx+q.y*tz-q.z*ty,y:v.y+q.w*ty+q.z*tx-q.x*tz,z:v.z+q.w*tz+q.x*ty-q.y*tx};
}

/** Dynamic chassis and four independent suspension rays. Units are metres, kg, seconds. */
export function createVehicle(RAPIER, world, candidate, groundY) {
  const raw=candidate.dimensions||{};
  const dimensions={x:clamp(Number(raw.x)||1.9,1,4),y:clamp(Number(raw.y)||1.5,.8,4),z:clamp(Number(raw.z)||4.85,2,9)};
  const radius=clamp(Number(candidate.wheelRadius)||.34,.22,.55), mass=clamp(Number(candidate.mass)||1750,700,4000);
  const rest=.24, rideHeight=.56;
  const wheels=candidate.wheels?.length===4?candidate.wheels:[-1,1].flatMap(z=>[-1,1].map(x=>({x:x*dimensions.x*.39,y:radius,z:z*dimensions.z*.3})));
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(candidate.x,groundY+rideHeight+.08,candidate.z).setRotation(yawRotation(candidate.yaw||0)).setLinearDamping(.04).setAngularDamping(.8).setCcdEnabled(true).setAdditionalSolverIterations(4));
  const halfHeight=Math.max(.18,(dimensions.y-.38)*.5);
  const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(dimensions.x*.43,halfHeight,dimensions.z*.46).setTranslation(0,.38+halfHeight-rideHeight,0).setMass(mass).setFriction(.35).setRestitution(.05).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(mass*4),body);
  // The chassis mass sits at sill height; the upper collision shell remains full-sized.
  collider.setMassProperties(mass,{x:0,y:0,z:0},{x:mass*(dimensions.z**2+dimensions.y**2)/12,y:mass*(dimensions.x**2+dimensions.z**2)/12,z:mass*(dimensions.x**2+dimensions.y**2)/12},{x:0,y:0,z:0,w:1});
  const controller=world.createVehicleController(body);controller.indexUpAxis=1;controller.setIndexForwardAxis=2;
  for(let i=0;i<4;i++) {
    const wheel=wheels[i];
    controller.addWheel({x:wheel.x,y:radius+rest-rideHeight,z:wheel.z},{x:0,y:-1,z:0},{x:-1,y:0,z:0},rest,radius);
    controller.setWheelSuspensionStiffness(i,32);controller.setWheelSuspensionCompression(i,4.4);controller.setWheelSuspensionRelaxation(i,5.2);
    controller.setWheelMaxSuspensionTravel(i,.22);controller.setWheelMaxSuspensionForce(i,mass*18);
    controller.setWheelFrictionSlip(i,1.8);controller.setWheelSideFrictionStiffness(i,1);
  }
  return {body,collider,controller,dimensions,wheels,radius,mass,rest,rideHeight,halfHeight,steering:0,speed:0,yaw:candidate.yaw||0,grounded:false,impactCooldown:0};
}
export function vehiclePose(vehicle) {
  const q=vehicle.body.rotation(),p=vehicle.body.translation(),offset=rotateVector({x:0,y:-vehicle.rideHeight,z:0},q),forward=rotateVector({x:0,y:0,z:-1},q),velocity=vehicle.body.linvel();
  vehicle.speed=velocity.x*forward.x+velocity.y*forward.y+velocity.z*forward.z;
  vehicle.yaw=Math.atan2(-forward.x,-forward.z);
  vehicle.grounded=[0,1,2,3].some(i=>vehicle.controller.wheelIsInContact(i));
  return {position:{x:p.x+offset.x,y:p.y+offset.y,z:p.z+offset.z},rotation:{...q},yaw:vehicle.yaw,speed:vehicle.speed,grounded:vehicle.grounded,
    wheels:vehicle.wheels.map((w,i)=>({x:w.x,y:vehicle.radius+vehicle.rest-(vehicle.controller.wheelSuspensionLength(i)??vehicle.rest),z:w.z,steering:vehicle.controller.wheelSteering(i)||0,rotation:vehicle.controller.wheelRotation(i)||0,radius:vehicle.radius}))};
}
export function stepVehicleForces(vehicle, input, dt, occupied=true, filter) {
  const speed=vehiclePose(vehicle).speed, c=vehicle.controller;
  const throttle=occupied?clamp((Number(input.forward)||0)-(Number(input.backward)||0),-1,1):0;
  const steering=occupied?clamp((Number(input.left)||0)-(Number(input.right)||0),-1,1):0;
  const opposite=throttle*speed<-.5;
  const maxAngle=.5/(1+Math.abs(speed)*.055),target=steering*maxAngle;
  vehicle.steering+=clamp(target-vehicle.steering,-dt*1.8,dt*1.8);
  const braking=!occupied||input.brake||opposite||vehicle.health===0;
  const drive=braking?0:-throttle*vehicle.mass*6.5/(1+(Math.abs(speed)/27)**2);
  if(throttle||steering||braking&&Math.abs(speed)>.02)vehicle.body.wakeUp();
  vehicle.body.resetForces(false);
  const vel=vehicle.body.linvel(),drag=.42*Math.hypot(vel.x,vel.z);
  vehicle.body.addForce({x:-vel.x*drag,y:0,z:-vel.z*drag},false);
  for(let i=0;i<4;i++) {
    const front=vehicle.wheels[i].z<0;
    c.setWheelSteering(i,front?vehicle.steering:0);
    c.setWheelEngineForce(i,drive/4);
    c.setWheelBrake(i,braking?vehicle.mass*9*dt/4:input.handbrake&&!front?vehicle.mass*12*dt/2:vehicle.mass*.12*dt/4);
    c.setWheelFrictionSlip(i,input.handbrake&&!front?.8:1.8);
  }
  c.updateVehicle(dt,undefined,undefined,collider=>collider.parent()?.handle!==vehicle.body.handle&&(!filter||filter(collider)));
  vehicle.impactCooldown=Math.max(0,vehicle.impactCooldown-dt);
}
