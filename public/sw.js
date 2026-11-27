// Huddle service worker: lets the installed app open quickly, and even without a connection.
// Calls themselves always need the internet; only the app's own files are cached.
const CACHE = "huddle-v35";
const SHELL = [
  "/", "/style.css", "/app.js", "/games/hub.js", "/games/butter.js", "/chats.js", "/phone.js", "/phone-inbox.js", "/notifications.js", "/pip-brain.js", "/pip.js", "/games/tictactoe.js", "/games/connect4.js", "/games/trivia.js", "/tabs.js", "/home.js", "/alarms.js", "/feeds.js", "/manifest.webmanifest", "/icon.svg",
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
  // Posted videos and photos stream straight from the server (videos load in pieces).
  if (url.pathname.startsWith("/api/post-media/") || req.headers.has("range")) return;

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

// ---------- Notifications: phone calls, voicemails, chat messages, call invites ----------
// Skipped when Huddle is open and on screen (the app shows those itself).
// A phone call rings: the notification is shown again every few seconds (each time with the
// device's notification sound and vibration) until it's answered, declined, missed, or 30 seconds
// pass. Web pages can't play their own ringtone while closed, so this is how Huddle "rings".
const RING_EVERY = 3500, RING_FOR = 30000;
const ringing = new Map(); // tag -> { stop }
async function closeTag(tag) {
  for (const x of await self.registration.getNotifications()) if (x.data && x.data.ringTag === tag) x.close();
}
function stopRing(tag) {
  const r = ringing.get(tag);
  if (r) { r.stop = true; ringing.delete(tag); }
}
async function ring(n) {
  const tag = n.tag || "pcall";
  stopRing(tag);
  const me = { stop: false };
  ringing.set(tag, me);
  const start = Date.now();
  for (let i = 0; !me.stop && Date.now() - start < RING_FOR; i++) {
    const old = await self.registration.getNotifications();
    // A new notification each round (then the old one is closed), so every round makes a sound.
    await self.registration.showNotification(n.title || "Huddle", {
      body: (n.body || "Phone call") + " \u00b7 ringing",
      tag: tag + "-r" + (i % 2),
      renotify: true,
      requireInteraction: true,
      silent: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      vibrate: [800, 400, 800, 400, 800],
      actions: [{ action: "answer", title: "Answer" }, { action: "decline", title: "Decline" }],
      data: { url: n.url || "/", ringTag: tag, decline: n.decline || null },
    });
    for (const x of old) if (x.data && x.data.ringTag === tag && x.tag !== tag + "-r" + (i % 2)) x.close();
    await new Promise((r) => setTimeout(r, RING_EVERY));
  }
  if (ringing.get(tag) === me) ringing.delete(tag);
  // Rang out without an answer: leave a quiet "Missed call" in its place (the server usually
  // sends its own a moment later, which replaces this one).
  if (!me.stop) {
    await closeTag(tag);
    await self.registration.showNotification(n.title || "Huddle", { body: "Missed call", tag, icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png", data: { url: (n.url || "/").replace(/&answer=1/, "") }, silent: true });
  }
}

self.addEventListener("push", (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil((async () => {
    // Anything new about this call (answered, missed, voicemail) stops it ringing.
    if (n.tag && ringing.has(n.tag)) { stopRing(n.tag); await closeTag(n.tag); }
    if (n.kind === "call-end") return;
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    if (n.kind === "call" && n.ring) return ring(n);
    const call = n.kind === "call";
    await self.registration.showNotification(n.title || "Huddle", {
      body: n.body || "",
      tag: n.tag || undefined,
      renotify: !!n.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      data: { url: n.url || "/" },
      requireInteraction: call,
      vibrate: call ? [400, 200, 400, 200, 400, 200, 400] : [120, 60, 120],
    });
  })());
});

// Swiping a ringing call away stops the ringing (the caller keeps holding, then voicemail).
self.addEventListener("notificationclose", (e) => {
  const d = e.notification.data || {};
  if (d.ringTag && ringing.has(d.ringTag)) { stopRing(d.ringTag); closeTag(d.ringTag); }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  if (d.ringTag) {
    stopRing(d.ringTag);
    e.waitUntil(closeTag(d.ringTag));
    if (e.action === "decline") {
      // Send the caller to voicemail.
      if (d.decline) e.waitUntil(fetch(d.decline, { method: "POST" }).catch(() => {}));
      return;
    }
  }
  const url = new URL(d.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      await w.focus();
      w.postMessage({ type: "huddle-open", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
