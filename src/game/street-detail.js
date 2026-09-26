/** Visual curb estimates in metres. These are deliberately conservative; the
 * road data contains centre lines, not surveyed sidewalk polygons. */
export function roadHalfWidth(highway) {
  return ({motorway:7,trunk:7,primary:5.5,secondary:4.8,tertiary:4,residential:3.2,
    unclassified:3.2,living_street:3.2,service:2.6,pedestrian:1.8,footway:1.8})[highway]??3.2;
}

export function streetSeed(value) {
  let seed=2166136261;
  for(const character of String(value))seed=Math.imul(seed^character.charCodeAt(0),16777619);
  return seed>>>0;
}

export function distanceToRoad(x,z,segment) {
  const dx=segment.bx-segment.ax,dz=segment.bz-segment.az;
  const t=Math.max(0,Math.min(1,((x-segment.ax)*dx+(z-segment.az)*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(x-segment.ax-t*dx,z-segment.az-t*dz);
}

const FOOTPRINT={lamp:.24,tree:.85,palm:.9,shrub:.65,bench:1.15};
const KINDS=['lamp','tree','shrub','bench','lamp','palm','tree','shrub'];
const CELL=64;
const cellKey=(x,z)=>`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;

/** Only the mesh raycast can distinguish a sidewalk from a broad carriageway.
 * Pick one clear measured position per placement after those samples return. */
export function selectStreetSamples(points,{limit=64,vehicles=[]}={}) {
  limit=Math.min(64,Math.max(0,Math.floor(limit)));
  if(!limit)return [];
  const selected=[],seen=new Set();
  for(const point of points) {
    if(!Number.isFinite(point.y)||point.y<=-3||(point.surface!=null&&point.surface!==3))continue;
    const id=point.placementId??point.id;
    if(id!=null&&seen.has(id))continue;
    if(selected.some(other=>Math.hypot(other.x-point.x,other.z-point.z)<7))continue;
    const radius=FOOTPRINT[point.kind]??.85;
    const overlapsVehicle=vehicles.some(vehicle=>{
      const p=vehicle.position??vehicle;
      if(!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.abs((p.y??point.y)-point.y)>3)return false;
      const dx=point.x-p.x,dz=point.z-p.z,yaw=vehicle.yaw??0;
      const across=dx*Math.cos(yaw)-dz*Math.sin(yaw),along=dx*Math.sin(yaw)+dz*Math.cos(yaw);
      return Math.abs(across)<1.25+radius+.3&&Math.abs(along)<2.8+radius+.3;
    });
    if(overlapsVehicle)continue;
    selected.push(point);if(id!=null)seen.add(id);
    if(selected.length>=limit)break;
  }
  return selected;
}

/** Deterministic, bounded street furniture placement. No changes to source
 * buildings or road surfaces, and no inference of unobserved facade features. */
export class StreetDetailLayout {
  constructor({roads=[],buildings=[]}={}) {
    this.roadGrid=new Map();this.buildingGrid=new Map();this.segments=[];
    const insert=(grid,item,minX,minZ,maxX,maxZ)=>{
      for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++){
        const key=`${x},${z}`;
        if(!grid.has(key))grid.set(key,[]);
        grid.get(key).push(item);
      }
    };
    for(const b of buildings)insert(this.buildingGrid,b,b[0]-3,b[1]-3,b[2]+3,b[3]+3);
    for(const [index,road] of roads.entries()) {
      const points=road.points||[];
      for(let i=1;i<points.length;i++) {
        const [ax,az]=points[i-1],[bx,bz]=points[i];
        const length=Math.hypot(bx-ax,bz-az);
        if(length<1)continue;
        const segment={road,ax,az,bx,bz,length,half:roadHalfWidth(road.highway),id:`${road.id??index}:${i}`};
        this.segments.push(segment);
        insert(this.roadGrid,segment,Math.min(ax,bx)-12,Math.min(az,bz)-12,Math.max(ax,bx)+12,Math.max(az,bz)+12);
      }
    }
  }
  clear(x,z,radius=.85) {
    for(const b of this.buildingGrid.get(cellKey(x,z))||[]) {
      if(x>b[0]-radius-.35&&x<b[2]+radius+.35&&z>b[1]-radius-.35&&z<b[3]+radius+.35)return false;
    }
    for(const s of this.roadGrid.get(cellKey(x,z))||[]) {
      if(distanceToRoad(x,z,s)<s.half+radius+.25)return false;
    }
    return true;
  }
  candidates(position,{radius=145,limit=48,sampleAlternatives=false}={}) {
    limit=Math.min(64,Math.max(0,Math.floor(limit)));
    if(!limit||!Number.isFinite(radius)||radius<=0)return [];
    const segments=new Set();
    for(let x=Math.floor((position.x-radius)/CELL);x<=Math.floor((position.x+radius)/CELL);x++)for(let z=Math.floor((position.z-radius)/CELL);z<=Math.floor((position.z+radius)/CELL);z++){
      for(const segment of this.roadGrid.get(`${x},${z}`)||[])segments.add(segment);
    }
    const candidates=[];
    for(const s of segments) {
      if(s.road.bridge||s.road.tunnel||['motorway','trunk','steps','path','cycleway'].includes(s.road.highway))continue;
      const tx=(s.bx-s.ax)/s.length,tz=(s.bz-s.az)/s.length;
      const phase=7+streetSeed(s.id)%11;
      for(let distance=phase,n=0;distance<s.length-5;distance+=17,n++)for(const side of [-1,1]) {
        const id=`${s.id}:${n}:${side}`,seed=streetSeed(id),kind=KINDS[seed%KINDS.length];
        const footprint=FOOTPRINT[kind],baseOffset=s.half+footprint+.65;
        // Local +Z points toward the street, and +X follows its edge.
        const yaw=Math.atan2(tz*side,-tx*side);
        const alternatives=[];
        for(const lateralOffset of sampleAlternatives?[0,2,4,6]:[0]) {
          const offset=baseOffset+lateralOffset;
          const x=s.ax+tx*distance-tz*side*offset,z=s.az+tz*distance+tx*side*offset;
          const range=Math.hypot(x-position.x,z-position.z);
          if(range>radius||!this.clear(x,z,footprint))continue;
          alternatives.push({x,z,yaw,kind,seed,id:sampleAlternatives?`${id}@${lateralOffset}`:id,
            placementId:id,lateralOffset,street:s.road.name||'',streetAr:s.road.nameAr||'',range});
        }
        if(alternatives.length)candidates.push({...alternatives[0],alternatives});
      }
    }
    candidates.sort((a,b)=>a.range-b.range||a.id.localeCompare(b.id));
    const selected=[],samples=[];
    for(const candidate of candidates) {
      if(selected.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<7))continue;
      selected.push(candidate);
      samples.push(...candidate.alternatives.slice(0,128-samples.length));
      if(samples.length>=128)break;
      if(selected.length>=limit)break;
    }
    return samples;
  }
}
