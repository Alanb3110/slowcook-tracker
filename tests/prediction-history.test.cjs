const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Analysis=require('../analysis.js');
const History=require('../prediction-history.js');
const origin=Date.parse('2026-09-26T10:00:00Z');
const measure=(minutes,temperature)=>({timestamp:new Date(origin+minutes*60000).toISOString(),temperature});
const cooking=ms=>({targetTemperature:80,measurements:ms,events:[],predictionLog:[]});

test('a forecast is recorded with only observations available when it was issued',()=>{
  const c=cooking([0,10,20,30,40,50].map(m=>measure(m,30+m*.5)));
  const issuedAtMs=origin+50*60000,a=Analysis.analyze(c,issuedAtMs);
  const entry=History.snapshot(c,a,issuedAtMs);
  assert.ok(entry.eta);assert.equal(entry.targetC,80);assert.equal(entry.measuredC,55);
  assert.equal(entry.measurementAt,new Date(issuedAtMs).toISOString());
  assert.equal(entry.model,a.activePhase.model.family);
  const saved=History.append(c.predictionLog,entry);
  c.measurements.push(measure(90,83));
  assert.deepEqual(saved[0],entry);assert.equal(History.assess(entry,c.measurements),'compatible');
  assert.deepEqual(History.crossingWindow(c.measurements,80),{earliestAtMs:origin+50*60000,latestAtMs:origin+90*60000});
});
test('an uncertain crossing is judged by its bounding measurements',()=>{
  const c=cooking([measure(10,79),measure(100,81)]),base={kind:'eta-v1',issuedAt:new Date(origin).toISOString(),targetC:80};
  assert.equal(History.assess({...base,eta:{earliestAtMs:origin+30*60000,latestAtMs:origin+70*60000}},c.measurements),'compatible');
  assert.equal(History.assess({...base,eta:{earliestAtMs:origin,latestAtMs:origin+5*60000}},c.measurements),'early');
  assert.equal(History.assess({...base,eta:{earliestAtMs:origin+110*60000,latestAtMs:origin+120*60000}},c.measurements),'late');
  assert.equal(History.assess({...base,eta:{earliestAtMs:origin,latestAtMs:origin+5*60000}},c.measurements,
    [{timestamp:new Date(origin+40*60000).toISOString(),phaseBoundary:true}]),'changed');
  assert.equal(History.assess({...base,eta:null},c.measurements),'unknown');
  assert.equal(History.crossingWindow([measure(0,81)],80),null);
  assert.equal(History.crossingWindow([measure(0,79),measure(0,81)],80),null);
});
test('editing old measurements invalidates subsequent records; old exports are never backfilled',()=>{
  const c=cooking([measure(0,32),measure(10,40)]),entry={kind:'eta-v1',issuedAt:new Date(origin+10*60000).toISOString(),targetC:80,eta:null};
  const log=History.invalidateFrom([entry],origin+5*60000);
  assert.equal(log[0].invalidated,true);assert.equal(entry.invalidated,undefined);
  const legacy=require('./paleron-real-v5.json').cooking;
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  const noop={classList:{add(){},remove(){}},addEventListener(){},innerHTML:''};
  const context={console,Date,Math,JSON,Number,Set,URLSearchParams,location:{search:''},navigator:{},localStorage:{getItem(){return null;}},
    document:{getElementById(){return noop;},addEventListener(){}},window:{addEventListener(){},TemperatureAnalysis:Analysis,PredictionHistory:History},TemperatureAnalysis:Analysis,PredictionHistory:History,requestAnimationFrame(){}};
  vm.createContext(context);vm.runInContext(inline,context);context.legacy=legacy;
  const imported=vm.runInContext('migrateState({schemaVersion:5,activeCooking:legacy,archivedCookings:[]})',context);
  assert.equal(imported.schemaVersion,5);assert.equal(imported.activeCooking.predictionLog.length,0);
  assert.equal(imported.activeCooking.measurements.length,18);
  imported.activeCooking.predictionLog.push(entry);context.imported=imported;
  const exported=vm.runInContext('state=imported;stateExportPayload()',context);
  const roundTrip=vm.runInContext('migrateState(JSON.parse(JSON.stringify(stateExportPayload())))',context);
  assert.equal(exported.schemaVersion,5);assert.equal(roundTrip.activeCooking.predictionLog[0].issuedAt,entry.issuedAt);
  assert.equal(c.measurements.length,2);
});
