const CACHE = 'fff-v1.0.1';
const CORE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data/spots.json',
  './data/species.json',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/arrow.svg',
  './assets/fart.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  e.respondWith((async ()=>{
    const cached = await caches.match(req);
    if(cached) return cached;
    try{
      const res = await fetch(req);
      if (req.method === 'GET' && new URL(req.url).origin === location.origin){
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    }catch{
      return cached || new Response('Offline', {status:503});
    }
  })());
});
