import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { Readable, Writable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { makeServer } from '../server.mjs';

const file=name=>new URL('../'+name,import.meta.url);
const read=name=>fs.readFileSync(file(name),'utf8');
const html=read('index.html');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(ids).size,ids.length,'HTML IDs are unique');
const css=read('lunar-style.css');
assert.match(css,/@media \(max-width: 610px\)[\s\S]*?\.inspect-grid,#missionMetrics,\.evidence-grid \{ grid-template-columns:1fr/);
assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);

const drawing=new Proxy({}, {get:(target,key)=>target[key]??(()=>{})});
class Element {
  constructor(tag=''){
    this.tag=tag;this.handlers={};this.dataset={};this.attrs={};this.style={};
    this.options=[];this.children=[];this.clientWidth=560;this.clientHeight=265;this.validity={valid:true};this.value='';
  }
  setAttribute(k,v){this.attrs[k]=String(v);}
  getContext(){return drawing;}
  addEventListener(event,handler){this.handlers[event]=handler;}
  add(option){this.options.push(option);}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  focus(){}
  closest(){return this;}
  getBoundingClientRect(){return {left:10,width:100};}
  get rendered(){return [this.textContent,this.innerHTML,...this.children.map(node=>node.rendered)].filter(Boolean).join(' ');}
}
const frames=new Map();
let nextFrame=0;
const els=Object.fromEntries(ids.map(id=>[id,new Element()]));
els.cursor.value='720';
const markers=()=>Object.values(els).flatMap(function find(el){
  return [...(el.className==='position'?[el]:[]),...(el.children??[]).flatMap(find)];
});
const document={
  getElementById:id=>els[id],
  createElement:tag=>new Element(tag),
  querySelectorAll:()=>markers()
};
const window={addEventListener(){}};
const location={protocol:'file:',hostname:''};
let mockModelCalls=0;
const context=vm.createContext({document,window,location,AbortController,
  async fetch(){mockModelCalls++;throw new Error('Ollama unavailable');},
  requestAnimationFrame(fn){frames.set(++nextFrame,fn);return nextFrame;},
  cancelAnimationFrame(id){frames.delete(id);},
  Option:class {constructor(name,value){Object.assign(this,{name,value});}}});
function paint(now){
  for(const id of [...frames.keys()]){
    const fn=frames.get(id);frames.delete(id);if(fn)fn(now);
  }
}
for(const script of ['data.js','validation-data.js','decision.js','advisor-ui.js','app.js'])vm.runInContext(read(script),context,{filename:script});
const evaluate=code=>vm.runInContext(code,context);
const run=(id,event,...args)=>els[id].handlers[event](...args);
paint(0);
assert.match(els.verdict.textContent,/de Gerlache Rim 2 is favored/);
assert.match(els.reversal.textContent,/0\.0 h vs 1\.1 h.*20\.5 h vs 7\.7 h/);
assert.match(els.cards.rendered,/20\.5 h/);
assert.match(els.cards.rendered,/7\.7 h/);
assert.match(els.demoSummary.rendered,/7\.7 h.*20\.5 h.*10\.9 h/);
assert.match(els.heightResults.rendered,/Malapert Massif 20\.5 h 10\.9 h/);
assert.match(els.validationSummary.textContent,/10,374 paired.*0\.000002°.*0\.000001°.*0\.0006 minutes/);
assert.match(els.limbSummary.textContent,/117 of 144/);
const validation=window.LUNAR_VALIDATION;
for(const row of validation.cases){
  assert.equal(createHash('sha256').update(fs.readFileSync(file('validation/horizons/'+row.file))).digest('hex'),row.sha256);
}
const start=evaluate('state().start');
const span=evaluate('state().span');
const results=evaluate('compare(state())');
const csv=evaluate('comparisonCsv(state())').split('\n').slice(1).map(line=>line.split(','));
const sections=evaluate('measure(state().selected,state().height,state().mode,"earth",state().start,state().span).rows');
const legend=els.cards.children[0].children[2].children[1];
assert.equal(legend.children.length,sections.length+1);
const blocked=csv.filter(row=>row[0]===results[0].siteId&&row[3]==='terrain'&&row[4]==='earth'&&row[7]==='terrain-blocked');
assert.equal((blocked.reduce((sum,row)=>sum+Number(row[9]),0)/60).toFixed(1),'20.5');
assert.match(els.scenario.textContent,/2026-11-17 00:00 UTC.*2026-11-18 00:00 UTC.*2 m/);

