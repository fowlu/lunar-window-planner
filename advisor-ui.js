'use strict';

function renderAlternates(s,priority,deadline){
  const offsets=[0,360,720,1440].filter(offset=>s.start+offset+s.span<=total);
  const candidates=offsets.flatMap(offset=>compare(s,s.start+offset));
  const result=LunarDecision.rank(candidates,priority,deadline,rankingTolerance);
  const note=document.createElement('p');
  note.className='caption';
  note.textContent=result.winner
    ? result.winner.name+' at '+stamp(result.winner.start)+' leads the evaluated starts.'
    : LunarDecision.describe(result,priority,deadline);
  const buttons=offsets.filter(offset=>offset>0).map(offset=>{
    const start=s.start+offset;
    const row=document.createElement('div');
    row.className='alternate-row';
    const evidence=document.createElement('p');
    evidence.className='caption';
    evidence.textContent=candidates.filter(option=>option.start===start).map((option,i)=>
      'Site '+(i?'B':'A')+' '+LunarDecision.display(option[priority],priority)).join(' · ');
    const button=document.createElement('button');
    button.type='button';
    button.textContent='Test '+stamp(start);
    button.addEventListener('click',()=>{
      $('day').value=clock(start);
      updateWindow('day');
    });
    row.append(button,evidence);
    return row;
  });
  if(!buttons.length)note.textContent+=' The current data coverage allows only the selected start.';
  $('alternates').replaceChildren(note,...buttons);
}

function clearAdvisor(s,priority,deadline){
  advisorRequest?.abort();
  advisorRequest=null;
  $('advisorAnswer').replaceChildren();
  $('advisorStatus').textContent='Answers use the same calculation as Mission results.';
  $('questionInterpretation').textContent='';
  $('deadline').max=s.span/60;
  $('deadlineNote').textContent=$('deadline').validity.valid
    ? 'Tests whether an Earth sightline opens by this time.'
    : 'Enter a deadline inside the selected mission window.';
  renderAlternates(s,priority,deadline);
}

function advisorSnapshot(s,question,request=LunarDecision.readQuestion(question,s.height,$('priority').value,readDeadline(s))){
  if(request.deadline!==null&&request.deadline>s.span)return null;
  const scenario={...s,height:request.height};
  const options=compare(scenario);
  const result=LunarDecision.rank(options,request.priority,request.deadline,rankingTolerance);
  const facts=options.flatMap((item,i)=>[
    {id:'blackout'+i,text:item.name+' · Longest Earth blackout '+LunarDecision.display(item.blackout,'blackout')},
    {id:'earliest'+i,text:item.name+' · First Earth sightline '+LunarDecision.display(item.earliest,'earliest')},
    {id:'sunlight'+i,text:item.name+' · Potential sunlight '+LunarDecision.display(item.sunlight,'sunlight')}
  ]);
  const synopsis=LunarDecision.describe(result,request.priority,request.deadline);
  const tradeoff='Potential sunlight in the same window is '+
    options.map(item=>item.name+' '+LunarDecision.display(item.sunlight,'sunlight')).join(' · ')+'.';
  const comparisons=[];
  if(request.height!==s.height){
    const baseline=LunarDecision.rank(compare(s),request.priority,request.deadline,rankingTolerance);
    comparisons.push('At '+s.height+' m, '+LunarDecision.describe(baseline,request.priority,request.deadline));
    for(const [i,item] of compare(s).entries()){
      facts.push({id:'baseline'+i,text:s.height+' m · '+item.name+' · '+
        LunarDecision.priorities[request.priority]+' '+LunarDecision.display(item[request.priority],request.priority)});
    }
  }
  const nextTests=[
    {id:'horizon',text:'Toggle the horizon model at the same touchdown to isolate the effect of terrain.'},
    {id:'priority',text:'Switch the mission priority to check whether power exposure and Earth visibility favor the same site.'}
  ];
  if(s.start+360+s.span<=total)nextTests.push({id:'time',text:'Open Nearby touchdown times and try the covered start six hours later.'});
  if(request.height===s.height)nextTests.push({id:'height',text:'Inspect the alternate antenna height as a sensitivity case.'});
  const caveats=[
    'Earth visibility is geometric line of sight. Sun visibility is potential solar exposure.',
    'The terrain grid cannot resolve meter-scale antenna placement. Height changes are modeled sensitivity cases.'
  ];
  if(options.some(o=>o.earthUnknown>0||o.sunUnknown>0))caveats.push('Uncertain intervals are included in the displayed bounds.');
  if(result.kind==='indeterminate'&&result.reason==='overlap')caveats.push('The priority uses a '+rankingTolerance+' minute decision tolerance.');
  return {
    question, synopsis, comparisons, facts, nextTests, caveats, tradeoff,
    scenario:{start:utc(s.start),end:utc(s.start+s.span),antennaHeightM:Number(request.height),
      model:s.mode,priority:request.priority,deadlineMinutes:request.deadline,options,
      outcome:result.kind,reason:result.reason,winner:result.winner?.name??null}
  };
}

