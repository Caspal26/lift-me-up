// Lift Me Up service worker: offline readings, push delivery, notification taps.

const VERSION = 'v3';
const SHELL_CACHE = `lmu-shell-${VERSION}`;
const DATA_CACHE = 'lmu-data-v1'; // readings outlive app updates
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-96.png'];
const CACHED_API = /^\/api\/(today|editions\/\d{4}-\d{2}-\d{2}|archive|favourites|settings|encouragements)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('lmu-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function offlineJson() {
  return new Response(JSON.stringify({ offline: true }), { status: 503, headers: { 'content-type': 'application/json' } });
}

async function remember(cache, key, response) {
  const body = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set('x-lmu-cached-at', new Date().toISOString());
  await cache.put(key, new Response(body, { status: response.status, headers }));
}

async function fromCache(cache, key) {
  const hit = await cache.match(key);
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('x-lmu-from-cache', hit.headers.get('x-lmu-cached-at') || 'yes');
  return new Response(await hit.arrayBuffer(), { status: hit.status, headers });
}

// Network first, so a refresh always shows the server's edition; the cached
// copy is the fallback when the phone is offline.
async function apiNetworkFirst(request, path) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await remember(cache, path, response);
      if (path === '/api/today') {
        const data = await response.clone().json().catch(() => null);
        const edition = data?.edition || data?.previous;
        if (edition?.date) {
          await cache.put(`/api/editions/${edition.date}`, new Response(JSON.stringify(edition), {
            headers: { 'content-type': 'application/json', 'x-lmu-cached-at': new Date().toISOString() },
          }));
        }
      }
    }
    return response;
  } catch {
    return (await fromCache(cache, path)) || offlineJson();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/')) || offlineJson()));
    return;
  }
  if (CACHED_API.test(url.pathname)) {
    event.respondWith(apiNetworkFirst(request, url.pathname));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  // App files: answer from the cache at once, refresh it in the background,
  // so an update to the app appears on the next open.
  const refresh = caches.open(SHELL_CACHE).then((cache) => fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null));
  event.waitUntil(refresh);
  event.respondWith(caches.match(request).then(async (hit) => hit || (await refresh) || Response.error()));
});

// ---- Push -----------------------------------------------------------------------

async function showEdition(data) {
  // Fetch the reading now, so it opens instantly — even offline — when tapped.
  if (data.date) {
    try {
      const res = await fetch(`/api/editions/${data.date}`, { credentials: 'same-origin' });
      if (res.ok) await remember(await caches.open(DATA_CACHE), `/api/editions/${data.date}`, res);
    } catch { /* the tap will fetch it */ }
  }
  return self.registration.showNotification(data.title || 'Lift Me Up', {
    body: data.body || 'Your morning reading is here.',
    tag: data.tag || 'lift-me-up',
    data: { url: data.url || '/', date: data.date || null },
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
  });
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data?.text() }; }
  event.waitUntil(showEdition(data));
});

async function openUrl(path) {
  const url = new URL(path || '/', self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    // Browsers allow focus() only inside a real notification click.
    await client.focus().catch(() => {});
    if ('navigate' in client && client.url !== url) {
      try { return await client.navigate(url); } catch { /* not controlled yet */ }
    }
    client.postMessage({ type: 'open', url });
    return client;
  }
  return self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openUrl(event.notification.data?.url));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const key = event.oldSubscription?.options?.applicationServerKey;
    if (!key) return;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscribe', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  })());
});

// Local testing only: replay a push payload and a tap without a push service.
// Where the test browser has notifications blocked, the payload is held here
// and the tap goes through the same openUrl() a real tap uses.
const heldForTest = new Map();
self.addEventListener('message', (event) => {
  if (!['localhost', '127.0.0.1'].includes(self.location.hostname)) return;
  const msg = event.data || {};
  if (msg.type === 'test:push') {
    heldForTest.set(msg.payload.tag, msg.payload);
    event.waitUntil(showEdition(msg.payload).catch(() => {}));
  } else if (msg.type === 'test:tap') {
    event.waitUntil((async () => {
      const [n] = await self.registration.getNotifications({ tag: msg.tag }).catch(() => []);
      n?.close();
      const url = n?.data?.url || heldForTest.get(msg.tag)?.url || msg.payload?.url;
      if (url) await openUrl(url);
    })());
  }
});
