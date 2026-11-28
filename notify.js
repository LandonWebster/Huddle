// Notifications (web push): incoming phone calls and voicemails to the Huddle number,
// Huddle chat messages, call invites, and alarms. Each person can switch kinds off in Settings. They show up even when Huddle is closed, on
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

// Each person's Settings switches (Account > Settings). Everything is on until they turn it off.
const DEFAULT_PREFS = {
  phoneRing: true,   // phone calls to your Huddle number ring
  phoneAlerts: true, // voicemails and missed calls
  huddleRing: true,  // friends calling you in Huddle ring
  chats: true,       // chat messages
  alarms: true,      // alarms and timers ring
  sounds: true,      // notifications make a sound
  vibrate: true,     // and vibrate
  sleep: false,      // Sleep Mode: only your Huddle Buddy can call you in Huddle
};
// Sleep Mode's Huddle Buddy: one friend's user id (or null). Saved with the switches above.
// Sleep Mode Caller Exceptions: { friendUserId: "work" | "parent" }. Their Huddle calls ring in Sleep Mode.
function cleanExceptions(x) {
  const out = {};
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x).slice(0, 100)) if (k && k.length <= 64 && (v === "work" || v === "parent")) out[k] = v;
  return out;
}
const prefsCache = new Map();
async function getPrefs(userId) {
  if (prefsCache.has(userId)) return prefsCache.get(userId);
  let saved = {};
  try { saved = JSON.parse((await store.getSetting("prefs:" + userId)) || "{}") || {}; } catch {}
  const p = { ...DEFAULT_PREFS };
  for (const k of Object.keys(p)) if (typeof saved[k] === "boolean") p[k] = saved[k];
  p.buddy = typeof saved.buddy === "string" && saved.buddy ? saved.buddy : null;
  p.exceptions = cleanExceptions(saved.exceptions);
  prefsCache.set(userId, p);
  return p;
}
async function setPrefs(userId, changes) {
  const p = { ...(await getPrefs(userId)) };
  for (const k of Object.keys(DEFAULT_PREFS)) if (changes && typeof changes[k] === "boolean") p[k] = changes[k];
  if (changes && "exceptions" in changes) p.exceptions = cleanExceptions(changes.exceptions);
  await store.setSetting("prefs:" + userId, JSON.stringify(p));
  prefsCache.set(userId, p);
  return p;
}

// What a note is about decides which switch it follows (note.cat):
//   phone-call (rings), phone-alert, huddle-call (rings; note.fromId = the caller), chat, alarm (rings).
// A ringing kind with its ring switch off still shows once, quietly; the others are skipped.
function applyPrefs(note, p) {
  const cat = note.cat;
  if (cat === "phone-alert" && !p.phoneAlerts) return null;
  if (cat === "chat" && !p.chats) return null;
  if (cat === "alarm" && !p.alarms) return null;
  // Sleep Mode: Huddle calls only get through from your Huddle Buddy and Caller Exceptions.
  // (Phone calls: only ones forwarded from your cell ring, see phone.js. Alarms still ring.)
  if (cat === "huddle-call" && p.sleep && !(note.fromId && (note.fromId === p.buddy || p.exceptions[note.fromId]))) return null;
  const n = { ...note };
  if (cat === "phone-call" && !p.phoneRing) n.ring = false;
  if (cat === "huddle-call" && !p.huddleRing) n.ring = false;
  if (!p.sounds) n.silent = true;
  if (!p.vibrate) n.noVibrate = true;
  return n;
}

// Huddle Buddy pairs are made by buddy.js (a request the other person accepts), never by the app.
async function setBuddy(userId, buddyId) {
  const p = { ...(await getPrefs(userId)), buddy: buddyId || null };
  await store.setSetting("prefs:" + userId, JSON.stringify(p));
  prefsCache.set(userId, p);
  return p;
}

// Send to every device this person turned notifications on for. Never throws.
// note: { title, body, tag, url, kind ("call" | "alarm" | "text" | "call-end"), cat (see above),
//         ring (repeat until answered), ttl (seconds) }
async function notify(userId, note) {
  try {
    if (!userId) return;
    if (note.kind !== "call-end") {
      note = applyPrefs(note, await getPrefs(userId));
      if (!note) return;
    }
    await vapid();
    const subs = await store.pushSubs(userId);
    const payload = JSON.stringify(note);
    await Promise.all(subs.map((sub) =>
      webpush.sendNotification(sub, payload, { TTL: note.ttl || 3600, urgency: note.kind === "call" || note.kind === "alarm" ? "high" : "normal" })
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
  if (method === "GET" && sub === "prefs") return { status: 200, body: { prefs: await getPrefs(user.id) } };
  if (method === "POST" && sub === "prefs") return { status: 200, body: { prefs: await setPrefs(user.id, body && body.prefs) } };
  if (method === "POST" && sub === "unsubscribe") {
    if (body && body.endpoint) await store.deletePushSub(String(body.endpoint), user.id);
    return { status: 200, body: {} };
  }
  return { status: 404, body: { error: "Not found" } };
}

module.exports = { notify, route, getPrefs, setBuddy };
