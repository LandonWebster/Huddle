// Alarms that ring even when Huddle is closed. The app sends its alarms (and a running timer)
// here with the person's time zone; every few seconds this checks whose alarm is due and sends
// a ringing notification (public/sw.js repeats it like a phone ringing until it's stopped).
// The Android app also sets real device alarms (native), which ring with a full-screen alarm.
//
// Saved in app_settings as "alarms:<userId>" = { alarms: [{ id, h, m, days, label, on, pip }], tz, timer }.
const crypto = require("crypto");
const store = require("./store");
const { notify } = require("./notify");

const users = new Map(); // userId -> { alarms, tz, timer }
const fired = new Map(); // "user:alarm" -> "YYYY-MM-DD HH:MM" last fired (so it fires once a minute)
const snoozes = new Map(); // token -> { userId, alarm, at, sent }
let tell = () => {}; // tells the person's open apps something changed (set by api.js)
let loaded = null;

const clean = (a) => ({
  id: String(a.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 20),
  h: Math.max(0, Math.min(23, Math.floor(Number(a.h) || 0))),
  m: Math.max(0, Math.min(59, Math.floor(Number(a.m) || 0))),
  days: Array.isArray(a.days) ? [...new Set(a.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [],
  label: String(a.label || "").slice(0, 40),
  on: !!a.on,
  pip: !!a.pip,
});
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
function ring(userId, a, snoozed) {
  const token = crypto.randomBytes(12).toString("hex");
  snoozes.set(token, { userId, alarm: a, at: 0, sent: Date.now() });
  notify(userId, {
    kind: "alarm", cat: "alarm", ring: true,
    title: a.label || (a.timer ? "Time's up" : "Alarm"),
    body: a.timer ? "Your timer is done" : (snoozed ? "Snoozed alarm · " : "") + fmt(a.h, a.m),
    tag: "alarm-" + a.id, url: "/?alarm=" + encodeURIComponent(a.id), ttl: 120,
    snooze: a.timer ? undefined : "/api/alarm-snooze/" + token,
    stop: "/api/alarm-stop/" + token,
  });
}

async function tick() {
  await load();
  const now = Date.now();
  for (const [userId, u] of users) {
    if (!u) continue;
    const t = localNow(validTz(u.tz), now);
    const stamp = `${t.date} ${t.h}:${t.m}`;
    let changed = false;
    for (const a of u.alarms || []) {
      if (!a.on || a.h !== t.h || a.m !== t.m) continue;
      if (a.days && a.days.length && !a.days.includes(t.day)) continue;
      const k = userId + ":" + a.id;
      if (fired.get(k) === stamp) continue;
      fired.set(k, stamp);
      ring(userId, a);
      if (!a.days || !a.days.length) { a.on = false; changed = true; } // one-time alarms turn off
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
  notify(s.userId, { kind: "call-end", tag: "alarm-" + s.alarm.id });
  return true;
}
function stop(token) {
  const s = snoozes.get(token);
  if (!s) return false;
  snoozes.delete(token);
  notify(s.userId, { kind: "call-end", tag: "alarm-" + s.alarm.id });
  return true;
}

module.exports = { start, get, set, snooze, stop, localNow };
