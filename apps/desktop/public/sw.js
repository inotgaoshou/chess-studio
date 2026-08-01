const CACHE_NAME = "xiangqi-studio-v2";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/skins/default/ba.png",
  "/skins/default/bb.png",
  "/skins/default/bc.png",
  "/skins/default/bk.png",
  "/skins/default/bn.png",
  "/skins/default/board.png",
  "/skins/default/bp.png",
  "/skins/default/br.png",
  "/skins/default/mask.png",
  "/skins/default/mask2.png",
  "/skins/default/ra.png",
  "/skins/default/rb.png",
  "/skins/default/rc.png",
  "/skins/default/rk.png",
  "/skins/default/rn.png",
  "/skins/default/rp.png",
  "/skins/default/rr.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.headers.has("authorization") || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
