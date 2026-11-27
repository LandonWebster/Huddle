// Real phone calls and texts in Huddle, through Twilio: call a number from a call (the phone
// joins the call), call-backs that ring inside Huddle while it's open, voicemail, and texting.
//
// Setup is two values in Render: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (from the Twilio
// console), plus one phone number bought in that Twilio account. Everything else (the API key
// and the "TwiML app" that tells Twilio what to do) is created here automatically.
//
// How a call works:
//  1. A signed-in person taps "Call a phone" in a call. The app asks POST /api/phone for a
//     short-lived Twilio pass and starts the call from the browser.
//  2. Twilio asks POST /twilio/voice what to do; we answer "dial this number" (after checking
//     the request really came from Twilio and the number is allowed).
//  3. The phone's voice is mixed into the caller's audio in the browser, so everyone in the
//     Huddle call hears the phone, and the phone hears everyone.
//
// Optional settings:
//  TWILIO_PHONE_NUMBER    the caller ID to show (default: the first number in the account, or
//                         if there is none, the first verified caller ID)
//  PHONE_ALLOW_PREFIXES   comma list of allowed number starts (default "+1": US and Canada)
//  PHONE_MAX_MINUTES      longest phone call, in minutes (default 30)
//  PHONE_CALLS_PER_DAY    calls each person can make per day (default 20)
//  PHONE_TEXTS_PER_DAY    texts each person can send per day (default 100)
//  PHONE_OWNER            Huddle account name that gets calls/texts from new numbers (default:
//                         whoever used the phone last)
//  PHONE_GREETING         what callers hear before leaving a voicemail
//  PUBLIC_URL             this app's address (Render sets RENDER_EXTERNAL_URL on its own)
//
// Incoming calls and texts reach whoever last called or texted that number from Huddle.
// Huddle never rings or notifies outside the app: if it's closed, callers get voicemail.
const crypto = require("crypto");
const store = require("./store");
const live = () => require("./api"); // push + presence (required late: api.js requires this file)

const env = (k, d) => (process.env[k] || d || "").trim();
const SID = () => env("TWILIO_ACCOUNT_SID");
const AUTH = () => env("TWILIO_AUTH_TOKEN");
const enabled = () => /^AC[0-9a-f]{32}$/i.test(SID()) && !!AUTH();

const ALLOW = () => env("PHONE_ALLOW_PREFIXES", "+1").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_MINUTES = () => Math.max(1, Math.min(240, Number(env("PHONE_MAX_MINUTES", "30")) || 30));
const PER_DAY = () => Math.max(1, Number(env("PHONE_CALLS_PER_DAY", "20")) || 20);
const TEXTS_PER_DAY = () => Math.max(1, Number(env("PHONE_TEXTS_PER_DAY", "100")) || 100);
const GREETING = () => env("PHONE_GREETING", "Hi, you've reached Huddle. Please leave a message after the beep.");
const APP_NAME = "Huddle phone calls";
const KEY_NAME = "huddle-auto";

