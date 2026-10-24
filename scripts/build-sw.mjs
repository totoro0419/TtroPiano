import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
async function files(dir) { const entries = await readdir(dir, { withFileTypes: true }); const result = []; for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) result.push(...await files(p)); else if (e.name !== 'sw.js' && !p.includes('/qa/')) result.push(p); } return result; }
const paths = await files('dist'); const hash = createHash('sha256'); for (const f of paths.toSorted()) hash.update(await readFile(f));
const version = hash.digest('hex').slice(0, 16), assets = paths.map(p => './' + p.replace(/^dist\//, ''));
const script = `const CACHE='ttropiano-${version}', ASSETS=${JSON.stringify(assets)};
self.addEventListener('install', event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate', event=>event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ttropiano-')&&k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>{const response=await cache.match(event.request,{ignoreSearch:true});if(response)return response;try{return await fetch(event.request)}catch(error){if(event.request.mode==='navigate')return await cache.match('./index.html');throw error}}))});
self.addEventListener('message',event=>{if(event.data?.type==='offline-status')event.waitUntil(caches.open(CACHE).then(async cache=>{const checks=await Promise.all(ASSETS.map(asset=>cache.match(asset)));event.ports[0]?.postMessage({ready:checks.every(Boolean),assets:checks.length,version:'${version}'})}))});
`;
await writeFile('dist/sw.js', script); console.log(`Offline cache: ${assets.length} assets, ${version}`);
