'use strict';

const data = window.LUNAR_DATA;
const $ = id => document.getElementById(id);
function element(tag,text='',className=''){
  const node=document.createElement(tag);
  if(text)node.textContent=text;
  if(className)node.className=className;
  return node;
}
const labels = {
  visible:'Visible', 'visible-below-tangent':'Visible below flat tangent', 'terrain-blocked':'Terrain blocked',
  'below-tangent':'Blocked below the flat tangent', unknown:'Unknown coverage'
};
const utc = minutes => new Date(Date.parse(data.epoch)+Math.round(minutes)*60000).toISOString();
const stamp = minutes => utc(minutes).slice(0,16).replace('T',' ')+' UTC';
const elapsed = minutes => (minutes/60).toFixed(1)+' h';
const byId = id => activeCustom?.id===id ? activeCustom : data.sites.find(site=>site.id===id);
const wrap = az => ((az%360)+360)%360;
const clock = minutes => utc(minutes).slice(0,16);
const epoch = Date.parse(data.epoch);
const total = data.days*1440;
const toMinutes = value => (Date.parse(value+'Z')-epoch)/60000;
const histories=new Map();
const maxSpan=30*1440;
const demoStart=4320;
let activeCustom, worker, skyCache, pendingInspect, customBusy=false;
let windowStart=demoStart, windowSpan=1440, pendingWindow;
let horizonMode='terrain', playFrame=0, advisorRequest;
const rankingTolerance=data.rankingToleranceMinutes||data.timeStep;