// ---------- Twilio REST (no extra packages) ----------
async function twilio(method, path, form) {
  const url = path.startsWith("https://") ? path : `https://api.twilio.com/2010-04-01/Accounts/${SID()}${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      authorization: "Basic " + Buffer.from(`${SID()}:${AUTH()}`).toString("base64"),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (method === "DELETE" && (r.status === 204 || r.status === 404)) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || `Twilio said ${r.status}`), { status: r.status, code: j.code });
  return j;
}

// ---------- One-time setup, done on the first phone call after each restart ----------
let setup = null; // Promise<{ keySid, keySecret, appSid, callerId, voiceUrl }>
let setupAt = 0;
function baseUrl(req) {
  const fixed = env("PUBLIC_URL") || env("RENDER_EXTERNAL_URL");
  if (fixed || !req) return (fixed || "").replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${req.headers.host}`;
}
function ready(req) {
  // If setup failed, try again (at most once a minute) instead of staying broken.
  if (!setup || (setup.failed && Date.now() - setupAt > 60000)) {
    setupAt = Date.now();
    setup = doSetup(baseUrl(req)).catch((e) => { setup.failed = true; throw e; });
  }
  return setup;
}
async function doSetup(base) {
  const voiceUrl = `${base}/twilio/voice`;
  // Caller ID: a number bought in this Twilio account.
  let callerId = env("TWILIO_PHONE_NUMBER");
  const nums = await twilio("GET", "/IncomingPhoneNumbers.json?PageSize=20");
  const list = nums.incoming_phone_numbers || [];
  const owned = callerId ? list.find((x) => x.phone_number === callerId) : list.find((x) => x.capabilities && x.capabilities.voice !== false);
  if (owned) {
    callerId = owned.phone_number;
    // Calls and texts to this number come to Huddle (call-backs, voicemail, texts).
    const want = { VoiceUrl: `${base}/twilio/incoming`, VoiceMethod: "POST", SmsUrl: `${base}/twilio/sms`, SmsMethod: "POST" };
    if (owned.voice_url !== want.VoiceUrl || owned.sms_url !== want.SmsUrl) {
      await twilio("POST", `/IncomingPhoneNumbers/${owned.sid}.json`, want).catch((e) => console.warn("Couldn't point the number at Huddle:", e.message));
    }
  }
  if (!callerId) {
    // No number bought yet (Twilio's free trial doesn't give one): show a verified caller ID
    // instead, like the phone number used to sign up for Twilio.
    const ids = await twilio("GET", "/OutgoingCallerIds.json?PageSize=20");
    const v = (ids.outgoing_caller_ids || [])[0];
    if (!v) throw Object.assign(new Error("no_number"), { friendly: "The Twilio account needs a phone number or a verified caller ID first" });
    callerId = v.phone_number;
  }
  // The TwiML app points Twilio back at /twilio/voice. Reuse ours if it's already there.
  const apps = await twilio("GET", `/Applications.json?FriendlyName=${encodeURIComponent(APP_NAME)}`);
  let app = (apps.applications || [])[0];
  if (app && app.voice_url !== voiceUrl) app = await twilio("POST", `/Applications/${app.sid}.json`, { VoiceUrl: voiceUrl, VoiceMethod: "POST" });
  if (!app) app = await twilio("POST", "/Applications.json", { FriendlyName: APP_NAME, VoiceUrl: voiceUrl, VoiceMethod: "POST" });
  // A fresh API key each restart (Twilio only shows a key's secret once). Remove our old ones.
  const keys = await twilio("GET", "/Keys.json?PageSize=100");
  for (const k of keys.keys || []) if (k.friendly_name === KEY_NAME) await twilio("DELETE", `/Keys/${k.sid}.json`).catch(() => {});
  const key = await twilio("POST", "/Keys.json", { FriendlyName: KEY_NAME });
  return { keySid: key.sid, keySecret: key.secret, appSid: app.sid, callerId, voiceUrl, base, owned: !!owned };
}

// ---------- Access token (a signed JWT, the same thing Twilio's own library makes) ----------
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function accessToken(s, identity, ttl = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${s.keySid}-${now}`, iss: s.keySid, sub: SID(), iat: now, exp: now + ttl,
    grants: { identity, voice: { incoming: { allow: true }, outgoing: { application_sid: s.appSid } } },
  };
  const body = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  return body + "." + b64url(crypto.createHmac("sha256", s.keySecret).update(body).digest());
}

// ---------- Rules for which numbers can be called ----------
// Turns "(555) 123-4567" or "1 555 123 4567" into "+15551234567".
function normalize(raw) {
  let s = String(raw || "").trim();
  const plus = s.startsWith("+") || s.startsWith("00");
  s = s.replace(/^00/, "").replace(/\D/g, "");
  if (!s) return null;
  if (!plus) {
    if (s.length === 10) s = "1" + s; // US/Canada without the 1
    else if (!(s.length === 11 && s[0] === "1")) return null;
  }
  if (s.length < 8 || s.length > 15) return null;
  return "+" + s;
}
function allowed(num) {
  if (!num) return "That doesn't look like a phone number";
  if (!ALLOW().some((p) => num.startsWith(p))) return "Huddle can only call numbers in the US and Canada right now";
  // Expensive or risky numbers: pay-per-call lines and 911-style short codes.
  if (/^\+1(900|976)/.test(num) || /^\+1\d{0,2}11$/.test(num)) return "Huddle can't call that number";
  return null;
}

// Per-person daily limit, so a stolen login can't run up the bill.
const dayLog = new Map(); // identity -> [times]
function overLimit(identity, record, max = PER_DAY()) {
  const t = Date.now();
  const list = (dayLog.get(identity) || []).filter((x) => t - x < 24 * 3600 * 1000);
  if (record) list.push(t);
  dayLog.set(identity, list);
  return list.length > max;
}
const identityOf = (user) => "u" + String(user.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
const userIdOf = (identity) => String(identity || "").replace(/^client:/, "").replace(/^u/, "");

// ---------- App routes (/api/phone...) ----------
const fail = (e) => {
  console.warn("Twilio:", e.message);
  const msg = e.friendly || (e.status === 401 ? "The Twilio keys in Render don't look right" : "Couldn't reach the phone service");
  return { status: 503, body: { error: msg } };
};
const pretty = (n) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n);
const pushTo = (userId, msg) => { try { live().push(userId, msg); } catch {} };

// Is this person the one who gets calls and texts? (So the app knows to listen for call-backs.)
async function isLineUser(user) {
  const owner = env("PHONE_OWNER");
  if (owner) return store.nameKey(owner) === user.username || (await store.phoneUsed(user.id));
  return store.phoneUsed(user.id);
}

// POST /api/phone → { token, callerId, line }. `listen: true` is the app opening (it only
// wants a token if this person can get call-backs); otherwise it's about to dial.
async function tokenFor(user, req, body = {}) {
  if (!enabled()) return { status: 404, body: { error: "Phone calls aren't set up yet" } };
  const identity = identityOf(user);
  const line = await isLineUser(user).catch(() => false);
  if (body.listen && !line) return { status: 200, body: { line: false } };
  if (!body.listen && overLimit(identity, false)) return { status: 429, body: { error: `You've made ${PER_DAY()} phone calls today. Try again tomorrow.` } };
  try {
    const s = await ready(req);
    return { status: 200, body: { token: accessToken(s, identity, 3600), callerId: s.callerId, maxMinutes: MAX_MINUTES(), line } };
  } catch (e) { return fail(e); }
}

