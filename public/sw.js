// Huddle service worker: lets the installed app open quickly, and even without a connection.
// Calls themselves always need the internet; only the app's own files are cached.
const CACHE = "huddle-v37";
const SHELL = [
  "/", "/style.css", "/app.js", "/games/hub.js", "/games/butter.js", "/chats.js", "/phone.js", "/phone-inbox.js", "/notifications.js", "/pip-brain.js", "/pip.js", "/games/tictactoe.js", "/games/connect4.js", "/games/trivia.js", "/settings.js", "/tabs.js", "/home.js", "/alarms.js", "/feeds.js", "/manifest.webmanifest", "/icon.svg",
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

// ---------- Notifications: phone calls, voicemails, chat messages, call invites, alarms ----------
// Skipped when Huddle is open and on screen (the app shows those itself).
// Calls and alarms ring: the notification is shown again every few seconds (each time with the
// device's notification sound and vibration) until it's answered, stopped, or time runs out.
// Web pages can't play their own ringtone while closed, so this is how Huddle "rings".
// The person's Settings switches arrive with each note: silent (no sound), noVibrate.
const RING_EVERY = 3500;
const RING_FOR = { call: 30000, invite: 30000, alarm: 60000 };
const ringing = new Map(); // tag -> { stop }
async function closeTag(tag) {
  for (const x of await self.registration.getNotifications()) if (x.data && x.data.ringTag === tag) x.close();
}
function stopRing(tag) {
  const r = ringing.get(tag);
  if (r) { r.stop = true; ringing.delete(tag); }
}
const kindOf = (n) => n.kind === "alarm" ? "alarm" : n.cat === "huddle-call" ? "invite" : "call";
function ringLook(n, kind) {
  if (kind === "alarm") return {
    body: (n.body || "Alarm") + " \u00b7 ringing",
    actions: n.snooze ? [{ action: "snooze", title: "Snooze 9 min" }, { action: "stop", title: "Stop" }] : [{ action: "stop", title: "Stop" }],
    vibrate: [1000, 500, 1000, 500, 1000],
  };
  if (kind === "invite") return {
    body: (n.body || "Huddle call") + " \u00b7 ringing",
    actions: [{ action: "answer", title: "Join" }, { action: "decline", title: "Decline" }],
    vibrate: [800, 400, 800, 400, 800],
  };
  return {
    body: (n.body || "Phone call") + " \u00b7 ringing",
    actions: [{ action: "answer", title: "Answer" }, { action: "decline", title: "Decline" }],
    vibrate: [800, 400, 800, 400, 800],
  };
}
async function ring(n) {
  const tag = n.tag || "pcall";
  const kind = kindOf(n);
  stopRing(tag);
  const me = { stop: false };
  ringing.set(tag, me);
  const start = Date.now();
  const look = ringLook(n, kind);
  for (let i = 0; !me.stop && Date.now() - start < RING_FOR[kind]; i++) {
    const old = await self.registration.getNotifications();
    // A new notification each round (then the old one is closed), so every round makes a sound.
    await self.registration.showNotification(n.title || "Huddle", {
      body: look.body,
      tag: tag + "-r" + (i % 2),
      renotify: true,
      requireInteraction: true,
      silent: !!n.silent,
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      vibrate: n.noVibrate ? [] : look.vibrate,
      actions: look.actions,
      data: { url: n.url || "/", ringTag: tag, kind, decline: n.decline || null, snooze: n.snooze || null, stop: n.stop || null },
    });
    for (const x of old) if (x.data && x.data.ringTag === tag && x.tag !== tag + "-r" + (i % 2)) x.close();
    await new Promise((r) => setTimeout(r, RING_EVERY));
  }
  if (ringing.get(tag) === me) ringing.delete(tag);
  // Rang out without an answer: leave a quiet note in its place (for a phone call the server
  // usually sends its own "Missed call" a moment later, which replaces this one).
  if (!me.stop) {
    await closeTag(tag);
    const body = kind === "alarm" ? (n.body || "Alarm") : kind === "invite" ? "Missed Huddle call" : "Missed call";
    await self.registration.showNotification(n.title || "Huddle", { body, tag, icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png", data: { url: (n.url || "/").replace(/&answer=1/, "") }, silent: true });
  }
}

self.addEventListener("push", (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil((async () => {
    // Anything new about this call or alarm (answered, missed, stopped elsewhere) stops it ringing.
    if (n.tag && ringing.has(n.tag)) { stopRing(n.tag); await closeTag(n.tag); }
    if (n.kind === "call-end") { if (n.tag) await closeTag(n.tag); return; }
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    if (n.ring) return ring(n);
    const loud = n.kind === "call" || n.kind === "alarm";
    await self.registration.showNotification(n.title || "Huddle", {
      body: n.body || "",
      tag: n.tag || undefined,
      renotify: !!n.tag,
      silent: !!n.silent,
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      data: { url: n.url || "/" },
      requireInteraction: loud,
      vibrate: n.noVibrate ? [] : loud ? [400, 200, 400, 200, 400, 200, 400] : [120, 60, 120],
    });
  })());
});

// Swiping a ringing call or alarm away stops the ringing (a caller keeps holding, then voicemail).
self.addEventListener("notificationclose", (e) => {
  const d = e.notification.data || {};
  if (d.ringTag && ringing.has(d.ringTag)) {
    stopRing(d.ringTag); closeTag(d.ringTag);
    if (d.stop) fetch(d.stop, { method: "POST" }).catch(() => {});
  }
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
    if (e.action === "snooze" || e.action === "stop") {
      const u = e.action === "snooze" ? d.snooze : d.stop;
      if (u) e.waitUntil(fetch(u, { method: "POST" }).catch(() => {}));
      return;
    }
    // Tapping an alarm itself (not a button) stops it too, then opens Huddle.
    if (d.kind === "alarm" && d.stop) e.waitUntil(fetch(d.stop, { method: "POST" }).catch(() => {}));
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
