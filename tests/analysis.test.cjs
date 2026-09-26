const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const A=require('../analysis.js');

const start=Date.parse('2026-09-26T10:00:00Z');
function cooking(times,fn,target=80,eventMinute=null){
  return {targetTemperature:target,measurements:times.map((t,i)=>({timestamp:new Date(start+t*60000).toISOString(),temperature:fn(t,i)})),
    events:eventMinute===null?[]:[{timestamp:new Date(start+eventMinute*60000).toISOString(),phaseBoundary:true,type:'setpointChanged'}]};
}
const regular=Array.from({length:19},(_,i)=>i*8);
function check(c){const last=Date.parse(c.measurements.at(-1).timestamp);return A.analyze(c,last+2*60000);}
function report(name,a){return {dataset:name,phases:a.phases.map(p=>({start:p.startIndex,end:p.endIndex,model:p.model?.family,rmseC:p.model?.rmseC,predictiveRmseC:p.model?.predictiveRmseC})),active:a.activePhase?.model?.family,etaHours:a.eta?.hours??null,confidence:a.confidence,warnings:a.warnings};}
const reports=[];

test('A linear warming: one phase, parsimonious model',()=>{
  const a=check(cooking(regular,t=>30+.28*t));reports.push(report('A',a));assert.equal(a.phases.length,1);assert.equal(a.activePhase.model.family,'linear');assert.ok(a.eta);
});
test('B exponential plateau: no fabricated ETA above asymptote',()=>{
  const a=check(cooking(regular,t=>75-50*Math.exp(-t/60),80));reports.push(report('B',a));assert.equal(a.phases.length,1);assert.equal(a.activePhase.model.family,'exponential');assert.equal(a.eta,null);assert.match(a.reason,/plateau/);
});
test('C two clear regimes',()=>{
  const a=check(cooking(regular,t=>t<=72?30+.4*t:58.8+.09*(t-72)));reports.push(report('C',a));assert.equal(a.phases.length,2);assert.ok(Math.abs(a.phases[1].startIndex-9)<=1);assert.equal(a.activePhase.model.family,'linear');
});
test('D event creates a prior, observed transition lags behind it',()=>{
  const a=check(cooking(regular,t=>t<=88?30+.3*t:56.4+.08*(t-88),80,72));reports.push(report('D',a));assert.equal(a.phases.length,2);assert.ok(a.phases[1].startMs>start+72*60000);
});
test('E large gap in an unchanged linear process reduces confidence, never partitions it',()=>{
  const a=check(cooking([0,8,16,24,32,40,48,56,64,72,130,138,146],t=>30+.25*t));reports.push(report('E',a));assert.equal(a.phases.length,1);assert.ok(a.acq.gaps.length);assert.equal(a.activePhase.points.length,13);assert.equal(a.activePhase.model.family,'linear');
});
test('F isolated outlier does not create a permanent phase',()=>{
  const a=check(cooking(regular,(t,i)=>30+.25*t+(i===9?9:0)));reports.push(report('F',a));assert.equal(a.phases.length,1);assert.match(a.warnings.join(' '),/atypique/);
  const tail=check(cooking(regular,(t,i)=>30+.25*t+(i===18?12:0)));
  assert.equal(tail.phases.length,1);assert.equal(tail.eta,null);assert.match(tail.warnings.join(' '),/atypique/);
});
test('G several points confirm a break',()=>{
  const c=cooking(regular,t=>t<=72?30+.4*t:58.8+.09*(t-72));
  const before=check({...c,measurements:c.measurements.slice(0,11)}),after=check(c);
  reports.push(report('G',after));assert.equal(after.phases.length,2);assert.ok(after.phases[1].points.length>=3);assert.ok(before.phases.length<=2);
});
test('H sparse data refuses complex functions',()=>{
  const a=check(cooking([0,5,12],t=>35+.3*t));reports.push(report('H',a));assert.equal(a.phases.length,1);assert.equal(a.activePhase.model.family,'linear');assert.equal(a.confidence,'low');assert.equal(a.eta,null);
});
test('I irregular sampling uses elapsed time, not sample index',()=>{
  const a=check(cooking([0,2,5,17,18,27,40,65,67,85,101,130],t=>35+.3*t));reports.push(report('I',a));assert.equal(a.phases.length,1);assert.equal(a.activePhase.model.family,'linear');assert.ok(Math.abs(a.slope-18)<.01);
});
test('J real Paleron v5: gap does not erase the trend',()=>{
  const d=require('./paleron-real-v5.json'),c=d.cooking,last=Date.parse(c.measurements.at(-1).timestamp);
  const a=A.analyze(c,last+5*60000);reports.push(report('J Paleron',a));
  assert.ok(a.acq.gaps.some(g=>g.minutes>57));assert.ok(a.activePhase.points.length>=3);
  assert.ok(a.activePhase.model);assert.ok(Number.isFinite(a.slope));assert.ok(Number.isFinite(a.projection));
  assert.ok(a.warnings.some(w=>/intervalle/i.test(w)));
  const stale=A.analyze(c,last+74*60000);assert.equal(stale.quality.key,'stale');assert.ok(Number.isFinite(stale.slope));assert.equal(stale.eta,null);
});
test('multi-regime complete cook and target crossing',()=>{
  const times=Array.from({length:33},(_,i)=>i*8),c=cooking(times,t=>t<=72?30+.4*t:t<=152?58.8+.12*(t-72):68.4+.32*(t-152),106.68,68);
  const a=check(c);reports.push(report('Full cook',a));assert.equal(a.phases.length,3);assert.ok(a.eta);assert.ok(a.eta.estimatedAtMs>Date.parse(c.measurements.at(-1).timestamp));
});
test('old v5 cooking import and v5 export stay compatible with analysis v4.2.2',()=>{
  const d=require('./paleron-real-v5.json'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];assert.ok(inline);
  const fakeElement=()=>({classList:{add(){},remove(){}},addEventListener(){},innerHTML:'',getBoundingClientRect(){return {width:390,height:270};}});
  const context={console,Date,Math,JSON,Number,Set,URLSearchParams,location:{search:''},navigator:{},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById(){return fakeElement();},addEventListener(){}},window:{addEventListener(){},TemperatureAnalysis:A},TemperatureAnalysis:A,requestAnimationFrame(){}};
  vm.createContext(context);vm.runInContext(inline,context);
  context.incoming=d;const result=vm.runInContext('migrateState({activeCooking:incoming.cooking,archivedCookings:[],schemaVersion:5})',context);
  assert.equal(result.schemaVersion,5);assert.equal(result.activeCooking.measurements.length,18);
  vm.runInContext('state=migrateState({activeCooking:incoming.cooking,archivedCookings:[],schemaVersion:5})',context);
  const exportData=vm.runInContext('stateExportPayload()',context);
  assert.equal(exportData.schemaVersion,5);assert.equal(exportData.activeCooking.measurements.length,18);
  assert.equal(vm.runInContext('ANALYSIS_VERSION',context),'web-4.2.2');
});