// Everything else under /api/phone/...: the Phone screen (texts, calls, voicemails).
async function appRoute(method, sub, user, url, body, req) {
  if (!enabled()) return { status: 404, body: { error: "Phone isn't set up yet" } };
  if (method === "GET" && sub === "threads") {
    return { status: 200, body: { threads: await store.phoneThreads(user.id), unread: await store.phoneUnread(user.id), number: setup && !setup.failed ? (await setup).callerId : null } };
  }
  if (method === "GET" && sub === "thread") {
    const number = normalize(url.searchParams.get("n"));
    if (!number) return { status: 400, body: { error: "Bad number" } };
    return { status: 200, body: { items: await store.phoneThread(user.id, number, url.searchParams.get("before")) } };
  }
  if (method === "POST" && sub === "read") {
    const number = normalize(body.number);
    if (number) await store.phoneMarkRead(user.id, number);
    return { status: 200, body: { unread: await store.phoneUnread(user.id) } };
  }
  if (method === "POST" && sub === "text") return sendText(user, body, req);
  return { status: 404, body: { error: "Not found" } };
}

// Texts go out through the number's Messaging Service when it has one (texting registration
// puts the number in one), otherwise straight from the number.
let msgService = { sid: null, at: 0 };
async function messagingServiceFor(number) {
  if (Date.now() - msgService.at < 10 * 60 * 1000) return msgService.sid;
  msgService = { sid: null, at: Date.now() };
  try {
    const list = await twilio("GET", "https://messaging.twilio.com/v1/Services?PageSize=50");
    for (const svc of list.services || []) {
      const nums = await twilio("GET", `https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers?PageSize=50`);
      if ((nums.phone_numbers || []).some((p) => p.phone_number === number)) {
        msgService.sid = svc.sid;
        // Let texts to the number keep coming to Huddle, not to the service's own setting.
        if (!svc.use_inbound_webhook_on_number) await twilio("POST", `https://messaging.twilio.com/v1/Services/${svc.sid}`, { UseInboundWebhookOnNumber: "true" }).catch(() => {});
        break;
      }
    }
  } catch (e) { console.warn("Messaging service lookup failed:", e.message); }
  return msgService.sid;
}
const TEXT_ERRORS = {
  30034: "Not delivered: the number's texting registration isn't approved yet",
  30007: "Not delivered: the carrier blocked it as spam",
  30003: "Not delivered: their phone is off or can't get texts",
  30005: "Not delivered: that number doesn't exist",
  30006: "Not delivered: that number can't get texts (landline?)",
  21610: "Not delivered: they replied STOP to your texts",
  21608: "Not delivered: trial accounts can only text verified numbers",
  21614: "Not delivered: that number can't get texts",
};
async function sendText(user, body, req) {
  const to = normalize(body.to);
  const why = allowed(to);
  if (why) return { status: 400, body: { error: why.replace("call", "text") } };
  const text = String(body.text || "").trim().slice(0, 1000);
  if (!text) return { status: 400, body: { error: "Type a message" } };
  if (overLimit("t:" + user.id, true, TEXTS_PER_DAY())) return { status: 429, body: { error: `You've sent ${TEXTS_PER_DAY()} texts today. Try again tomorrow.` } };
  let s;
  try { s = await ready(req); } catch (e) { return fail(e); }
  if (!s.owned) return { status: 400, body: { error: "Texting needs a phone number bought in Twilio" } };
  const form = { To: to, Body: text, StatusCallback: `${s.base}/twilio/sms-status` };
  const svc = await messagingServiceFor(s.callerId);
  if (svc) form.MessagingServiceSid = svc; else form.From = s.callerId;
  try {
    const m = await twilio("POST", "/Messages.json", form);
    const item = await store.phoneAdd(user.id, to, "text_out", { body: text, status: m.status || "queued", sid: m.sid });
    pushTo(user.id, { type: "phone-update", number: to });
    return { status: 200, body: { item } };
  } catch (e) {
    const item = await store.phoneAdd(user.id, to, "text_out", { body: text, status: "failed:" + (e.code || "") });
    pushTo(user.id, { type: "phone-update", number: to });
    return { status: 200, body: { item, error: TEXT_ERRORS[e.code] || "Couldn't send that text" } };
  }
}

