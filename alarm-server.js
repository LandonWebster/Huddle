// Alarms that ring even when Huddle is closed. The app sends its alarms (and a running timer)
// here with the person's time zone; every few seconds this checks whose alarm is due and sends
// a ringing notification (public/sw.js repeats it like a phone ringing until it's stopped).
// The Android app also sets real device alarms (native), which ring with a full-screen alarm.
//
// Saved in app_settings as "alarms:<userId>" = { alarms: [{ id, h, m, days, label, on, pip, sound,
// screen, vib, vibStr, color, snoozeColor, routine, more, skipUntil }], tz, timer }.
const crypto = require("crypto");
const store = require("./store");
const { notify } = require("./notify");

const users = new Map(); // userId -> { alarms, tz, timer }
const fired = new Map(); // "user:alarm" -> "YYYY-MM-DD HH:MM" last fired (so it fires once a minute)
const snoozes = new Map(); // token -> { userId, alarm, at, sent }
let tell = () => {}; // tells the person's open apps something changed (set by api.js)
let loaded = null;

const hex = (c, d) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const safeId = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const text = (v, n) => String(v || "").slice(0, n);
// Each alarm's own sound, vibration, alarm screen, colors, routine and extra alarms (the
// Alarms tab's editor; songs and pictures stay on the phone, so only their id and name are here).
const clean = (a) => {
  const s = a.sound || {}, sc = a.screen || {}, mo = a.more || {};
  const out = {
    id: String(a.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 20),
    h: Math.max(0, Math.min(23, Math.floor(Number(a.h) || 0))),
    m: Math.max(0, Math.min(59, Math.floor(Number(a.m) || 0))),
    days: Array.isArray(a.days) ? [...new Set(a.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [],
    label: String(a.label || "").slice(0, 40),
    on: !!a.on,
    pip: !!a.pip,
  };
  if (a.sound) out.sound = {
    kind: pick(s.kind, ["tone", "file", "app"], "tone"),
    tone: pick(s.tone, ["phone", "chime", "bells", "rise", "marimba", "tune", "beep"], "chime"),
    file: s.file && safeId(s.file.id) ? { id: safeId(s.file.id), name: text(s.file.name, 60), dur: num(s.file.dur, 0, 36000, 0) } : null,
    app: pick(s.app, ["spotify", "apple", "youtube"], "spotify"),
    link: /^https:\/\//.test(String(s.link || "")) ? text(s.link, 300) : "",
    start: num(s.start, 0, 36000, 0), end: num(s.end, 0, 36000, 30), full: !!s.full,
    vol: num(s.vol, 5, 100, 80), ramp: s.ramp !== false,
  };
  if (a.screen) out.screen = {
    kind: pick(sc.kind, ["look", "photo", "video"], "look"),
    look: pick(sc.look, ["glow", "sunrise", "night", "ocean", "plain"], "glow"),
    media: sc.media && safeId(sc.media.id) ? { id: safeId(sc.media.id), name: text(sc.media.name, 60), kind: pick(sc.media.kind, ["photo", "video"], "photo") } : null,
    shade: sc.shade !== false,
  };
  if (a.vib) { out.vib = pick(a.vib, ["off", "gentle", "pulse", "heartbeat", "rapid", "strong", "sos"], "pulse"); out.vibStr = num(a.vibStr, 1, 3, 2); }
  if (a.color) out.color = hex(a.color, "#2f55e4");
  if (a.snoozeColor) out.snoozeColor = hex(a.snoozeColor, "#22d3ee");
  if (a.routine) out.routine = pick(a.routine, ["none", "morning", "night"], "none");
  if (a.more) out.more = { on: !!mo.on, every: Math.round(num(mo.every, 1, 60, 5)), count: Math.round(num(mo.count, 1, 20, 1)) };
  if (a.skipUntil && Number(a.skipUntil) > Date.now()) out.skipUntil = Math.min(Number(a.skipUntil), Date.now() + 2 * 86400000);
  return out;
};
// An alarm and its extra alarms ("Set more alarms", every few minutes after it).
function series(a) {
  const out = [{ ...a, idx: 0, count: 0 }];
  if (!a.more || !a.more.on) return out;
  const { every, count } = a.more;
  out[0].count = count;
  for (let i = 1; i <= count; i++) {
    const t = a.h * 60 + a.m + i * every, shift = Math.floor(t / 1440);
    out.push({ ...a, id: a.id + "x" + i, idx: i, count, h: Math.floor((t % 1440) / 60), m: t % 60, days: (a.days || []).map((d) => (d + shift) % 7) });
  }
  return out;
}
function validTz(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

function load() {
  if (!loaded) {
    loaded = store.settingsLike("alarms:").then((rows) => {
      for (const r of rows) { try { users.set(r.key.slice(7), JSON.parse(r.value)); } catch {} }
    }).catch((e) => { loaded = null; console.warn("alarms load failed", e.message); });
  }
  return loaded;
}
async function save(userId) {
  const u = users.get(userId);
  await store.setSetting("alarms:" + userId, JSON.stringify(u));
}

// The time on the person's own clock: { date: "YYYY-MM-DD", h, m, day }.
function localNow(tz, at = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    h: Number(parts.hour) % 24, m: Number(parts.minute),
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}

const fmt = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
// On an iPhone (Home Screen web app) a closed app can't keep ringing by itself, so the alarm
// notification is sent again every 5 seconds until it's opened, snoozed or turned off, for up
// to 5 minutes. Other devices repeat it themselves (public/sw.js).
const REPEAT_MS = 5 * 1000, REPEAT_FOR = 5 * 60 * 1000;
function ring(userId, a, snoozed) {
  const token = crypto.randomBytes(12).toString("hex");
  const s = { userId, alarm: a, at: 0, sent: Date.now() };
  snoozes.set(token, s);
  const note = () => ({
    kind: "alarm", cat: "alarm", ring: true,
    title: a.label || (a.timer ? "Time's up" : "Alarm"),
    body: a.timer ? "Your timer is done" : (snoozed ? "Snoozed alarm · " : "") + fmt(a.h, a.m),
    tag: "alarm-" + a.id, url: "/?alarm=" + encodeURIComponent(a.id), ttl: 120,
    snooze: a.timer ? undefined : "/api/alarm-snooze/" + token,
    stop: "/api/alarm-stop/" + token,
  });
  notify(userId, note());
  s.repeat = setInterval(() => {
    if (snoozes.get(token) !== s || s.at || Date.now() - s.sent > REPEAT_FOR) { clearInterval(s.repeat); return; }
    notify(userId, { ...note(), appleOnly: true });
  }, REPEAT_MS);
  s.repeat.unref();
}
const quiet = (s) => { if (s && s.repeat) clearInterval(s.repeat); };

async function tick() {
  await load();
  const now = Date.now();
  for (const [userId, u] of users) {
    if (!u) continue;
    const t = localNow(validTz(u.tz), now);
    const stamp = `${t.date} ${t.h}:${t.m}`;
    let changed = false;
    for (const base of u.alarms || []) {
      if (!base.on) continue;
      if (base.skipUntil && now < base.skipUntil) continue; // "Skip the other alarms" was tapped
      for (const a of series(base)) {
        if (a.h !== t.h || a.m !== t.m) continue;
        if (a.days && a.days.length && !a.days.includes(t.day)) continue;
        const k = userId + ":" + a.id;
        if (fired.get(k) === stamp) continue;
        fired.set(k, stamp);
        ring(userId, a);
        // One-time alarms turn off (after their last extra alarm).
        if ((!base.days || !base.days.length) && a.idx === a.count) { base.on = false; changed = true; }
      }
    }
    if (u.timer && u.timer.at <= now) {
      if (now - u.timer.at < 5 * 60 * 1000) ring(userId, { id: "timer", timer: true, label: "Time's up" });
      u.timer = null; changed = true;
    }
    if (changed) { save(userId).catch(() => {}); tell(userId, { type: "alarms-changed" }); }
  }
  for (const [token, s] of snoozes) {
    if (s.at && s.at <= now) { snoozes.delete(token); ring(s.userId, s.alarm, true); }
    else if (!s.at && now - s.sent > 30 * 60 * 1000) snoozes.delete(token);
  }
}

function start(push) {
  if (push) tell = push;
  setInterval(() => tick().catch((e) => console.warn("alarm tick failed", e.message)), 10 * 1000).unref();
}

// GET/POST /api/alarms (signed in), POST /api/alarm-snooze|alarm-stop/<token> (from a notification; no sign-in).
async function get(userId) {
  await load();
  const u = users.get(userId);
  return { alarms: (u && u.alarms) || null, timer: (u && u.timer) || null };
}
async function set(userId, body) {
  await load();
  const prev = users.get(userId) || {};
  const u = {
    alarms: Array.isArray(body.alarms) ? body.alarms.slice(0, 50).map(clean).filter((a) => a.id) : prev.alarms || [],
    tz: validTz(String(body.tz || prev.tz || "UTC")),
    timer: "timer" in body ? (body.timer && Number(body.timer.at) > Date.now() ? { at: Number(body.timer.at) } : null) : prev.timer || null,
  };
  users.set(userId, u);
  await save(userId);
  return { alarms: u.alarms, timer: u.timer };
}
// Snooze or Stop on one device stops it ringing on the others too.
function snooze(token) {
  const s = snoozes.get(token);
  if (!s || s.at) return false;
  s.at = Date.now() + 9 * 60 * 1000;
  quiet(s);
  notify(s.userId, { kind: "call-end", tag: "alarm-" + s.alarm.id });
  return true;
}
function stop(token) {
  const s = snoozes.get(token);
  if (!s) return false;
  snoozes.delete(token);
  quiet(s);
  notify(s.userId, { kind: "call-end", tag: "alarm-" + s.alarm.id });
  return true;
}
// Snooze or Turn off in the open app: stop this person's alarms ringing everywhere else.
function hush(userId) {
  let n = 0;
  for (const [token, s] of snoozes) {
    if (s.userId !== userId || s.at) continue;
    snoozes.delete(token);
    quiet(s);
    notify(userId, { kind: "call-end", tag: "alarm-" + s.alarm.id });
    n++;
  }
  return n;
}

module.exports = { start, get, set, snooze, stop, hush, localNow };
