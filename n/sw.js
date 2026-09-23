// sw.js – Bar Organizer Deluxe
// Increment the version whenever cached files change.
const VERSION = 'v3.1.0';
const STATIC_CACHE = `bar-organizer-static-${VERSION}`;
const RUNTIME_CACHE = `bar-organizer-runtime-${VERSION}`;
const IMAGE_CACHE = 'bar-organizer-images';   // kept across versions, size-limited
const MAX_IMAGES = 150;

// Must succeed for the install to succeed
const CORE_ASSETS = ['./', './index.html', './app.js'];

// Best effort (install does not fail if one of these is missing)
const OPTIONAL_ASSETS = [
    './manifest.json',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
    'icons/icon-72x72.png', 'icons/icon-96x96.png', 'icons/icon-128x128.png', 'icons/icon-144x144.png',
    'icons/icon-152x152.png', 'icons/icon-192x192.png', 'icons/icon-384x384.png', 'icons/icon-512x512.png',
    'icons/apple-touch-icon-152x152.png', 'icons/apple-touch-icon-167x167.png', 'icons/apple-touch-icon-180x180.png',
    'icons/favicon-32x32.png', 'icons/favicon-16x16.png',
];

// Only these third-party hosts are cached (static libraries & fonts). Everything else – in particular
// the API worker and Firebase Auth endpoints – always goes to the network and is never stored.
const CACHEABLE_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NEVER_CACHE_HOSTS = ['workers.dev', 'googleapis.com', 'firebaseio.com', 'firebasedatabase.app', 'identitytoolkit', 'securetoken'];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(CORE_ASSETS);
        await Promise.allSettled(OPTIONAL_ASSETS.map(async (url) => {
            try {
                const cross = url.startsWith('http');
                const res = await fetch(new Request(url, cross ? { mode: 'cors' } : {}));
                if (res.ok) await cache.put(url, res);
            } catch (e) { console.warn('[SW] optional asset not cached:', url); }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];
        const names = await caches.keys();
        await Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

async function trimCache(name, max) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;                       // never touch writes
    if (req.headers.has('Authorization')) return;           // never cache authenticated requests
    const url = new URL(req.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    const sameOrigin = url.origin === self.location.origin;

    if (!sameOrigin && NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h)) && !CACHEABLE_HOSTS.includes(url.hostname)) return;

    // Pages: network first, fall back to the cached shell when offline
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                if (res.ok) { const c = await caches.open(STATIC_CACHE); c.put('./index.html', res.clone()); }
                return res;
            } catch {
                return (await caches.match(req)) || (await caches.match('./index.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        })());
        return;
    }

    // Own files (app.js, icons, manifest): stale-while-revalidate so updates arrive on the next load
    if (sameOrigin) {
        event.respondWith((async () => {
            const cached = await caches.match(req);
            const network = fetch(req).then(async (res) => {
                if (res.ok) { const c = await caches.open(STATIC_CACHE); await c.put(req, res.clone()); }
                return res;
            }).catch(() => null);
            if (cached) { event.waitUntil(network); return cached; }
            return (await network) || new Response('', { status: 504 });
        })());
        return;
    }

    // Versioned CDN libraries & fonts: cache first
    if (CACHEABLE_HOSTS.includes(url.hostname)) {
        event.respondWith((async () => {
            const cached = await caches.match(req);
            if (cached) return cached;
            const res = await fetch(req);
            if (res.ok || res.type === 'opaque') { const c = await caches.open(RUNTIME_CACHE); c.put(req, res.clone()); }
            return res;
        })());
        return;
    }

    // Drink images from anywhere: cache first, limited size
    if (req.destination === 'image') {
        event.respondWith((async () => {
            const cached = await caches.match(req);
            if (cached) return cached;
            try {
                const res = await fetch(req);
                if (res.ok || res.type === 'opaque') {
                    const c = await caches.open(IMAGE_CACHE);
                    await c.put(req, res.clone());
                    event.waitUntil(trimCache(IMAGE_CACHE, MAX_IMAGES));
                }
                return res;
            } catch {
                return new Response('', { status: 504 });
            }
        })());
    }
    // everything else: default browser handling (network)
});