run('flatMode','click');
assert.match(els.verdict.textContent,/Malapert Massif is favored/);
run('terrainMode','click');
els.priority.value='sunlight';run('priority','change');
assert.equal(els.verdict.dataset.result,'indeterminate');
els.priority.value='blackout';run('priority','change');
assert.equal(evaluate('state().start'),start);
assert.equal(evaluate('state().span'),span);
run('askTwo','click');
assert.match(els.advisorAnswer.rendered,/No evaluated option has an Earth sightline by 2\.0 h/);
assert.match(els.advisorAnswer.rendered,/20\.5 h/);
assert.equal(els.advisorStatus.textContent,'Computed answer');
assert.match(els.questionInterpretation.textContent,/Deadline 2\.0 h.*antenna 2 m/);
run('askFive','click');
assert.match(els.advisorAnswer.rendered,/5 m antenna/);
assert.match(els.advisorAnswer.rendered,/At 2 m/);
assert.match(els.advisorAnswer.rendered,/meter-scale/);
const snapshot=evaluate("advisorSnapshot(state(),'What if the antenna is 5 m?')");
els.question.value='What if the antenna is 3 m?';
await run('advisorForm','submit',{preventDefault(){}});
assert.match(els.advisorStatus.textContent,/Available antenna settings/);
els.question.value='Earth within two hours?';
els.localModelOption.hidden=false;
els.localModel.checked=true;
await run('advisorForm','submit',{preventDefault(){}});
assert.equal(mockModelCalls,1);
assert.match(els.advisorStatus.textContent,/optional Ollama commentary/);
els.localModelOption.hidden=true;
await run('advisorForm','submit',{preventDefault(){}});
assert.equal(mockModelCalls,1);
run('flatMode','click');
assert.equal(els.advisorAnswer.children.length,0,'A scenario change clears earlier model commentary');
run('terrainMode','click');
els.end.value='2026-11-18T12:00';
run('end','input');paint(50);
assert.equal(Number(els.windowHours.value),36);
run('resetDemo','click');paint(90);
const clickLane=els.cards.children[1].children[2].children[1];
clickLane.handlers.click({detail:1,clientX:85});
assert.equal(els.inspectSite.value,results[1].siteId);
assert.equal(Number(els.cursor.value),1080);
assert.match(els.time.value,/18:00 UTC/);
assert(markers().every(marker=>marker.style.left==='75%'));
els.cursor.value=120;run('cursor','input');paint(100);
assert.match(els.time.value,/02:00 UTC/);
run('play','click');paint(100);paint(1500);paint(1501);
assert(Number(els.cursor.value)>120);
assert.equal(els.play.textContent,'Pause window');
run('play','click');
assert.equal(els.play.textContent,'Play window');
run('jump','click');paint(2000);
assert.match(els.profileSummary.textContent,/Terrain blocks Earth/);

