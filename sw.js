// Network-first proxy: online behaviour is unchanged (every request still
// hits the network and refreshes the offline cache as a side effect);
// offline, previously cached responses — filled in bulk by the header
// install button — are served instead. version.json is exempt so a stale
// "new version" banner cannot appear while offline.
const CACHE_NAME = "bible-offline-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/version.json")) return;
  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      // Asset URLs carry a ?v= cache-buster; dropping older variants keeps
      // a single copy per file.
      event.waitUntil(
        cache.delete(request, { ignoreSearch: true }).then(() => cache.put(request, copy)),
      );
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("./index.html", { ignoreSearch: true });
      if (shell) return shell;
    }
    throw error;
  }
}
