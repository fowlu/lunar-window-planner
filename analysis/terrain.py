"""Rebuild Lunar Window from the NASA PDS grids and NASA JPL Horizons."""
import csv
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
import argparse
import shutil
import numpy as np

PDS = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/'
MIT = 'https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/'
JPL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
START = datetime(2026, 11, 14, tzinfo=timezone.utc)
DAYS = 12
HEIGHTS = (2, 5)
SITES = [('malapert', 'Malapert Massif', -85.9948, -.23578),
         ('gerlache', 'de Gerlache Rim 2', -88.23, -64.6284)]
PRODUCTS = [('LDEM_75S_240M', MIT), ('LDEM_80S_80M', PDS)]


def obtain(path, url):
    if not path.exists():
        temp = path.with_suffix(path.suffix + '.part')
        with urlopen(url, timeout=60) as source, temp.open('wb') as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
        temp.replace(path)
    return path


class Grid:
    def __init__(self, folder, stem, base):
        def url(ext):
            text = stem + '.' + ext
            return base + (text.lower() if base == PDS else text)
        label_path = obtain(folder / (stem + '.LBL'), url('LBL'))
        self.label = label_path.read_text()
        def field(name):
            return re.search(r'^\s*' + name + r'\s*=\s*([^\r\n<]+)', self.label, re.M)[1].strip()
        assert field('SAMPLE_TYPE') == 'LSB_INTEGER' and field('SAMPLE_BITS') == '16'
        assert field('CENTER_LATITUDE') == '-90' and field('CENTER_LONGITUDE') == '0'
        assert 'MEAN EARTH/POLAR AXIS OF DE421' in field('COORDINATE_SYSTEM_NAME')
        self.radius = float(field('OFFSET'))
        self.quant = float(field('SCALING_FACTOR'))
        self.scale = float(field('MAP_SCALE'))
        self.maxlat = float(field('MAXIMUM_LATITUDE'))
        self.row0 = float(field('LINE_PROJECTION_OFFSET')) - .5
        self.col0 = float(field('SAMPLE_PROJECTION_OFFSET')) - .5
        self.minimum = int(field('DERIVED_MINIMUM'))
        self.maximum = int(field('DERIVED_MAXIMUM'))
        if not np.isfinite(self.minimum + self.maximum):
            raise ValueError('Missing PDS sample limits')
        image = obtain(folder / (stem + '.IMG'), url('IMG'))
        n, m = int(field('LINES')), int(field('LINE_SAMPLES'))
        if image.stat().st_size != n * m * 2:
            raise ValueError(f'{stem}: raster byte count disagrees with label')
        self.raster = np.memmap(image, '<i2', mode='r', shape=(n, m))
        self.meta = dict(id=stem, version=field('PRODUCT_VERSION_ID').strip('"'),
                         mapScaleM=self.scale, source=url('IMG'), label=url('LBL'),
                         latLimit=self.maxlat, sha256=hashlib.file_digest(image.open('rb'), 'sha256').hexdigest())

    def sample(self, lat, lon):
        rho = 2 * self.radius * np.tan((lat + np.pi / 2) / 2)
        col = self.col0 + rho * np.sin(lon) / self.scale
        row = self.row0 - rho * np.cos(lon) / self.scale
        i, j = np.floor(row).astype(int), np.floor(col).astype(int)
        n, m = self.raster.shape
        use = (i >= 0) & (i < n-1) & (j >= 0) & (j < m-1) & (lat <= np.radians(self.maxlat))
        i, j = np.clip(i, 0, n-2), np.clip(j, 0, m-2)
        a, b = np.clip(row-i,0,1), np.clip(col-j,0,1)
        cells = [self.raster[i,j], self.raster[i+1,j], self.raster[i,j+1], self.raster[i+1,j+1]]
        for c in cells:
            use &= (c >= self.minimum) & (c <= self.maximum)
        z = cells[0]*(1-a)*(1-b) + cells[1]*a*(1-b) + cells[2]*(1-a)*b + cells[3]*a*b
        return np.where(use, z*self.quant, np.nan)


def enu(lat, lon):
    p, q = np.radians([lat, lon])
    up = np.array([np.cos(p)*np.cos(q), np.cos(p)*np.sin(q), np.sin(p)])
    east = np.array([-np.sin(q), np.cos(q), 0])
    north = np.cross(up, east)
    return up, east, north


