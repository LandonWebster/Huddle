// The Alarms tab: alarms, a timer and a stopwatch. When one rings, Pip can say good morning.
// Alarms (and a running timer) are saved with your account too, so they ring even when Huddle
// is closed: the server sends a ringing notification (alarm-server.js), and the Android app
// sets real phone alarms (native AlarmScheduler). Open and on screen, Huddle rings by itself.
(() => {
  "use strict";
  const T = window.HuddleTabs;
  if (!T) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "huddle:alarms";
  const load = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
  const save = (fromServer) => {
    try { localStorage.setItem(KEY, JSON.stringify(alarms)); } catch {}
    window.dispatchEvent(new Event("huddle:alarms"));
    if (!fromServer) upload();
    setNative();
  };
  let alarms = load(); // [{ id, h, m, days: [0..6], label, on, pip }]

  // ---------- Saved with the account, and as phone alarms in the Android app ----------
  const H = () => window.huddle || {};
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
  const pref = (k) => !window.HuddlePrefs || window.HuddlePrefs.get(k);
  async function call(method, body) {
    const r = await fetch("/api/alarms", {
      method,
      headers: { authorization: "Bearer " + (token() || ""), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error("alarms " + r.status);
    return r.json();
  }
  let upTimer = null;
  function upload(extra) {
    if (!token()) return;
    clearTimeout(upTimer);
    upTimer = setTimeout(() => call("POST", { alarms, tz: tz(), ...(extra || {}) }).catch(() => {}), extra ? 0 : 400);
  }
  // Server's copy wins (it turns one-time alarms off after they ring); a first sign-in on a
  // device that already had alarms sends them up.
  async function download() {
    if (!token()) return;
    try {
      const r = await call("GET");
      if (Array.isArray(r.alarms)) { alarms = r.alarms; save(true); if (typeof renderAlarms === "function" && mode === "alarm" && !p.el.hidden) renderAlarms(); }
      else if (alarms.length) upload();
      else call("POST", { alarms: [], tz: tz() }).catch(() => {});
    } catch {}
  }
  // The Android app rings alarms itself (a real alarm, with Huddle closed or the phone restarted).
  let nativeRings = false;
  function setNative() {
    if (!H().isNativeApp || !H().native) return;
    const on = pref("alarms");
    H().native("setAlarms", {
      alarms: on ? alarms : [],
      timer: on && timer.running ? timer.endAt : 0,
      name: myFirstName(),
      sound: pref("sounds"), vibrate: pref("vibrate"),
    }).then(() => { nativeRings = true; }).catch(() => { nativeRings = false; });
  }
  window.addEventListener("huddle:signedin", download);
  window.addEventListener("huddle:signed-in", download);
  window.addEventListener("huddle:alarms-changed", download);
  window.addEventListener("huddle:prefs", () => setNative());
  // Ring here, or leave it to the notification / phone alarm? Here only when Huddle is on screen
  // (the notification is skipped then) or nothing else can ring.
  async function ringsHere() {
    if (!pref("alarms")) return false;
    if (nativeRings) return false;
    if (!document.hidden) return true;
    try { return !window.huddleNotify || (await window.huddleNotify.state()) !== "on"; } catch { return true; }
  }
  const DAY = ["S", "M", "T", "W", "T", "F", "S"];
  const DAY_LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (h, m) => new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function daysText(d) {
    if (!d || !d.length) return "Once";
    const s = [...d].sort().join("");
    if (s === "0123456") return "Every day";
    if (s === "12345") return "Mon to Fri";
    if (s === "06") return "Weekends";
    return [...d].sort().map((i) => DAY_LONG[i]).join(", ");
  }
  // When an alarm rings next (a Date), or null when it's off.
  function nextAt(a, from = new Date()) {
    if (!a.on) return null;
    for (let i = 0; i < 8; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, a.h, a.m, 0, 0);
      if (d <= from) continue;
      if (!a.days || !a.days.length || a.days.includes(d.getDay())) return d;
    }
    return null;
  }
  function next() {
    let best = null;
    for (const a of alarms) { const d = nextAt(a); if (d && (!best || d < best.at)) best = { at: d, alarm: a }; }
    return best && { at: best.at, time: fmt(best.at.getHours(), best.at.getMinutes()), alarm: best.alarm };
  }
  function untilText(d) {
    const mins = Math.max(1, Math.round((d - Date.now()) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return "Rings in " + (h ? `${h} hr ` : "") + (m || !h ? `${m} min` : "").trim();
  }
  window.HuddleAlarms = { next };

  // ---------- The page ----------
  const p = T.page("alarms", "Alarms");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tp-round";
  addBtn.setAttribute("aria-label", "New alarm");
  addBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  addBtn.onclick = () => edit(null);
  p.right.appendChild(addBtn);
  let mode = "alarm";
  p.body.innerHTML = `
    <div class="seg" role="tablist" aria-label="Clock">
      <button type="button" role="tab" data-mode="alarm">Alarm</button>
      <button type="button" role="tab" data-mode="timer">Timer</button>
      <button type="button" role="tab" data-mode="stopwatch">Stopwatch</button>
    </div>
    <div class="al-view"></div>`;
  const view = p.body.querySelector(".al-view");
  for (const b of p.body.querySelectorAll("[data-mode]")) b.onclick = () => { mode = b.dataset.mode; render(); };

  function render() {
    for (const b of p.body.querySelectorAll("[data-mode]")) {
      b.classList.toggle("on", b.dataset.mode === mode);
      b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    }
    addBtn.hidden = mode !== "alarm";
    if (mode === "alarm") renderAlarms();
    else if (mode === "timer") renderTimer();
    else renderStopwatch();
  }

  function renderAlarms() {
    const n = next();
    const face = '<span class="al-pip"></span>';
    view.innerHTML = `
      <section class="al-next">${face}<div><small>Next alarm</small><strong>${n ? untilText(n.at) : "No alarms on"}</strong>
        <span>${n ? esc(n.time + " · " + (n.alarm.label || "Alarm")) : "Tap + to add one."}</span></div></section>
      <ul class="al-list">${alarms.map((a) => `
        <li class="al-item${a.on ? "" : " off"}">
          <button type="button" class="al-open" data-id="${esc(a.id)}" aria-label="Edit ${esc(fmt(a.h, a.m))} alarm">
            <strong>${esc(fmt(a.h, a.m))}</strong><small>${esc((a.label || "Alarm") + " · " + daysText(a.days))}</small>
          </button>
          <button type="button" class="sw al-sw" role="switch" aria-checked="${a.on}" aria-label="${esc(fmt(a.h, a.m))} alarm on or off" data-id="${esc(a.id)}"><span class="track"></span></button>
        </li>`).join("")}</ul>
      ${alarms.length ? "" : '<p class="tp-empty">No alarms yet.</p>'}
      <p class="al-note">${H().isNativeApp ? "Alarms ring even when Huddle is closed." : "Alarms ring even when Huddle is closed, once notifications are on (Account, Settings)."}</p>`;
    const pf = view.querySelector(".al-pip");
    if (pf && window.Pip) pf.appendChild(window.Pip.face(48));
    for (const b of view.querySelectorAll(".al-open")) b.onclick = () => edit(alarms.find((a) => a.id === b.dataset.id));
    for (const b of view.querySelectorAll(".al-sw")) b.onclick = () => {
      const a = alarms.find((x) => x.id === b.dataset.id);
      if (!a) return;
      a.on = !a.on; save(); renderAlarms();
      if (a.on) { const d = nextAt(a); if (d && window.huddle && window.huddle.toast) window.huddle.toast(untilText(d)); }
    };
  }

  // ---------- Add or change an alarm ----------
  function edit(a) {
    const isNew = !a;
    const now = new Date();
    const draft = a ? { ...a, days: [...(a.days || [])] } : { id: Math.random().toString(36).slice(2, 10), h: (now.getHours() + 1) % 24, m: 0, days: [], label: "", on: true, pip: true };
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop al-wrap";
    wrap.innerHTML = `
      <div class="sheet al-sheet" role="dialog" aria-modal="true" aria-label="${isNew ? "New alarm" : "Edit alarm"}">
        <div class="sheet-grab" aria-hidden="true"></div>
        <h2>${isNew ? "New alarm" : "Edit alarm"}</h2>
        <label class="al-time"><span>Time</span><input type="time" value="${pad(draft.h)}:${pad(draft.m)}" required></label>
        <div class="al-days" role="group" aria-label="Repeat on">${DAY.map((d, i) => `<button type="button" aria-pressed="${draft.days.includes(i)}" aria-label="${DAY_LONG[i]}" data-d="${i}">${d}</button>`).join("")}</div>
        <label class="al-field"><span>Name</span><input class="al-label" maxlength="30" placeholder="Alarm" value="${esc(draft.label)}"></label>
        <label class="al-check"><input type="checkbox" class="al-pipbox" ${draft.pip ? "checked" : ""}> Pip says good morning</label>
        <div class="sheet-actions">
          <button type="button" class="btn primary" data-act="save">Save</button>
          ${isNew ? "" : '<button type="button" class="btn danger-ghost" data-act="delete">Delete</button>'}
          <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    for (const b of wrap.querySelectorAll("[data-d]")) b.onclick = () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    wrap.querySelector('[data-act="cancel"]').onclick = close;
    const del = wrap.querySelector('[data-act="delete"]');
    if (del) del.onclick = () => { alarms = alarms.filter((x) => x.id !== draft.id); save(); close(); renderAlarms(); };
    wrap.querySelector('[data-act="save"]').onclick = () => {
      const [h, m] = (wrap.querySelector('input[type="time"]').value || "").split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;
      Object.assign(draft, {
        h, m, on: true,
        days: [...wrap.querySelectorAll('[data-d][aria-pressed="true"]')].map((b) => Number(b.dataset.d)),
        label: wrap.querySelector(".al-label").value.trim().slice(0, 30),
        pip: wrap.querySelector(".al-pipbox").checked,
      });
      if (isNew) alarms.push(draft); else alarms = alarms.map((x) => (x.id === draft.id ? draft : x));
      alarms.sort((x, y) => x.h * 60 + x.m - (y.h * 60 + y.m));
      save(); close(); renderAlarms();
      const d = nextAt(draft);
      if (d && window.huddle && window.huddle.toast) window.huddle.toast(untilText(d));
    };
  }

  // ---------- Ringing ----------
  let ringing = null;
  function chime(ctx) {
    const t = ctx.currentTime;
    [660, 880, 990].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.18);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.18 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.65);
    });
  }
  function ring({ title, sub, pip, onSnooze }) {
    if (ringing) ringing.stop();
    const el = document.createElement("div");
    el.className = "al-ring";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-label", title);
    el.innerHTML = `<div class="al-ring-pip"></div><strong>${esc(title)}</strong><span>${esc(sub)}</span>
      <div class="al-ring-btns">${onSnooze ? '<button type="button" class="btn" data-act="snooze">Snooze 9 min</button>' : ""}<button type="button" class="btn primary" data-act="stop">Stop</button></div>`;
    document.body.appendChild(el);
    if (window.Pip) el.querySelector(".al-ring-pip").appendChild(window.Pip.face(110));
    let ctx = null, loop = null;
    if (pref("sounds")) try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      chime(ctx);
      loop = setInterval(() => chime(ctx), 2000);
    } catch {}
    if (pref("vibrate")) try { navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]); } catch {}
    if (pip && window.Pip && window.Pip.speak) setTimeout(() => { try { window.Pip.speak(pip); } catch {} }, 1500);
    const stop = () => {
      clearInterval(loop);
      if (ctx) ctx.close().catch(() => {});
      try { navigator.vibrate && navigator.vibrate(0); } catch {}
      try { window.Pip && window.Pip.stopSpeaking && window.Pip.stopSpeaking(); } catch {}
      el.remove();
      ringing = null;
    };
    el.querySelector('[data-act="stop"]').onclick = stop;
    const sn = el.querySelector('[data-act="snooze"]');
    if (sn) sn.onclick = () => { stop(); onSnooze(); };
    // Stops by itself after 10 minutes.
    setTimeout(() => { if (ringing && ringing.el === el) stop(); }, 10 * 60 * 1000);
    ringing = { el, stop };
  }

  const firedAt = new Map(); // alarm id -> "y-m-d h:m" it last rang
  let snoozes = []; // [{ at, alarm }]
  function myFirstName() {
    const u = (window.HuddleAccount && window.HuddleAccount.user) || {};
    return u.display ? u.display.split(" ")[0] : "";
  }
  async function fire(a) {
    if (!(await ringsHere())) return;
    const n = myFirstName();
    ring({
      title: fmt(a.h, a.m),
      sub: a.label || "Alarm",
      pip: a.pip ? (a.h < 12 ? `Good morning${n ? ", " + n : ""}. Time to get up.` : `Hey${n ? " " + n : ""}. It's time${a.label ? " for " + a.label : ""}.`) : null,
      onSnooze: () => { snoozes.push({ at: Date.now() + 9 * 60 * 1000, alarm: a }); },
    });
  }
  function tick() {
    const d = new Date();
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
    let changed = false;
    for (const a of alarms) {
      if (!a.on || a.h !== d.getHours() || a.m !== d.getMinutes()) continue;
      if (a.days && a.days.length && !a.days.includes(d.getDay())) continue;
      if (firedAt.get(a.id) === key) continue;
      firedAt.set(a.id, key);
      if (!a.days || !a.days.length) { a.on = false; changed = true; } // a one-time alarm turns itself off
      fire(a);
    }
    const due = snoozes.filter((s) => s.at <= Date.now());
    if (due.length) { snoozes = snoozes.filter((s) => s.at > Date.now()); fire(due[0].alarm); }
    if (changed) { save(); if (mode === "alarm" && !p.el.hidden) renderAlarms(); }
    timerTick();
  }
  setInterval(tick, 1000);

  // ---------- Timer ----------
  const timer = { left: 5 * 60 * 1000, total: 5 * 60 * 1000, endAt: 0, running: false };
  const clock = (ms, tenths) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + pad(m) : String(m)) + ":" + pad(x) + (tenths ? "." + Math.floor((ms % 1000) / 100) : "");
  };
  function renderTimer() {
    const left = timer.running ? timer.endAt - Date.now() : timer.left;
    view.innerHTML = `
      <div class="al-big" aria-live="off">${clock(left)}</div>
      <div class="al-presets" role="group" aria-label="Quick times">${[1, 3, 5, 10, 15, 30].map((m) => `<button type="button" data-min="${m}">${m} min</button>`).join("")}</div>
      <label class="al-field al-custom"><span>Minutes</span><input type="number" inputmode="numeric" min="1" max="600" value="${Math.round(timer.total / 60000)}"></label>
      <div class="al-ctrls">
        <button type="button" class="btn" data-act="reset">Reset</button>
        <button type="button" class="btn primary" data-act="go">${timer.running ? "Pause" : left < timer.total && left > 0 ? "Resume" : "Start"}</button>
      </div>`;
    const setMin = (m) => { if (timer.running) return; timer.total = timer.left = Math.min(600, Math.max(1, m)) * 60000; renderTimer(); };
    for (const b of view.querySelectorAll("[data-min]")) b.onclick = () => setMin(Number(b.dataset.min));
    view.querySelector(".al-custom input").onchange = (e) => setMin(Number(e.target.value) || 1);
    view.querySelector('[data-act="reset"]').onclick = () => { timer.running = false; timer.left = timer.total; timerChanged(); renderTimer(); };
    view.querySelector('[data-act="go"]').onclick = () => {
      if (timer.running) { timer.left = timer.endAt - Date.now(); timer.running = false; }
      else { if (timer.left <= 0) timer.left = timer.total; timer.endAt = Date.now() + timer.left; timer.running = true; }
      timerChanged();
      renderTimer();
    };
  }
  // A running timer rings with Huddle closed too.
  function timerChanged() { upload({ timer: timer.running ? { at: timer.endAt } : null }); setNative(); }
  function timerTick() {
    if (timer.running && Date.now() >= timer.endAt) {
      timer.running = false; timer.left = timer.total;
      ringsHere().then((yes) => { if (yes) ring({ title: "Time's up", sub: "Timer · " + clock(timer.total), pip: "Your timer is done." }); });
      upload({ timer: null }); setNative();
      if (mode === "timer" && !p.el.hidden) renderTimer();
      return;
    }
    if (mode === "timer" && !p.el.hidden && timer.running) {
      const big = view.querySelector(".al-big");
      if (big) big.textContent = clock(timer.endAt - Date.now());
    }
  }

  // ---------- Stopwatch ----------
  const sw = { start: 0, acc: 0, running: false, laps: [] };
  const swNow = () => sw.acc + (sw.running ? Date.now() - sw.start : 0);
  const swClock = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), c = Math.floor((ms % 1000) / 10); return `${pad(m)}:${pad(s)}.${pad(c)}`; };
  let swRaf = null;
  function renderStopwatch() {
    view.innerHTML = `
      <div class="al-big">${swClock(swNow())}</div>
      <div class="al-ctrls">
        <button type="button" class="btn" data-act="lap">${sw.running ? "Lap" : "Reset"}</button>
        <button type="button" class="btn primary" data-act="go">${sw.running ? "Stop" : swNow() ? "Resume" : "Start"}</button>
      </div>
      <ol class="al-laps">${sw.laps.map((l, i) => `<li><span>Lap ${sw.laps.length - i}</span><b>${swClock(l)}</b></li>`).join("")}</ol>`;
    view.querySelector('[data-act="go"]').onclick = () => {
      if (sw.running) { sw.acc = swNow(); sw.running = false; } else { sw.start = Date.now(); sw.running = true; }
      renderStopwatch();
    };
    view.querySelector('[data-act="lap"]').onclick = () => {
      if (sw.running) sw.laps.unshift(swNow()); else { sw.acc = 0; sw.laps = []; }
      renderStopwatch();
    };
    cancelAnimationFrame(swRaf);
    const big = view.querySelector(".al-big");
    const step = () => {
      if (mode !== "stopwatch" || !big.isConnected) return;
      big.textContent = swClock(swNow());
      if (sw.running) swRaf = requestAnimationFrame(step);
    };
    if (sw.running) swRaf = requestAnimationFrame(step);
  }

  p.onShow = render;
  render();
})();
