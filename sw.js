const CACHE='ttropiano-7e57db9c5472a087', ASSETS=["./assets/main-5ZoqcwsJ.css","./assets/main-EU8KDxOn.js","./assets/persistence.worker-DdBEz4-A.js","./assets/qa-lD5Qm8sc.js","./assets/ux-DElxS22w.js","./icon-192.png","./icon-512.png","./icon.svg","./index.html","./manifest.webmanifest","./piano/LICENSE.txt","./piano/hard-101.mp3","./piano/hard-105.mp3","./piano/hard-107.mp3","./piano/hard-23.mp3","./piano/hard-27.mp3","./piano/hard-31.mp3","./piano/hard-35.mp3","./piano/hard-40.mp3","./piano/hard-45.mp3","./piano/hard-50.mp3","./piano/hard-55.mp3","./piano/hard-59.mp3","./piano/hard-64.mp3","./piano/hard-69.mp3","./piano/hard-76.mp3","./piano/hard-80.mp3","./piano/hard-85.mp3","./piano/hard-89.mp3","./piano/hard-93.mp3","./piano/hard-97.mp3","./piano/manifest.json","./piano/soft-101.mp3","./piano/soft-105.mp3","./piano/soft-107.mp3","./piano/soft-23.mp3","./piano/soft-27.mp3","./piano/soft-31.mp3","./piano/soft-35.mp3","./piano/soft-40.mp3","./piano/soft-45.mp3","./piano/soft-50.mp3","./piano/soft-55.mp3","./piano/soft-59.mp3","./piano/soft-64.mp3","./piano/soft-69.mp3","./piano/soft-76.mp3","./piano/soft-80.mp3","./piano/soft-85.mp3","./piano/soft-89.mp3","./piano/soft-93.mp3","./piano/soft-97.mp3","./ux/index.html"];
const URLS=new Set(ASSETS.map(asset=>new URL(asset,self.location.href).href));
const INDEX=new URL('./index.html',self.location.href).href, ROOT=new URL('./',self.location.href).pathname;
self.addEventListener('install', event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate', event=>event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ttropiano-')&&k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 url.search='';const navigation=event.request.mode==='navigate'&&(url.pathname===ROOT||url.href===INDEX);
 if(!navigation&&!URLS.has(url.href))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{
  // Only the build's static allowlist is cached. CORS requests add Origin while
  // precache requests may omit it; Vary: Origin must not hide identical JS/CSS offline.
  const response=await cache.match(navigation?INDEX:url.href,{ignoreSearch:true,ignoreVary:true});
  if(response)return response;return fetch(event.request);
 }));
});
self.addEventListener('message',event=>{if(event.data?.type==='offline-status')event.waitUntil(caches.open(CACHE).then(async cache=>{const checks=await Promise.all(ASSETS.map(asset=>cache.match(asset,{ignoreVary:true})));event.ports[0]?.postMessage({ready:checks.every(Boolean),assets:checks.length,version:'7e57db9c5472a087'})}))});
