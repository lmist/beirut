#!/usr/bin/env python3
"""Collect bounded, resumable real Bliss Street facade reference photographs.

Metadata requests are unmetered. Every static-image attempt is durably reserved
in imagery-collection.json before network activity; the lifetime ceiling is120.
No generated imagery and no unverified building identity claims are introduced.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import http.client
import io
import json
import math
from pathlib import Path
import threading
import time
import urllib.parse

import numpy as np
from PIL import Image

from prepare_facade_textures import City, write_json

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/bliss-street'
OUT = DATA / 'imagery-collected'
MANIFEST = DATA / 'imagery-collection.json'
HARD_LIMIT =120


class Collector:
    def __init__(self):
        raw = (ROOT / 'googlenv').read_text().strip().splitlines()[0]
        self.key = raw.split('=',1)[-1].strip().strip('"').strip("'")
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.local = threading.local()
        self.city = City()
        self.street = json.loads((ROOT / 'public/data/bliss-street.json').read_text())
        self.architecture = {b['id']:b for b in json.loads((ROOT / 'public/data/bliss-architecture.json').read_text())['buildings']}
        self.rows = sorted(self.street['buildings'], key=lambda b:(b['photo'] is not None,b['station']))
        OUT.mkdir(parents=True,exist_ok=True)
        self.state = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {
            'version':1,'registration':self.city.registration,'sources':{},'buildings':{},
            'requests':[], 'summary':{'requestLimit':HARD_LIMIT,'requests':0},
            'accuracyStatus':'Camera position from Google metadata; elevation from modeled terrain. Each photograph requires visual facade identity review.'}
        if self.state['registration'] != self.city.registration:
            raise RuntimeError('Registration changed; preserve prior ledger and reconcile cameras before collecting.')
        self.save()

    def save(self):
        with self.lock:
            counts=Counter(row.get('status','UNKNOWN') for row in self.state['buildings'].values())
            self.state['summary']={
                'targetBuildings':len(self.rows),'requests':len(self.state['requests']),
                'requestLimit':HARD_LIMIT,'savedImages':len(self.state['sources']),
                'statusCounts':dict(counts),'stopped':self.stop.is_set(),
                'maximumListPriceUSD':round(len(self.state['requests'])*.007,3),
                'billingNote':'Upper estimate at $7/1000images before any allowances; metadata excluded.',
                'attribution':'© Google Street View',
            }
            write_json(MANIFEST,self.state)

    def request(self,endpoint,params,allow_stopped=False):
        # Single attempt only: the caller owns all metered retry decisions.
        if self.stop.is_set() and not allow_stopped:
            return None,'STOPPED'
        path='/maps/api/streetview'+endpoint+'?'+urllib.parse.urlencode({**params,'key':self.key})
        try:
            if not getattr(self.local,'connection',None):
                self.local.connection=http.client.HTTPSConnection('maps.googleapis.com',timeout=25)
            self.local.connection.request('GET',path,headers={'User-Agent':'beirut-bliss-reference-collection/1.0'})
            response=self.local.connection.getresponse()
            body=response.read()
            if response.status !=200:
                if response.status in (403,429):
                    self.stop.set()
                return None,f'HTTP_{response.status}'
            return body,'OK'
        except Exception as error:
            if getattr(self.local,'connection',None):
                self.local.connection.close()
                self.local.connection=None
            # Never emit exception strings or credential-bearing request URLs.
            return None,type(error).__name__

    def metadata(self,xz,radius=40,allow_stopped=False):
        lat,lon=self.city.geographic(*xz)
        body,status=self.request('/metadata',{'location':f'{lat:.8f},{lon:.8f}',
            'radius':radius,'source':'outdoor'},allow_stopped=allow_stopped)
        if body is None:
            return {'status':status}
        try:
            result=json.loads(body)
        except ValueError:
            return {'status':'BAD_METADATA'}
        if result.get('status') in ('REQUEST_DENIED','OVER_QUERY_LIMIT'):
            self.stop.set()
        # API error strings are not needed and may accidentally include request data.
        return {k:result[k] for k in ('status','pano_id','location','date','copyright') if k in result}

    def road_distance(self,xz):
        distances=[]
        for seg in self.street['segments']:
            a,b=np.array(seg['a']),np.array(seg['b'])
            d=b-a
            t=np.clip(np.dot(xz-a,d)/np.dot(d,d),0,1)
            distances.append(float(np.linalg.norm(xz-(a+t*d))))
        return min(distances)

    def frame(self,b,meta):
        loc=meta['location'];xz=self.city.world(loc['lat'],loc['lng'])
        if self.road_distance(xz)>45:
            return None
        camera=np.array([xz[0],self.city.camera_height(xz),xz[1]])
        faces=self.architecture[b['id']]['facades']
        choices=[]
        for f in faces:
            center=np.array(f['center']);delta=center-xz
            distance=float(np.linalg.norm(delta))
            if distance<4 or distance>140:
                continue
            facing=float(np.dot(np.array(f['normal']),-delta/distance))
            if facing<.12:
                continue
            tangent=np.array(f['tangent'])
            corners=[np.array([center[0]+u*tangent[0],f['base']+y,center[1]+u*tangent[1]]) for u,y in f['polygon']]
            heading=self.city.heading(delta)
            elevations=[math.degrees(math.atan2(p[1]-camera[1],np.linalg.norm(p[::2]-xz))) for p in corners]
            pitch=(min(elevations)+max(elevations))/2
            # Exact square-perspective framing, including pitch-induced horizontal stretch.
            yaw=math.atan2(delta[0],-delta[1]);p=math.radians(pitch)
            forward=np.array([math.sin(yaw)*math.cos(p),math.sin(p),-math.cos(yaw)*math.cos(p)])
            right=np.array([math.cos(yaw),0,math.sin(yaw)])
            up=np.cross(right,forward)
            tangents=[]
            for point in corners:
                rel=point-camera;depth=np.dot(rel,forward)
                if depth<=.01:
                    break
                tangents.append(max(abs(np.dot(rel,right)),abs(np.dot(rel,up)))/depth)
            if len(tangents)!=len(corners):
                continue
            required=math.degrees(2*math.atan(max(tangents)))
            fov=max(42,min(118,required+8))
            coverage=min(1,math.tan(math.radians(fov/2))/max(max(tangents),.001))
            area=f['width']*(f['top']-f['base'])
            # Prefer the major visible wall, front-facing and close enough for useful detail.
            score=(math.sqrt(area)*facing*coverage)/(max(12,distance)**.55)*(1 if required<110 else .7)
            choices.append((score,{
                'panoId':meta['pano_id'],'pano':meta['pano_id'],'date':meta.get('date'),
                'lat':loc['lat'],'lon':loc['lng'], 'headingDeg':round(heading,3),
                'pitchDeg':round(pitch,3),'fovDeg':round(fov,3),
                'camera':[round(float(c),6) for c in camera],
                'path':f'data/bliss-street/imagery-collected/{b["id"]}.jpg',
                'imageId':f'bliss-{b["id"]}','source':'bliss-targeted-street-view',
                'targetBuildingId':b['id'],'targetFacadeId':f['id'],
                'targetFacadeCenter':f['center'],'distanceMetres':round(distance,3),
                'faceNormalCosine':round(facing,4),'predictedFrameCoverage':round(coverage,4),
                'confidence':round(max(.35,min(.85,.72*facing+.1*coverage)),3),
                'cameraHeightMethod':'Inverse-distance weighting of nearest5modeled ground elevations +2.5m',
                'identityStatus':'unreviewed; geometric target is not visual identity confirmation',
                'copyright':meta.get('copyright','© Google'),
            }))
        return max(choices,key=lambda x:x[0]) if choices else None

    def plan_one(self,b):
        bid=str(b['id'])
        with self.lock:
            old=self.state['buildings'].get(bid,{})
        if old.get('photo') and old.get('status') in ('PLANNED','OK','HTTP_500','HTTP_502','HTTP_503','TimeoutError','RemoteDisconnected'):
            return old
        candidates=[]; seen=set();lookups=[]
        road=np.array(b['nearestPoint']);direction=np.array(b['roadDirection'])
        for offset in (0,-20,20,-40,40,-60,60):
            meta=self.metadata(road+direction*offset,40)
            lookups.append({'roadOffsetMetres':offset,**meta})
            if self.stop.is_set():
                break
            if meta.get('status')!='OK':
                continue
            if meta['pano_id'].startswith('CAo') or meta['pano_id'] in seen:
                continue
            seen.add(meta['pano_id'])
            choice=self.frame(b,meta)
            if choice:
                candidates.append(choice)
        if not candidates and not self.stop.is_set():
            meta=self.metadata(road,60)
            lookups.append({'roadOffsetMetres':0,'radius':60,**meta})
            if meta.get('status')=='OK' and not meta['pano_id'].startswith('CAo'):
                choice=self.frame(b,meta)
                if choice:
                    candidates.append(choice)
        row={'sourceId':f'bliss-{bid}','status':'NO_USABLE_ROADSIDE_PANORAMA',
             'metadataLookups':lookups,'station':b['station'],'previouslyAssignedPhoto':b['photo'] is not None}
        if candidates:
            row.update(status='PLANNED',photo=max(candidates,key=lambda x:x[0])[1])
        with self.lock:
            self.state['buildings'][bid]=row
            self.save()
        return row

    def fetch_one(self,b):
        bid=str(b['id'])
        row=self.state['buildings'][bid]
        photo=row.get('photo')
        if not photo:
            return row['status']
        path=ROOT/photo['path']
        if row['status']=='OK' and path.exists():
            with Image.open(path) as im:
                im.verify()
            return 'EXISTING'
        params={'size':'640x640','pano':photo['panoId'],'heading':photo['headingDeg'],
                'pitch':photo['pitchDeg'],'fov':photo['fovDeg'],'return_error_code':'true'}
        with self.lock:
            if self.stop.is_set():
                return 'STOPPED'
            if len(self.state['requests'])>=HARD_LIMIT:
                return 'BUDGET_EXHAUSTED'
            # A reserved request remains counted even if the process crashes pre-send.
            attempt={'buildingId':b['id'],'attempt':len(self.state['requests'])+1,
                'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
                'status':'RESERVED','parameters':params}
            self.state['requests'].append(attempt)
            self.save()
        body,status=self.request('',params)
        if body is not None:
            try:
                with Image.open(io.BytesIO(body)) as im:
                    im.verify()
                if not body.startswith(b'\xff\xd8') or len(body)<2000:
                    status='BAD_IMAGE'
                else:
                    temporary=path.with_suffix('.tmp');temporary.write_bytes(body);temporary.replace(path)
                    write_json(path.with_suffix('.json'),photo)
            except Exception:
                status='BAD_IMAGE'
        with self.lock:
            attempt['status']=status;row['status']=status
            if status=='OK':
                self.state['sources'][photo['imageId']]=photo
            self.save()
        if status=='HTTP_403':
            # One free metadata recheck records access state without further image retries.
            meta=self.metadata(np.array(b['nearestPoint']),allow_stopped=True)
            with self.lock:
                self.state['accessRecheck']=meta;self.save()
        return status

    def run(self,collect=False):
        started=time.monotonic()
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures={pool.submit(self.plan_one,b):b for b in self.rows}
            for n,future in enumerate(as_completed(futures),1):
                future.result()
                if n%15==0 or n==len(futures):
                    print(json.dumps({'phase':'metadata','processed':n,'summary':self.state['summary']}),flush=True)
        if collect and not self.stop.is_set():
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures={pool.submit(self.fetch_one,b):b for b in self.rows}
                counts=Counter()
                for n,future in enumerate(as_completed(futures),1):
                    counts[future.result()]+=1
                    if n%10==0 or n==len(futures):
                        print(json.dumps({'phase':'images','processed':n,'counts':dict(counts),'requests':len(self.state['requests'])}),flush=True)
        self.save()
        print(json.dumps({'complete':True,'elapsedSeconds':round(time.monotonic()-started),**self.state['summary']}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collect',action='store_true',help='Spend at most120lifetime static-image requests; default metadata only.')
    Collector().run(collect=parser.parse_args().collect)
