/* Static application shell only. Cooking records remain in local browser storage. */
const CACHE='cuisson-tracker-shell-v3.3.0';
const PREFIX='cuisson-tracker-shell-';
const SHELL=['./','./index.html','./analysis.js?v=4.2.2','./prediction-history.js?v=1','./measurement-guidance.js?v=1','./manifest.webmanifest','./icon.svg'];
const scope=new URL(self.registration.scope);
const indexUrl=new URL('./index.html',scope);
const staticPaths=new Set(SHELL.slice(2).map(p=>new URL(p,scope).pathname));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok&&response.headers.get('content-type')?.includes('text/html'))
        caches.open(CACHE).then(cache=>cache.put(indexUrl,response.clone()));
      return response;
    }).catch(async()=>await caches.match(indexUrl)||new Response('Application hors ligne non initialisée.',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}})));
    return;
  }
  if(staticPaths.has(url.pathname))event.respondWith(caches.match(request).then(hit=>hit||fetch(request)));
});
