// Bump the cache name whenever any precached asset changes.
const CACHE_PREFIX = 'humidity-lab-';
const CACHE_NAME = 'humidity-lab-20260923-v3-type1';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './psychrometrics.js', './process.js', './chart.js',
  './manifest.webmanifest', './icons/icon-192.png',
  './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];
const base = self.registration.scope;
const assetURLs = new Set(ASSETS.map(path => new URL(path, base).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const entries = await Promise.all(ASSETS.map(async path => {
      const url = new URL(path, base).href;
      const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin', redirect: 'error' }));
      if (!response.ok || response.redirected) throw new Error('App asset unavailable');
      const type = response.headers.get('content-type') || '';
      if (path.endsWith('.js') && !/javascript|ecmascript/.test(type)) throw new Error('Expected script asset');
      if (path === './' || path.endsWith('.html')) {
        const html = await response.clone().text();
        if (!html.includes('id="psych-chart"')) throw new Error('Expected calculator document');
      }
      return [url, response];
    }));
    // Fetch and validate every asset before writing a complete offline version.
    await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = ''; url.hash = '';
  if (!assetURLs.has(url.href)) return;
  // An active version serves its matching HTML and scripts together.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url.href);
    if (response) return response;
    return fetch(event.request);
  })());
});