function state(){
  return {start:windowStart,span:windowSpan,
    mode:horizonMode,height:$('height').value,selected:byId($('site').value),
    comparison:byId($('compareSite').value),t:Number($('cursor').value)};
}
function formatBound(m){
  return m.unknown>1e-7 ? elapsed(m.lower)+' – '+elapsed(m.upper) : elapsed(m.lower);
}
function inspectionState(){
  const s=state();
  return {...s,selected:byId($('inspectSite').value)||s.selected};
}
function timeline(site,height,mode,target){
  const key=[site.id,height,mode,target].join('/');
  if(!histories.has(key)){
    const result=site.heights[height];
    const records=result.days ? result.days.flatMap(d=>d[mode+'_'+target+'_intervals']) : calculateIntervals(result,mode,target);
    histories.set(key,records);
  }
  return histories.get(key);
}
function calculateIntervals(result,mode,target){
  const track=result[target];
  const flat=mode==='flat';
  const far=flat?-90:result.far[target];
  const samples=track.map(([t,az,el])=>{
    const horizon=flat?[0]:terrainAt(result.terrain[target],az);
    const i=Math.floor(az)%360;
    return [t,el,horizon?.[0],!flat&&(result.missing[i]||result.missing[(i+1)%360])];
  });
  const rows=[];
  const add=(a,b,label)=>{
    if(rows.at(-1)?.[2]===label)rows.at(-1)[1]=b;
    else rows.push([a,b,label]);
  };
  for(let i=1;i<samples.length;i++){
    const [t0,e0,h0,missing0]=samples[i-1],[t1,e1,h1,missing1]=samples[i];
    if(!Number.isFinite(h0)||!Number.isFinite(h1)){
      add(t0,t1,'unknown');
      continue;
    }
    const cuts=[0,1];
    for(const [a,b] of [[e0-h0,e1-h1],[e0,e1],[e0-far,e1-far]]){
      if(a*b<0)cuts.push(-a/(b-a));
    }
    cuts.sort((a,b)=>a-b);
    for(let j=1;j<cuts.length;j++){
      const a=cuts[j-1],b=cuts[j];
      if(a===b)continue;
      const mid=(a+b)/2,el=e0+(e1-e0)*mid,h=h0+(h1-h0)*mid;
      const status=el<=h ? (el>0?'terrain-blocked':'below-tangent') :
        (missing0||missing1||el<=far ? 'unknown' : (el>0?'visible':'visible-below-tangent'));
      add(t0+(t1-t0)*a,t0+(t1-t0)*b,status);
    }
  }
  return rows;
}
function intervalStatus(rows,t){
  let lo=0,hi=rows.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(t<rows[mid][1])hi=mid;
    else lo=mid+1;
  }
  return rows[lo]?.[2] || 'unknown';
}
function measure(site,height,mode,target,start,span){
  const rows=[];
  let visible=0, first=null, lower=0, upper=0, runKnown=0, runPossible=0, unknown=0;
  for(const [from,to,status] of timeline(site,height,mode,target)){
    if(to<=start)continue;
    if(from>=start+span)break;
    const a=Math.max(from,start),b=Math.min(to,start+span),length=b-a;
    const previous=rows.at(-1);
    if(previous?.[2]===status)previous[1]=b;
    else rows.push([a,b,status]);
    if(status.startsWith('visible')){
      visible+=length;
      if(first===null)first=a-start;
      runKnown=runPossible=0;
    }else{
      runPossible+=length;
      if(status==='unknown'){runKnown=0;unknown+=length;}
      else runKnown+=length;
      lower=Math.max(lower,runKnown);upper=Math.max(upper,runPossible);
    }
  }
  return {lower,upper,visible,first,unknown,rows};
}
function outcomes(site,s,start=s.start,mode=s.mode){
  return ['earth','sun'].map(target=>measure(site,s.height,mode,target,start,s.span));
}
function lane(label,rows,base,t,span,site){
  const line=document.createElement('div');
  line.className='track';
  const key=document.createElement('span');
  key.className='small';key.textContent=label;
  const bar=document.createElement('button');
  bar.type='button';
  bar.className='lane';
  bar.setAttribute('aria-label','Inspect '+site.name+' '+label+' timeline');
  bar.addEventListener('click',event=>{
    const rect=bar.getBoundingClientRect();
    const ratio=event.detail ? Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)) : state().t/span;
    stopPlayback();
    $('cursor').value=Math.round(ratio*span);
    $('inspectSite').value=site.id;
    refreshInspection();
    $('cursor').focus({preventScroll:true});
  });
  for(const [a,b,status] of rows){
    const seg=document.createElement('span');
    seg.className='segment '+status;
    seg.style.left=((a-base)/span*100)+'%';
    seg.style.width=((b-a)/span*100)+'%';
    seg.title=labels[status]+' · '+stamp(a)+' to '+stamp(b);
    bar.append(seg);
  }
  const cursor=document.createElement('span');
  cursor.className='position';cursor.style.left=Math.min(99.7,t/span*100)+'%';
  bar.append(cursor);
  line.append(key,bar);
  return line;
}
function siteCard(site,s,option){
  const [m,solar]=outcomes(site,s);
  const card=document.createElement('article');
  const name=document.createElement('h4');
  name.textContent=site.name;
  const stats=document.createElement('dl');
  stats.className='stats';
  const report=readDeadline(s);
  const status=report===null ? '' : LunarDecision.eligibility(option,report);
  const metrics=[
    ['Longest Earth blackout',LunarDecision.display(option.blackout,'blackout')],
    ['First Earth sightline',LunarDecision.display(option.earliest,'earliest')],
    ['Earth visibility',visibilityPercent(m,s.span)],
    ['Potential sunlight',LunarDecision.display(option.sunlight,'sunlight')+' · '+visibilityPercent(solar,s.span)]
  ];
  for(const [label,value] of metrics){
    const row=element('div');
    row.append(element('dt',label),element('dd',value));
    stats.append(row);
  }
  card.append(name,stats);
  if(status){
    const note=document.createElement('p');
    note.className='caption';
    note.textContent={eligible:'Meets modeled report deadline',excluded:'Misses modeled report deadline',uncertain:'Report deadline uncertain'}[status];
    card.append(note);
  }
  card.append(lane('Earth',m.rows,s.start,s.t,s.span,site),lane('Sun',solar.rows,s.start,s.t,s.span,site));
  return card;
}
function compare(s,start=s.start,mode=s.mode){
  return [s.selected,s.comparison].map(site=>
    LunarDecision.option(site,start,s.span,...outcomes(site,s,start,mode)));
}
function evidenceTable(headers,rows){
  const table=element('table','','evidence-table');
  const head=element('thead'),top=element('tr'),body=element('tbody');
  for(const label of headers){
    const cell=element('th',label);
    cell.setAttribute('scope','col');
    top.append(cell);
  }
  head.append(top);
  for(const [name,...values] of rows){
    const row=element('tr'),cell=element('th',name);
    cell.setAttribute('scope','row');
    row.append(cell,...values.map(value=>element('td',value)));
    body.append(row);
  }
  table.append(head,body);
  return table;
}
function blackoutLabel(option){
  return LunarDecision.display(option.blackout,'blackout');
}
function renderHeightResults(s){
  const byHeight=['2','5'].map(height=>compare({...s,height}));
  const rows=byHeight[0].map((option,i)=>[option.name,...byHeight.map(set=>blackoutLabel(set[i]))]);
  $('heightResults').replaceChildren(evidenceTable(['Landing site','2 m','5 m'],rows));
}
function renderDemoSummary(){
  const [selected,comparison]=data.sites;
  const s={selected,comparison,start:demoStart,span:1440,height:'2',mode:'terrain'};
  const modeled=compare(s),alternate=compare({...s,height:'5'});
  const summary=$('demoSummary');
  summary.replaceChildren(
    element('strong','17 Nov · 24-hour demo'),
    element('span','Terrain favors '+comparison.name+'. At 2 m, its longest Earth blackout is '+
      blackoutLabel(modeled[1])+' versus '+blackoutLabel(modeled[0])+' at Malapert. At 5 m, Malapert falls to '+
      blackoutLabel(alternate[0])+'.')
  );
}
function renderValidation(){
  const validation=window.LUNAR_VALIDATION;
  if(!validation){
    $('validationSummary').textContent='Validation results are available in the bundled README.';
    return;
  }
  const cases=validation.cases;
  const max=(key,rows=cases)=>Math.max(...rows.map(row=>row[key]));
  const earth=cases.filter(row=>row.target==='earth');
  const rounded=degree=>degree.toFixed(6)+'°';
  const samples=cases.reduce((sum,row)=>sum+row.count,0);
  $('validationSummary').textContent='Across '+samples.toLocaleString('en-US')+
    ' paired Earth and Sun samples at two sites, the largest difference from separately queried Horizons directions was '+
    rounded(max('maxAzDeg'))+' in bearing and '+rounded(max('maxElDeg'))+
    ' in elevation. The longest modeled Earth outage shifted by '+max('maxWindowShiftMin',earth).toFixed(4)+' minutes or less in the checked 24-hour UTC windows.';
  const rows=cases.map(row=>[row.site+' · '+(row.target==='earth'?'Earth':'Sun')+' · '+row.height+' m',
    rounded(row.maxAzDeg),rounded(row.maxElDeg),row.maxWindowShiftMin.toFixed(4)+' min']);
  $('validationTable').replaceChildren(evidenceTable(['Observer and target','Bearing difference','Elevation difference','Largest outage shift'],rows));
  $('dailySensitivity').textContent='At 2 m with terrain enabled, the two sites can be ranked under the 30-minute rule in '+
    validation.dailyRanked+' of '+validation.dailyWindows+
    ' fixed 24-hour UTC windows. A blackout can span multiple days, so the count depends on where the windows start and end.';
  const demo=earth.find(row=>row.height===2&&row.site===data.sites[0].name);
  $('limbSummary').textContent='The model follows each body’s center. At Malapert in the 2 m demo, Earth’s center was within one apparent Earth radius of the skyline at '+
    demo.nearLimbSamples+' of '+demo.demoSampleCount+
    ' samples. This flags possible partial visibility along the center bearing. Full-disc visibility also depends on nearby bearings.';
}
function readDeadline(s){
  const field=$('deadline');
  const minutes=Number(field.value)*60;
  return field.value && minutes>=0 && minutes<=s.span ? minutes : null;
}
function renderReversal(s,options,priority,deadline,current){
  const otherMode=s.mode==='terrain'?'flat':'terrain';
  const other=compare(s,s.start,otherMode);
  const alternative=LunarDecision.rank(other,priority,deadline,rankingTolerance);
  const el=$('reversal');
  if(!current.winner||!alternative.winner||current.winner.siteId===alternative.winner.siteId){
    el.textContent='';
    return;
  }
  const flat=s.mode==='flat'?options:other;
  const terrain=s.mode==='terrain'?options:other;
  const values=rows=>rows.map(row=>LunarDecision.display(row[priority],priority)).join(' vs ');
  el.textContent='Terrain reverses the recommendation. Flat reference gives '+values(flat)+
    ' and LOLA terrain gives '+values(terrain)+' for '+s.selected.name+' vs '+s.comparison.name+'.';
}
function sample(track,t){
  const i=Math.min(track.length-2,Math.floor(t/data.timeStep)), q=(t-track[i][0])/data.timeStep;
  const [,a,e]=track[i], [,b,f]=track[i+1];
  return [wrap(a+(((b-a+540)%360)-180)*q),e+(f-e)*q];
}
function terrainAt(records,az){
  const v=wrap(az)*records.length/360,i=Math.floor(v)%records.length;
  const a=records[i],b=records[(i+1)%records.length];
  if(!a||!b)return null;
  return a.map((value,j)=>j===0?value+(b[j]-value)*(v-Math.floor(v)):records[Math.round(v)%records.length][j]);
}
function visibilityPercent(m,span){
  const pct=minutes=>(minutes/span*100).toFixed(1)+'%';
  return m.unknown>1e-7 ? pct(m.visible)+' – '+pct(m.visible+m.unknown) : pct(m.visible);
}
function renderMission(s){
  const [earth,sun]=outcomes(s.selected,s);
  const cards=[
    ['Sun visible',visibilityPercent(sun,s.span),'Potential solar exposure at 2 m'],
    ['Longest darkness',formatBound(sun),'Continuous modeled solar shadow'],
    ['Earth visible',visibilityPercent(earth,s.span),'Direct line of sight at '+s.height+' m']
  ];
  $('missionMetrics').replaceChildren(...cards.map(([label,value,help])=>{
    const item=element('article','','metric-row');
    item.append(element('p',label,'metric-label'),element('p',value,'metric-value'),element('p',help,'caption'));
    return item;
  }));
  const alerts=[];
  if(!earth.visible&&!earth.unknown)alerts.push('No direct Earth sightline in this window. Evaluate relay coverage or another site or date.');
  if(sun.visible+sun.unknown<s.span*.5)alerts.push('High shadow exposure. Check energy storage against the longest dark interval.');
  if(earth.unknown>1e-7||sun.unknown>1e-7)alerts.push('Some bearings have uncertain terrain coverage. The displayed ranges include those intervals.');
  $('missionAlerts').replaceChildren(...alerts.map(alert=>element('p',alert,'mission-alert')));
  const ticks=element('div','','scale'),marks=element('div','','ticks');
  marks.append(...[0,.25,.5,.75,1].map(f=>element('span',elapsed(f*s.span))));
  ticks.append(element('span'),marks);
  $('missionTimeline').replaceChildren(ticks,lane('Sun',sun.rows,s.start,s.t,s.span,s.selected),lane('Earth',earth.rows,s.start,s.t,s.span,s.selected));
}
function chartContext(id){
  const canvas=$(id),w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h)return null;
  const ratio=Math.min(window.devicePixelRatio||1,2),c=canvas.getContext('2d');
  canvas.width=w*ratio;canvas.height=h*ratio;c.scale(ratio,ratio);
  c.font='12px system-ui';
  return {c,w,h};
}
function drawClearance(s,result){
  const ctx=chartContext('clearanceChart');
  if(!ctx)return;
  const {c,w,h}=ctx,left=52,right=w-18,top=20,bottom=h-28;
  const x=t=>left+(right-left)*t/s.span;
  const tracks=['earth','sun'].map(key=>{
    const times=[0];
    const stride=Math.max(data.timeStep,Math.ceil(s.span/(550*data.timeStep))*data.timeStep);
    for(let t=stride;t<s.span;t+=stride)times.push(t);
    times.push(s.span);
    return times.map(t=>{
      const [az,el]=sample(result[key],s.start+t);
      const terrain=s.mode==='flat'?[0]:terrainAt(result.terrain[key],az);
      return [t,terrain?el-terrain[0]:null];
    });
  });
  const vals=tracks.flatMap(track=>track.map(row=>row[1])).filter(Number.isFinite);
  const min=Math.min(-1,...vals),max=Math.max(1,...vals),ys=v=>bottom-(bottom-top)*(v-min)/(max-min);
  const line=(ax,ay,bx,by,color,dash=[])=>{
    c.strokeStyle=color;c.setLineDash(dash);c.beginPath();c.moveTo(ax,ay);c.lineTo(bx,by);c.stroke();c.setLineDash([]);
  };
  c.fillStyle='#afbbcb';
  for(const degree of [min,(min+max)/2,max]){
    line(left,ys(degree),right,ys(degree),'#3b4c60');
    c.fillText(degree.toFixed(1)+'°',3,ys(degree)+4);
  }
  line(left,ys(0),right,ys(0),'#d4deed',[4,4]);
  for(const [i,track] of tracks.entries()){
    c.strokeStyle=i?'#ffbd87':'#8ccaff';c.beginPath();let open=false;
    for(const [t,a] of track){
      if(a===null){open=false;continue;}
      if(open)c.lineTo(x(t),ys(a));else c.moveTo(x(t),ys(a));
      open=true;
    }
    c.stroke();
  }
  line(x(s.t),top,x(s.t),bottom,'#ffffff');
  c.textAlign='left';c.fillText('0 h',left,bottom+19);
  c.textAlign='right';c.fillText(elapsed(s.span),right,bottom+19);
}
function draw(profile,crest,earthAz,elevation){
  const ctx=chartContext('profile');
  if(!ctx)return;
  const {c,w,h}=ctx;
  const left=55,right=w-18,top=22,bottom=h-35;
  const maxX=crest?Math.max(800,crest[1]*1.28):1000;
  const rayHeight=x=>Math.tan(elevation*Math.PI/180)*x;
  const pts=(profile||[]).filter(p=>p[0]<=maxX&&p[1]!==null);
  const values=[0,rayHeight(maxX),...pts.map(p=>p[1]),crest?crest[2]:0];
  const margin=Math.max(3,(Math.max(...values)-Math.min(...values))*.08);
  const minY=Math.min(...values)-margin,maxY=Math.max(...values)+margin;
  const x=v=>left+(right-left)*v/maxX,y=v=>bottom-(bottom-top)*(v-minY)/(maxY-minY);
  const line=(a,b,d,e,color,dash=[])=>{
    c.strokeStyle=color;c.setLineDash(dash);c.beginPath();c.moveTo(a,b);c.lineTo(d,e);c.stroke();c.setLineDash([]);
  };
  c.fillStyle='#afbbcb';
  for(let i=0;i<=4;i++){
    const v=minY+(maxY-minY)*i/4;
    line(left,y(v),right,y(v),'#3b4c60');
    c.fillText(Math.round(v)+' m',4,y(v)+4);
  }
  line(left,y(0),right,y(0),'#6b7c92',[2,4]);
  line(x(0),y(0),x(maxX),y(rayHeight(maxX)),'#8ccaff',[6,3]);
  if(pts.length){
    c.strokeStyle='#ffbd87';c.lineWidth=2;c.beginPath();
    c.moveTo(x(pts[0][0]),y(pts[0][1]));
    for(const [d,z] of pts.slice(1))c.lineTo(x(d),y(z));
    c.stroke();c.lineWidth=1;
  }
  for(const [d,z,color] of [[0,0,'#a7e5ca'],...(crest?[[crest[1],crest[2],'#ffbd87']]:[])]){
    c.fillStyle=color;c.beginPath();c.arc(x(d),y(z),4.5,0,Math.PI*2);c.fill();
  }
  c.fillStyle='#afbbcb';c.fillText('Horizontal distance from antenna (km)',left,bottom+32);
  for(let i=0;i<=4;i++){
    const v=maxX*i/4;c.textAlign=i===4?'right':i===0?'left':'center';
    c.fillText((v/1000).toFixed(maxX<2000?2:1),x(v),bottom+16);
  }
  c.textAlign='left';c.fillStyle='#8ccaff';c.fillText('Earth ray · '+earthAz.toFixed(1)+'° bearing',left,14);
  c.fillStyle='#a7e5ca';c.fillText('Antenna',left+6,y(0)-7);
  if(crest){const nearRight=x(crest[1])>w-120;c.textAlign=nearRight?'right':'left';
    c.fillStyle='#ffbd87';c.fillText('Horizon point',x(crest[1])+(nearRight?-7:7),y(crest[2])-7);}
}
function skyTracks(s,result){
  const tracks=['sun','earth'].map(target=>{
    const rows=timeline(s.selected,s.height,s.mode,target);
    const times=new Set([s.start,s.start+s.span]);
    const stride=Math.max(data.timeStep,Math.ceil(s.span/(420*data.timeStep))*data.timeStep);
    for(let t=s.start+stride;t<s.start+s.span;t+=stride)times.add(t);
    for(const [begin] of rows)if(begin>s.start&&begin<s.start+s.span)times.add(begin);
    return [...times].sort((a,b)=>a-b).map((t,i,list)=>{
      const [az,el]=sample(result[target],t);
      return [az,el,intervalStatus(rows,(t+(list[i+1]??t))/2)];
    });
  });
  return tracks;
}
function skyOverview(s,result,w,h){
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d');
  const left=39,right=w-10,top=17,bottom=h-29;
  c.font='11px system-ui';
  const points=skyTracks(s,result);
  const skyline=s.mode==='flat'?[0,0]:result.terrain.sun.map(p=>p?.[0]??null);
  const earthSkyline=s.mode==='terrain'&&s.height==='5'?result.terrain.earth.map(p=>p?.[0]??null):null;
  const values=[...skyline,...(earthSkyline||[]),...points.flatMap(track=>track.map(p=>p[1]))].filter(Number.isFinite);
  const high=Math.max(3,Math.ceil(Math.max(...values)+.5)),low=Math.min(-3,Math.floor(Math.min(...values)-.5));
  const x=az=>left+(right-left)*az/360,y=el=>bottom-(bottom-top)*(el-low)/(high-low);
  const line=(x0,y0,x1,y1)=>{
    c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();
  };
  const tick=Math.ceil((high-low)/5);
  c.fillStyle='#bed0e0';c.strokeStyle='#3e5366';
  for(let el=Math.ceil(low/tick)*tick;el<=high;el+=tick){
    line(left,y(el),right,y(el));
    c.fillText(el+'°',5,y(el)+3);
  }
  c.strokeStyle='#8191a4';c.setLineDash([3,5]);
  line(left,y(0),right,y(0));c.setLineDash([]);
  for(const [az,label] of [[0,'North'],[90,'East'],[180,'South'],[270,'West'],[360,'North']]){
    c.textAlign=az===0?'left':az===360?'right':'center';
    c.fillText(label,x(az),h-10);
  }
  c.save();
  c.beginPath();c.rect(left,top,right-left,bottom-top);c.clip();
  const drawSkyline=(profile,shade)=>{
    c.beginPath();
    let open=false,last=0,first=0;
    const close=()=>{
      if(shade){c.lineTo(last,bottom);c.lineTo(first,bottom);c.closePath();c.fill();}
      c.stroke();
    };
    for(let i=0;i<=profile.length;i++){
      const el=profile[i%profile.length];
      if(el===null){if(open)close();c.beginPath();open=false;continue;}
      last=x(i/profile.length*360);
      if(open)c.lineTo(last,y(el));else{first=last;c.moveTo(last,y(el));open=true;}
    }
    if(open)close();
  };
  c.fillStyle='#050b13';c.strokeStyle='#91a5b8';
  drawSkyline(skyline,true);
  if(earthSkyline){
    c.strokeStyle='#84b8d6';c.setLineDash([4,3]);drawSkyline(earthSkyline,false);c.setLineDash([]);
  }
  const colors=['#fbbf24','#38bdf8'];
  for(const [i,track] of points.entries()){
    c.strokeStyle=colors[i];
    for(let j=1;j<track.length;j++){
      const [az0,el0,status]=track[j-1],[az1,el1]=track[j];
      c.globalAlpha=status.startsWith('visible')?1:.39;
      c.lineWidth=status.startsWith('visible')?2.4:1.15;
      const diff=az1-az0;
      if(Math.abs(diff)<180){
        line(x(az0),y(el0),x(az1),y(el1));
      }else{
        const edge=diff>0?0:360,adjusted=az1+(diff>0?-360:360);
        const crossing=el0+(el1-el0)*(edge-az0)/(adjusted-az0);
        line(x(az0),y(el0),x(edge),y(crossing));
        line(x(360-edge),y(crossing),x(az1),y(el1));
      }
    }
  }
  c.restore();
  return {canvas,x,y,left,right,top,bottom};
}
function drawHorizon(s,result){
  const ctx=chartContext('visualizer-canvas');
  if(!ctx)return;
  const {c,w,h}=ctx;
  const key=[s.selected.id,s.height,s.mode,s.start,s.span,w,h].join('/');
  if(skyCache?.key!==key)skyCache={key,...skyOverview(s,result,w,h)};
  const {canvas,x,y}=skyCache;
  c.drawImage(canvas,0,0,w,h);
  const t=s.start+s.t;
  const readings=['sun','earth'].map((target,i)=>{
    const [az,el]=sample(result[target],t);
    const horizon=s.mode==='flat'?0:terrainAt(result.terrain[target],az)?.[0];
    const status=intervalStatus(timeline(s.selected,s.height,s.mode,target),t);
    const visible=status.startsWith('visible');
    c.strokeStyle=i?'#38bdf8':'#fbbf24';
    c.fillStyle=visible?c.strokeStyle:'#091523';
    c.lineWidth=2;c.beginPath();c.arc(x(az),y(el),5,0,2*Math.PI);c.fill();c.stroke();
    const direction=['North','Northeast','East','Southeast','South','Southwest','West','Northwest'][Math.round(az/45)%8];
    const outcome=visible?'Clear view':status==='unknown'?'Uncertain view':'Blocked';
    const relative=horizon===undefined?'Skyline unavailable':
      Math.abs(el-horizon).toFixed(1)+'° '+(el>=horizon?'above':'below')+' the selected horizon';
    const reading=element('p');
    reading.append(element('strong',(i?'Earth':'Sun')+' · '+outcome),
      element('span','Look '+direction.toLowerCase()),element('br'),element('span',relative));
    return reading;
  });
  $('skyReadout').replaceChildren(...readings);
}
function inspect(s){
  const result=s.selected.heights[s.height],t=s.start+s.t;
  const [az,el]=sample(result.earth,t);
  const profile=profilesInWindow(s).find(p=>p[0]===t);
  const exact=profile&&profile[0]===t;
  const crest=exact?profile[4]:terrainAt(result.terrain.earth,az);
  const conservative=crest&&el>crest[0]&&el<=result.far.earth;
  $('time').value=stamp(t)+' · '+elapsed(s.t)+' after touchdown';
  $('comparisonTime').textContent='Inspecting '+s.selected.name+' · '+stamp(t);
  $('profileText').textContent='Earth elevation '+el.toFixed(2)+'° · azimuth '+az.toFixed(2)+'°'+
    (crest?' · horizon '+crest[0].toFixed(2)+'° · clearance '+(el-crest[0]).toFixed(2)+'° · controlling terrain about '+
      (crest[1]/1000).toFixed(2)+' km away ('+Math.abs(crest[3]).toFixed(4)+(crest[3]<0?'° S, ':'° N, ')+
      Math.abs(crest[4]).toFixed(4)+(crest[4]<0?'° W)':'° E)'):' · terrain unavailable')+
    (conservative?' · beyond-grid obstruction stays possible.':'.')+
    (exact?' Orange line shows sampled LOLA terrain.':' The horizon point comes from the nearest sampled bearing.'+
      (s.selected.custom?' Custom sites show the horizon point and the Earth ray.':' Full cross-sections are available at selected blocked timestamps.'));
  $('jump').disabled=!measure(s.selected,s.height,'terrain','earth',s.start,s.span).rows.some(p=>p[2]==='terrain-blocked');
  if(s.mode==='flat')$('profileText').textContent+=' The cross-section still shows LOLA terrain for comparison with the flat reference.';
  const distance=crest?(crest[1]<1000?Math.round(crest[1])+' m':(crest[1]/1000).toFixed(1)+' km'):'';
  const status=intervalStatus(timeline(s.selected,s.height,'terrain','earth'),t);
  const plain=status==='unknown'?'These terrain data leave Earth visibility uncertain.':
    status.startsWith('visible')?'The modeled Earth sightline clears the terrain.':
    status==='below-tangent'?'Earth is below the skyline at this time.':
    (crest?'Terrain blocks Earth. The highest obstruction on this bearing is about '+distance+' away.':'The selected time has no modeled Earth sightline.');
  $('profileSummary').textContent=plain+(exact?' The orange line traces the ground.':
    (crest?' The orange dot marks the highest sampled terrain angle.':''))+
    (s.mode==='flat'?' This side view still uses LOLA terrain.':'');
  drawClearance(s,result);
  draw(exact?profile[3]:null,crest,az,el);
  drawHorizon(s,result);
}
function update(){
  stopPlayback();
  const s=state();
  const options=compare(s);
  const priority=$('priority').value,deadline=readDeadline(s);
  const result=LunarDecision.rank(options,priority,deadline,rankingTolerance);
  const verdict=$('verdict');
  verdict.dataset.result=result.kind;
  verdict.textContent=LunarDecision.describe(result,priority,deadline);
  $('scenario').textContent=stamp(s.start)+' → '+stamp(s.start+s.span)+' · '+s.height+' m antenna';
  $('cards').replaceChildren(...[s.selected,s.comparison].map((site,i)=>siteCard(site,s,options[i])));
  $('terrainMode').setAttribute('aria-pressed',s.mode==='terrain');
  $('flatMode').setAttribute('aria-pressed',s.mode==='flat');
  renderReversal(s,options,priority,deadline,result);
  renderHeightResults(s);
  $('customWarning').hidden=!s.selected.custom;
  const current=$('inspectSite').value;
  $('inspectSite').replaceChildren(...[s.selected,s.comparison].map(site=>new Option(site.name,site.id)));
  $('inspectSite').value=[s.selected.id,s.comparison.id].includes(current)?current:s.selected.id;
  refreshInspection();
  clearAdvisor(s,priority,deadline);
}
function refreshInspection(){
  const s=inspectionState();
  renderMission(s);
  inspect(s);
  refreshMarkers(s);
}
function refreshMarkers(s){
  for(const cursor of document.querySelectorAll('.lane .position'))cursor.style.left=Math.min(99.7,s.t/s.span*100)+'%';
}
function updateCursor(){
  if(pendingInspect)return;
  pendingInspect=requestAnimationFrame(()=>{
    pendingInspect=0;
    const s=inspectionState();
    inspect(s);
    refreshMarkers(s);
  });
}
function setObstructionCursor(s){
  const p=profilesInWindow(s).find(row=>row[4]&&row[2]<=row[4][0]);
  if(p){$('cursor').value=p[0]-s.start;}
  else {
    const blocked=measure(s.selected,s.height,'terrain','earth',s.start,s.span).rows.find(row=>row[2]==='terrain-blocked');
    if(blocked)$('cursor').value=Math.round((blocked[0]+blocked[1])/2-s.start);
  }
}
function jumpToObstruction(){
  stopPlayback();
  setObstructionCursor(inspectionState());
  updateCursor();
}
function stopPlayback(){
  if(playFrame)cancelAnimationFrame(playFrame);
  playFrame=0;
  $('play').textContent='Play window';
}
function togglePlayback(){
  if(playFrame){stopPlayback();return;}
  const {t,span}=state(),from=t>=span?0:t;
  let begun;
  $('play').textContent='Pause window';
  const frame=now=>{
    begun??=now;
    const next=Math.min(span,Math.round(from+(now-begun)*span/26000));
    if(Number($('cursor').value)!==next){
      $('cursor').value=next;
      updateCursor();
    }
    if(next===span)stopPlayback();
    else playFrame=requestAnimationFrame(frame);
  };
  playFrame=requestAnimationFrame(frame);
}
function profilesInWindow(s){
  return Object.values(s.selected.heights[s.height].profiles).filter(p=>p[0]>=s.start&&p[0]<=s.start+s.span);
}
function comparisonCsv(s){
  const rows=[['site','scenario','window_min','mode','target','start_utc','end_utc','status','reason','duration_min','antenna_m','panel_m','provenance']];
  for(const site of [s.selected,s.comparison]){
    for(const m of ['flat','terrain'])for(const target of ['earth','sun']){
      const record=measure(site,s.height,m,target,s.start,s.span);
      for(const [a,b,status] of record.rows){
        rows.push([site.id,utc(s.start),s.span,m,target,utc(a),utc(b),status,labels[status],
          (b-a).toFixed(1),s.height,2,m==='terrain'?'JPL Horizons + LOLA':'JPL Horizons']);
      }
    }
  }
  return rows.map(r=>r.join(',')).join('\n');
}
function exportCsv(){
  const file=new Blob([comparisonCsv(state())],{type:'text/csv'});
  const url=URL.createObjectURL(file),a=document.createElement('a');
  a.href=url;a.download='lunar-window-intervals.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function normalize(changed,editing=false){
  const field=$('day'), end=$('end'), duration=$('windowHours'), notes=[];
  const minutes=toMinutes(field.value);
  const t=Math.min(total-60,Math.max(0,Math.round(Number.isFinite(minutes)?minutes:4320)));
  if(t!==minutes)notes.push('Touchdown was set inside the NASA data coverage.');
  const max=Math.min(total-t,maxSpan);
  const requested=changed==='end'?toMinutes(end.value)-t:Number(duration.value||24)*60;
  const span=Math.min(max,Math.max(60,Math.round(Number.isFinite(requested)?requested:1440)));
  if(Math.abs(requested-span)>1e-5)notes.push('The end was adjusted to fit the covered 1-hour to 30-day window.');
  duration.max=max/60;
  if(!editing||changed!=='windowHours')duration.value=span/60;
  if(!editing||changed!=='day')field.value=clock(t);
  end.min=clock(t+60);end.max=clock(t+max);
  if(!editing||changed!=='end')end.value=clock(t+span);
  windowStart=t;
  windowSpan=span;
  $('cursor').max=span;
  $('cursor').value=Math.min(span,Number($('cursor').value)||0);
  $('inputNote').textContent=notes.join(' ');
}
function updateWindow(id,editing=false){
  if(pendingWindow)cancelAnimationFrame(pendingWindow);
  pendingWindow=0;
  if(!editing){
    normalize(id);
    update();
    jumpToObstruction();
    return;
  }
  pendingWindow=requestAnimationFrame(()=>{
    pendingWindow=0;
    const input=$(id);
    if(!input.value||!input.validity.valid)return;
    normalize(id,true);
    update();
    jumpToObstruction();
  });
}
function addSources(){
  const links=[['NASA challenge','https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/'],
    ['NASA Lunar Surface Data Book','https://ntrs.nasa.gov/citations/20230007818'],
    ['JPL Horizons','https://ssd.jpl.nasa.gov/horizons/'],
    ['NASA SVS independent geometry input','https://svs.gsfc.nasa.gov/5587'],
    ['NASA lunar radio propagation context','https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/lunar-surface-propagation/']];
  for(const product of data.products)links.push([product.id+' product label',product.label]);
  for(const [i,url] of data.referenceQueries.entries())links.push([i?'Sun Horizons query':'Earth Horizons query',url]);
  for(const [label,url] of links){
    const a=document.createElement('a');a.href=url;a.textContent=label;
    a.target='_blank';a.rel='noopener';$('sourceLinks').append(a);
  }
  $('sourceStats').textContent=data.timeStep+' min Horizons cadence. Preset rays sample every '+data.radialStep+
    ' m at '+data.azStep+'° bearing increments. Custom rays sample every 120 m at 1° increments. Both scan '+data.extent/1000+
    ' km. Near ties within '+
    (data.rankingToleranceMinutes||data.timeStep)+' minutes are indeterminate. A 12 km maximum elevation envelope bounds unmodeled distant terrain.';
}
function coordinateNote(){
  const {latitudeMin,latitudeMax}=data.customGrid, lat=$('latitude'),lon=$('longitude');
  const valid=lat.validity.valid&&lon.validity.valid;
  $('applyCoords').disabled=customBusy||!valid;
  $('coordNote').textContent=valid?'Screening grade. Custom sites use a 240 m grid, 1° bearings and 120 m steps.':
    'Enter latitude '+latitudeMin+'° to '+latitudeMax+'° and longitude −180° to 180° east-positive.';
  return valid;
}
function syncSites(){
  const selected=byId($('site').value);
  for(const opt of $('compareSite').options)opt.disabled=opt.value===selected.id;
  if($('compareSite').value===selected.id)$('compareSite').value=data.sites.find(site=>site.id!==selected.id).id;
  $('latitude').value=selected.lat;
  $('longitude').value=selected.lon;
  coordinateNote();
  $('inspectSite').value=selected.id;
  update();
  jumpToObstruction();
}
function loadCustom(lat,lon){
  if(!worker)worker=new Worker('lunar-terrain-worker.js');
  return new Promise((resolve,reject)=>{
    worker.onmessage=({data: answer})=>answer.error?reject(new Error(answer.error)):resolve(answer.site);
    worker.onerror=()=>{
      worker.terminate();worker=null;
      reject(new Error('The terrain worker could not start. Reload the page and try again.'));
    };
    worker.postMessage({lat,lon,grid:data.customGrid,extent:data.extent,bodyVectors:data.bodyVectors,cadence:data.timeStep});
  });
}
async function useCoordinates(event){
  event.preventDefault();
  if(customBusy||!coordinateNote())return;
  const lat=Number($('latitude').value),lon=Number($('longitude').value);
  const chosen=[...data.sites,...(activeCustom?[activeCustom]:[])].find(site=>Math.abs(lat-site.lat)<1e-8&&
    Math.abs(((lon-site.lon+540)%360)-180)<1e-8);
  if(chosen){
    $('site').value=chosen.id;
    syncSites();
    return;
  }
  if(location.protocol==='file:'){
    $('coordNote').textContent='Start the included local server to load custom terrain.';
    return;
  }
  customBusy=true;
  $('site').disabled=$('latitude').disabled=$('longitude').disabled=$('applyCoords').disabled=true;
  $('coordNote').textContent='Loading LOLA terrain and calculating the local horizon…';
  let notice='';
  try{
    const site=await loadCustom(lat,lon);
    if(activeCustom){
      for(const key of histories.keys())if(key.startsWith(activeCustom.id+'/'))histories.delete(key);
      $('site').options[$('site').options.length-1].remove();
    }
    activeCustom={...site,id:'custom:'+lat+':'+lon,name:'Custom site ('+lat+'°, '+lon+'° E)',custom:true};
    $('site').add(new Option(activeCustom.name,activeCustom.id));
    $('site').value=activeCustom.id;
    syncSites();
    notice='Custom horizon calculated from the 240 m LOLA grid.';
  }catch(error){
    notice=error.message||'Could not calculate terrain for that location.';
  }finally{
    customBusy=false;
    $('site').disabled=$('latitude').disabled=$('longitude').disabled=false;
    coordinateNote();
    $('coordNote').textContent=notice;
  }
}
function setHorizon(mode){
  horizonMode=mode;
  update();
}
function resetDemo(){
  $('site').value=data.sites[0].id;
  $('compareSite').value=data.sites[1].id;
  $('day').value=clock(demoStart);
  $('windowHours').value=24;
  $('height').value='2';
  $('priority').value='blackout';
  $('deadline').value='';
  $('question').value='';
  horizonMode='terrain';
  normalize();
  syncSites();
}
function init(){
  for(const site of data.sites){
    $('site').add(new Option(site.name,site.id));
    $('compareSite').add(new Option(site.name,site.id));
  }
  $('day').value=clock(demoStart);
  $('day').min=clock(0);$('day').max=clock(total-60);
  $('coverage').textContent=stamp(0)+' to '+stamp(total);
  $('site').addEventListener('change',syncSites);
  $('height').addEventListener('change',()=>{update();jumpToObstruction();});
  $('compareSite').addEventListener('change',update);
  $('inspectSite').addEventListener('change',()=>{stopPlayback();refreshInspection();});
  $('coordinates').addEventListener('submit',useCoordinates);
  for(const id of ['latitude','longitude'])$(id).addEventListener('input',coordinateNote);
  for(const id of ['day','end','windowHours']){
    $(id).addEventListener('input',()=>updateWindow(id,true));
    $(id).addEventListener('change',()=>updateWindow(id));
  }
  $('month').addEventListener('click',()=>{
    $('windowHours').value=720;
    updateWindow('windowHours');
  });
  $('terrainMode').addEventListener('click',()=>setHorizon('terrain'));
  $('flatMode').addEventListener('click',()=>setHorizon('flat'));
  $('resetDemo').addEventListener('click',resetDemo);
  $('openDemo').addEventListener('click',resetDemo);
  $('cursor').addEventListener('input',()=>{stopPlayback();updateCursor();});
  $('jump').addEventListener('click',jumpToObstruction);
  $('play').addEventListener('click',togglePlayback);
  $('download').addEventListener('click',exportCsv);
  $('clearanceChart').closest('details').addEventListener('toggle',updateCursor);
  window.addEventListener('resize',updateCursor);
  initAdvisor();
  renderDemoSummary();
  renderValidation();
  addSources();
  resetDemo();
}
init();
