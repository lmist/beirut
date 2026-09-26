import { northVector, normalizeRegistration, toEastNorth, toWgs84 } from './georeference.js';

function nearestOnSegment(x,z,ax,az,bx,bz) {
  const dx=bx-ax,dz=bz-az;
  const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(x-ax-t*dx,z-az-t*dz);
}

export class CityMap {
  constructor(data, buildings) {
    this.data = data || {};
    this.roads = this.data.roads || [];
    this.areas = this.data.areas || [];
    this.landmarks = this.data.landmarks || [];
    this.registration = normalizeRegistration(this.data.registration);
    this.bounds = [-4050,-3450,3600,3100];
    this.base = document.createElement('canvas');
    this.base.width = 3072; this.base.height = 2630;
    this.scale = this.base.width/(this.bounds[2]-this.bounds[0]);
    this.roadGrid = new Map();
    this.build(buildings);
    this.radar = document.getElementById('map-canvas');
    this.radar.width = this.radar.height = 512;
    this.ctx = this.radar.getContext('2d');
    this.fullMap = document.getElementById('full-map-canvas');
    this.fullMap.width = 1280; this.fullMap.height = 920;
    this.fullCtx = this.fullMap.getContext('2d');
    this.expanded = false;
    this.lastArea = '';
    this.lastQuery = {x:Infinity,z:Infinity,value:null};
  }
  px(x) { return (x-this.bounds[0])*this.scale; }
  pz(z) { return (z-this.bounds[1])*this.scale; }
  build(buildings) {
    const c=this.base.getContext('2d');
    c.fillStyle='#143841';c.fillRect(0,0,this.base.width,this.base.height);
    c.fillStyle='#273637';
    for(const b of buildings)c.fillRect(this.px(b[0])-4,this.pz(b[1])-4,Math.max(2,(b[2]-b[0])*this.scale+8),Math.max(2,(b[3]-b[1])*this.scale+8));
    c.fillStyle='#66776e';
    for(const b of buildings)c.fillRect(this.px(b[0]),this.pz(b[1]),Math.max(1,(b[2]-b[0])*this.scale),Math.max(1,(b[3]-b[1])*this.scale));
    c.lineJoin='round';c.lineCap='round';
    for(const road of this.roads) {
      const p=road.points||[];if(p.length<2)continue;
      const major=['primary','secondary','trunk','motorway'].includes(road.highway);
      c.strokeStyle=major?'#a3a68c':'#414f4b';c.lineWidth=major?3:1.4;
      c.beginPath();p.forEach(([x,z],i)=>i?c.lineTo(this.px(x),this.pz(z)):c.moveTo(this.px(x),this.pz(z)));c.stroke();
      if(road.name) for(let i=1;i<p.length;i++) {
        const [ax,az]=p[i-1],[bx,bz]=p[i];
        for(let gx=Math.floor(Math.min(ax,bx)/200);gx<=Math.floor(Math.max(ax,bx)/200);gx++)
          for(let gz=Math.floor(Math.min(az,bz)/200);gz<=Math.floor(Math.max(az,bz)/200);gz++) {
            const key=`${gx},${gz}`;if(!this.roadGrid.has(key))this.roadGrid.set(key,[]);
            this.roadGrid.get(key).push({road,ax,az,bx,bz});
          }
      }
    }
  }
  locate(x,z) {
    if(Math.hypot(x-this.lastQuery.x,z-this.lastQuery.z)<8&&this.lastQuery.value)return this.lastQuery.value;
    let street=null,distance=Infinity;
    const gx=Math.floor(x/200),gz=Math.floor(z/200);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const s of this.roadGrid.get(`${gx+dx},${gz+dz}`)||[]) {
      const d=nearestOnSegment(x,z,s.ax,s.az,s.bx,s.bz);if(d<distance){distance=d;street=s.road;}
    }
    let area=null,areaDistance=Infinity;
    for(const a of this.areas){const d=Math.hypot(x-a.x,z-a.z);if(d<areaDistance){areaDistance=d;area=a;}}
    const value={area:area?.name||'Beirut',areaAr:area?.nameAr||'بيروت',street:distance<(this.data.lookup?.maxStreetDistanceMetres||150)?street?.name:null,distance};
    this.lastQuery={x,z,value};return value;
  }
  coordinates(x,z) {
    return toWgs84(x,z,this.registration);
  }
  toggle() {
    this.expanded=!this.expanded;document.getElementById('full-map').hidden=!this.expanded;
    if(this.expanded)document.exitPointerLock?.();
    this.onToggle?.(this.expanded);
  }
  draw(position,yaw,{vehicles=[],target=null,driving=false,overview=false,route=[]}={}) {
    const c=this.ctx,w=512,r=245,range=driving?410:230,k=r/range;
    c.clearRect(0,0,w,w);c.save();c.beginPath();c.arc(256,256,r,0,Math.PI*2);c.clip();
    c.fillStyle='#173640';c.fillRect(0,0,w,w);
    c.translate(256,256);c.rotate(yaw);c.scale(k,k);c.translate(-position.x,-position.z);
    c.drawImage(this.base,this.bounds[0],this.bounds[1],this.base.width/this.scale,this.base.height/this.scale);
    if(target) {
      c.strokeStyle='#f4b45b';c.setLineDash([7/k,7/k]);c.lineWidth=3/k;
      c.beginPath();c.moveTo(position.x,position.z);for(const p of route.length?route:[target])c.lineTo(p.x,p.z);c.stroke();c.setLineDash([]);
    }
    for(const v of vehicles) {const p=v.position;c.fillStyle=v.occupied?'#eecd75':'#77c2dd';c.fillRect(p.x-4/k,p.z-6/k,8/k,12/k);}
    c.restore();
    if(target) {
      const dx=target.x-position.x,dz=target.z-position.z,rx=(dx*Math.cos(yaw)-dz*Math.sin(yaw))*k,rz=(dx*Math.sin(yaw)+dz*Math.cos(yaw))*k;
      const scale=Math.min(1,221/Math.hypot(rx,rz));
      c.fillStyle='#ffc05c';c.strokeStyle='#1b2229';c.lineWidth=3;c.beginPath();c.arc(256+rx*scale,256+rz*scale,9,0,Math.PI*2);c.fill();c.stroke();
    }
    c.fillStyle='#f6f4d9';c.strokeStyle='#102027';c.lineWidth=4;c.beginPath();c.moveTo(256,240);c.lineTo(244,269);c.lineTo(256,263);c.lineTo(268,269);c.closePath();c.fill();c.stroke();
    c.strokeStyle='#e9ded070';c.lineWidth=2;c.beginPath();c.arc(256,256,r,0,Math.PI*2);c.stroke();
    c.fillStyle='#f8f0d3';c.font='bold 23px monospace';c.textAlign='center';
    const north=northVector(this.registration);
    const nx=(north.x*Math.cos(yaw)-north.z*Math.sin(yaw))*224;
    const nz=(north.x*Math.sin(yaw)+north.z*Math.cos(yaw))*224;
    c.fillText('N',256+nx,264+nz);
    if(this.expanded)this.drawFull(position,yaw,vehicles,target);
    const location=this.locate(position.x,position.z);
    document.getElementById('district-name').textContent=location.area;
    document.getElementById('street-name').textContent=location.street?`Near ${location.street}`:'Unmarked street';
    document.getElementById('location-ar').textContent=location.areaAr;
    const gps=this.coordinates(position.x,position.z);
    if(gps)document.getElementById('google-maps').href=`https://www.google.com/maps/search/?api=1&query=${gps.lat.toFixed(6)},${gps.lon.toFixed(6)}`;
    if(location.area!==this.lastArea&&!overview){this.lastArea=location.area;const badge=document.getElementById('district-arrival');badge.textContent=location.area;badge.classList.remove('show');void badge.offsetWidth;badge.classList.add('show');}
  }
  fullMapFrame(width,height) {
    const [minX,minZ,maxX,maxZ]=this.bounds;
    const corners=[[minX,minZ],[minX,maxZ],[maxX,minZ],[maxX,maxZ]].map(([x,z])=>toEastNorth(x,z,this.registration));
    const minEast=Math.min(...corners.map(point=>point.east)),maxEast=Math.max(...corners.map(point=>point.east));
    const minNorth=Math.min(...corners.map(point=>point.north)),maxNorth=Math.max(...corners.map(point=>point.north));
    const scale=Math.min((width-40)/(maxEast-minEast),(height-40)/(maxNorth-minNorth));
    return {minEast,maxNorth,scale,ox:(width-(maxEast-minEast)*scale)/2,oy:(height-(maxNorth-minNorth)*scale)/2};
  }
  fullPoint(x,z,frame) {
    const point=toEastNorth(x,z,this.registration);
    return {x:frame.ox+(point.east-frame.minEast)*frame.scale,y:frame.oy+(frame.maxNorth-point.north)*frame.scale};
  }
  drawFull(position,yaw,vehicles,target) {
    const ctx=this.fullCtx,w=1280,h=920,frame=this.fullMapFrame(w,h);
    ctx.fillStyle='#13252c';ctx.fillRect(0,0,w,h);
    const [minX,minZ]=this.bounds,r=this.registration,a=r.angleDeg*Math.PI/180,baseScale=this.scale;
    const origin=this.fullPoint(minX,minZ,frame);
    const ax=frame.scale*r.scale*Math.cos(a)/baseScale;
    const bx=-frame.scale*r.scale*Math.sin(a)/baseScale;
    const cx=-frame.scale*r.scale*Math.sin(a)*r.zSign/baseScale;
    const dx=-frame.scale*r.scale*Math.cos(a)*r.zSign/baseScale;
    ctx.save();ctx.setTransform(ax,bx,cx,dx,origin.x,origin.y);ctx.drawImage(this.base,0,0);ctx.restore();
    const point=(x,z)=>this.fullPoint(x,z,frame);
    ctx.font='bold 23px sans-serif';ctx.textAlign='center';
    const priorities=['El Hamra','Gemmayzeh','Badaro','Achrafieh','Salim Slam','Mar Mikhael','Raoucheh','Verdun','Ras Beirut','Burj Abi Haidar','Karantina','Saifi','Mar Elias','Ras El Nabaa','Manara','Msaitbeh','Tariq El Jdideh','Bir Hassan','Qoreitem','Port','Adliyeh'];
    const labels=[],seen=new Set();
    const ordered=[...this.areas].sort((a,b)=>(priorities.includes(a.name)?priorities.indexOf(a.name):100)-(priorities.includes(b.name)?priorities.indexOf(b.name):100));
    for(const a of ordered){
      if(seen.has(a.name))continue;
      const label=a.name.toUpperCase(),{x,y:z}=point(a.x,a.z),half=ctx.measureText(label).width/2+8;
      if(labels.some(r=>Math.abs(x-r.x)<half+r.half&&Math.abs(z-r.z)<34))continue;
      labels.push({x,z,half});seen.add(a.name);
      ctx.lineWidth=5;ctx.strokeStyle='#17252bec';ctx.strokeText(label,x,z+5);ctx.fillStyle='#d3cfb5';ctx.fillText(label,x,z+5);
    }
    ctx.fillStyle='#e5be7f';ctx.textAlign='right';ctx.fillText('N ↑',1240,45);ctx.textAlign='center';
    if(target){const start=point(position.x,position.z),end=point(target.x,target.z);ctx.strokeStyle='#f7b557';ctx.lineWidth=3;ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffc267';ctx.beginPath();ctx.arc(end.x,end.y,9,0,Math.PI*2);ctx.fill();ctx.fillText(target.name,end.x,end.y-18);}
    for(const v of vehicles){const p=point(v.position.x,v.position.z);ctx.fillStyle='#82cbe1';ctx.fillRect(p.x-4,p.y-6,8,12);}
    const player=point(position.x,position.z);ctx.fillStyle='#f7f4dc';ctx.strokeStyle='#193034';ctx.lineWidth=3;ctx.beginPath();ctx.arc(player.x,player.y,9,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillText('YOU',player.x,player.y-18);
  }
}