def make_terrain(grids, lat, lon, height, panel_height, distance_limit, rad_step, az_step, profile_az=None):
    radius = grids[0].radius
    up, east, north = enu(lat, lon)
    lat0, lon0 = np.radians([lat, lon])
    def terrain(p, l):
        values = grids[0].sample(p, l)
        for grid in grids[1:]:
            fine = grid.sample(p, l)
            values = np.where(np.isfinite(fine), fine, values)
        return values
    ground = float(terrain(lat0, lon0))
    if not np.isfinite(ground):
        raise ValueError('Site location falls outside usable raster coverage')
    distances = np.arange(rad_step, distance_limit + .01, rad_step)
    angles = np.arange(0, 360, az_step) if profile_az is None else np.atleast_1d(profile_az)
    records = {'earth': [], 'sun': []}
    coverage = []
    for group in np.array_split(angles, max(1, int(len(angles)/90))):
        bearings = np.radians(group)[:, None, None]
        tangents = np.sin(bearings)*east + np.cos(bearings)*north
        separation = distances[None,:,None]/radius
        units = np.cos(separation)*up + np.sin(separation)*tangents
        p = np.arcsin(units[:,:,2])
        l = np.arctan2(units[:,:,1],units[:,:,0])
        z = terrain(p,l)
        pos = units*(radius+z[:,:,None])
        missing = ~np.isfinite(z)
        coverage.extend(np.any(missing,axis=1).tolist())
        for key, h in [('earth',height),('sun',panel_height)]:
            d = pos - (radius+ground+h)*up
            u = d[:,:,0]*up[0]+d[:,:,1]*up[1]+d[:,:,2]*up[2]
            horizontal = np.sqrt(np.maximum(0,np.sum(d*d,axis=2)-u*u))
            values = np.degrees(np.arctan2(u,horizontal))
            ix = np.argmax(np.where(missing,-np.inf,values),axis=1)
            if profile_az is not None:
                take=sorted({*range(0,len(distances),max(1,round(150/rad_step))),int(ix[0]),len(distances)-1})
                points=[[0,-height]]+[[round(float(horizontal[0,i]),2),
                    None if missing[0,i] else round(float(u[0,i]),2)] for i in take]
                i=ix[0]
                return [points,[float(values[0,i]),float(horizontal[0,i]),float(u[0,i]),
                                float(np.degrees(p[0,i])),float(np.degrees(l[0,i]))]]
            for n,i in enumerate(ix):
                if np.isfinite(values[n,i]):
                    records[key].append([round(float(values[n,i]),5), round(float(horizontal[n,i]),2),
                                         round(float(u[n,i]),2), round(float(np.degrees(p[n,i])),6),
                                         round(float(np.degrees(l[n,i])),6)])
                else:
                    records[key].append(None)
    # Conservative outside-of-search upper envelope, contingent on 12 km global relief cap.
    theta = distance_limit/radius
    far = {}
    for key,h in [('earth',height),('sun',panel_height)]:
        top = radius + 12000
        far[key] = float(np.degrees(np.arctan2(top*np.cos(theta)-(radius+ground+h), top*np.sin(theta))))
    return ground, records, coverage, far


def jpl_request(folder, site, alt, target, spacing, begin=START, stop=START+timedelta(days=DAYS)):
    sid, _, lat, lon = site
    params = dict(format='text', COMMAND=f"'{target}'", CENTER="'coord@301'",
                  COORD_TYPE="'GEODETIC'", SITE_COORD=f"'{lon},{lat},{alt/1000:.8f}'",
                  EPHEM_TYPE="'OBSERVER'", START_TIME=f"'{begin:%Y-%m-%d %H:%M}'",
                  STOP_TIME=f"'{stop:%Y-%m-%d %H:%M}'", STEP_SIZE=f"'{spacing} m'",
                  QUANTITIES="'4'", CSV_FORMAT="'YES'")
    url = JPL + '?' + urlencode(params)
    path = folder / f'{sid}_{alt:.4f}_{target}_{spacing}_{begin:%m%d%H%M}_{stop:%m%d%H%M}.txt'
    raw = obtain(path,url).read_text(encoding='utf-8')
    if '$$SOE' not in raw or 'MEAN_ME' not in raw or '1737.4, 1737.4, 1737.4' not in raw:
        raise ValueError(raw[:700])
    match = re.search(r'Center geodetic\s*:\s*([^\r\n{]+)',raw)
    glon,glat,galt = map(float,match[1].split(','))
    if abs((glon-lon+180)%360-180)>2e-5 or abs(glat-lat)>2e-5 or abs(galt*1000-alt)>.2:
        raise ValueError('Horizons observer mismatch')
    track = []
    for line in raw.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines():
        cols = [part.strip() for part in line.split(',')]
        when = datetime.strptime(cols[0],'%Y-%b-%d %H:%M').replace(tzinfo=timezone.utc)
        track.append([int((when-START).total_seconds()/60),float(cols[3]),float(cols[4])])
    expected = int((stop-begin).total_seconds()/60/spacing)+1
    if len(track)!=expected or any(b[0]-a[0]!=spacing for a,b in zip(track,track[1:])):
        raise ValueError('Horizons time rows incomplete')
    return track,url


