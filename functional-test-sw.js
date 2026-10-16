// Explicitly installed by the offline test. Cache only this app's shell.
const CACHE = 'xpeng-functional-v1';
const ROOT = new URL('./', self.location.href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([ROOT.href, new URL('index.html', ROOT).href])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin ||
      ![ROOT.pathname, ROOT.pathname + 'index.html'].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(new URL('index.html', ROOT).href))));
});
