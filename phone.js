// Real phone calls in Huddle, through Twilio: call a number from a call (the phone joins the
// call), call-backs that ring inside Huddle, and voicemail. (Texting was turned off on purpose.)
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
//  PHONE_OWNER            Huddle account name that gets calls from new numbers (default:
//                         whoever used the phone last)
//  PHONE_GREETING         what callers hear before leaving a voicemail
//  PUBLIC_URL             this app's address (Render sets RENDER_EXTERNAL_URL on its own)
//
// Incoming calls reach whoever last called that number from Huddle, with a
// notification (when they turned notifications on). If Huddle is closed, the caller is held for
// about 20 seconds while it opens from the notification, then goes to voicemail.
const crypto = require("crypto");
const store = require("./store");
const live = () => require("./api"); // push + presence (required late: api.js requires this file)
const { notify } = require("./notify");
const billing = require("./billing");

const env = (k, d) => (process.env[k] || d || "").trim();
const SID = () => env("TWILIO_ACCOUNT_SID");
const AUTH = () => env("TWILIO_AUTH_TOKEN");
const enabled = () => /^AC[0-9a-f]{32}$/i.test(SID()) && !!AUTH();

const ALLOW = () => env("PHONE_ALLOW_PREFIXES", "+1").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_MINUTES = () => Math.max(1, Math.min(240, Number(env("PHONE_MAX_MINUTES", "30")) || 30));
const PER_DAY = () => Math.max(1, Number(env("PHONE_CALLS_PER_DAY", "20")) || 20);
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
billing.init(twilio);

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
    // Calls to this number come to Huddle (call-backs, voicemail). Texting is off, so texts
    // aren't sent to Huddle.
    const want = { VoiceUrl: `${base}/twilio/incoming`, VoiceMethod: "POST", SmsUrl: "" };
    if (owned.voice_url !== want.VoiceUrl || (owned.sms_url || "") !== "") {
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
  return { keySid: key.sid, keySecret: key.secret, appSid: app.sid, callerId, voiceUrl, base, owned: !!owned, ownedSid: owned ? owned.sid : null };
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

// Is this person the one who gets calls? (So the app knows to listen for call-backs.)
async function isLineUser(user) {
  const owner = env("PHONE_OWNER");
  if (owner && store.nameKey(owner) === user.username) return true;
  if ((await store.getSetting("phone_user")) === user.id) return true;
  if (await store.cellOf(user.id)) return true;
  return store.phoneUsed(user.id);
}

// POST /api/phone → { token, callerId, line }. `listen: true` is the app opening (it only
// wants a token if this person can get call-backs); otherwise it's about to dial.
async function tokenFor(user, req, body = {}) {
  if (!enabled()) return { status: 404, body: { error: "Phone calls aren't set up yet" } };
  const identity = identityOf(user);
  const line = await isLineUser(user).catch(() => false);
  if (body.listen && !line) return { status: 200, body: { line: false } };
  // 911 is never blocked: no daily limit, no balance check, nothing saved about who dials.
  if (body.emergency) {
    try { const s = await ready(req); return { status: 200, body: { token: accessToken(s, identity, 3600), callerId: s.callerId, line } }; }
    catch (e) { return fail(e); }
  }
  if (!body.listen && overLimit(identity, false)) return { status: 429, body: { error: `You've made ${PER_DAY()} phone calls today. Try again tomorrow.` } };
  if (!body.listen && (await payer(user.id)) && (await billing.minutesLeft(user.id, "out")) < 1) {
    return { status: 402, body: { error: "Add money to your phone balance first (Phone > Balance)", needsCredit: true } };
  }
  // Whoever dials out last is the default person for call-backs from new numbers. The first
  // person to ever dial out is the phone's owner (unless PHONE_OWNER says otherwise).
  if (!body.listen) {
    store.setSetting("phone_user", user.id).catch(() => {});
    store.getSetting("phone_owner_id").then((o) => o || store.setSetting("phone_owner_id", user.id)).catch(() => {});
  }
  try {
    const s = await ready(req);
    return { status: 200, body: { token: accessToken(s, identity, 3600), callerId: s.callerId, maxMinutes: MAX_MINUTES(), line } };
  } catch (e) { return fail(e); }
}

// ---------- Which number shows when calling out ----------
// The Huddle (Twilio) number, or a cell verified in Twilio (a "Verified Caller ID"). Only the
// phone's owner can show a verified cell; everyone else shows the Huddle number.
async function isOwner(user) {
  const owner = env("PHONE_OWNER");
  if (owner) return store.nameKey(owner) === user.username;
  const id = await store.getSetting("phone_owner_id");
  return !id || id === user.id;
}
async function ownerById(userId) {
  const u = userId && await store.userById(userId);
  return u ? isOwner({ id: userId, username: u.username }) : false;
}
// Does this person pay for their phone calls? (Everyone but the owner, once billing is on.)
async function payer(userId) {
  return billing.active() && !(await ownerById(userId).catch(() => false));
}
// The Huddle number this person uses: their own (paid) number, else the main one.
async function huddleNumberFor(userId, s) {
  const mine = await store.numberOf(userId).catch(() => null);
  return mine ? mine.number : s.callerId;
}
// Longest call (seconds) this person gets: the usual limit, or less if their balance is low.
async function callLimit(userId, kind) {
  let secs = MAX_MINUTES() * 60;
  if (await payer(userId)) secs = Math.min(secs, (await billing.minutesLeft(userId, kind)) * 60);
  return secs;
}
let verified = { list: [], at: 0 };
async function verifiedNumbers() {
  if (Date.now() - verified.at < 5 * 60 * 1000) return verified.list;
  const j = await twilio("GET", "/OutgoingCallerIds.json?PageSize=1000");
  verified = { list: (j.outgoing_caller_ids || []).map((v) => v.phone_number).filter(Boolean), at: Date.now() };
  return verified.list;
}
// Each person can show their own linked cell (proven theirs, and verified in Twilio). The owner
// can also show verified numbers nobody else has linked (like the cell they verified by hand).
async function callerOptions(user, s) {
  const opts = [{ number: await huddleNumberFor(user.id, s), label: "Huddle number" }];
  try {
    const list = await verifiedNumbers();
    const mine = await store.cellOf(user.id);
    if (mine && list.includes(mine)) opts.push({ number: mine, label: "Your cell" });
    if (await isOwner(user)) {
      const taken = new Set(await store.linkedCells());
      for (const n of list) if (n !== s.callerId && !taken.has(n) && !opts.some((o) => o.number === n)) opts.push({ number: n, label: "Your cell" });
    }
  } catch (e) { console.warn("verified numbers:", e.message); }
  return { options: opts, canChoose: opts.length > 1 };
}
// The caller ID for this person's outgoing calls. By default the owner's verified cell, if any.
async function callerIdFor(userId, s) {
  const user = { id: userId, username: (await store.userById(userId) || {}).username };
  const { options } = await callerOptions(user, s);
  const pick = await store.getSetting("callerid:" + userId);
  if (pick && options.some((o) => o.number === pick)) return pick;
  if (!pick && options.length > 1) return options[1].number;
  return options[0].number;
}

// Everything else under /api/phone/...: the Phone screen (calls and voicemails).
async function appRoute(method, sub, user, url, body, req) {
  if (!enabled()) return { status: 404, body: { error: "Phone isn't set up yet" } };
  if (sub === "billing") {
    let s;
    try { s = await ready(req); } catch (e) { return fail(e); }
    return billing.route(method, user, body || {}, s.base, !(await payer(user.id)));
  }
  if (method === "GET" && sub === "threads") {
    const s = setup && !setup.failed ? await setup.catch(() => null) : null;
    return { status: 200, body: { threads: await store.phoneThreads(user.id), unread: await store.phoneUnread(user.id), number: s ? await huddleNumberFor(user.id, s) : null } };
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
  if (sub === "callerid") {
    let s;
    try { s = await ready(req); } catch (e) { return fail(e); }
    const { options, canChoose } = await callerOptions(user, s);
    if (method === "POST") {
      const n = normalize(body.number);
      if (!canChoose || !options.some((o) => o.number === n)) return { status: 400, body: { error: "You can't show that number" } };
      await store.setSetting("callerid:" + user.id, n);
    }
    return { status: 200, body: { options, canChoose, selected: await callerIdFor(user.id, s) } };
  }
  // Contacts: GET lists them; POST { number, name } saves one, and an empty name deletes it.
  // { number, oldNumber, name } changes a contact's number too.
  if (sub === "contacts") {
    if (method === "POST") {
      const number = normalize(body.number);
      if (!number) return { status: 400, body: { error: "Type a 10-digit phone number" } };
      const old = normalize(body.oldNumber);
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!name) await store.deleteContact(user.id, number);
      else {
        const isNew = !(await store.contactName(user.id, number));
        if (isNew && (await store.contactCount(user.id)) >= 1000) return { status: 400, body: { error: "You can save up to 1,000 contacts" } };
        if (old && old !== number) await store.deleteContact(user.id, old);
        await store.saveContact(user.id, number, name);
      }
    }
    return { status: 200, body: { contacts: await store.contacts(user.id) } };
  }
  if (sub === "cell") return cellRoute(method, user, body, req);
  if (sub === "e911") return e911Route(method, user, body || {}, req);
  if (method === "GET" && sub === "calls") return { status: 200, body: { calls: await store.phoneCalls(user.id) } };
  // The app's phone line is connected and can ring (so a waiting caller can be put through).
  if (method === "POST" && sub === "ready") { lineReady.set(user.id, Date.now()); return { status: 200, body: {} }; }
  return { status: 404, body: { error: "Not found" } };
}

// ---------- Your cell: link it, so calls it forwards to the Huddle number ring you in Huddle ----------
// First the person proves the cell is theirs: Twilio calls it and they type the code shown in
// Huddle. That also verifies it in Twilio, so it can be their caller ID. If Twilio already has
// it verified (someone verified it by hand), Huddle calls it itself with its own code instead.
const cellChecks = new Map(); // userId -> { number, code, at, tries }
const CHECK_MS = 5 * 60 * 1000;
const gatherXml = (s, userId, number, lead) =>
  `<Gather numDigits="6" timeout="20" action="${xml(`${s.base}/twilio/cell-code?u=${encodeURIComponent(userId)}&n=${encodeURIComponent(number)}`)}"><Say>${xml(lead)}</Say></Gather><Say>${xml("We didn't get a code. Goodbye.")}</Say>`;
async function cellRoute(method, user, body, req) {
  let s;
  try { s = await ready(req); } catch (e) { return fail(e); }
  if (method === "POST" && body.action === "unlink") {
    const n = await store.cellOf(user.id);
    await store.unlinkCell(user.id);
    if (n && !(await isOwner(user))) {
      // Take it off the account's verified caller IDs too, so nobody else can show it.
      twilio("GET", `/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(n)}`)
        .then((j) => Promise.all((j.outgoing_caller_ids || []).filter((v) => v.phone_number === n).map((v) => twilio("DELETE", `/OutgoingCallerIds/${v.sid}.json`))))
        .then(() => { verified.at = 0; }).catch(() => {});
    }
    cellChecks.delete(user.id);
  } else if (method === "POST") {
    const number = normalize(body.number);
    const why = allowed(number);
    if (why) return { status: 400, body: { error: why } };
    if (number === s.callerId || (await store.numberUser(number))) return { status: 400, body: { error: "That's a Huddle number. Type your own cell." } };
    if (overLimit("v:" + user.id, true, 8)) return { status: 429, body: { error: "Too many tries today. Try again tomorrow." } };
    try {
      const v = await twilio("POST", "/OutgoingCallerIds.json", {
        PhoneNumber: number, FriendlyName: `Huddle: ${user.username}`.slice(0, 64),
        StatusCallback: `${s.base}/twilio/cell-verified?u=${encodeURIComponent(user.id)}&n=${encodeURIComponent(number)}`,
      });
      cellChecks.set(user.id, { number, code: String(v.validation_code), at: Date.now(), tries: 0 });
    } catch (e) {
      if (e.code !== 21450) return { status: 400, body: { error: e.status === 400 ? "Twilio couldn't call that number" : "Couldn't reach the phone service" } };
      // Already verified in Twilio: call it ourselves with our own code.
      const code = String(crypto.randomInt(100000, 1000000));
      cellChecks.set(user.id, { number, code, at: Date.now(), tries: 0 });
      try {
        await twilio("POST", "/Calls.json", { To: number, From: s.callerId, Twiml: `<Response>${gatherXml(s, user.id, number, "Hi, this is Huddle. Type the 6 digit code shown in the app.")}</Response>` });
      } catch { cellChecks.delete(user.id); return { status: 400, body: { error: "Twilio couldn't call that number" } }; }
    }
  }
  const check = cellChecks.get(user.id);
  if (check && Date.now() - check.at > CHECK_MS) cellChecks.delete(user.id);
  const pending = cellChecks.get(user.id);
  return { status: 200, body: {
    cell: await store.cellOf(user.id),
    ownNumber: !!(await store.numberOf(user.id)),
    needsNumber: !(await store.numberOf(user.id)) && (await payer(user.id)),
    // Where to forward: your own Huddle number. People who pay need one first; the owner uses the main one.
    huddleNumber: (await store.numberOf(user.id)) ? await huddleNumberFor(user.id, s) : (await payer(user.id)) ? null : s.callerId,
    pending: pending ? { number: pending.number, code: pending.code, failed: !!pending.failed } : null,
  } };
}
async function cellProven(userId, number) {
  const check = cellChecks.get(userId);
  if (!check || check.number !== number || Date.now() - check.at > CHECK_MS) return false;
  cellChecks.delete(userId);
  await store.linkCell(userId, number);
  verified.at = 0;
  pushTo(userId, { type: "phone-update", kind: "cell" });
  return true;
}

// Whose phone line in the app is connected right now.
const lineReady = new Map(); // userId -> when it last connected
function canRing(userId) {
  try {
    const a = live();
    return a.presenceOf(userId).online && (lineReady.get(userId) || 0) > a.offlineAt(userId);
  } catch { return false; }
}
// "Mom" if this person saved the number as a contact, else "(555) 123-4567".
const nameOf = async (userId, number) => (await store.contactName(userId, number).catch(() => null)) || pretty(number);
const ringXml = (s, userId, from, name, viaCell, limit = MAX_MINUTES() * 60) => {
  const after = `${s.base}/twilio/after?u=${encodeURIComponent(userId)}&n=${encodeURIComponent(from)}`;
  return `<Dial timeout="25" timeLimit="${limit}" answerOnBridge="true" action="${xml(after)}"><Client><Identity>u${xml(userId)}</Identity><Parameter name="from" value="${xml(from)}"/>${name ? `<Parameter name="name" value="${xml(name)}"/>` : ""}${viaCell ? '<Parameter name="via" value="cell"/>' : ""}</Client></Dial>`;
};
const HOLD_TRIES = 6; // about 20 seconds

// ---------- 911 ----------
// A 911 call shows the dispatcher the emergency address registered on the calling number (Twilio
// "Emergency Calling"). Each person registers their own address on their own Huddle number; the
// owner registers theirs on the main number. People without their own number call from the main
// number (the dispatcher may see the wrong address, so the app tells them to say where they are).
// 911 calls are never blocked or charged to the person: no balance, limit or time checks.
async function e911NumberFor(userId, s) {
  const mine = await store.numberOf(userId).catch(() => null);
  if (mine) return { number: mine.number, sid: mine.sid, own: true };
  if (await ownerById(userId).catch(() => false)) return s.ownedSid ? { number: s.callerId, sid: s.ownedSid, own: true } : null;
  return null;
}
async function emergencyDial(s, userId, short) {
  let from = s.callerId;
  try {
    const reg = await store.e911Of(userId);
    const n = await e911NumberFor(userId, s);
    if (reg && n && reg.number === n.number) from = n.number;
    else if (n) from = n.number;
  } catch {}
  console.log(short === "911" ? "EMERGENCY CALL (911)" : "911 address test call (933)");
  store.phoneAdd(userId, short, "call_out", { status: "emergency" }).then(() => pushTo(userId, { type: "phone-update", number: short })).catch(() => {});
  return `<Dial callerId="${xml(from)}" answerOnBridge="true"><Number>${short}</Number></Dial>`;
}
const E911_FIELDS = { name: 60, street: 100, street2: 60, city: 60, region: 2, postal: 10 };
async function e911Route(method, user, body, req) {
  let s;
  try { s = await ready(req); } catch (e) { return fail(e); }
  const n = await e911NumberFor(user.id, s);
  let reg = await store.e911Of(user.id);
  if (method === "POST") {
    if (!n) return { status: 400, body: { error: "Get your own Huddle number first, so 911 can show your address" } };
    const a = {};
    for (const [k, max] of Object.entries(E911_FIELDS)) a[k] = String(body[k] || "").replace(/\s+/g, " ").trim().slice(0, max);
    a.region = a.region.toUpperCase();
    if (!a.name || !a.street || !a.city || !/^[A-Z]{2}$/.test(a.region) || !/^\d{5}(-\d{4})?$/.test(a.postal)) {
      return { status: 400, body: { error: "Fill in your name, street, city, 2-letter state and ZIP code" } };
    }
    const form = { CustomerName: a.name, Street: a.street, StreetSecondary: a.street2, City: a.city, Region: a.region, PostalCode: a.postal, EmergencyEnabled: "true", AutoCorrectAddress: "false" };
    let addressSid = reg && reg.addressSid;
    try {
      if (addressSid) await twilio("POST", `/Addresses/${addressSid}.json`, form);
      else addressSid = (await twilio("POST", "/Addresses.json", { ...form, IsoCountry: "US", FriendlyName: "Huddle 911" })).sid;
      await twilio("POST", `/IncomingPhoneNumbers/${n.sid}.json`, { EmergencyAddressSid: addressSid });
    } catch (e) {
      if (addressSid && !(reg && reg.addressSid)) twilio("DELETE", `/Addresses/${addressSid}.json`).catch(() => {});
      const msg = e.code === 21629 ? `Check the address. Twilio suggests: ${e.message}` : e.code === 21628 ? "That address couldn't be found. Check the street, city, state and ZIP." : "Couldn't save the address right now. Try again.";
      return { status: 400, body: { error: msg } };
    }
    await store.saveE911(user.id, addressSid, n.number, a);
    reg = await store.e911Of(user.id);
  }
  let status = null;
  if (reg && n && reg.number === n.number) {
    try { status = (await twilio("GET", `/IncomingPhoneNumbers/${n.sid}.json`)).emergency_address_status || null; } catch {}
  }
  return { status: 200, body: { number: n ? n.number : null, mainNumber: s.callerId, address: reg && n && reg.number === n.number ? reg.address : null, status } };
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

// Who gets a call from this number: whoever in Huddle last talked to it, else the
// PHONE_OWNER account, else the phone's owner (first person to dial), else whoever used it last.
async function ownerFor(number) {
  const known = await store.phoneUserFor(number, true);
  if (known) return known;
  const owner = env("PHONE_OWNER");
  const u = owner && (await store.userByName(owner));
  if (u) return u.id;
  return (await store.getSetting("phone_owner_id")) || (await store.phoneUserFor(null, false)) || (await store.getSetting("phone_user"));
}

// Each route: check Twilio really sent it, then answer. Everything Twilio calls lives here.
const routes = {
  // A call the app started (outgoing).
  async voice(s, p) {
    const identity = userIdOf(p.From);
    // 911 (and 933, Twilio's free address test) go through before every other check.
    const short = String(p.To || "").replace(/\D/g, "");
    if (identity && (short === "911" || short === "933")) return emergencyDial(s, identity, short);
    const to = normalize(p.To);
    const why = allowed(to);
    if (!identity || why) return `<Say>${xml(why || "Sorry, that call can't be made.")}</Say><Hangup/>`;
    if (overLimit("u" + identity, true)) return "<Say>You've reached today's phone call limit.</Say><Hangup/>";
    const limit = await callLimit(identity, "out");
    if (limit < 60) return `<Say>${xml("Add money to your Huddle phone balance to make calls.")}</Say><Hangup/>`;
    console.log(`Phone call to ${to.slice(0, -4)}••••`);
    if (await payer(identity)) await billing.trackCall(identity, p.CallSid, to, "out");
    const done = `${s.base}/twilio/out-done?u=${encodeURIComponent(identity)}&n=${encodeURIComponent(to)}`;
    const callerId = await callerIdFor(identity, s).catch(() => s.callerId);
    return `<Dial callerId="${xml(callerId)}" timeLimit="${limit}" answerOnBridge="true" action="${xml(done)}"><Number>${xml(to)}</Number></Dial>`;
  },
  // The outgoing call ended: save it in the Phone screen.
  async "out-done"(s, p, q) {
    const userId = q.get("u"), to = normalize(q.get("n"));
    if (userId && to) {
      const ok = p.DialCallStatus === "completed";
      await store.phoneAdd(userId, to, "call_out", { duration: ok ? Number(p.DialCallDuration || 0) : 0, status: p.DialCallStatus || null, sid: p.CallSid || null });
      pushTo(userId, { type: "phone-update", number: to });
    }
    return "<Hangup/>";
  },
  // Someone called the Huddle number: notify, ring inside Huddle, or hold briefly while Huddle
  // opens from the notification. Nobody picks up: voicemail.
  async incoming(s, p) {
    const from = normalize(p.From) || String(p.From || "unknown").slice(0, 20);
    // Forwarded from someone's linked cell? Then it's their call. (Most carriers say which cell
    // forwarded it; when they don't, it goes to whoever last talked to the caller.)
    // Called someone's own Huddle number? Then it's theirs, whoever is calling.
    const numberOwner = await store.numberUser(normalize(p.To));
    const fwd = normalize(p.ForwardedFrom);
    const cellOwner = numberOwner ? null : fwd && fwd !== s.callerId ? await store.cellUser(fwd) : null;
    const userId = numberOwner || cellOwner || await ownerFor(from);
    console.log(`Incoming phone call${p.ForwardedFrom ? " (forwarded" + (cellOwner ? " from a linked cell)" : ")") : ""}`);
    if (!userId) return `<Say>${xml("Sorry, nobody can take this call right now.")}</Say><Hangup/>`;
    // People who pay for calls: track this one, and send it to voicemail if their balance is empty.
    if (await payer(userId)) {
      await billing.trackCall(userId, p.CallSid, from, "in");
      if ((await callLimit(userId, "in")) < 60) return voicemail(s, userId, from);
    }
    const name = await store.contactName(userId, from).catch(() => null);
    notify(userId, { kind: "call", title: name || pretty(from), body: cellOwner ? "Calling your cell" : "Calling your Huddle number", tag: "pcall-" + from, url: "/?phone=" + encodeURIComponent(from), ttl: 30 });
    if (canRing(userId)) return ringXml(s, userId, from, name, !!cellOwner, await callLimit(userId, "in"));
    return `<Say>${xml("Please hold while I connect you.")}</Say><Redirect>${xml(`${s.base}/twilio/hold?t=1&u=${encodeURIComponent(userId)}&n=${encodeURIComponent(from)}${cellOwner ? "&c=1" : ""}`)}</Redirect>`;
  },
  // Waiting for Huddle to open (checked every few seconds).
  async hold(s, p, q) {
    const userId = q.get("u"), from = q.get("n"), t = Number(q.get("t")) || 1;
    if (canRing(userId)) return ringXml(s, userId, from, await store.contactName(userId, from).catch(() => null), q.get("c") === "1", await callLimit(userId, "in"));
    if (t >= HOLD_TRIES) return voicemail(s, userId, from);
    return `<Pause length="3"/><Redirect>${xml(`${s.base}/twilio/hold?t=${t + 1}&u=${encodeURIComponent(userId)}&n=${encodeURIComponent(from)}${q.get("c") === "1" ? "&c=1" : ""}`)}</Redirect>`;
  },
  // After ringing in Huddle: answered (save it) or not (voicemail).
  async after(s, p, q) {
    const userId = q.get("u"), from = q.get("n");
    if (p.DialCallStatus === "completed") {
      await store.phoneAdd(userId, from, "call_in", { duration: Number(p.DialCallDuration || 0), sid: p.CallSid || null });
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
      await store.phoneAdd(userId, from, "voicemail", { mediaId, duration: Number(p.RecordingDuration || 0), sid: p.CallSid || null });
      billing.addRecording(p.CallSid, p.RecordingDuration).catch(() => {});
      pushTo(userId, { type: "phone-update", number: from, kind: "voicemail" });
      notify(userId, { kind: "text", title: await nameOf(userId, from), body: `New voicemail (${Math.floor((p.RecordingDuration || 0) / 60)}:${String((p.RecordingDuration || 0) % 60).padStart(2, "0")})`, tag: "pvm-" + from, url: "/?phone=" + encodeURIComponent(from) });
      if (p.RecordingSid) twilio("DELETE", `/Recordings/${p.RecordingSid}.json`).catch(() => {});
    } catch (e) { console.warn("voicemail save failed", e.message); }
    return "";
  },
  // Twilio finished checking a cell (its own call with the code typed in).
  async "cell-verified"(s, p, q) {
    if (p.VerificationStatus === "success") await cellProven(q.get("u"), q.get("n"));
    else { const c = cellChecks.get(q.get("u")); if (c && c.number === q.get("n")) c.failed = true; }
    return "";
  },
  // Huddle's own check call: the code they typed.
  async "cell-code"(s, p, q) {
    const userId = q.get("u"), number = q.get("n"), check = cellChecks.get(userId);
    if (!check || check.number !== number) return `<Say>${xml("That code has expired. Start again in Huddle.")}</Say><Hangup/>`;
    if (String(p.Digits || "") === check.code && await cellProven(userId, number)) return `<Say>${xml("Thanks! Your cell is now linked to Huddle. Goodbye.")}</Say><Hangup/>`;
    if (++check.tries >= 3) { check.failed = true; return `<Say>${xml("That code didn't match. Start again in Huddle. Goodbye.")}</Say><Hangup/>`; }
    return gatherXml(s, userId, number, "That code didn't match. Please try again.");
  },
  // Texting is off: anything Twilio still sends here is ignored.
  async sms() { return ""; },
  async "sms-status"() { return ""; },
};
function voicemail(s, userId, from) {
  store.phoneAdd(userId, from, "missed").then(() => pushTo(userId, { type: "phone-update", number: from })).catch(() => {});
  nameOf(userId, from).then((title) => notify(userId, { kind: "text", title, body: "Missed call", tag: "pcall-" + from, url: "/?phone=" + encodeURIComponent(from) }));
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
      twiml(res, ["sms", "sms-status", "recording", "cell-verified"].includes(name) ? "" : "<Say>Sorry, something went wrong.</Say><Hangup/>");
    }
  });
}

// Get ready as soon as the server starts, so call-backs work before anyone dials.
if (enabled() && (env("PUBLIC_URL") || env("RENDER_EXTERNAL_URL"))) setTimeout(() => ready(null).catch(() => {}), 3000);

module.exports = { enabled, tokenFor, appRoute, webhook, normalize, allowed, pretty, _accessToken: accessToken, _validSignature: validSignature };
