// Calling real phone numbers from a Huddle call, through Twilio Voice.
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
//  PUBLIC_URL             this app's address (Render sets RENDER_EXTERNAL_URL on its own)
const crypto = require("crypto");

const env = (k, d) => (process.env[k] || d || "").trim();
const SID = () => env("TWILIO_ACCOUNT_SID");
const AUTH = () => env("TWILIO_AUTH_TOKEN");
const enabled = () => /^AC[0-9a-f]{32}$/i.test(SID()) && !!AUTH();

const ALLOW = () => env("PHONE_ALLOW_PREFIXES", "+1").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_MINUTES = () => Math.max(1, Math.min(240, Number(env("PHONE_MAX_MINUTES", "30")) || 30));
const PER_DAY = () => Math.max(1, Number(env("PHONE_CALLS_PER_DAY", "20")) || 20);
const APP_NAME = "Huddle phone calls";
const KEY_NAME = "huddle-auto";

// ---------- Twilio REST (no extra packages) ----------
async function twilio(method, path, form) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}${path}`, {
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
  if (fixed) return fixed.replace(/\/+$/, "");
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
  if (!callerId) {
    const nums = await twilio("GET", "/IncomingPhoneNumbers.json?PageSize=20");
    const n = (nums.incoming_phone_numbers || []).find((x) => x.capabilities && x.capabilities.voice !== false);
    if (n) callerId = n.phone_number;
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
  return { keySid: key.sid, keySecret: key.secret, appSid: app.sid, callerId, voiceUrl };
}

// ---------- Access token (a signed JWT, the same thing Twilio's own library makes) ----------
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function accessToken(s, identity, ttl = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${s.keySid}-${now}`, iss: s.keySid, sub: SID(), iat: now, exp: now + ttl,
    grants: { identity, voice: { outgoing: { application_sid: s.appSid } } },
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
function overLimit(identity, record) {
  const t = Date.now();
  const list = (dayLog.get(identity) || []).filter((x) => t - x < 24 * 3600 * 1000);
  if (record) list.push(t);
  dayLog.set(identity, list);
  return list.length > PER_DAY();
}

// ---------- Routes ----------
// POST /api/phone (signed in): { token, callerId }
async function tokenFor(user, req) {
  if (!enabled()) return { status: 404, body: { error: "Phone calls aren't set up yet" } };
  const identity = "u" + String(user.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  if (overLimit(identity, false)) return { status: 429, body: { error: `You've made ${PER_DAY()} phone calls today. Try again tomorrow.` } };
  try {
    const s = await ready(req);
    return { status: 200, body: { token: accessToken(s, identity, 3600), callerId: s.callerId, maxMinutes: MAX_MINUTES() } };
  } catch (e) {
    console.warn("Twilio setup failed:", e.message);
    const msg = e.friendly || (e.status === 401 ? "The Twilio keys in Render don't look right" : "Couldn't reach the phone service");
    return { status: 503, body: { error: msg } };
  }
}

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

// POST /twilio/voice: Twilio asks what to do with a call the app started.
function voiceWebhook(req, res) {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size < 32 * 1024) chunks.push(c); });
  req.on("end", async () => {
    try {
      if (!enabled() || !setup || setup.failed) { res.writeHead(403); return res.end(); }
      const s = await setup;
      const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
      if (!validSignature(s.voiceUrl, params, req.headers["x-twilio-signature"]) || params.AccountSid !== SID()) {
        res.writeHead(403);
        return res.end();
      }
      const identity = String(params.From || "").replace(/^client:/, "");
      const to = normalize(params.To);
      const why = allowed(to);
      if (!identity || why) return twiml(res, `<Say>${xml(why || "Sorry, that call can't be made.")}</Say><Hangup/>`);
      if (overLimit(identity, true)) return twiml(res, "<Say>You've reached today's phone call limit.</Say><Hangup/>");
      console.log(`Phone call from ${identity} to ${to.slice(0, -4)}••••`);
      twiml(res, `<Dial callerId="${xml(s.callerId)}" timeLimit="${MAX_MINUTES() * 60}" answerOnBridge="true"><Number>${xml(to)}</Number></Dial>`);
    } catch (e) {
      console.warn("phone webhook failed", e.message);
      twiml(res, "<Say>Sorry, something went wrong.</Say><Hangup/>");
    }
  });
}

module.exports = { enabled, tokenFor, voiceWebhook, normalize, allowed, _accessToken: accessToken, _validSignature: validSignature };
