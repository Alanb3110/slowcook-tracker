const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('service worker caches only the static shell and serves it without network',async()=>{
  const scope='https://alanb3110.github.io/slowcook-tracker/',handlers={},content=new Map(),deleted=[];
  const response={ok:true,headers:{get(){return 'text/html';}},clone(){return this;}};
  const cache={addAll:async paths=>{for(const p of paths)content.set(new URL(p,scope).href,response);},put:async(k,v)=>content.set(k.href||k,v)};
  const caches={open:async()=>cache,keys:async()=>['cuisson-tracker-shell-v3.2.2','cuisson-tracker-shell-v3.3.0'],
    delete:async key=>{deleted.push(key);return true;},match:async request=>content.get(request.url||request.href||request)};
  const self={registration:{scope},addEventListener(name,fn){handlers[name]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  const ctx={self,caches,URL,Response,Promise,Set,fetch:async()=>{throw new Error('offline');}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),ctx);
  await new Promise((resolve,reject)=>handlers.install({waitUntil(p){p.then(resolve,reject);}}));
  await new Promise((resolve,reject)=>handlers.activate({waitUntil(p){p.then(resolve,reject);}}));
  assert.deepEqual(deleted,['cuisson-tracker-shell-v3.2.2']);
  assert.ok(content.has(scope+'index.html'));
  for(const file of ['analysis.js?v=4.2.2','prediction-history.js?v=1','measurement-guidance.js?v=1','manifest.webmanifest','icon.svg'])assert.ok(content.has(scope+file));
  assert.ok(![...content.keys()].some(x=>x.endsWith('.json')));
  let reply;handlers.fetch({request:{method:'GET',mode:'navigate',url:scope},respondWith(p){reply=p;}});
  assert.equal(await reply,response);
  reply=null;handlers.fetch({request:{method:'GET',mode:'same-origin',url:scope+'analysis.js?v=4.2.2'},respondWith(p){reply=p;}});
  assert.equal(await reply,response);
  reply=null;handlers.fetch({request:{method:'GET',mode:'same-origin',url:scope+'icon.svg'},respondWith(p){reply=p;}});
  assert.equal(await reply,response);
  reply=null;handlers.fetch({request:{method:'GET',mode:'same-origin',url:scope+'private-cooking.json'},respondWith(p){reply=p;}});
  assert.equal(reply,null);
});
