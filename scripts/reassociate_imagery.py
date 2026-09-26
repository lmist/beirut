"""Prepare corrected building targets and conservative cached-photo candidates.

Does not edit legacy imagery, metadata, or request any new imagery.
"""
from pathlib import Path
import json,math
import numpy as np
from scipy.spatial import cKDTree
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/registration-v2';OUT.mkdir(parents=True,exist_ok=True)

def en(lat,lon,r):
 return np.stack([(lon-r['anchorLon'])*111320*math.cos(math.radians(r['anchorLat'])),(lat-r['anchorLat'])*111320],axis=-1)

def main():
 r=json.loads((ROOT/'public/data/registration.json').read_text())
 b=np.array(json.loads((ROOT/'public/data/buildings.json').read_text()))
 center=(b[:,:2]+b[:,2:4])/2
 a=math.radians(r['angleDeg']);c,s=math.cos(a),math.sin(a);z=center[:,1]*r['zSign']
 E=r['scale']*(center[:,0]*c-z*s)+r['translationEast'];N=r['scale']*(center[:,0]*s+z*c)+r['translationNorth']
 lat=r['anchorLat']+N/111320;lon=r['anchorLon']+E/(111320*math.cos(math.radians(r['anchorLat'])))
 targets=[{'id':i,'x':round(float(center[i,0]),3),'z':round(float(center[i,1]),3),'lat':round(float(lat[i]),8),'lon':round(float(lon[i]),8),'w':round(float(b[i,2]-b[i,0]),3),'d':round(float(b[i,3]-b[i,1]),3)} for i in range(len(b))]
 (OUT/'buildings_geo.json').write_text(json.dumps(targets,separators=(',',':')))
 cameras=[];rejected=[]
 for path in sorted((ROOT/'data/buildings/streetview').glob('*.json')):
  if not path.stem.isdigit():continue
  row=json.loads(path.read_text())
  p=en(np.array(row['pano_lat']),np.array(row['pano_lon']),r)
  old=en(np.array(row['lat']),np.array(row['lon']),r)
  if np.linalg.norm(p-old)>1000 or not(33.84<row['pano_lat']<33.93 and 35.44<row['pano_lon']<35.56):
   rejected.append({'imageId':int(path.stem),'reason':'implausible_original_camera_association'});continue
  cameras.append({'id':int(path.stem),'panoId':row['pano_id'],'e':float(p[0]),'n':float(p[1]),'heading':float(row['heading']),'lat':row['pano_lat'],'lon':row['pano_lon']})
 xy=np.array([[x['e'],x['n']] for x in cameras]);tree=cKDTree(xy)
 rows=[];counts={str(radius):0 for radius in [40,60,80,120]};headings={str(angle):0 for angle in [15,30,40]}
 for i,p in enumerate(np.stack([E,N],axis=1)):
  nearby=tree.query_ball_point(p,120)
  candidate=[];bestdistance=math.inf
  for j in nearby:
   camera=cameras[j];delta=p-xy[j];distance=float(np.linalg.norm(delta));bestdistance=min(bestdistance,distance)
   desired=math.degrees(math.atan2(delta[0],delta[1]))%360
   error=abs((desired-camera['heading']+180)%360-180)
   if distance<=80 and error<=40:
    candidate.append({'imageId':camera['id'],'distanceMetres':round(distance,1),'bearingErrorDegrees':round(error,1),'score':round(distance/80+error/40,3)})
  for radius in counts:
   if bestdistance<=int(radius):counts[radius]+=1
  for angle in headings:
   if any(x['distanceMetres']<=60 and x['bearingErrorDegrees']<=int(angle) for x in candidate):headings[angle]+=1
  candidate.sort(key=lambda x:x['score'])
  rows.append({'buildingId':i,'candidates':candidate[:3]})
 (OUT/'photo-candidates.json').write_text(json.dumps(rows,separators=(',',':')))
 (OUT/'rejected-photos.json').write_text(json.dumps(rejected,indent=2))
 legacy=json.loads((ROOT/'data/buildings_geo.json').read_text())
 legacy_en=en(np.array([q['lat'] for q in legacy]),np.array([q['lon'] for q in legacy]),r)
 displacement=np.linalg.norm(np.stack([E,N],axis=1)-legacy_en,axis=1)
 summary={'buildings':len(targets),'cachedImagesConsidered':len(cameras),'excludedImages':len(rejected),'uniquePanoramas':len({x['panoId'] for x in cameras}),'cameraProximityCoverage':{k:{'count':v,'percent':round(v/len(b)*100,2)} for k,v in counts.items()},'headingCoverageWithin60m':{k:{'count':v,'percent':round(v/len(b)*100,2)} for k,v in headings.items()},'buildingsWithCandidateWithin80mAnd40deg':sum(bool(row['candidates']) for row in rows),'correctionDisplacementMetres':{'median':round(float(np.median(displacement)),1),'p95':round(float(np.percentile(displacement,95)),1),'max':round(float(displacement.max()),1)},'limitations':['Candidates are proximity and horizontal-framing matches only.','Occlusion, camera height, wall geometry and full facade visibility are not validated.','Existing images keep their original heading; targets without suitable framing need another view.'],'legacyFilesChanged':False}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
