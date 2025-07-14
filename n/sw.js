// sw.js

// Define a unique cache name for your app's assets.
// Increment this version if you update any of the cached files.
const CACHE_NAME = 'bar-organizer-deluxe-cache-v2.9';

// List of URLs to cache when the service worker is installed.
const URLS_TO_CACHE = [
  './', // Cache the root of your app (often serves index.html)
  './index.html', // Cache your main HTML file
  './manifest.json',   // Cache the PWA manifest

  // Tailwind CSS from CDN (Play CDN is not ideal for production offline, but can be cached)
  'https://cdn.tailwindcss.com',

  // Font Awesome CSS
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  // Note: Font Awesome also loads font files. For full offline, those would need caching too,
  // or you'd self-host Font Awesome. This example keeps it simple.

  // Firebase SDKs (ensure these versions match your app)
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',

  // Your app's icons (add all sizes you reference in manifest.json and HTML)
  'icons/icon-72x72.png',
  'icons/icon-96x96.png',
  'icons/icon-128x128.png',
  'icons/icon-144x144.png',
  'icons/icon-152x152.png',
  'icons/icon-192x192.png',
  'icons/icon-384x384.png',
  'icons/icon-512x512.png',
  'icons/apple-touch-icon-152x152.png',
  'icons/apple-touch-icon-167x167.png',
  'icons/apple-touch-icon-180x180.png',
  'icons/favicon-32x32.png',
  'icons/favicon-16x16.png'
  // Add any other static assets like local CSS or JS files here
];

// Event: install
// This event is triggered when the service worker is first installed.
// It's used to cache the essential app shell and static assets.
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Opened cache:', CACHE_NAME);
        // Add all specified URLs to the cache.
        // If any of these fetches fail, the service worker installation will fail.
        // This is often where "Failed to fetch" errors originate if a URL is incorrect or unreachable.
        return cache.addAll(URLS_TO_CACHE.map(url => new Request(url, { mode: 'cors' }))) // Use cors for CDN assets
          .catch(error => {
            console.error('[Service Worker] Failed to cache URLs during install:', error);
            // Log specific problematic URLs if possible
            URLS_TO_CACHE.forEach(url => {
                fetch(new Request(url, { mode: 'cors' })).catch(err => console.error(`Failed to fetch ${url}:`, err));
            });
            throw error; // Propagate error to fail installation if critical assets can't be cached
          });
      })
      .then(() => {
        console.log('[Service Worker] All assets cached successfully.');
        // Force the waiting service worker to become the active service worker.
        return self.skipWaiting();
      })
  );
});

// Event: activate
// This event is triggered when the service worker is activated.
// It's used to clean up old caches.
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // If a cache is not the current one, delete it.
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        console.log('[Service Worker] Claiming clients.');
        // Take control of all open clients (tabs) immediately.
        return self.clients.claim();
    })
  );
});

// Event: fetch
// This event is triggered for every network request made by the page.
// It allows the service worker to intercept requests and respond from the cache if available.
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // For navigation requests (HTML pages), try network first, then cache.
  // This ensures users get the latest version if online, but still have a fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // If the network request is successful, cache the response for future offline use.
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // If the network request fails (e.g., offline), try to serve from cache.
          console.log(`[Service Worker] Network request failed for navigation: ${event.request.url}. Trying cache.`);
          return caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // If not in cache, and it's a navigation, you might want a generic offline page.
                // For this example, we'll just let it fail if not cached.
                console.log(`[Service Worker] No cache match for navigation: ${event.request.url}`);
                // return caches.match('./offline.html'); // Example: serve a fallback offline page
            });
        })
    );
    return;
  }

  // For other requests (CSS, JS, images, Firebase SDKs), use a cache-first strategy.
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // If the request is found in the cache, return the cached response.
        if (cachedResponse) {
          // console.log(`[Service Worker] Serving from cache: ${event.request.url}`);
          return cachedResponse;
        }

        // If the request is not in the cache, fetch it from the network.
        // console.log(`[Service Worker] Not in cache, fetching from network: ${event.request.url}`);
        return fetch(event.request).then((networkResponse) => {
          // If the network fetch is successful, clone the response and cache it.
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
          }
          return networkResponse;
        }).catch(error => {
            console.error(`[Service Worker] Fetch failed for ${event.request.url}:`, error);
            // You could return a placeholder for images or specific error responses here if needed.
        });
      })
  );
});