def intervals(times, elevation, horizon, unknown, far):
    rows = []
    for i in range(len(times)-1):
        start,end=times[i:i+2]
        a,b=elevation[i:i+2]
        x,y=horizon[i:i+2]
        if not all(np.isfinite(v) for v in (a,b,x,y)):
            rows.append((start,end,'unknown'))
            continue
        def crossing(v,w):
            return [-v/(w-v)] if v*w<0 else []
        fractions = sorted({0,1,*crossing(a-x,b-y),*crossing(a,b),*crossing(a-far,b-far)})
        for l,r in zip(fractions,fractions[1:]):
            mid=(l+r)/2
            el=a+(b-a)*mid
            h=x+(y-x)*mid
            state = ('terrain-blocked' if el>0 else 'below-tangent') if el<=h else (
                'unknown' if unknown[i] or unknown[i+1] or el<=far else
                'visible' if el>0 else 'visible-below-tangent')
            rows.append((start+(end-start)*l,start+(end-start)*r,state))
    merged=[]
    for start,end,state in rows:
        if merged and merged[-1][2]==state:
            merged[-1]=(merged[-1][0],end,state)
        else:
            merged.append((start,end,state))
    return merged


def metrics(rows):
    visible=0; first=None; lower=upper=blocked=0; run0=run1=0
    for a,b,state in rows:
        length=b-a
        if state.startswith('visible'):
            visible+=length
            if first is None: first=a-rows[0][0]
            run0=run1=0
        else:
            run1+=length
            run0=0 if state=='unknown' else run0+length
            if state=='terrain-blocked':blocked+=length
        lower=max(lower,run0);upper=max(upper,run1)
    return dict(visible=visible, first=first, lower=lower, upper=upper, terrainBlocked=blocked,
                unknown=sum(b-a for a,b,s in rows if s=='unknown'))


def angle_samples(records, missing, az, step):
    marks=[row[0] if row else np.nan for row in records]
    n=len(marks)
    def pair(a):
        q=(a%360)/step
        left=int(q)%n
        right=(left+1)%n
        return (marks[left]+(marks[right]-marks[left])*(q-int(q)),missing[left] or missing[right])
    return list(zip(*(pair(a) for a in az)))


def evaluate(track, cutoff, horizon=None, missing=None, far=-90, step=.1):
    rows=[row for row in track if cutoff<=row[0]<=cutoff+1440]
    times,az,el=map(list,zip(*rows))
    if horizon is None:
        hs,un=[0]*len(rows),[False]*len(rows)
    else:
        hs,un=angle_samples(horizon,missing,az,step)
    return intervals(times,el,hs,un,far)


