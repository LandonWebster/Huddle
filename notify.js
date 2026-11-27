// Notifications (web push): incoming phone calls and voicemails to the Huddle number,
// plus Huddle chat messages and call invites. They show up even when Huddle is closed, on
// phones and computers where the person turned notifications on (iPhone: only when Huddle is
// added to the Home Screen). If Huddle is open and on screen, the app shows things itself and
// the notification is skipped (see public/sw.js).
//
// The keys that sign notifications are made once and saved in the database.
const webpush = require("web-push");
const store = require("./store");

let keys = null; // Promise<{ publicKey, privateKey }>
function vapid() {
  if (!keys) {
    keys = (async () => {
      const saved = await store.getSetting("vapid");
      let k = saved ? JSON.parse(saved) : null;
      if (!k) {
        k = webpush.generateVAPIDKeys();
        await store.setSetting("vapid", JSON.stringify(k));
      }
      let site = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
      if (!/^https:\/\//.test(site)) site = "https://huddle-26au.onrender.com";
      webpush.setVapidDetails(site, k.publicKey, k.privateKey);
      return k;
    })().catch((e) => { keys = null; throw e; });
  }
  return keys;
}

// Send to every device this person turned notifications on for. Never throws.
// note: { title, body, tag, url, kind ("call" rings longer), ttl (seconds) }
async function notify(userId, note) {
  try {
    if (!userId) return;
    await vapid();
    const subs = await store.pushSubs(userId);
    const payload = JSON.stringify(note);
    await Promise.all(subs.map((sub) =>
      webpush.sendNotification(sub, payload, { TTL: note.ttl || 3600, urgency: note.kind === "call" ? "high" : "normal" })
        .catch((e) => { if (e.statusCode === 404 || e.statusCode === 410) store.deletePushSub(sub.endpoint).catch(() => {}); })));
  } catch (e) { console.warn("notify failed", e.message); }
}

// /api/push/...: key (the public key the browser needs), subscribe, unsubscribe.
async function route(method, sub, user, body) {
  if (method === "GET" && sub === "key") return { status: 200, body: { key: (await vapid()).publicKey } };
  if (method === "POST" && sub === "subscribe") {
    const s = body && body.subscription;
    if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) return { status: 400, body: { error: "Bad subscription" } };
    await store.savePushSub(user.id, { endpoint: s.endpoint.slice(0, 1000), keys: { p256dh: String(s.keys.p256dh).slice(0, 200), auth: String(s.keys.auth).slice(0, 100) } });
    return { status: 200, body: {} };
  }
  if (method === "POST" && sub === "unsubscribe") {
    if (body && body.endpoint) await store.deletePushSub(String(body.endpoint), user.id);
    return { status: 200, body: {} };
  }
  return { status: 404, body: { error: "Not found" } };
}

module.exports = { notify, route };
