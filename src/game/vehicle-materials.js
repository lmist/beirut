import * as THREE from 'three';

const PAINT=['#315967','#ded3bb','#33454e','#8b969c','#445a65','#46535e','#735650','#45404a','#23313e','#526774','#343c47'];
export function prepareVehicleMaterials(model, asset, index=0) {
  model.traverse(object=>{
    if(!object.isMesh)return;
    const materials=(Array.isArray(object.material)?object.material:[object.material]).map(source=>{
      const name=source.name||'',part=object.name||'';
      const paint=/^(primary|secondary|body(?:\.\d+)?|remap(?:\.\d+)?)$/i.test(name)||asset.id==='mercedes_sprinter'&&/vehiclegrunge/.test(name);
      const tire=/tyre|tire|rubber/i.test(name);
      const glass=!paint&&!tire&&(/glass|windscreen|window|steklo/i.test(name)||/glass|windscreen|window/i.test(part)&&!/interior|light/i.test(name)||asset.id==='w124_e500'&&/door/i.test(part)&&/vehiclegeneric/i.test(name));
      const interior=/interior|leather|leater|lether|carpet|carpback|cloth|velure|alcantara|seat|dash/i.test(name);
      const chrome=/chrome|badge|grille|rim|disc|124gr/i.test(name)||/wheel/i.test(part)&&/vehiclegeneric/i.test(name);
      const untexturedTrim=!source.map&&!paint&&!tire&&!glass&&!chrome&&/vehiclegeneric|carpback/i.test(name);
      const lamp=/vehiclelights/i.test(name);
      const color=source.color.clone();
      if(paint)color.set(PAINT[index%PAINT.length]);
      else if(tire)color.set('#222326');
      else if(glass)color.set('#3d5864');
      else if(chrome&&!source.map)color.set('#aab2b1');
      else if(untexturedTrim)color.set('#293030');
      else if(lamp&&!source.map)color.set(/rear|boot/i.test(part)?'#8b2620':'#d4d5bd');
      else if(!source.map&&interior)color.set('#333335');
      // GTA body-texture alpha is also used for gloss; only glazing is transparent.
      const Material = paint || glass ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
      const material=new Material({name,map:glass?null:source.map,color,vertexColors:!paint&&!tire&&!glass&&source.vertexColors,metalness:paint?.48:chrome?.92:glass?0:.08,roughness:glass?.08:paint?.28:chrome?.2:.8,transparent:glass,opacity:glass?.46:1,depthWrite:!glass,side:THREE.DoubleSide,envMapIntensity:glass?1.15:paint?.8:.65});
      if(paint){material.clearcoat=.9;material.clearcoatRoughness=.19;}
      if(glass){material.ior=1.5;material.clearcoat=1;material.clearcoatRoughness=.06;}
      if(material.map){material.map.magFilter=THREE.LinearFilter;material.map.anisotropy=4;}
      return material;
    });
    object.material=Array.isArray(object.material)?materials:materials[0];
  });
}
