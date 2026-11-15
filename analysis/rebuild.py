"""Build the scenario dataset from the NASA LOLA grids and JPL Horizons."""
import argparse
import csv
import gzip
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
from terrain import Grid, PRODUCTS, JPL, START, enu, evaluate, make_terrain, metrics, obtain, check

SITES = [
    ('malapert', 'Malapert Massif', -85.9948, -.23578),
    ('gerlache', 'de Gerlache Rim 2', -88.23, -64.6284),
    ('shackleton', 'Shackleton Rim', -89.7668, -171.87),
    ('connecting', 'Connecting Ridge', -89.4632, -137.49),
    ('nobile', 'Nobile Rim 1', -85.4381, 37.36667),
]
DAYS, STEP, AZ, RADIAL, EXTENT = 36, 10, .1, 40, 270000
AU_M = 149597870700


def export_intervals(payload, destination):
    epoch = datetime.fromisoformat(payload['epoch'])
    def utc(minutes):
        return (epoch+timedelta(minutes=minutes)).isoformat(timespec='seconds')
    with destination.open('w', newline='', encoding='utf-8') as file:
        writer = csv.writer(file)
        writer.writerow(['site','mode','target','start_utc','end_utc','status','duration_min',
                         'antenna_m','panel_m','provenance'])
        for site in payload['sites']:
            for height, result in site['heights'].items():
                for mode in ('flat', 'terrain'):
                    for target in ('earth', 'sun'):
                        for day in result['days']:
                            for t0, t1, status in day[f'{mode}_{target}_intervals']:
                                writer.writerow([site['id'],mode,target,utc(t0),utc(t1),status,round(t1-t0,3),
                                                 height,2,'JPL Horizons + LOLA' if mode == 'terrain' else 'JPL Horizons'])


def reference(cache, target, radius, observer):
    _, _, lat, lon = SITES[0]
    params = dict(format='text', COMMAND=f"'{target}'", CENTER="'coord@301'",
                  COORD_TYPE="'GEODETIC'", SITE_COORD=f"'{lon},{lat},{(observer-radius)/1000:.8f}'",
                  EPHEM_TYPE="'OBSERVER'", START_TIME=f"'{START:%Y-%m-%d %H:%M}'",
                  STOP_TIME=f"'{START+timedelta(days=DAYS):%Y-%m-%d %H:%M}'",
                  STEP_SIZE=f"'{STEP} m'", QUANTITIES="'4,20'", CSV_FORMAT="'YES'")
    url = JPL + '?' + urlencode(params)
    raw = obtain(cache / f'mission36_q4_20_{target}.txt', url).read_text('utf8')
    assert '$$SOE' in raw and 'MEAN_ME' in raw and '1737.4, 1737.4, 1737.4' in raw
    times, az, el, distance = [], [], [], []
    for line in raw.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines():
        cols = [col.strip() for col in line.split(',')]
        when = datetime.strptime(cols[0], '%Y-%b-%d %H:%M').replace(tzinfo=timezone.utc)
        times.append(int((when-START).total_seconds()/60))
        az.append(float(cols[3]))
        el.append(float(cols[4]))
        distance.append(float(cols[5])*AU_M)
    assert times == list(range(0, DAYS*1440+1, STEP))
    a,e = np.radians(az)[:,None], np.radians(el)[:,None]
    up,east,north = enu(lat,lon)
    direction = np.cos(e)*(np.sin(a)*east+np.cos(a)*north)+np.sin(e)*up
    vectors = observer*up+np.array(distance)[:,None]*direction
    assert np.all(np.linalg.norm(vectors,axis=1)>1e8)
    return vectors,url


