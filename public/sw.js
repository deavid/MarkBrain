/*
 * MarkBrain service worker — offline app shell (PWA, 2026-10-26).
 *
 * Strategy, deliberately minimal:
 * - install: precache the full app shell (PRECACHE manifest stamped by
 *   scripts/build-sw.mjs at build time — Vite hashes assets per build, so
 *   the list must be generated, not hardcoded).
 * - fetch: cache-first for same-origin GET (runtime-cache everything on
 *   first sight, including hashed assets); network-first for navigations so
 *   users get fresh index.html when online, falling back to the cached one
 *   in airplane mode.
 * - never touch cross-origin requests (there should be none anymore once
 *   fonts are self-hosted, but belt-and-braces).
 * - activate: purge old cache versions on upgrade (VERSION bump busts it).
 *
 * Only registered in production builds (main.tsx guards on import.meta.env.PROD)
 * — under `npm run dev` the dev server/HMR would fight the SW.
 */
const VERSION = 'v1';
const CACHE = `markbrain-shell-${VERSION}`;

// Placeholder — scripts/build-sw.mjs replaces this with the real file list at
// build time (hashed assets change every build; hardcoding here would rot).
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The API is live data — never served from the shell cache. (Auth'd
  // endpoints also must not land in a shared CacheStorage.)
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Network-first: fresh shell when online, cached shell in airplane mode.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    );
    return;
  }

  // Cache-first for assets (hashed filenames → immutable in practice).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
