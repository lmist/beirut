import * as THREE from 'three';

// RenderWare supplies one wheel mesh and axle frames for the game to instance it.
export function addVehicleWheels(model, vehicle, asset) {
  vehicle.updateMatrixWorld(true);
  let source=null;
  model.traverse(object=>{if(!source && /^wheel(?:[_ .]|$)/i.test(object.name) && !/dummy/i.test(object.name) && (object.isMesh||object.children.some(c=>c.isMesh)))source=object;});
  const template=new THREE.Group(),bounds=new THREE.Box3(),inverse=vehicle.matrixWorld.clone().invert();
  if(source)source.traverse(object=>{
    if(!object.isMesh)return;
    const geometry=object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld));
    geometry.computeBoundingBox();bounds.union(geometry.boundingBox);
    template.add(new THREE.Mesh(geometry,object.material));
  });
  const radius=asset.wheelRadius||.34;
  if(!bounds.isEmpty()) {
    const center=bounds.getCenter(new THREE.Vector3());
    for(const mesh of template.children)mesh.geometry.translate(-center.x,-center.y,-center.z);
  } else {
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,.23,24),new THREE.MeshStandardMaterial({color:'#17191b',roughness:.94}));
    tire.rotation.z=Math.PI/2;template.add(tire);
    for(const side of [-1,1]) {
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(radius*.68,radius*.68,.015,16),new THREE.MeshStandardMaterial({color:'#b4b8bc',metalness:.75,roughness:.25}));
      rim.rotation.z=Math.PI/2;rim.position.x=side*.12;template.add(rim);
    }
  }
  model.traverse(object=>{if(/^wheel(?:[_ .]|$)/i.test(object.name))object.visible=false;});
  const positions=asset.wheels?.length===4?asset.wheels:[-1,1].flatMap(z=>[-1,1].map(x=>({x:x*asset.dimensions.x*.39,y:radius,z:z*asset.dimensions.z*.3})));
  return positions.map(p=>{
    const steering=new THREE.Group(),spin=new THREE.Group(),mesh=template.clone();
    if(p.x<0)mesh.rotation.y=Math.PI;
    spin.add(mesh);steering.add(spin);steering.position.set(p.x,p.y,p.z);vehicle.add(steering);
    return {steering,spin};
  });
}
