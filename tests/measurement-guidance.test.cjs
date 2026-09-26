const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const Analysis=require('../analysis.js');
const History=require('../prediction-history.js');
const Guidance=require('../measurement-guidance.js');
const start=Date.parse('2026-09-26T10:00:00Z');
function cooking(times,target=90){return {startTime:new Date(start).toISOString(),initialCookerSetpointC:140,cookerSetpointC:140,targetTemperature:target,
  events:[],predictionLog:[],measurements:times.map(t=>({timestamp:new Date(start+t*60000).toISOString(),temperature:35+.25*t}))};}

test('sampling reminder reacts to target proximity, an event, and stale readings',()=>{
  const c=cooking([0,10,20,30,40,50],100),now=start+50*60000;
  let a=Analysis.analyze(c,now);assert.equal(Guidance.recommend(c,a,now).when,'Dans 20–30 min');
  c.events=[{timestamp:new Date(now+2*60000).toISOString(),type:'modeChanged',phaseBoundary:true}];
  a=Analysis.analyze(c,now+4*60000);assert.equal(Guidance.recommend(c,a,now+4*60000).when,'Dans 10–20 min');
  assert.equal(Guidance.recommend(c,a,now+17*60000).when,'Maintenant');
  assert.equal(Guidance.recommend(c,Analysis.analyze(c,now+80*60000),now+80*60000).when,'Maintenant');
  c.targetTemperature=47;assert.equal(Guidance.recommend(c,Analysis.analyze(c,now),now),null);
});
test('known event can be backdated without forcing a phase at its timestamp',()=>{
  const c=cooking([0,10,20,30,40,50,60,70],100),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1],noop={classList:{add(){},remove(){}},addEventListener(){},innerHTML:''};
  const fields={eventForm:{onsubmit:null},eventTime:{value:''},eventVal:{value:''},eventErr:{textContent:''},deleteEvent:{onclick:null}};
  const context={console,Date,Math,JSON,Number,Set,URLSearchParams,location:{search:''},navigator:{},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById(id){return fields[id]||noop;},addEventListener(){}},window:{addEventListener(){},TemperatureAnalysis:Analysis,PredictionHistory:History,MeasurementGuidance:Guidance},
    TemperatureAnalysis:Analysis,PredictionHistory:History,MeasurementGuidance:Guidance,requestAnimationFrame(){}};
  vm.createContext(context);vm.runInContext(inline,context);context.c=c;
  vm.runInContext('state.activeCooking=c;addEvent("modeChanged","Mode : Smoker",{mode:"Smoker"},new Date(c.measurements[3].timestamp).toISOString())',context);
  assert.equal(c.events[0].phaseBoundary,true);assert.equal(c.events[0].details.mode,'Smoker');
  assert.equal(c.events[0].timestamp,c.measurements[3].timestamp);
  const a=Analysis.analyze(c,start+70*60000);assert.equal(a.phases.length,1);
  vm.runInContext('addEvent("setpointChanged","Consigne 170 °C",{toC:170},new Date(c.measurements[4].timestamp).toISOString())',context);
  assert.equal(c.cookerSetpointC,170);
  vm.runInContext('addEvent("setpointChanged","Consigne effacée",{toC:null},new Date(c.measurements[5].timestamp).toISOString())',context);
  assert.equal(c.cookerSetpointC,null);
  vm.runInContext('c.events.pop();syncSetpoint(c)',context);assert.equal(c.cookerSetpointC,170);
  vm.runInContext('c.events.pop();syncSetpoint(c)',context);assert.equal(c.cookerSetpointC,140);
  c.predictionLog.push({kind:'eta-v1',issuedAt:new Date(start+60*60000).toISOString(),targetC:100,eta:null});
  vm.runInContext('openModal=()=>{};closeModal=()=>{};render=()=>{};toast=()=>{};eventForm("modeChanged",0)',context);
  context.editedAt=new Date(start+35*60000);fields.eventTime.value=vm.runInContext('toDatetimeLocal(editedAt)',context);fields.eventVal.value='Roast';
  fields.eventForm.onsubmit({preventDefault(){}});
  assert.equal(c.events[0].details.mode,'Roast');assert.equal(Date.parse(c.events[0].timestamp),start+35*60000);
  assert.equal(c.predictionLog[0].invalidated,true);
  c.events.push({type:'legacyPhase',label:'Legacy',timestamp:new Date(start+40*60000).toISOString(),details:{custom:'kept'},phaseBoundary:true});
  vm.runInContext('editEvent(1)',context);context.editedAt=new Date(start+45*60000);
  fields.eventTime.value=vm.runInContext('toDatetimeLocal(editedAt)',context);fields.eventVal.value='Legacy edited';
  fields.eventForm.onsubmit({preventDefault(){}});
  assert.equal(c.events[1].phaseBoundary,true);assert.equal(c.events[1].type,'legacyPhase');assert.equal(c.events[1].details.custom,'kept');
});
