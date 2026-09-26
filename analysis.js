/* CuissonTracker analysis v4.2.1. Times are milliseconds, rates are °C/h.
 * This module has no DOM or storage dependency and also runs in Node tests.
 * @typedef {{timeMs:number,temperature:number,index:number,timestamp:string}} Point
 * @typedef {'linear'|'quadratic'|'logarithmic'|'exponential'} ModelFamily
 * @typedef {{family:ModelFamily,parameters:Object,rmseC:number,predictiveRmseC:number|null,score:number,rejectedReason:string|null}} ModelResult
 * @typedef {{startIndex:number,endIndex:number,startMs:number,endMs:number,points:Point[],model:ModelResult|null,candidates:ModelResult[]}} CookingPhase
 */
(function(root){
  'use strict';
  const H=3600000, M=60000, NOISE=0.8, BREAK_COST=12, MAX_ETA_H=8;
  const finite=Number.isFinite;
  const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function prepare(c){
    return (c?.measurements||[]).map((p,index)=>({index,timeMs:new Date(p.timestamp).getTime(),temperature:Number(p.temperature),timestamp:p.timestamp}))
      .filter(p=>finite(p.timeMs)&&finite(p.temperature)).sort((a,b)=>a.timeMs-b.timeMs||a.index-b.index)
      .filter((p,i,a)=>i===0||p.timeMs!==a[i-1].timeMs); // One independent observation per instant.
  }
  function acquisition(points,nowMs){
    const intervals=points.slice(1).map((p,i)=>(p.timeMs-points[i].timeMs)/M).filter(v=>v>0);
    // Use the lower half of recent spacings: a recording outage cannot redefine normal cadence.
    const recent=intervals.slice(-12).sort((a,b)=>a-b);
    const baseline=median(recent.slice(0,Math.max(1,Math.ceil(recent.length/2))))||12;
    const gapThreshold=clamp(3.5*baseline,30,120),staleThreshold=clamp(2.5*baseline,30,90);
    const gaps=intervals.map((minutes,i)=>({beforeIndex:i+1,minutes})).filter(g=>g.minutes>gapThreshold);
    const age=points.length?Math.max(0,(nowMs-points.at(-1).timeMs)/M):Infinity;
    return {baselineIntervalMinutes:baseline,gapThresholdMinutes:gapThreshold,staleThresholdMinutes:staleThreshold,
      gaps,ageMinutes:age,isStale:age>staleThreshold};
  }
  function solve(a,b){
    const n=b.length,m=a.map((r,i)=>[...r,b[i]]);
    for(let j=0;j<n;j++){
      let k=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[k][j]))k=i;
      if(Math.abs(m[k][j])<1e-10)return null;
      [m[k],m[j]]=[m[j],m[k]];const v=m[j][j];for(let h=j;h<=n;h++)m[j][h]/=v;
      for(let i=0;i<n;i++)if(i!==j){const q=m[i][j];for(let h=j;h<=n;h++)m[i][h]-=q*m[j][h];}
    }
    return m.map(r=>r[n]);
  }
  function regression(xs,ys,basis){
    const n=basis(xs[0]).length;let weights=xs.map(()=>1),coef=null;
    for(let iteration=0;iteration<3;iteration++){
      const matrix=Array.from({length:n},()=>Array(n).fill(0)),rhs=Array(n).fill(0);
      for(let i=0;i<xs.length;i++){const row=basis(xs[i]);for(let j=0;j<n;j++){
        rhs[j]+=weights[i]*row[j]*ys[i];for(let k=0;k<n;k++)matrix[j][k]+=weights[i]*row[j]*row[k];
      }}
      coef=solve(matrix,rhs);if(!coef)return null;
      weights=xs.map((x,i)=>{const residual=Math.abs(ys[i]-basis(x).reduce((s,v,j)=>s+v*coef[j],0));return Math.min(1,1.5/Math.max(residual,1e-9));});
    }
    return coef;
  }
  function evaluate(model,x){
    const p=model.parameters;
    if(model.family==='linear')return p.a+p.b*x;
    if(model.family==='quadratic')return p.a+p.b*x+p.c*x*x;
    if(model.family==='logarithmic')return p.a+p.b*Math.log(x+p.c);
    return p.tInf-p.A*Math.exp(-p.k*x);
  }
  function derivative(model,x){const p=model.parameters;
    if(model.family==='linear')return p.b;
    if(model.family==='quadratic')return p.b+2*p.c*x;
    if(model.family==='logarithmic')return p.b/(x+p.c);
    return p.A*p.k*Math.exp(-p.k*x);
  }
  // Monotone piecewise cubic on actual timestamps; each smooth run stays inside
  // a detected phase and stops at a sampling gap. This is only for the chart.
  function historyCurve(phases,acq){
    const gaps=new Set((acq?.gaps||[]).map(g=>g.beforeIndex)),segments=[];
    function endpoint(d0,d1,h0,h1){
      let m=((2*h0+h1)*d0-h0*d1)/(h0+h1);
      if(m*d0<=0)m=0;
      else if(d0*d1<0&&Math.abs(m)>3*Math.abs(d0))m=3*d0;
      return m;
    }
    function smoothRun(points,phaseIndex){
      if(points.length<2)return;
      const h=points.slice(1).map((p,i)=>(p.timeMs-points[i].timeMs)/H);
      const d=h.map((v,i)=>(points[i+1].temperature-points[i].temperature)/v);
      const m=Array(points.length);
      if(points.length===2){m[0]=m[1]=d[0];}
      else{
        m[0]=endpoint(d[0],d[1],h[0],h[1]);
        m[m.length-1]=endpoint(d.at(-1),d.at(-2),h.at(-1),h.at(-2));
        for(let i=1;i<points.length-1;i++){
          if(d[i-1]*d[i]<=0){m[i]=0;continue;}
          const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
          m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);
        }
      }
      for(let i=0;i<points.length-1;i++){
        const left=points[i],right=points[i+1],step=h[i],steps=Math.min(24,Math.max(2,Math.ceil(step*H/(3*M))));
        const samples=Array.from({length:steps+1},(_,j)=>{
          const u=j/steps,u2=u*u,u3=u2*u;
          const temperature=(2*u3-3*u2+1)*left.temperature+(u3-2*u2+u)*step*m[i]
            +(-2*u3+3*u2)*right.temperature+(u3-u2)*step*m[i+1];
          const rateCPerHour=((6*u2-6*u)*left.temperature+(3*u2-4*u+1)*step*m[i]
            +(-6*u2+6*u)*right.temperature+(3*u2-2*u)*step*m[i+1])/step;
          return {timeMs:left.timeMs+(right.timeMs-left.timeMs)*u,temperature,rateCPerHour};
        });
        segments.push({phaseIndex,gap:false,boundary:false,samples});
      }
    }
    for(let phaseIndex=0;phaseIndex<phases.length;phaseIndex++){
      const phase=phases[phaseIndex],points=phase.points;
      let runStart=0;
      for(let i=1;i<=points.length;i++){
        if(i<points.length&&!gaps.has(phase.startIndex+i))continue;
        smoothRun(points.slice(runStart,i),phaseIndex);
        if(i<points.length)segments.push({phaseIndex,gap:true,boundary:false,samples:[
          {timeMs:points[i-1].timeMs,temperature:points[i-1].temperature},
          {timeMs:points[i].timeMs,temperature:points[i].temperature}]});
        runStart=i;
      }
      if(phaseIndex>0){const prev=phases[phaseIndex-1].points.at(-1),first=points[0];
        segments.push({phaseIndex,gap:gaps.has(phase.startIndex),boundary:true,samples:[
          {timeMs:prev.timeMs,temperature:prev.temperature},{timeMs:first.timeMs,temperature:first.temperature}]});
      }
    }
    return segments.sort((a,b)=>a.samples[0].timeMs-b.samples[0].timeMs);
  }
  function rateCurve(phases,acq){
    return historyCurve(phases,acq).filter(s=>!s.gap&&!s.boundary&&
      phases[s.phaseIndex].points.length>=4&&phases[s.phaseIndex].endMs-phases[s.phaseIndex].startMs>=15*M);
  }
  function rawFit(points,family){
    const n=points.length,min={linear:2,quadratic:6,logarithmic:7,exponential:7}[family];
    if(n<min)return null;
    const originMs=points[0].timeMs,xs=points.map(p=>(p.timeMs-originMs)/H),ys=points.map(p=>p.temperature);
    if(xs.at(-1)<1/600)return null;
    let candidates=[];
    if(family==='linear'){
      const q=regression(xs,ys,x=>[1,x]);if(q)candidates=[{a:q[0],b:q[1]}];
    }else if(family==='quadratic'){
      const q=regression(xs,ys,x=>[1,x,x*x]);if(q)candidates=[{a:q[0],b:q[1],c:q[2]}];
    }else if(family==='logarithmic'){
      for(const c of [.05,.1,.2,.35,.5,.8,1.2,2,3.5,6,10,20]){
        const q=regression(xs,ys,x=>[1,Math.log(x+c)]);if(q&&q[1]>0)candidates.push({a:q[0],b:q[1],c});
      }
    }else{
      // Profile the rate; fit T_inf and amplitude in temperature space, never use oven setpoint or target.
      for(let i=0;i<=56;i++){
        const k=.025*Math.pow(1.11,i),q=regression(xs,ys,x=>[1,Math.exp(-k*x)]);
        if(q&&q[1]<0&&q[0]>Math.max(...ys)-1)candidates.push({tInf:q[0],A:-q[1],k});
      }
    }
    let best=null;
    for(const parameters of candidates){
      const model={family,originMs,parameters};
      const errors=xs.map((x,i)=>ys[i]-evaluate(model,x));
      const robustSse=errors.reduce((s,e)=>s+Math.min(e*e,9),0);
      if(!best||robustSse<best.robustSse)best={...model,robustSse,rmseC:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/n),pointCount:n};
    }
    return best;
  }
  function candidatesFor(points){
    const families=['linear','quadratic','logarithmic','exponential'],n=points.length;
    return families.map(family=>{
      const fit=rawFit(points,family);
      if(!fit)return {family,rejectedReason:'Nombre de mesures insuffisant ou paramètres non identifiables'};
      const complexity=family==='linear'?2:3;
      const hold=Math.max(2,Math.floor(n*.25)),train=n-hold;
      let predictiveRmseC=null;
      // Chronological holdout is only used when the training subset identifies this family.
      if(train>=({linear:3,quadratic:6,logarithmic:7,exponential:7}[family])){
        const previous=rawFit(points.slice(0,train),family);
        if(previous)predictiveRmseC=Math.sqrt(points.slice(train).reduce((s,p)=>s+(p.temperature-evaluate(previous,(p.timeMs-previous.originMs)/H))**2,0)/hold);
      }
      const score=fit.rmseC+(.75*(predictiveRmseC??fit.rmseC))+.35*(complexity-2)
        +(!finite(predictiveRmseC)&&complexity>2?.6:0);
      return {...fit,complexity,predictiveRmseC,score,rejectedReason:null};
    });
  }
  function select(points){
    const candidates=candidatesFor(points);
    // Until enough points exist for a genuine out-of-sample comparison, favor the linear law.
    const eligible=candidates.filter(m=>!m.rejectedReason&&(m.family==='linear'||points.length>=9));
    eligible.sort((a,b)=>a.score-b.score||a.complexity-b.complexity);
    let best=eligible[0]||null;
    const simple=eligible.find(m=>m.family==='linear');
    if(simple&&best&&best!==simple&&simple.score-best.score<.32)best=simple;
    for(const m of candidates)if(m!==best&&!m.rejectedReason)m.rejectedReason=points.length<9&&m.complexity>2?'Validation chronologique insuffisante':`Score ${m.score.toFixed(2)} contre ${best.score.toFixed(2)}`;
    return {model:best,candidates};
  }
  function eventNear(events,left,right){
    return (events||[]).some(e=>{
      if(!e.phaseBoundary)return false;
      const t=new Date(e.timestamp).getTime();
      // Allow thermal lag after the action. Evidence in the measurements remains mandatory.
      return t>=left-45*M&&t<=right;
    });
  }
  function segmentCost(points){
    const {model}=select(points);if(!model)return Infinity;
    return model.robustSse/(NOISE*NOISE)+model.complexity*Math.log(points.length);
  }
  function detectPhases(points,events=[]){
    if(!points.length)return [];
    if(points.length<7){const s=select(points);return [{startIndex:0,endIndex:points.length-1,startMs:points[0].timeMs,endMs:points.at(-1).timeMs,points, ...s}];}
    // Bottom-up: blocks of at least four, then merge adjacent compatible blocks.
    const blocks=[];for(let i=0;i<points.length;i+=4)blocks.push({start:i,end:Math.min(points.length,i+4)});
    if(blocks.length>1&&blocks.at(-1).end-blocks.at(-1).start<3)blocks.at(-2).end=blocks.pop().end;
    while(blocks.length>1){
      let best=null;
      for(let i=0;i<blocks.length-1;i++){
        const l=blocks[i],r=blocks[i+1],split=points.slice(l.start,l.end),next=points.slice(r.start,r.end);
        const merged=points.slice(l.start,r.end),cost=segmentCost(merged)-segmentCost(split)-segmentCost(next);
        const near=eventNear(events,points[l.end-1].timeMs,points[l.end].timeMs);
        const threshold=near?9:BREAK_COST;
        if(cost<=threshold&&(!best||cost-threshold<best.gain))best={i,gain:cost-threshold};
      }
      if(!best)break;
      blocks.splice(best.i,2,{start:blocks[best.i].start,end:blocks[best.i+1].end});
    }
    // Refine each retained boundary locally; never use a time gap as a boundary criterion.
    for(let i=0;i<blocks.length-1;i++){
      const l=blocks[i],r=blocks[i+1];let best=l.end,bestCost=Infinity;
      for(let b=Math.max(l.start+3,l.end-3);b<=Math.min(r.end-3,l.end+3);b++){
        const score=segmentCost(points.slice(l.start,b))+segmentCost(points.slice(b,r.end))
          -(eventNear(events,points[b-1].timeMs,points[b].timeMs)?2:0);
        if(score<bestCost){bestCost=score;best=b;}
      }
      l.end=best;r.start=best;
    }
    return blocks.map(({start,end})=>({startIndex:start,endIndex:end-1,startMs:points[start].timeMs,
      endMs:points[end-1].timeMs,points:points.slice(start,end),...select(points.slice(start,end))}));
  }
  function crossHours(model,last,target,spanH){
    if(!model)return {hours:null,reason:'Données insuffisantes'};
    const x=(last.timeMs-model.originMs)/H,shift=last.temperature-evaluate(model,x),p=model.parameters;
    const slope=derivative(model,x);
    if(!finite(slope)||slope<=.05)return {hours:null,reason:'Régime sans montée confirmée'};
    if(model.family==='exponential'&&target>=p.tInf+shift-1e-6)return {hours:null,reason:'Cible au-dessus du plateau estimé'};
    const horizon=Math.min(MAX_ETA_H,Math.max(2,3*spanH));
    const f=h=>evaluate(model,x+h)+shift-target;
    if(f(horizon)<0)return {hours:null,reason:'Cible hors horizon fiable'};
    if(!finite(f(horizon)))return {hours:null,reason:'Extrapolation non finie'};
    let lo=0,hi=horizon;for(let i=0;i<42;i++){const mid=(lo+hi)/2;if(f(mid)>=0)hi=mid;else lo=mid;}
    if(model.family==='quadratic'&&(p.c>0&&hi>spanH||derivative(model,x+hi)<=0||derivative(model,x+hi)>3*Math.max(slope,1)))
      return {hours:null,reason:'Extrapolation quadratique non physique'};
    return {hours:hi,reason:null};
  }
  function predict(phase,target,acq,nowMs,ended){
    const {points,model,candidates}=phase,last=points.at(-1),spanH=Math.max(0,(last.timeMs-points[0].timeMs)/H);
    const warnings=[];
    if(acq.isStale)warnings.push(`Dernière mesure il y a ${Math.round(acq.ageMinutes)} min`);
    const activeGaps=acq.gaps.filter(g=>g.beforeIndex>phase.startIndex&&g.beforeIndex<=phase.endIndex);
    if(activeGaps.length)warnings.push(`Grand intervalle dans le régime actif (${Math.round(Math.max(...activeGaps.map(g=>g.minutes)))} min)`);
    if(points.length<5)warnings.push('Peu de mesures dans le régime actif');
    if(points.length>1&&spanH*60/(points.length-1)>Math.max(25,acq.baselineIntervalMinutes*2.5))warnings.push('Mesures espacées dans le régime actif');
    const outliers=model?points.filter(p=>Math.abs(p.temperature-evaluate(model,(p.timeMs-model.originMs)/H))>Math.max(3,3*model.rmseC)):[];
    if(outliers.length===1&&outliers[0]!==last)warnings.push('Point atypique isolé dans le régime actif');
    const lastResidual=model?Math.abs(last.temperature-evaluate(model,(last.timeMs-model.originMs)/H)):Infinity;
    const atypical=lastResidual>Math.max(3,3*(model?.rmseC??0));
    if(atypical)warnings.push('Dernière mesure atypique : confirmer la sonde');
    let slope=model?derivative(model,(last.timeMs-model.originMs)/H):null;
    if(!finite(slope))slope=null;
    let projection=null;
    if(model&&points.length>=3&&!atypical){const x=(last.timeMs-model.originMs)/H,v=last.temperature+evaluate(model,x+.25)-evaluate(model,x);
      if(finite(v)&&v>=-20&&v<=350&&Math.abs(v-last.temperature)<30)projection=v;
    }
    const primary=target>last.temperature&&!ended?(atypical?{hours:null,reason:'Confirmer la dernière mesure avant ETA'}:points.length>=4?crossHours(model,last,target,spanH):{hours:null,reason:'Données insuffisantes pour ETA'}):{hours:null,reason:null};
    const alternatives=[];
    for(const m of candidates){if(!m.parameters||m===model||m.score>model.score+.8)continue;
      const a=crossHours(m,last,target,spanH);if(a.hours!==null)alternatives.push(a.hours);
    }
    let confidence='low',eta=null;
    if(primary.hours!==null){
      const estimates=[primary.hours,...alternatives],range=Math.max(...estimates)-Math.min(...estimates),rate=Math.max(.2,slope);
      const error=Math.max(model.predictiveRmseC??model.rmseC,model.rmseC,.5);
      let half=Math.max(.25,1.5*error/rate,...alternatives.map(h=>Math.abs(h-primary.hours)));
      if(warnings.length||primary.hours>spanH*1.5)half=Math.max(half,.5);
      confidence=points.length>=8&&spanH>=.5&&error<=1.2&&range<.6&&!warnings.length&&primary.hours<spanH*1.5?'high':
        points.length>=5&&error<=1.8&&range<1.5&&!acq.isStale&&!warnings.length?'medium':'low';
      const center=last.timeMs+primary.hours*H;
      // A late observation cannot justify an ETA that is already in the past.
      if(center+half*H>nowMs&&!acq.isStale){eta={estimatedAtMs:center,earliestAtMs:center-half*H,latestAtMs:center+half*H,hours:primary.hours,confidence};}
      else if(acq.isStale)warnings.push('ETA suspendue : confirmer avec une nouvelle mesure');
    }
    if(alternatives.length&&(primary.reason||Math.max(...alternatives,primary.hours)-Math.min(...alternatives,primary.hours)>1))
      warnings.push('Modèles plausibles divergents');
    if(primary.reason)warnings.push(primary.reason);
    if(!eta)confidence='low';
    return {slope,projection,eta,confidence,warnings,reason:primary.reason,alternativeHours:alternatives};
  }
  function analyze(c,nowMs=Date.now()){
    const all=prepare(c),acq=acquisition(all,nowMs),phases=detectPhases(all,c?.events||[]);
    if(!phases.length)return {all,acq,phases,activePhase:null,slope:null,projection:null,eta:null,confidence:'low',warnings:['Aucune mesure'],quality:{key:'none',label:'Aucune donnée',detail:'Ajoute une première température.'}};
    const activePhase=phases.at(-1),last=all.at(-1);
    const p=predict(activePhase,Number(c.targetTemperature),acq,nowMs,Boolean(c.endedAt));
    const key=acq.isStale?'stale':p.confidence==='high'?'good':p.confidence==='medium'?'usable':'limited';
    const label={stale:'Mesure ancienne',good:'Confiance élevée',usable:'Confiance moyenne',limited:'Confiance faible'}[key];
    const quality={key,label,detail:`${activePhase.points.length} mesures dans le régime actif${p.warnings.length?' · '+p.warnings[0]:''}.`};
    return {all,acq,phases,activePhase,...p,quality};
  }
  const api={prepare,acquisition,rawFit,candidatesFor,select,detectPhases,evaluate,derivative,historyCurve,rateCurve,crossHours,analyze};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.TemperatureAnalysis=api;
})(typeof window!=='undefined'?window:globalThis);
