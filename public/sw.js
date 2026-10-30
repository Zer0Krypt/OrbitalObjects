// Orbital Objects service worker: makes the site installable, quick to
// reopen and usable offline with the last data it downloaded.
//
//   page            network first (4 s), else the cached copy
//   assets/*        hashed build files: cache first, kept for good
//   textures, sky, icons, geo, fonts: served from cache, refreshed in the background
//   data/history/*  orbital snapshots: cached for a week (the backfill can
//                   upgrade one in place during a site's first days)
//   data/*.json     fresh copy if the cached one is over 15 minutes old;
//                   on a slow or failed network, the cached copy
//
// Bump VERSION when this file's caching logic changes.
const VERSION = 'v3';
const SHELL = `oo-shell-${VERSION}`;
const ASSETS = `oo-assets-${VERSION}`;
const STATIC = `oo-static-${VERSION}`;
const DATA = `oo-data-${VERSION}`;
const KEEP = [SHELL, ASSETS, STATIC, DATA];
const FRESH_MS = 15 * 60e3;
const MAX_ASSETS = 60;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['./', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png']))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('oo-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

/** Store a copy with the time it was fetched. */
async function put(cacheName, req, res) {
  if (!res || !res.ok || res.type === 'opaque') return;
  const headers = new Headers(res.headers);
  headers.set('x-oo-fetched', String(Date.now()));
  // Vary (e.g. on Origin) would stop the copy matching a slightly different request.
  headers.delete('vary');
  const body = await res.clone().blob();
  const cache = await caches.open(cacheName);
  await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function page(req) {
  // The app is the shell; other pages (status.html) are cached under their own URL.
  const app = /\/(index\.html)?$/.test(new URL(req.url).pathname);
  const key = app ? './' : new URL(req.url).pathname;
  try {
    const res = await Promise.race([fetch(req), timeout(4000)]);
    if (res.ok) put(SHELL, key, res.clone());
    return res;
  } catch {
    return (await caches.match(key, { cacheName: SHELL, ignoreVary: true })) || (await caches.match(req, { ignoreVary: true })) || Response.error();
  }
}

async function cacheFirst(cacheName, req, onStore) {
  const hit = await caches.match(req, { cacheName, ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  await put(cacheName, req, res.clone());
  if (onStore) onStore();
  return res;
}

async function staleWhileRevalidate(cacheName, req) {
  const hit = await caches.match(req, { cacheName, ignoreVary: true });
  const refresh = fetch(req)
    .then(async (res) => {
      await put(cacheName, req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await refresh) || Response.error();
}

/** Mark a response as coming from the offline copy, so the page can say so. */
function offline(res) {
  const headers = new Headers(res.headers);
  headers.set('x-oo-offline', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function data(req, freshMs = FRESH_MS) {
  const hit = await caches.match(req, { cacheName: DATA, ignoreVary: true });
  const age = hit ? Date.now() - Number(hit.headers.get('x-oo-fetched') || 0) : Infinity;
  if (hit && age < freshMs) return hit;
  try {
    // A cached copy to fall back on means we needn't wait forever.
    const res = await (hit ? Promise.race([fetch(req), timeout(10000)]) : fetch(req));
    if (res.ok) {
      await put(DATA, req, res.clone());
      return res;
    }
    return hit ? offline(hit) : res;
  } catch (err) {
    if (hit) return offline(hit);
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (req.mode === 'navigate') return e.respondWith(page(req));
  if (/\/assets\//.test(path)) return e.respondWith(cacheFirst(ASSETS, req, () => trim(ASSETS, MAX_ASSETS)));
  if (/\/data\/history\/.+\.bin$/.test(path)) return e.respondWith(data(req, 7 * 86400e3));
  if (/\/data\/.+\.json$/.test(path)) return e.respondWith(data(req));
  if (/\/(textures|sky|icons|geo)\//.test(path) || /\.(svg|webmanifest|woff2?)$/.test(path)) return e.respondWith(staleWhileRevalidate(STATIC, req));
});

// ---------- background pass alerts (Web Push from the push worker) ----------
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Orbital Objects', {
      body: d.body || '',
      tag: d.tag || undefined,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: d.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open tab of the site if there is one.
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