test('time-local displayed rate keeps an exact linear slope, without changing ETA',()=>{
  const c=cooking([0,2,5,17,18,27,40,65,67,85,101,130],t=>35+.3*t);
  const a=check(c),segments=A.rateCurve(a.phases,a.acq);
  assert.equal(a.phases.length,1);assert.equal(segments.length,c.measurements.length-1);
  assert.ok(segments.every(s=>s.phaseIndex===0&&s.samples.every(p=>Math.abs(p.rateCPerHour-18)<1e-6)));
  assert.equal(segments[0].samples[0].timeMs,Date.parse(c.measurements[0].timestamp));
  assert.equal(segments.at(-1).samples.at(-1).timeMs,Date.parse(c.measurements.at(-1).timestamp));
  const gap=check(cooking([0,8,16,24,32,40,48,56,64,72,130,138,146],t=>30+.25*t));
  assert.ok(A.historyCurve(gap.phases,gap.acq).some(s=>s.gap));
  assert.ok(A.rateCurve(gap.phases,gap.acq).every(s=>!s.gap));
});
test('exponential local rate slows, and phase changes do not join derivatives',()=>{
  const exp=check(cooking(regular,t=>75-50*Math.exp(-t/60),80)),rates=A.rateCurve(exp.phases,exp.acq);
  assert.ok(rates[0].samples[0].rateCPerHour>rates.at(-1).samples.at(-1).rateCPerHour);
  const a=check(cooking(regular,t=>t<=72?30+.4*t:58.8+.09*(t-72)));
  const segments=A.rateCurve(a.phases,a.acq);
  assert.equal(a.phases.length,2);
  assert.ok(segments.some(s=>s.phaseIndex===0));assert.ok(segments.some(s=>s.phaseIndex===1));
  assert.ok(segments.every(s=>s.samples[0].timeMs>=a.phases[s.phaseIndex].startMs&&s.samples.at(-1).timeMs<=a.phases[s.phaseIndex].endMs));
});
test('sparse phases hide rate and real Paleron preserves its gap indication',()=>{
  const sparse=check(cooking([0,5,12],t=>35+.3*t));assert.deepEqual(A.rateCurve(sparse.phases,sparse.acq),[]);
  const d=require('./paleron-real-v5.json'),last=Date.parse(d.cooking.measurements.at(-1).timestamp),a=A.analyze(d.cooking,last+5*60000);
  const segments=A.rateCurve(a.phases,a.acq);
  assert.ok(segments.length);assert.ok(A.historyCurve(a.phases,a.acq).some(s=>s.gap));
  assert.ok(segments.every(s=>!s.gap));
  assert.ok(segments.every(s=>s.samples.at(-1).timeMs<=last));
});
test('PCHIP stays monotone; local rate omits a 91 min gap',()=>{
  const c=cooking([0,10,20,30,40,50,141,171],(t,i)=>[64,66,68,70,73,77,80,84][i]);
  const points=A.prepare(c),acq=A.acquisition(points,points.at(-1).timeMs);
  const phase={startIndex:0,endIndex:points.length-1,startMs:points[0].timeMs,endMs:points.at(-1).timeMs,
    points,model:{family:'linear',parameters:{b:5},originMs:points[0].timeMs}};
  const history=A.historyCurve([phase],acq),rates=A.rateCurve([phase],acq);
  assert.equal(acq.gaps.length,1);assert.equal(Math.round(acq.gaps[0].minutes),91);
  const gap=history.find(s=>s.gap);assert.equal(gap.samples.length,2);
  assert.equal(gap.samples[0].timeMs,points[5].timeMs);assert.equal(gap.samples[1].timeMs,points[6].timeMs);
  assert.ok(rates.every(s=>s.samples.at(-1).timeMs<=points[5].timeMs||s.samples[0].timeMs>=points[6].timeMs));
  assert.equal(rates.at(-1).samples.at(-1).rateCPerHour,8); // 4 °C over 30 min, independent of the model's 5 °C/h.
  for(const s of rates){
    const values=s.samples.map(p=>p.temperature),a=values[0],b=values.at(-1);
    assert.ok(values.every(v=>v>=Math.min(a,b)-1e-10&&v<=Math.max(a,b)+1e-10));
    assert.ok(s.samples.every(p=>Number.isFinite(p.rateCPerHour)));
  }
});
test('a one-degree reading 48 s later cannot dominate a six-hour rate axis',()=>{
  const c=cooking([0,8,16,23,24,24.8,28,36,44,52,60],(t,i)=>[30,33,36,39,40,41,42,45,48,51,54][i]);
  const points=A.prepare(c),acq=A.acquisition(points,points.at(-1).timeMs),phase={startIndex:0,endIndex:points.length-1,
    startMs:points[0].timeMs,endMs:points.at(-1).timeMs,points};
  const raw=Math.max(...A.historyCurve([phase],acq).flatMap(s=>s.samples.map(p=>p.rateCPerHour)));
  const smooth=Math.max(...A.rateCurve([phase],acq).flatMap(s=>s.samples.map(p=>p.rateCPerHour)));
  assert.ok(raw>50);assert.ok(smooth>15&&smooth<42);
});
test('an isolated aberrant point does not dominate the smoothed rate',()=>{
  const a=check(cooking(regular,(t,i)=>30+.25*t+(i===9?9:0)));
  const v=A.rateCurve(a.phases,a.acq).flatMap(s=>s.samples.map(p=>p.rateCPerHour));
  assert.equal(a.phases.length,1);assert.ok(v.length);
  assert.ok(Math.min(...v)>0&&Math.max(...v)<30);
});
test('the historical display never changes phase fitting or ETA',()=>{
  const d=require('./paleron-real-v5.json'),c=d.cooking,last=Date.parse(c.measurements.at(-1).timestamp);
  const before=A.analyze(c,last+5*60000),projection=before.projection,eta=before.eta,slope=before.slope;
  A.historyCurve(before.phases,before.acq);A.rateCurve(before.phases,before.acq);
  const after=A.analyze(c,last+5*60000);
  assert.equal(after.projection,projection);assert.equal(after.slope,slope);assert.deepEqual(after.eta,eta);
});
test('390 px chart uses a right rate axis and its toggle hides that axis',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  const labels=[],button={pressed:null,classList:{toggle(){}},setAttribute(k,v){if(k==='aria-pressed')this.pressed=v;}},note={textContent:''};
  const ctx={scale(){},clearRect(){},fillText(s){labels.push(s);},beginPath(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},setLineDash(){},arc(){},fill(){},rect(){},clip(){}};
  const canvas={width:0,height:0,getBoundingClientRect(){return {width:390,height:270};},getContext(){return ctx;}};
  const noop={classList:{add(){},remove(){}},addEventListener(){},innerHTML:''};
  const context={console,Date,Math,JSON,Number,Set,URLSearchParams,location:{search:''},navigator:{},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById(id){return id==='chart'?canvas:id==='velocityToggle'?button:id==='velocityNote'?note:noop;},addEventListener(){}},
    window:{addEventListener(){},TemperatureAnalysis:A,devicePixelRatio:2},TemperatureAnalysis:A,requestAnimationFrame(){}};
  vm.createContext(context);vm.runInContext(inline,context);
  const c=cooking(regular,t=>30+.28*t),a=check(c);context.c=c;context.a=a;vm.runInContext('state.activeCooking=c',context);
  vm.runInContext('drawChart(c,a)',context);
  assert.ok(labels.includes('°C/h'));assert.ok(vm.runInContext('chartView.rateRange',context));
  vm.runInContext('toggleVelocity()',context);
  assert.equal(button.pressed,'false');assert.equal(vm.runInContext('chartView.rateRange',context),null);assert.equal(note.textContent,'');
  assert.ok(a.eta);
});