const worker=vm.createContext({self:{}});
vm.runInContext(read('lunar-terrain-worker.js'),worker);
const raster=gunzipSync(Buffer.concat(['lola-custom-1.bin','lola-custom-2.bin'].map(name=>fs.readFileSync(file(name)))));
const d=window.LUNAR_DATA;
assert.equal(createHash('sha256').update(raster).digest('hex'),d.products[0].sha256);
const calculate=vm.runInContext('calculate',worker);
const gridCells=new Int16Array(raster.buffer,raster.byteOffset,raster.length/2);
const gridRequest={grid:d.customGrid,extent:d.extent,bodyVectors:d.bodyVectors,cadence:d.timeStep};
const custom=calculate({lat:-89.654321,lon:-169.987654,...gridRequest},gridCells);
assert(custom.heights[2].earth.length>5000);
assert(custom.heights[2].terrain.earth.every(point=>point?.every(Number.isFinite)));
context.custom=custom;
evaluate("activeCustom={...custom,id:'custom-test',name:'Custom site (-89.654321°, -169.987654° E)',custom:true}");
els.site.value='custom-test';
run('site','change');paint(2020);
assert.match(els.cards.rendered,/Custom site \(-89\.654321°/);
assert.match(els.profileSummary.textContent,/modeled|Terrain|uncertain/);
assert.match(evaluate('comparisonCsv(state())'),/custom-test/);
assert.equal(els.customWarning.hidden,false);
for(const site of d.sites.slice(0,2)){
  context.customCase={...calculate({lat:site.lat,lon:site.lon,...gridRequest},gridCells),id:'coarse:'+site.id};
  const coarse=evaluate('measure(customCase,"2","terrain","earth",4320,1440)');
  const fine=site.heights[2].days[3].terrain_earth;
  assert(coarse.lower>=0&&coarse.upper<=1440);
  const values=[fine.lower,coarse.lower].map(minutes=>(minutes/60).toFixed(2));
  assert.deepEqual(values,site.id==='malapert'?['20.48','11.53']:['7.66','8.23']);
  console.log(site.name+' demo (preset → custom) '+values.join(' h → ')+' h');
}

function hit(server,path,method,body,headers={}){
  return new Promise((resolve,reject)=>{
    const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
    Object.assign(request,{url:path,method,headers:{'content-type':'application/json',host:'127.0.0.1:8787',...headers}});
    const chunks=[];
    const response=new Writable({
      write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}
    });
    response.writeHead=(status,headers)=>Object.assign(response,{status,headers});
    response.once('finish',()=>resolve({status:response.status,text:Buffer.concat(chunks).toString('utf8')}));
    response.once('error',reject);
    server.emit('request',request,response);
  });
}
let incoming;
const server=makeServer({send:async (url,request)=>{
  assert.equal(url,'http://127.0.0.1:11434/api/chat');
  incoming=JSON.parse(request.body);
  return {ok:true,json:async()=>({message:{content:JSON.stringify({
    summary:'The modeled intervals support the displayed comparison.',
    tradeoff:'Visibility and available sunlight affect different mission systems.',
    evidenceIds:['blackout0','blackout1'],nextTestId:'horizon'
  })}})};
}});
assert.match((await hit(server,'/','GET')).text,/when can a lander see Earth/i);
assert.equal((await hit(server,'/server.mjs','GET')).status,404);
const reply=await hit(server,'/api/advisor','POST',snapshot);
assert.equal(reply.status,200);
assert.equal(incoming.model,'qwen2.5:1.5b');
assert.equal(JSON.parse(incoming.messages[1].content).scenario.antennaHeightM,5);
assert.equal(JSON.parse(reply.text).nextTestId,'horizon');
assert.equal((await hit(server,'/api/advisor','POST',snapshot,{origin:'https://example.com'})).status,403);
const missing=makeServer({send:async()=>{throw new Error('Ollama unavailable');}});
assert.equal((await hit(missing,'/api/advisor','POST',snapshot)).status,503);
const invalid=makeServer({send:async()=>({ok:true,json:async()=>({message:{content:'{"summary":"23 hours","tradeoff":"Dummy","evidenceIds":["external"],"nextTestId":"horizon"}'}})})});
assert.equal((await hit(invalid,'/api/advisor','POST',snapshot)).status,503);
console.log('PASS: comparison, height sweep, observer-source checksums, accessible readouts, deadline handling, local-only fallback, date input, linked cursor, playback, obstruction, custom grid checks, CSV and API.');
