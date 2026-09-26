/* Immutable records of forecasts issued while a cook is in progress.
 * Historical forecasts must never be reconstructed from later measurements. */
(function(root){
  'use strict';
  function snapshot(c,analysis,issuedAtMs){
    const last=analysis.all.at(-1),target=Number(c.targetTemperature);
    if(!last||!Number.isFinite(issuedAtMs)||last.timeMs>issuedAtMs||!Number.isFinite(target))return null;
    const eta=analysis.eta;
    return {kind:'eta-v1',issuedAt:new Date(issuedAtMs).toISOString(),measurementAt:new Date(last.timeMs).toISOString(),
      measuredC:last.temperature,targetC:target,model:analysis.activePhase?.model?.family||null,
      confidence:analysis.confidence,quality:analysis.quality.key,
      eta:eta?{earliestAtMs:eta.earliestAtMs,estimatedAtMs:eta.estimatedAtMs,latestAtMs:eta.latestAtMs}:null,
      reason:eta?null:last.temperature>=target?'Cible déjà mesurée':analysis.reason||analysis.warnings.at(-1)||'Prévision indisponible'};
  }
  function append(log,entry){return entry?[...(Array.isArray(log)?log:[]),entry]:Array.isArray(log)?log:[];}
  function invalidateFrom(log,fromMs){return (Array.isArray(log)?log:[]).map(entry=>entry?.kind==='eta-v1'&&
    Date.parse(entry.issuedAt)>=fromMs?{...entry,invalidated:true}:entry);}
  function crossingWindow(measurements,targetC){
    if(!Number.isFinite(targetC))return null;
    const points=(measurements||[]).map(m=>({timeMs:Date.parse(m.timestamp),temperature:Number(m.temperature)}))
      .filter(p=>Number.isFinite(p.timeMs)&&Number.isFinite(p.temperature)).sort((a,b)=>a.timeMs-b.timeMs);
    for(let i=0;i<points.length;i++)if(points[i].temperature>=targetC){
      if(i===0||points[i-1].temperature>=targetC||points[i-1].timeMs>=points[i].timeMs)return null;
      return {earliestAtMs:points[i-1].timeMs,latestAtMs:points[i].timeMs};
    }
    return null;
  }
  function assess(entry,measurements,events=[]){
    if(entry?.kind!=='eta-v1'||entry.invalidated)return 'invalidated';
    const window=crossingWindow(measurements,entry.targetC);
    if(!window||!entry.eta||Date.parse(entry.issuedAt)>=window.latestAtMs)return 'unknown';
    if(events.some(e=>e.phaseBoundary&&Date.parse(e.timestamp)>Date.parse(entry.issuedAt)&&Date.parse(e.timestamp)<=window.latestAtMs))return 'changed';
    // The true crossing lies somewhere between two measurements: do not invent an exact arrival time.
    if(entry.eta.latestAtMs<window.earliestAtMs)return 'early';
    if(entry.eta.earliestAtMs>window.latestAtMs)return 'late';
    return 'compatible';
  }
  const api={snapshot,append,invalidateFrom,crossingWindow,assess};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PredictionHistory=api;
})(typeof window!=='undefined'?window:globalThis);
