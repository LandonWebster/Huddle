// Huddle service worker: lets the installed app open quickly, and even without a connection.
// Calls themselves always need the internet; only the app's own files are cached.
const CACHE = "huddle-v6";
const SHELL = [
  "/", "/style.css", "/app.js", "/manifest.webmanifest", "/icon.svg",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (["/ws", "/config", "/health"].includes(url.pathname)) return; // always live

  if (req.mode === "navigate") {
    // Pages (including invite links like /r/ABC123): use the network, fall back to the cached app.
    e.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  // App files: use the network so updates show up right away; use the cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