test('visible rate runs join only with dim dashed visual bridges across a gap',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  const bridgePaths=[];let currentPath=[],dash=[];
  const ctx={scale(){},clearRect(){},fillText(){},beginPath(){currentPath=[];},moveTo(x,y){currentPath.push([x,y]);},lineTo(x,y){currentPath.push([x,y]);},
    stroke(){if(this.strokeStyle==='rgba(100,210,255,.5)')bridgePaths.push({dash:[...dash],path:[...currentPath]});},
    save(){},restore(){},setLineDash(v){dash=v;},arc(){},fill(){},rect(){},clip(){}};
  const note={textContent:''},canvas={getBoundingClientRect(){return {width:390,height:270};},getContext(){return ctx;}},noop={classList:{add(){},remove(){}},addEventListener(){},innerHTML:''};
  const context={console,Date,Math,JSON,Number,Set,URLSearchParams,location:{search:''},navigator:{},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById(id){return id==='chart'?canvas:id==='velocityNote'?note:noop;},addEventListener(){}},
    window:{addEventListener(){},TemperatureAnalysis:A,devicePixelRatio:2},TemperatureAnalysis:A,requestAnimationFrame(){}};
  vm.createContext(context);vm.runInContext(inline,context);
  const c=cooking([0,10,20,30,40,50,141,171],(t,i)=>[64,66,68,70,73,77,80,84][i]);
  const points=A.prepare(c),acq=A.acquisition(points,points.at(-1).timeMs),phase={startIndex:0,endIndex:7,startMs:points[0].timeMs,endMs:points.at(-1).timeMs,points};
  context.c=c;context.a={all:points,phases:[phase],acq,projection:null,setpoint:null};
  vm.runInContext('chartRangeMinutes=360;drawChart(c,a)',context);
  assert.equal(bridgePaths.length,1);
  assert.deepEqual(bridgePaths[0].dash,[4,6]);
  assert.equal(bridgePaths[0].path.length,2);
  const view=vm.runInContext('chartView',context),toX=t=>42+(t-view.start)/(view.end-view.start)*(390-42-49);
  assert.ok(Math.abs(bridgePaths[0].path[0][0]-toX(points[5].timeMs))<1e-6);
  assert.ok(Math.abs(bridgePaths[0].path[1][0]-toX(points[6].timeMs))<1e-6);
  assert.match(note.textContent,/pointillés.*vitesse inconnue/);
  assert.ok(bridgePaths.every(s=>s.path.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y))));
});

test.after(()=>{console.log('DATASET_REPORT '+JSON.stringify(reports));});
