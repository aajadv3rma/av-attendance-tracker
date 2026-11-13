const CACHE_NAME = "av-attendance-shell-v1";
const STATIC_ASSETS = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("av-attendance-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok && ["/", "/workspace", "/about", "/reset-password", "/verify"].includes(url.pathname)) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/offline.html")) || Response.error()));
  }
});
