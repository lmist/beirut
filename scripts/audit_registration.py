"""Compare local CAD block geometry with independently mapped OSM streets.

Writes diagnostic candidates only; never changes runtime georeferencing.
Requires numpy, scipy, opencv-python-headless and pillow.
"""
from pathlib import Path
import json,math,time
import numpy as np
import cv2
from scipy.ndimage import map_coordinates
from scipy.optimize import differential_evolution, minimize

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.cache/registration-audit';OUT.mkdir(parents=True,exist_ok=True)
BOUNDS=np.array([-4050.,-3450.,3600.,3100.]);RES=2.5
W=int(np.ceil((BOUNDS[2]-BOUNDS[0])/RES));H=int(np.ceil((BOUNDS[3]-BOUNDS[1])/RES))
BASE=np.array([-5.5,870.,-680.,1.])

def pixels(p):return np.rint((p-BOUNDS[:2])/RES).astype(np.int32)

def masks():
 path=OUT/'masks.npz'
 if path.exists():
  a=np.load(path);return a['blocks'],a['land']
 blocks=np.zeros((H,W),np.uint8);land=np.zeros_like(blocks)
 dtype=np.dtype({'names':['p','n','surface'],'formats':[('<f4',3),('i1',3),'u1'],'offsets':[0,12,15],'itemsize':20})
 start=time.time();counts={}
 for count,path in enumerate(sorted((ROOT/'.cache/tiles').glob('*.raw'))):
  raw=path.read_bytes();nv,ni=np.frombuffer(raw,dtype='<u4',count=2)
  v=np.frombuffer(raw,dtype=dtype,count=nv,offset=8);ix=np.frombuffer(raw,dtype='<u4',count=ni,offset=8+int(nv)*20).reshape(-1,3)
  layer=v['surface'][ix[:,0]]
  for tag,img in [(3,blocks),(1,land)]:
   triangles=ix[(layer==tag)&(np.abs(v['n'][ix[:,0],1])>35)]
   p=v['p'][triangles]
   if tag==1:p=p[p[:,:,1].mean(axis=1)>-1]
   coords=pixels(p[:,:,[0,2]])
   for tri in coords:cv2.fillConvexPoly(img,tri,255)
   counts[tag]=counts.get(tag,0)+len(coords)
  if count%30==0:print('raster',count,round(time.time()-start,1),flush=True)
 land=np.maximum(land,blocks)
 np.savez_compressed(OUT/'masks.npz',blocks=blocks,land=land)
 cv2.imwrite(str(OUT/'blocks.png'),cv2.flip(blocks,0))
 cv2.imwrite(str(OUT/'land.png'),cv2.flip(land,0))
 print('triangles',counts,'seconds',time.time()-start,flush=True)
 return blocks,land

def road_points():
 data=json.loads((ROOT/'.cache/osm/beirut-roads.json').read_text())
 pts=[];weights=[];ids=[]
 for way in data['elements']:
  typ=way.get('tags',{}).get('highway')
  if typ not in ['primary','secondary','tertiary','residential','unclassified','trunk','motorway']:continue
  line=np.array([[p['lon'],p['lat']] for p in way.get('geometry',[])])
  if len(line)<2:continue
  en=(line-np.array([35.495,33.888]))*np.array([111320*math.cos(math.radians(33.888)),111320])
  for a,b in zip(en[:-1],en[1:]):
   length=np.linalg.norm(b-a);n=max(1,int(length/12))
   for t in np.linspace(0,1,n,endpoint=False):
    pts.append(a+(b-a)*t);weights.append({'primary':3,'secondary':2.5,'tertiary':2,'trunk':3,'motorway':3}.get(typ,1));ids.append(way['id'])
 return np.array(pts),np.array(weights),np.array(ids)

def inverse(p,params,z_sign=-1):
 angle,e,n,scale=params;c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle));d=p-[e,n]
 return np.stack([d[:,0]*c+d[:,1]*s,z_sign*(-d[:,0]*s+d[:,1]*c)],axis=1)/scale

