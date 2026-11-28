/* ChessLens service worker — app shell + CDN assets cached for offline use */
'use strict';

const VERSION = 'v12';
const SHELL_CACHE = 'chesslens-shell-' + VERSION;
const CDN_CACHE = 'chesslens-cdn-' + VERSION; // must match CDN_CACHE in app.js

const NEO_FILES = [
  './pieces/neo/WhitePawn.png',
  './pieces/neo/WhiteKnight.png',
  './pieces/neo/WhiteBishop.png',
  './pieces/neo/WhiteRook.png',
  './pieces/neo/WhiteQueen.png',
  './pieces/neo/WhiteKing.png',
  './pieces/neo/BlackPawn.png',
  './pieces/neo/BlackKnight.png',
  './pieces/neo/BlackBishop.png',
  './pieces/neo/BlackRook.png',
  './pieces/neo/BlackQueen.png',
  './pieces/neo/BlackKing.png'
];

const SHELL_FILES = ['./', './index.html', './style.css', './app.js', './manifest.json', ...NEO_FILES];
const PRECACHE_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js',
  'https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.min.js'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(PRECACHE_CDN.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res && res.ok) await cdn.put(url, res);
      } catch (err) { /* one CDN may be unreachable; the other is enough */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, CDN_CACHE];
    const names = await caches.keys();
    /* Carry the engine downloads (Stockfish js/wasm, chess.js) over from older CDN caches,
       so offline users do not need to download them again after the update */
    try {
      const cdn = await caches.open(CDN_CACHE);
      for (const n of names.filter((x) => x.startsWith('chesslens-cdn-') && !keep.includes(x))) {
        const old = await caches.open(n);
        const reqs = await old.keys();
        for (const r of reqs) {
          if (await cdn.match(r)) continue;
          const res = await old.match(r);
          if (res) await cdn.put(r, res);
        }
      }
    } catch (err) { /* best effort */ }
    /* then drop every older chesslens-* cache (v11 and earlier) */
    await Promise.all(names.filter((n) => n.startsWith('chesslens-') && !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'api.chess.com') return;

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { event.waitUntil(network); return hit; }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});
