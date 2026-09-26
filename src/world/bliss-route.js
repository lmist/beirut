/** The named OSM Bliss centerline, measured east to west in model metres. */
export function pointAlongBliss(corridor,station) {
  const segments=corridor?.segments||[];
  if(!segments.length)throw new Error('Bliss Street has no mapped route.');
  const distance=Math.max(0,Math.min(corridor.length,station));
  const segment=segments.find(s=>distance<=s.station+s.length)||segments.at(-1);
  const dx=segment.b[0]-segment.a[0],dz=segment.b[1]-segment.a[1];
  const length=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,(distance-segment.station)/(length||1)));
  return {x:segment.a[0]+dx*t,z:segment.a[1]+dz*t,yaw:Math.atan2(-dx,-dz),station:distance};
}

export function blissStops(corridor) {
  const gate=nearestBlissStation(corridor,{x:-2427,z:-1424});
  const gatePoint=pointAlongBliss(corridor,gate);
  return [
    {id:'east',name:'Bliss · eastern end',...pointAlongBliss(corridor,75)},
    {id:'gate',name:'Bliss · AUB Main Gate',...gatePoint,travelYaw:gatePoint.yaw,yaw:0},
    {id:'middle',name:'Bliss · middle blocks',...pointAlongBliss(corridor,corridor.length*.55)},
    {id:'west',name:'Bliss · western bend',...pointAlongBliss(corridor,corridor.length-75)},
  ];
}

export function nearestBlissStation(corridor,{x,z}) {
  let result={distance:Infinity,station:0};
  for(const s of corridor.segments) {
    const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((x-s.a[0])*dx+(z-s.a[1])*dz)/(dx*dx+dz*dz||1)));
    const distance=Math.hypot(x-s.a[0]-dx*t,z-s.a[1]-dz*t);
    if(distance<result.distance)result={distance,station:s.station+t*s.length};
  }
  return result.station;
}
