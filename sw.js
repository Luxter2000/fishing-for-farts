const CACHE = 'fff-v2.0.0';
const CORE = [
  './','./index.html','./species.html',
  './style.css','./app.js','./species.js',
  './data/spots.json','./data/species.json',
  './assets/logo.svg','./assets/arrow.svg','./assets/fart.svg',
  './assets/species/flathead.svg','./assets/species/bream.svg','./assets/species/whiting.svg','./assets/species/tailor.svg','./assets/species/mulloway.svg',
  './manifest.webmanifest'
];
self.addEventListener('install',(e)=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate',(e)=>{ e.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))); self.clients.claim(); })()); });
self.addEventListener('fetch',(e)=>{ const req=e.request; e.respondWith((async()=>{ const cached=await caches.match(req); if(cached) return cached; try{ const res=await fetch(req); if(req.method==='GET' && new URL(req.url).origin===location.origin){ const cache=await caches.open(CACHE); cache.put(req,res.clone()); } return res; }catch{ return cached || new Response('Offline', {status:503}); } })()); });