def local_track(vectors, lat, lon, observer):
    up,east,north = enu(lat,lon)
    ray = vectors-observer*up
    e,n,u = ray@east,ray@north,ray@up
    return [[i*STEP,round(a,6),round(el,6)] for i,(a,el) in enumerate(
        zip(np.degrees(np.arctan2(e,n))%360,np.degrees(np.arctan2(u,np.hypot(e,n)))))]


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--cache',type=Path,required=True)
    cli.add_argument('--out',type=Path,required=True)
    cli.add_argument('--reuse',type=Path,help='Reuse matching verified terrain and direct Horizons intervals')
    args=cli.parse_args()
    check()
    args.cache.mkdir(parents=True,exist_ok=True)
    args.out.mkdir(parents=True,exist_ok=True)
    grids=[Grid(args.cache,*p) for p in PRODUCTS]
    radius=grids[0].radius
    assert all(g.radius==radius for g in grids)
    _,_,lat,lon=SITES[0]
    ground = float(grids[-1].sample(*np.radians([lat,lon])))
    earth,earth_url=reference(args.cache,399,radius,radius+ground+2)
    sun,sun_url=reference(args.cache,10,radius,radius+ground+2)
    print('Both NASA JPL ephemerides verified',flush=True)
    old=json.loads(args.reuse.read_text('utf8').strip()[18:-1]) if args.reuse else None
    eligible=old and old['azStep']==AZ and old['extent']==EXTENT and old['radialStep']==RADIAL and old['timeStep']==STEP
    reuse={x['id']:x for x in old['sites']} if eligible else {}
    base_grid=grids[0]
    payload=dict(epoch=START.isoformat(),days=DAYS,azStep=AZ,timeStep=STEP,rankingToleranceMinutes=30,
                 radialStep=RADIAL,extent=EXTENT,products=[g.meta for g in grids],sites=[],
                 referenceQueries=[earth_url,sun_url],
                 customGrid=dict(radius=radius,scale=base_grid.scale,quant=base_grid.quant,
                                 row0=base_grid.row0,col0=base_grid.col0,shape=list(base_grid.raster.shape),
                                 minimum=base_grid.minimum,maximum=base_grid.maximum,
                                 latitudeMin=-89.99,latitudeMax=-84))
    for sid,name,lat,lon in SITES:
        print('Processing',name,flush=True)
        previous=reuse.get(sid)
        pack=dict(id=sid,name=name,lat=lat,lon=lon,heights={})
        profile_times={}
        for height in (2,5):
            old_state=previous['heights'][str(height)] if previous else None
            if old_state:
                ground,terrain,missing,far=[old_state[k] for k in ('ground','terrain','missing','far')]
            else:
                ground,terrain,missing,far=make_terrain(grids,lat,lon,height,2,EXTENT,RADIAL,AZ)
            result=dict(ground=round(ground,3),terrain=terrain,missing=missing,far=far,
                        earth=local_track(earth,lat,lon,radius+ground+height),
                        sun=local_track(sun,lat,lon,radius+ground+2),
                        queries=[earth_url,sun_url],days=[],profiles={})
            previous_days=len(old_state['days']) if old_state else 0
            if old_state:
                result['queries'] += old_state['queries']
                # Preserve original directly queried values. The extended vectors
                # use Horizons ranges to transform directions to each observer.
                for key in ('earth','sun'):
                    result[key][:len(old_state[key])]=old_state[key]
            for day in range(DAYS):
                if day < previous_days:
                    rec=old_state['days'][day]
                else:
                    rec={}
                    for mode in ('flat','terrain'):
                        for target in ('earth','sun'):
                            intervals=evaluate(result[target],day*1440,terrain[target] if mode=='terrain' else None,
                                missing,far[target] if mode=='terrain' else -90,AZ)
                            rec[f'{mode}_{target}_intervals']=intervals
                            rec[f'{mode}_{target}']=metrics(intervals)
                result['days'].append(rec)
                if old_state and str(day) in old_state['profiles']:
                    result['profiles'][str(day)]=old_state['profiles'][str(day)]
                    continue
                if height==2:
                    blocked=[(b-a,a,b) for a,b,state in rec['terrain_earth_intervals'] if state=='terrain-blocked']
                    if blocked:
                        _,a,b=max(blocked)
                        t=round((a+b)/(2*STEP))*STEP
                        if a<t<b:
                            profile_times[day]=t
                if day in profile_times:
                    t,az,el=result['earth'][profile_times[day]//STEP]
                    points,crest=make_terrain(grids,lat,lon,height,2,EXTENT,RADIAL,AZ,az)
                    result['profiles'][str(day)]=[t,az,el,points,crest]
            pack['heights'][str(height)]=result
        payload['sites'].append(pack)
    payload['bodyVectors']={key:values.round(1).tolist() for key,values in [('earth',earth),('sun',sun)]}
    (args.out/'data.js').write_text('window.LUNAR_DATA='+json.dumps(payload,separators=(',',':'),allow_nan=False)+';\n','utf8')
    export_intervals(payload, args.out/'intervals.csv')
    # Load the grid on demand. Keep each piece below the hosting limit.
    raster = gzip.compress(base_grid.raster.tobytes(),compresslevel=5,mtime=0)
    chunk = (len(raster)+1)//2
    for i in range(2):
        (args.out/f'lola-custom-{i+1}.bin').write_bytes(raster[i*chunk:(i+1)*chunk])
    print('Built',len(payload['sites']),'sites across',DAYS,'days',flush=True)


if __name__=='__main__':
    main()
