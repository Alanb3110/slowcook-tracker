/* Qualitative sampling reminders; these are scheduling heuristics, not physics. */
(function(root){
  'use strict';
  const M=60000;
  function recommend(c,a,nowMs){
    const last=a.all.at(-1);
    if(!last)return {when:'Dès le début',why:'Une première mesure lance le suivi.'};
    const target=Number(c.targetTemperature);
    if(Number.isFinite(target)&&last.temperature>=target)return null;
    const age=Math.max(0,(nowMs-last.timeMs)/M);
    const change=(c.events||[]).filter(e=>e.phaseBoundary).map(e=>Date.parse(e.timestamp))
      .filter(t=>Number.isFinite(t)&&t>last.timeMs&&t<=nowMs).sort((x,y)=>y-x)[0];
    if(a.warnings.some(w=>/atypique|divergents/i.test(w)))return {when:'Maintenant',why:'Confirmer la mesure ou la tendance avant de suivre l’ETA.'};
    if(a.acq.isStale||age>Math.max(30,2.5*a.acq.baselineIntervalMinutes))
      return {when:'Maintenant',why:'La dernière mesure est trop ancienne pour une prévision à jour.'};
    if(change!==undefined){
      if(nowMs-change>=15*M||target-last.temperature<=3)return {when:'Maintenant',why:'Vérifier l’effet du dernier changement de cuisson.'};
      return {when:'Dans 10–20 min',why:'Laisser apparaître l’effet du changement dans la température à cœur.'};
    }
    if(a.eta&&a.eta.earliestAtMs-nowMs<45*M||target-last.temperature<=5){
      return age>=15?{when:'Maintenant',why:'La cible est proche ; la mesurer plus souvent.'}:
        {when:'Dans 10–15 min',why:'La cible est proche ; la mesurer plus souvent.'};
    }
    if(age>25)return {when:'Maintenant',why:'Rafraîchir la tendance du régime actif.'};
    return {when:'Dans 20–30 min',why:'Conseil indicatif, à adapter au plat et à la sonde.'};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={recommend};
  root.MeasurementGuidance={recommend};
})(typeof window!=='undefined'?window:globalThis);