def main():
 cv2.setNumThreads(2)
 blocks,land=masks()
 # Distances inside CAD blocks penalize OSM streets crossing solid blocks.
 block_distance=cv2.distanceTransform(blocks,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)*RES
 valid=cv2.dilate(blocks,np.ones((81,81),np.uint8))>0
 valid&=land>0
 points,weights,ids=road_points()
 # Restrict to roads whose baseline projects into the central model footprint.
 # This keeps off-model eastern/southern road records out of every candidate.
 local=inverse(points,BASE,z_sign=1)
 central=(local[:,0]>-3200)&(local[:,0]<2500)&(local[:,1]>-1800)&(local[:,1]<2100)
 points,weights,ids=points[central],weights[central],ids[central]
 train=(ids%5)!=0
 def values(params,subset=None,z_sign=-1):
  p=inverse(points if subset is None else points[subset],params,z_sign=z_sign)
  coord=((p-BOUNDS[:2])/RES).T[[1,0]]
  distances=map_coordinates(block_distance,coord,order=1,mode='constant',cval=100)
  coverage=map_coordinates(valid.astype(np.uint8),coord,order=0,mode='constant',cval=0)>0
  return distances,coverage
 def score(params,z_sign=-1):
  d,v=values(params,train,z_sign=z_sign);w=weights[train]
  return np.average(np.minimum(d,45)**1.25+np.where(v,0,75),weights=w)
 def stats(params,subset,z_sign=-1):
  d,v=values(params,subset,z_sign=z_sign)
  return {'roadSamples':len(d),'insideBlockPercent':round(float(np.mean(d>RES)*100),2),'medianBlockPenetrationM':round(float(np.median(d)),2),'p90BlockPenetrationM':round(float(np.percentile(d,90)),2),'modelCoveragePercent':round(float(v.mean()*100),2)}
 print('samples',len(points),'baseline score',score(BASE,z_sign=1),stats(BASE,~train,z_sign=1),flush=True)
 # Deterministic bounded search; hold out entire OSM ways by id.
 bounds=[(-14,8),(350,1600),(-1250,-100),(.90,1.10)]
 if '--fit' in __import__('sys').argv:
  result=differential_evolution(score,bounds,seed=11,popsize=14,maxiter=100,tol=.0008,polish=False,workers=1)
  refined=minimize(score,result.x,method='Powell',bounds=bounds,options={'maxiter':70,'xtol':.00002,'ftol':.00001})
  best=refined.x if refined.fun<result.fun else result.x
 else:
  registration=json.loads((ROOT/'public/data/registration.json').read_text())
  best=np.array([registration[k] for k in ['angleDeg','translationEast','translationNorth','scale']])
 output={'method':'street/block occupancy fit; diagnostic proxy, not building accuracy','baseline':{'parameters':BASE.tolist(),'zSign':1,'score':score(BASE,z_sign=1),'train':stats(BASE,train,z_sign=1),'heldOut':stats(BASE,~train,z_sign=1)},'candidate':{'parameters':best.tolist(),'zSign':-1,'score':score(best),'train':stats(best,train),'heldOut':stats(best,~train)},'sampleSplit':'OSM way ID modulo 5; 20% held out','parameters':['rotationDeg','eastingOffsetM','northingOffsetM','uniformScale']}
 (OUT/'road-fit.json').write_text(json.dumps(output,indent=2))
 print(json.dumps(output,indent=2),flush=True)
 for name,params in [('baseline',BASE),('candidate',best)]:
  img=np.zeros((H,W,3),np.uint8);img[:]=[32,40,42];img[land>0]=[67,73,68];img[blocks>0]=[146,147,134]
  xy=pixels(inverse(points,params,z_sign=1 if name=='baseline' else -1));good=(xy[:,0]>=0)&(xy[:,0]<W)&(xy[:,1]>=0)&(xy[:,1]<H)
  for x,y in xy[good]:cv2.circle(img,(int(x),int(y)),1,(60,210,250),-1)
  cv2.imwrite(str(OUT/f'{name}-road-overlay.png'),cv2.flip(img,0))

if __name__=='__main__':main()