def check():
    assert metrics(intervals([0,60,120],[1,1,1],[0,2,0],[0,0,0],-90))['lower']==60
    assert metrics(intervals([0,60],[1,1],[0,0],[0,0],-90))['visible']==60
    assert metrics(intervals([0,60],[-1,-1],[0,0],[0,0],-90))['upper']==60
    assert metrics(intervals([0,60],[1,1],[0,0],[1,0],-90))['unknown']==60
    assert metrics(intervals([0,60],[-1,-1],[-2,-2],[0,0],-90))['visible']==60
    h,_=angle_samples([[0],[1],[2],[3]],[False]*4,[315,0],90)
    assert tuple(h)==(1.5,0)
    u,e,n=enu(-85.9948,-.23578)
    assert np.allclose(np.array([u,e,n]) @ np.array([u,e,n]).T,np.eye(3),atol=1e-13)


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--cache',type=Path,default=Path('cache'))
    cli.add_argument('--out',type=Path,default=Path('results'))
    cli.add_argument('--fine',action='store_true',help='rerun with 5 min and finer terrain rays')
    cli.add_argument('--coarse-only',action='store_true',help='use only the 240 m grid')
    cli.add_argument('--extended',action='store_true',help='check coverage to 270 km')
    args=cli.parse_args()
    check()
    args.cache.mkdir(parents=True,exist_ok=True)
    args.out.mkdir(parents=True,exist_ok=True)
    use=PRODUCTS[:1] if args.coarse_only else PRODUCTS
    with ThreadPoolExecutor() as pool:
        grids=list(pool.map(lambda data:Grid(args.cache,*data),use))
    assert len({g.radius for g in grids})==1
    spacing=5 if args.fine else 10
    az_step=.05 if args.fine else .1
    rad_step=20 if args.fine else (120 if args.coarse_only else 40)
    extent=270000 if args.extended else 210000
    data=dict(epoch=START.isoformat(),days=DAYS,azStep=az_step,timeStep=spacing,rankingToleranceMinutes=30,
              radialStep=rad_step,extent=extent,products=[g.meta for g in grids],sites=[])
    all_rows=[]
    for site in SITES:
        sid,name,lat,lon=site
        pack=dict(id=sid,name=name,lat=lat,lon=lon,heights={})
        profile_times={}
        for height in HEIGHTS:
            ground,terrain,missing,far=make_terrain(grids,lat,lon,height,2,extent,rad_step,az_step)
            print(name, height,'ground',round(ground,2),'missing directions',sum(missing),flush=True)
            with ThreadPoolExecutor() as pool:
                er=pool.submit(jpl_request,args.cache,site,ground+height,399,spacing)
                su=pool.submit(jpl_request,args.cache,site,ground+2,10,spacing)
                earth,earth_url=er.result()
                sun,sun_url=su.result()
            result=dict(ground=round(ground,3),terrain=terrain,missing=missing,far=far,
                        earth=earth,sun=sun,queries=[earth_url,sun_url],days=[], profiles={})
            for day in range(DAYS):
                rec={}
                for mode in ['flat','terrain']:
                    for target in ['earth','sun']:
                        intervals_=evaluate(result[target],day*1440,
                            terrain[target] if mode=='terrain' else None,missing,far[target] if mode=='terrain' else -90,az_step)
                        rec[mode+'_'+target]=metrics(intervals_)
                        rec[mode+'_'+target+'_intervals']=intervals_
                        if height==2:
                            for a,b,status in intervals_:
                                stamps=[(START+timedelta(minutes=round(t))).strftime('%Y-%m-%dT%H:%M:%S.000Z') for t in (day*1440,a,b)]
                                reason={'visible':'Visible','visible-below-tangent':'Visible below flat tangent',
                                        'terrain-blocked':'Terrain blocked','below-tangent':'Blocked below the flat tangent',
                                        'unknown':'Unknown coverage'}[status]
                                all_rows.append([sid,stamps[0],mode,target,*stamps[1:],status,reason,round(b-a,1),height,2,
                                                 'JPL Horizons' + (' + LOLA' if mode=='terrain' else '')])
                result['days'].append(rec)
                if height==HEIGHTS[0]:
                    spans=[(b-a,a,b) for a,b,state in rec['terrain_earth_intervals'] if state=='terrain-blocked']
                    if spans:
                        _,a,b=max(spans)
                        mid=min(earth,key=lambda t: abs(t[0]-(a+b)/2))
                        if a<mid[0]<b:
                            profile_times[day]=mid[0]
                if day in profile_times:
                    t,az,el=earth[profile_times[day]//spacing]
                    points,crest=make_terrain(grids,lat,lon,height,2,extent,rad_step,az_step,az)
                    result['profiles'][str(day)]=[t,az,el,points,crest]
            pack['heights'][str(height)]=result
        data['sites'].append(pack)
    with (args.out/'data.js').open('w',encoding='utf8') as f:
        f.write('window.LUNAR_DATA='+json.dumps(data,separators=(',',':'),allow_nan=False)+';\n')
    with (args.out/'intervals.csv').open('w',newline='',encoding='utf8') as f:
        w=csv.writer(f);w.writerow(['site','scenario','mode','target','start_utc','end_utc','status','reason',
                                    'duration_min','antenna_m','panel_m','provenance']);w.writerows(all_rows)
    for day in range(DAYS):
        print((START+timedelta(days=day)).date(),[(s['id'],[
            tuple(round(s['heights']['2']['days'][day][key][item],1)/60 for item in ('lower','upper','terrainBlocked','visible','unknown'))
            for key in ('flat_earth','terrain_earth','terrain_sun')]) for s in data['sites']])


if __name__=='__main__':
    main()