// ---------- Twilio webhooks (/twilio/...) ----------
// Twilio signs each webhook: base64(HMAC-SHA1(auth token, url + sorted key/values)).
function validSignature(url, params, sig) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const want = crypto.createHmac("sha1", AUTH()).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(want), b = Buffer.from(String(sig || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function twiml(res, inner) {
  res.writeHead(200, { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
}

// Who gets a call or text from this number: whoever in Huddle last talked to it, else the
// PHONE_OWNER account, else whoever used the phone last.
async function ownerFor(number) {
  const known = await store.phoneUserFor(number, true);
  if (known) return known;
  const owner = env("PHONE_OWNER");
  const u = owner && (await store.userByName(owner));
  return u ? u.id : store.phoneUserFor(null, false);
}

// Each route: check Twilio really sent it, then answer. Everything Twilio calls lives here.
const routes = {
  // A call the app started (outgoing).
  async voice(s, p) {
    const identity = userIdOf(p.From);
    const to = normalize(p.To);
    const why = allowed(to);
    if (!identity || why) return `<Say>${xml(why || "Sorry, that call can't be made.")}</Say><Hangup/>`;
    if (overLimit("u" + identity, true)) return "<Say>You've reached today's phone call limit.</Say><Hangup/>";
    console.log(`Phone call to ${to.slice(0, -4)}••••`);
    const done = `${s.base}/twilio/out-done?u=${encodeURIComponent(identity)}&n=${encodeURIComponent(to)}`;
    return `<Dial callerId="${xml(s.callerId)}" timeLimit="${MAX_MINUTES() * 60}" answerOnBridge="true" action="${xml(done)}"><Number>${xml(to)}</Number></Dial>`;
  },
  // The outgoing call ended: save it in the Phone screen.
  async "out-done"(s, p, q) {
    const userId = q.get("u"), to = normalize(q.get("n"));
    if (userId && to) {
      const ok = p.DialCallStatus === "completed";
      await store.phoneAdd(userId, to, "call_out", { duration: ok ? Number(p.DialCallDuration || 0) : 0, status: p.DialCallStatus || null });
      pushTo(userId, { type: "phone-update", number: to });
    }
    return "<Hangup/>";
  },
  // Someone called the Huddle number: ring inside Huddle if the person is in the app, else voicemail.
  async incoming(s, p) {
    const from = normalize(p.From) || String(p.From || "unknown").slice(0, 20);
    const userId = await ownerFor(from);
    if (!userId) return `<Say>${xml("Sorry, nobody can take this call right now.")}</Say><Hangup/>`;
    const online = (() => { try { return live().presenceOf(userId).online; } catch { return false; } })();
    const after = `${s.base}/twilio/after?u=${encodeURIComponent(userId)}&n=${encodeURIComponent(from)}`;
    if (online) {
      return `<Dial timeout="25" timeLimit="${MAX_MINUTES() * 60}" answerOnBridge="true" action="${xml(after)}"><Client><Identity>u${xml(userId)}</Identity><Parameter name="from" value="${xml(from)}"/></Client></Dial>`;
    }
    return voicemail(s, userId, from);
  },
  // After ringing in Huddle: answered (save it) or not (voicemail).
  async after(s, p, q) {
    const userId = q.get("u"), from = q.get("n");
    if (p.DialCallStatus === "completed") {
      await store.phoneAdd(userId, from, "call_in", { duration: Number(p.DialCallDuration || 0) });
      pushTo(userId, { type: "phone-update", number: from });
      return "<Hangup/>";
    }
    return voicemail(s, userId, from);
  },
  async "vm-done"() { return "<Hangup/>"; },
  // The voicemail recording is ready: keep it in Huddle and delete it from Twilio.
  async recording(s, p, q) {
    const userId = q.get("u"), from = q.get("n");
    if (!userId || !from || p.RecordingStatus !== "completed" || !p.RecordingUrl) return "";
    try {
      const auth = "Basic " + Buffer.from(`${SID()}:${AUTH()}`).toString("base64");
      const r = await fetch(`${p.RecordingUrl}.mp3`, { headers: { authorization: auth }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error("download " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const mediaId = await store.saveMedia({ id: userId }, "audio/mpeg", buf);
      await store.phoneAdd(userId, from, "voicemail", { mediaId, duration: Number(p.RecordingDuration || 0) });
      pushTo(userId, { type: "phone-update", number: from, kind: "voicemail" });
      if (p.RecordingSid) twilio("DELETE", `/Recordings/${p.RecordingSid}.json`).catch(() => {});
    } catch (e) { console.warn("voicemail save failed", e.message); }
    return "";
  },
  // A text came in.
  async sms(s, p) {
    const from = normalize(p.From);
    if (!from) return "";
    const userId = await ownerFor(from);
    if (!userId) return "";
    let body = String(p.Body || "").slice(0, 2000);
    const pics = Number(p.NumMedia || 0);
    if (pics) body = (body ? body + "\n" : "") + (pics === 1 ? "[sent a picture]" : `[sent ${pics} pictures]`);
    await store.phoneAdd(userId, from, "text_in", { body, sid: p.MessageSid || null });
    pushTo(userId, { type: "phone-update", number: from, kind: "text" });
    return "";
  },
  // Delivery reports for texts we sent.
  async "sms-status"(s, p) {
    if (!p.MessageSid) return "";
    const st = p.ErrorCode ? `failed:${p.ErrorCode}` : p.MessageStatus;
    const r = await store.phoneSetStatus(p.MessageSid, st).catch(() => null);
    if (r) pushTo(r.userId, { type: "phone-update", number: r.number });
    return "";
  },
};
function voicemail(s, userId, from) {
  store.phoneAdd(userId, from, "missed").then(() => pushTo(userId, { type: "phone-update", number: from })).catch(() => {});
  const qs = `u=${encodeURIComponent(userId)}&amp;n=${encodeURIComponent(from)}`;
  return `<Say>${xml(GREETING())}</Say><Record maxLength="120" timeout="5" playBeep="true" trim="trim-silence" action="${s.base}/twilio/vm-done" recordingStatusCallback="${s.base}/twilio/recording?${qs}" recordingStatusCallbackEvent="completed"/>`;
}

// POST /twilio/<name>
function webhook(req, res, url) {
  const name = url.pathname.slice("/twilio/".length);
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size < 64 * 1024) chunks.push(c); });
  req.on("end", async () => {
    try {
      if (!enabled() || !routes[name]) { res.writeHead(404); return res.end(); }
      const s = await ready(req);
      const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
      if (!validSignature(s.base + url.pathname + url.search, params, req.headers["x-twilio-signature"]) || params.AccountSid !== SID()) {
        res.writeHead(403);
        return res.end();
      }
      twiml(res, await routes[name](s, params, url.searchParams));
    } catch (e) {
      console.warn("phone webhook failed", name, e.message);
      twiml(res, name === "sms" || name === "sms-status" || name === "recording" ? "" : "<Say>Sorry, something went wrong.</Say><Hangup/>");
    }
  });
}

// Get ready as soon as the server starts, so call-backs and texts work before anyone dials.
if (enabled() && (env("PUBLIC_URL") || env("RENDER_EXTERNAL_URL"))) setTimeout(() => ready(null).catch(() => {}), 3000);

module.exports = { enabled, tokenFor, appRoute, webhook, normalize, allowed, pretty, _accessToken: accessToken, _validSignature: validSignature };
