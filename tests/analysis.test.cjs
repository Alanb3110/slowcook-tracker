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
test('old v5 cooking import and v5 export stay compatible with analysis v4.1',()=>{
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
  assert.equal(vm.runInContext('ANALYSIS_VERSION',context),'web-4.1');
});

test.after(()=>{console.log('DATASET_REPORT '+JSON.stringify(reports));});
