/** Clearance-aware paths through the spaces between the city buildings. */
export class StreetNavigation {
  constructor(buildings, cell=3) {
    this.cell=cell;this.minX=-4000;this.minZ=-3500;this.width=Math.ceil(7600/cell);this.height=Math.ceil(6900/cell);
    this.blocked=new Uint8Array(this.width*this.height);
    for(const b of buildings){const x0=Math.max(0,Math.ceil((b[0]-2.2-this.minX)/cell)),x1=Math.min(this.width-1,Math.floor((b[2]+2.2-this.minX)/cell));const z0=Math.max(0,Math.ceil((b[1]-2.2-this.minZ)/cell)),z1=Math.min(this.height-1,Math.floor((b[3]+2.2-this.minZ)/cell));for(let z=z0;z<=z1;z++)this.blocked.fill(1,z*this.width+x0,z*this.width+x1+1);}
  }
  key(p){return Math.round((p.z-this.minZ)/this.cell)*this.width+Math.round((p.x-this.minX)/this.cell);}
  point(k){return{x:this.minX+(k%this.width)*this.cell,z:this.minZ+Math.floor(k/this.width)*this.cell};}
  nearest(p,allowed){const center=this.key(p);for(let r=0;r<50;r++)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;const k=center+dz*this.width+dx;if(k>=0&&k<this.blocked.length&&!this.blocked[k]&&(!allowed||allowed[k]))return k;}return center;}
  clear(a,b){const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/this.cell*2);for(let i=0;i<=n;i++){const k=this.key({x:a.x+(b.x-a.x)*i/(n||1),z:a.z+(b.z-a.z)*i/(n||1)});if(k<0||k>=this.blocked.length||this.blocked[k])return false;}return true;}
  connect(from) {
    const seed=this.nearest(from),queue=new Int32Array(this.blocked.length);this.reachable=new Uint8Array(this.blocked.length);let head=0,tail=1;queue[0]=seed;this.reachable[seed]=1;
    while(head<tail){const k=queue[head++],x=k%this.width;for(const n of [x>0?k-1:-1,x<this.width-1?k+1:-1,k-this.width,k+this.width])if(n>=0&&n<this.blocked.length&&!this.blocked[n]&&!this.reachable[n]){this.reachable[n]=1;queue[tail++]=n;}}
  }
  route(from,to){
    const start=this.nearest(from),end=this.nearest(to,this.reachable),goal=this.point(end),heap=[],g=new Map([[start,0]]),previous=new Map(),closed=new Set();
    const push=(k,f)=>{let i=heap.length;heap.push({k,f});while(i>0){const p=(i-1)>>1;if(heap[p].f<=f)break;heap[i]=heap[p];i=p;}heap[i]={k,f};};
    const pop=()=>{const root=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[i]=heap[c];i=c;}heap[i]=last;}return root.k;};
    push(start,0);let count=0;
    while(heap.length&&count++<350000){const k=pop();if(closed.has(k))continue;if(k===end){const points=[];let p=k;while(p!==undefined){points.push(this.point(p));p=previous.get(p);}points.reverse();const simple=[points[0]];for(let i=1;i<points.length;i++)if(i===points.length-1||!this.clear(simple.at(-1),points[i+1]))simple.push(points[i]);return simple;}
      closed.add(k);const x=k%this.width,z=Math.floor(k/this.width);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const n=k+dx+dz*this.width;if(x+dx<0||x+dx>=this.width||z+dz<0||z+dz>=this.height||this.blocked[n]||closed.has(n))continue;if(dx&&dz&&(this.blocked[k+dx]||this.blocked[k+dz*this.width]))continue;const cost=g.get(k)+Math.hypot(dx,dz)*this.cell;if(cost>=(g.get(n)??Infinity))continue;g.set(n,cost);previous.set(n,k);const p=this.point(n);push(n,cost+Math.hypot(goal.x-p.x,goal.z-p.z));}
    }return [];
  }
}
