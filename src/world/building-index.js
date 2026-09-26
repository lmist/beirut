/** Spatial lookup for floor height; the source meshes remain unchanged. */
export function createBuildingIndex(buildings, cellSize = 64, groundHeights = null) {
  const grid = new Map();
  const key = (x, z) => x * 65536 + z;
  for (const [id,source] of buildings.entries()) {
    const b=[...source,groundHeights?.[id]??source[4],id];
    for (let x = Math.floor((b[0]-.04)/cellSize); x <= Math.floor((b[2]+.04)/cellSize); x++) {
      for (let z = Math.floor((b[1]-.04)/cellSize); z <= Math.floor((b[3]+.04)/cellSize); z++) {
        const k = key(x,z);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
    }
  }
  for (const candidates of grid.values()) candidates.sort((a,b) => (a[2]-a[0])*(a[3]-a[1]) - (b[2]-b[0])*(b[3]-b[1]));
  return {
    at(x,y,z) {
      const candidates = grid.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize)));
      if (candidates) for (const b of candidates) {
        if (x>=b[0]-.04 && x<=b[2]+.04 && z>=b[1]-.04 && z<=b[3]+.04 && y>=b[4]-.08 && y<=b[5]+.08) return b;
      }
      return null;
    },
    triangleAt(position,a,b,c) {
      const x=(position[a*3]+position[b*3]+position[c*3])/3;
      const y=(position[a*3+1]+position[b*3+1]+position[c*3+1])/3;
      const z=(position[a*3+2]+position[b*3+2]+position[c*3+2])/3;
      const candidates=grid.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize)));
      // A centroid alone can land inside a smaller overlapping building's
      // bounding box and give adjacent triangles different floors/styles.
      if(candidates)for(const bld of candidates) {
        if([a,b,c].every(i=>position[i*3]>=bld[0]-.08&&position[i*3]<=bld[2]+.08&&position[i*3+2]>=bld[1]-.08&&position[i*3+2]<=bld[3]+.08&&position[i*3+1]>=bld[4]-.08&&position[i*3+1]<=bld[5]+.08))return bld;
      }
      return this.at(x,y,z);
    },
    baseAt(x,y,z) { return this.at(x,y,z)?.[6]??y; },
  };
}

export function buildingPhotoSlots(position, surface, index, buildings, slots, seeds = null, frames = null, architecture = null, architectureIds = new Set(), replacementIds = new Set()) {
  const photoSlot=new Float32Array(surface.length);
  for(let i=0;i<index.length;i+=3) {
    const a=index[i],b=index[i+1],c=index[i+2];
    if(surface[a]!==5||surface[b]!==5||surface[c]!==5)continue;
    const building=buildings.triangleAt(position,a,b,c);
    const slot=building?slots.get(building[7])||0:0;
    photoSlot[a]=photoSlot[b]=photoSlot[c]=slot;
    if(seeds&&building) {
      const seed=(Math.imul(building[7]+1,2654435761)>>>24);
      seeds[a]=seeds[b]=seeds[c]=seed;
    }
    if(frames&&building)for(const vertex of [a,b,c])frames.set([building[0],building[1],building[5]],vertex*3);
    if(architecture&&building&&architectureIds.has(building[7]))architecture[a]=architecture[b]=architecture[c]=replacementIds.has(building[7])?2:1;
  }
  return photoSlot;
}

export function buildingBaseHeights(position, surface, index, buildings) {
  const base = new Float32Array(surface.length);
  for (let i=0;i<index.length;i+=3) {
    const a=index[i],b=index[i+1],c=index[i+2];
    if (surface[a]!==5) continue;
    const height=buildings.triangleAt(position,a,b,c)?.[6]??Math.min(position[a*3+1],position[b*3+1],position[c*3+1]);
    base[a]=base[b]=base[c]=height;
  }
  return base;
}