function renderAdvisorAnswer(snapshot,explanation){
  const answer=$('advisorAnswer'), p=text=>{
    const element=document.createElement('p');
    element.textContent=text;
    return element;
  };
  const {scenario}=snapshot;
  const scope=p(scenario.start.slice(0,16).replace('T',' ')+' → '+scenario.end.slice(0,16).replace('T',' ')+
    ' UTC · '+scenario.antennaHeightM+' m antenna · '+
    (scenario.model==='terrain'?'LOLA terrain':'Flat reference'));
  scope.className='caption';
  const outcome=p(snapshot.synopsis);
  const primaryFacts=snapshot.facts.filter(f=>f.id.startsWith(scenario.priority)||
    scenario.deadlineMinutes!==null&&f.id.startsWith('earliest')||f.id.startsWith('baseline'));
  const cited=explanation?.evidenceIds.map(id=>snapshot.facts.find(f=>f.id===id)).filter(Boolean)??[];
  const facts=document.createElement('ul');
  for(const fact of new Map([...primaryFacts,...cited].map(f=>[f.id,f])).values()){
    const li=document.createElement('li');
    li.textContent=fact.text;
    facts.append(li);
  }
  const texts=[scope,outcome,...snapshot.comparisons.map(p),facts];
  if(explanation)texts.push(p(explanation.summary),p(explanation.tradeoff));
  else texts.push(p(snapshot.tradeoff));
  texts.push(p(snapshot.nextTests.find(test=>test.id===explanation?.nextTestId)?.text??snapshot.nextTests[0].text));
  const limits=p(snapshot.caveats.join(' '));
  limits.className='caption';
  answer.replaceChildren(...texts,limits);
}

async function askAdvisor(event){
  event?.preventDefault();
  advisorRequest?.abort();
  advisorRequest=null;
  const status=$('advisorStatus');
  const interpretation=$('questionInterpretation');
  interpretation.textContent='';
  if(!$('deadline').validity.valid){
    status.textContent='Enter a report deadline within the selected window.';
    return;
  }
  const s=state(),question=$('question').value.trim();
  const request=LunarDecision.readQuestion(question,s.height,$('priority').value,readDeadline(s));
  if(request.invalidHeight){
    status.textContent='Available antenna settings are 2 m and 5 m.';
    $('advisorAnswer').replaceChildren();
    return;
  }
  const snapshot=advisorSnapshot(s,question,request);
  if(!snapshot){
    status.textContent='The requested deadline extends beyond the selected window. Extend the window to evaluate it.';
    $('advisorAnswer').replaceChildren();
    return;
  }
  interpretation.textContent=(question&&request.matched?'Interpreted as ':question?'Using current settings. Supported quick questions specify a deadline or antenna height. ':'Current settings. ')+
    (request.deadline===null?'No report deadline':'Deadline '+LunarDecision.hours(request.deadline))+' · antenna '+request.height+
    ' m · '+LunarDecision.priorities[request.priority]+'.';
  renderAdvisorAnswer(snapshot);
  if($('localModelOption').hidden||!$('localModel').checked){
    status.textContent='Computed answer';
    return;
  }
  const controller=new AbortController();
  advisorRequest=controller;
  status.textContent='Computed explanation ready. Requesting model commentary…';
  try{
    const response=await fetch('/api/advisor',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(snapshot),signal:controller.signal});
    if(!response.ok)throw new Error('No model response');
    const explanation=await response.json();
    if(advisorRequest!==controller)return;
    renderAdvisorAnswer(snapshot,explanation);
    status.textContent='Model commentary · the planner computed the ranking and cited figures.';
  }catch {
    if(advisorRequest===controller)status.textContent='Computed answer · optional Ollama commentary is unavailable on this machine.';
  }finally{
    if(advisorRequest===controller)advisorRequest=null;
  }
}

function initAdvisor(){
  $('localModelOption').hidden=!['127.0.0.1','localhost','[::1]'].includes(location.hostname);
  $('advisorForm').addEventListener('submit',askAdvisor);
  $('priority').addEventListener('change',update);
  $('deadline').addEventListener('input',update);
  for(const [id,question] of [
    ['askTwo','Which site has an Earth sightline within two hours?'],
    ['askFive','Would a 5 m antenna change the recommendation?']
  ]){
    $(id).addEventListener('click',()=>{
      $('question').value=question;
      askAdvisor();
    });
  }
}
