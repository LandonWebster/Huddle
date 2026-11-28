// The Alarms tab: alarms, a timer and a stopwatch. When one rings, Pip can say good morning.
// Alarms (and a running timer) are saved with your account too, so they ring even when Huddle
// is closed: the server sends a ringing notification (alarm-server.js), and the Android app
// sets real phone alarms (native AlarmScheduler). Open and on screen, Huddle rings by itself.
//
// Each alarm can have its own song or sound (just a moment of a song, or all of it), vibration,
// alarm screen (a look, or a photo or video), alarm and snooze button colors, a Morning or Night
// routine, and extra alarms every few minutes after it. The parts are in alarm-kit.js.
(() => {
  "use strict";
  const T = window.HuddleTabs;
  const K = window.HuddleAlarmKit;
  if (!T || !K) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "huddle:alarms";
  const load = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
  const save = (fromServer) => {
    try { localStorage.setItem(KEY, JSON.stringify(alarms)); } catch {}
    window.dispatchEvent(new Event("huddle:alarms"));
    if (!fromServer) upload();
    setNative();
  };
  // [{ id, h, m, days: [0..6], label, on, pip, routine, sound, vib, vibStr, screen, color, snoozeColor, more, skipUntil }]
  let alarms = load();

  // ---------- Saved with the account, and as phone alarms in the Android app ----------
  const H = () => window.huddle || {};
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
  const pref = (k) => !window.HuddlePrefs || window.HuddlePrefs.get(k);
  const toast = (m) => { if (H().toast) H().toast(m); };
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

  // An alarm and its extra alarms ("Set more alarms"): the extras are copies a few minutes apart
  // (moved to the next day when they pass midnight). idx 0 is the alarm itself.
  function series(a) {
    const f = K.full(a);
    const out = [{ ...f, base: a.id, idx: 0, count: 0 }];
    const mo = f.more;
    if (!mo || !mo.on) return out;
    const every = Math.max(1, Math.min(60, Math.round(mo.every) || 5)), count = Math.max(1, Math.min(20, Math.round(mo.count) || 1));
    out[0].count = count;
    for (let i = 1; i <= count; i++) {
      const t = f.h * 60 + f.m + i * every, shift = Math.floor(t / 1440);
      out.push({
        ...f, id: a.id + "x" + i, base: a.id, idx: i, count,
        h: Math.floor((t % 1440) / 60), m: t % 60,
        days: (f.days || []).map((d) => (d + shift) % 7),
      });
    }
    return out;
  }

  // The Android app rings alarms itself (a real alarm, with Huddle closed or the phone restarted).
  // Each alarm goes with the phone paths of its song and picture, copied into the app once.
  let nativeRings = false, nativeRun = 0;
  async function setNative() {
    if (!H().isNativeApp || !H().native) return;
    const run = ++nativeRun;
    const on = pref("alarms");
    const list = [];
    if (on) for (const a of alarms) {
      const f = K.full(a), s = f.sound;
      let soundPath = "";
      if (s.kind === "file" && s.file) soundPath = await K.nativePath(s.file.id);
      if (!soundPath && s.tone !== "phone") soundPath = await K.nativePath("tone-" + (s.tone || "chime"));
      const mediaPath = f.screen.kind !== "look" && f.screen.media ? await K.nativePath(f.screen.media.id) : "";
      if (run !== nativeRun) return; // something changed meanwhile; a newer run sends it
      for (const x of series(a)) list.push({
        ...x, soundPath, mediaPath,
        mediaKind: mediaPath ? f.screen.kind : "",
        playFrom: s.kind === "file" && !s.full ? Math.round(Number(s.start) || 0) : 0,
        playTo: s.kind === "file" && !s.full ? Math.round(Number(s.end) || 0) : 0,
        link: s.kind === "app" ? K.appLink(s.app, s.link) : "",
        appName: s.kind === "app" && K.APPS[s.app] ? K.APPS[s.app].name : "",
        vibPattern: K.vibPattern(f.vib, f.vibStr),
        lookColors: lookColors(f),
      });
    }
    H().native("setAlarms", {
      alarms: list,
      timer: on && timer.running ? timer.endAt : 0,
      name: myFirstName(),
      sound: pref("sounds"), vibrate: pref("vibrate"),
    }).then(() => { nativeRings = true; }).catch(() => { nativeRings = false; });
  }
  // The colors for the phone's own alarm screen (top to bottom) for each look.
  function lookColors(f) {
    const c = f.color;
    return ({ glow: ["#07080c", c, "#07080c"], sunrise: ["#1b1d4a", c, "#f97316"], night: ["#05060f", "#05060f", c], ocean: ["#031427", c, "#22d3ee"], plain: [c, c, c] })[f.screen.look] || ["#07080c", c, "#07080c"];
  }
  window.addEventListener("huddle:signedin", download);
  window.addEventListener("huddle:signed-in", download);
  window.addEventListener("huddle:alarms-changed", download);
  window.addEventListener("huddle:prefs", () => setNative());
  // Ring here, or leave it to the notification / phone alarm? Here only when Huddle is on screen
  // (the notification is skipped then) or nothing else can ring.
  async function ringsHere() {
    if (!pref("alarms")) return false;
    if (window.huddleQuiet) return false; // on a quiet 911 call
    if (nativeRings) return false;
    if (!document.hidden) return true;
    try { return !window.huddleNotify || (await window.huddleNotify.state()) !== "on"; } catch { return true; }
  }
  const DAY = ["S", "M", "T", "W", "T", "F", "S"];
  const DAY_LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (h, m) => new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtMin = (t) => fmt(Math.floor((((t % 1440) + 1440) % 1440) / 60), ((t % 60) + 60) % 60);
  const mmss = (s) => Math.floor(s / 60) + ":" + pad(Math.floor(s % 60));
  function daysText(d) {
    if (!d || !d.length) return "Once";
    const s = [...d].sort().join("");
    if (s === "0123456") return "Every day";
    if (s === "12345") return "Mon to Fri";
    if (s === "06") return "Weekends";
    return [...d].sort().map((i) => DAY_LONG[i]).join(", ");
  }
  // When one alarm (not its extras) rings next (a Date), or null when it's off.
  function nextAt(a, from = new Date()) {
    if (!a.on) return null;
    for (let i = 0; i < 8; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, a.h, a.m, 0, 0);
      if (d <= from) continue;
      if (a.skipUntil && d.getTime() < a.skipUntil) continue;
      if (!a.days || !a.days.length || a.days.includes(d.getDay())) return d;
    }
    return null;
  }
  function next() {
    let best = null;
    for (const a of alarms) for (const x of series(a)) { const d = nextAt(x); if (d && (!best || d < best.at)) best = { at: d, alarm: x }; }
    return best && { at: best.at, time: fmt(best.at.getHours(), best.at.getMinutes()), alarm: best.alarm };
  }
  function untilText(d) {
    const mins = Math.max(1, Math.round((d - Date.now()) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return "Rings in " + (h ? `${h} hr ` : "") + (m || !h ? `${m} min` : "").trim();
  }
  window.HuddleAlarms = { next };

  const ROUTINES = {
    none: { name: "None", hint: "Just an alarm." },
    morning: { name: "Morning", hint: "Morning routine: Pip says good morning when it rings." },
    night: { name: "Night", hint: "Night routine: Pip reminds you it's time to wind down for bed." },
  };
  function soundText(f) {
    const s = f.sound;
    const tone = (s.tone === "phone" ? K.PHONE_TONE : K.TONES.find((t) => t.id === s.tone) || K.TONES[0]).name;
    if (s.kind === "app" && K.APPS[s.app]) return `${tone}, then opens ${K.APPS[s.app].name}`;
    if (s.kind === "file" && s.file) return s.file.name + (s.full ? " · full song" : ` · ${mmss(s.start)} to ${mmss(s.end)}`);
    return tone;
  }
  const vibText = (f) => (K.VIBS.find((v) => v.id === f.vib) || K.VIBS[2]).name;
  function screenText(f) {
    if (f.screen.kind !== "look" && f.screen.media) return (f.screen.kind === "video" ? "Your video · " : "Your photo · ") + f.screen.media.name;
    return (K.LOOKS.find((l) => l.id === f.screen.look) || K.LOOKS[0]).name;
  }

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
      <ul class="al-list">${alarms.map((a) => {
        const f = K.full(a);
        const tag = f.routine !== "none" ? `<span class="al-tag" style="background:${esc(f.color)}">${ROUTINES[f.routine] ? ROUTINES[f.routine].name : ""}</span>` : "";
        const extra = f.more.on ? ` · +${f.more.count} every ${f.more.every} min` : "";
        return `
        <li class="al-item${a.on ? "" : " off"}">
          <button type="button" class="al-open" data-id="${esc(a.id)}" aria-label="Edit ${esc(fmt(a.h, a.m))} alarm">
            <strong>${esc(fmt(a.h, a.m))}</strong><small>${tag}${esc((a.label || "Alarm") + " · " + daysText(a.days) + extra)}</small>
          </button>
          <button type="button" class="sw al-sw" role="switch" aria-checked="${a.on}" aria-label="${esc(fmt(a.h, a.m))} alarm on or off" data-id="${esc(a.id)}"><span class="track"></span></button>
        </li>`;
      }).join("")}</ul>
      ${alarms.length ? "" : '<p class="tp-empty">No alarms yet.</p>'}
      <p class="al-note">${H().isNativeApp ? "Alarms ring even when Huddle is closed." : "Alarms ring even when Huddle is closed, once notifications are on (Account, Settings)."}</p>`;
    const pf = view.querySelector(".al-pip");
    if (pf && window.Pip) pf.appendChild(window.Pip.face(48));
    for (const b of view.querySelectorAll(".al-open")) b.onclick = () => edit(alarms.find((a) => a.id === b.dataset.id));
    for (const b of view.querySelectorAll(".al-sw")) b.onclick = () => {
      const a = alarms.find((x) => x.id === b.dataset.id);
      if (!a) return;
      a.on = !a.on; delete a.skipUntil; save(); renderAlarms();
      if (a.on) { const d = nextAt(a); if (d) toast(untilText(d)); }
    };
  }

  // ---------- Add or change an alarm ----------
  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    vib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M3 8v8M21 8v8"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    color: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
    snooze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h6l-6 7h6M14 11h6l-6 7h6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };
  const row = (page, ic, title, sum, dot) => `<button type="button" class="al-row" data-page="${page}"><span class="ic">${ICON[ic]}</span><span class="t"><b>${title}</b><small data-sum="${page}">${esc(sum)}</small></span>${dot ? `<span class="dot" data-dot="${page}"></span>` : ""}${ICON.chev}</button>`;
  const top = (title) => `<div class="al-top"><button type="button" class="al-back" aria-label="Back">${ICON.back}</button><h2>${title}</h2></div>`;

  function edit(a) {
    const isNew = !a;
    const now = new Date();
    const d = K.full(a ? JSON.parse(JSON.stringify(a)) : { id: Math.random().toString(36).slice(2, 10), h: (now.getHours() + 1) % 24, m: 0, days: [], label: "", on: true, pip: true });
    d.days = [...(d.days || [])];
    if (isNew && H().isNativeApp) d.sound.tone = "phone";
    let preview = null, vibing = null; // the sound / vibration being tried out
    const stopTry = () => { if (preview) { preview.stop(); preview = null; } if (vibing) { vibing.stop(); vibing = null; } const pb = wrap.querySelector(".al-play"); if (pb) pb.textContent = "Play preview"; };

    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop al-wrap";
    wrap.innerHTML = `
      <div class="sheet al-sheet al-ed" role="dialog" aria-modal="true" aria-label="${isNew ? "New alarm" : "Edit alarm"}">
        <section class="al-page" data-p="main">
          <div class="sheet-grab" aria-hidden="true"></div>
          <h2>${isNew ? "New alarm" : "Edit alarm"}</h2>
          <label class="al-time"><input type="time" value="${pad(d.h)}:${pad(d.m)}" required aria-label="Alarm time"></label>
          <div class="al-box">
            <b>Repeat on</b>
            <div class="al-days" role="group" aria-label="Repeat on">${DAY.map((x, i) => `<button type="button" aria-pressed="${d.days.includes(i)}" aria-label="${DAY_LONG[i]}" data-d="${i}">${x}</button>`).join("")}</div>
            <p class="al-hint al-days-txt"></p>
          </div>
          <label class="al-field"><span>Name</span><input class="al-label" maxlength="30" placeholder="Alarm" value="${esc(d.label)}"></label>
          <div class="al-box">
            <b>Routine</b>
            <div class="seg al-routine" role="group" aria-label="Routine">${Object.entries(ROUTINES).map(([k, r]) => `<button type="button" data-r="${k}">${r.name}</button>`).join("")}</div>
            <p class="al-hint al-routine-txt"></p>
          </div>
          <div class="al-rows">
            ${row("sound", "sound", "Sound", soundText(d))}
            ${row("vib", "vib", "Vibration", vibText(d))}
            ${row("screen", "screen", "Alarm screen", screenText(d))}
            ${row("color", "color", "Alarm color", d.color.toUpperCase(), true)}
            ${row("snooze", "snooze", "Snooze button", d.snoozeColor.toUpperCase(), true)}
          </div>
          <label class="al-check"><input type="checkbox" class="al-pipbox" ${d.pip ? "checked" : ""}> Pip talks when it rings</label>
          <div class="al-box">
            <div class="al-line"><b style="color:var(--text)">Set more alarms</b><button type="button" class="sw al-more-sw" role="switch" aria-checked="${d.more.on}" aria-label="Set more alarms"><span class="track"></span></button></div>
            <div class="al-more" ${d.more.on ? "" : "hidden"}>
              <div class="al-line"><span>Every</span><div class="al-step"><button type="button" data-k="every" data-by="-1" aria-label="Fewer minutes">−</button><output data-o="every"></output><button type="button" data-k="every" data-by="1" aria-label="More minutes">+</button><small>min</small></div></div>
              <div class="al-line"><span>Extra alarms</span><div class="al-step"><button type="button" data-k="count" data-by="-1" aria-label="Fewer alarms">−</button><output data-o="count"></output><button type="button" data-k="count" data-by="1" aria-label="More alarms">+</button></div></div>
              <div class="al-last">Last alarm goes off at <strong class="al-last-t"></strong></div>
              <div class="al-times"></div>
            </div>
          </div>
          <div class="sheet-actions">
            <button type="button" class="btn primary" data-act="save">Save</button>
            ${isNew ? "" : '<button type="button" class="btn danger-ghost" data-act="delete">Delete</button>'}
            <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
          </div>
        </section>

        <section class="al-page sub" data-p="sound" aria-label="Sound">
          ${top("Sound")}
          <button type="button" class="al-pick" data-pick="song">${ICON.plus} Choose a song from your phone</button>
          <input type="file" accept="audio/*" class="al-file-song" hidden>
          <div class="al-box al-songbox"></div>
          <div class="al-box"><b class="al-tones-cap">Huddle sounds</b><div class="al-tones"></div></div>
          <div class="al-box">
            <b>From a music app</b>
            <div class="al-apps">${Object.entries(K.APPS).map(([k, x]) => `<button type="button" class="al-opt" data-app="${k}">${x.name}<small>Opens when you turn it off</small></button>`).join("")}</div>
            <input class="al-link" type="url" inputmode="url" placeholder="Paste the song's share link (optional)" aria-label="Song link" hidden>
            <p class="al-hint">Spotify, Apple Music and YouTube don't let other apps play their songs as an alarm. So Huddle rings with the Huddle sound you pick above, then opens your song in that app as soon as you turn the alarm off.</p>
          </div>
          <div class="al-box">
            <label class="al-range">Volume<input type="range" class="al-vol" min="5" max="100" value="${d.sound.vol}"></label>
            <div class="al-line"><span>Start quiet, get louder</span><button type="button" class="sw al-ramp" role="switch" aria-checked="${d.sound.ramp}" aria-label="Start quiet, get louder"><span class="track"></span></button></div>
            ${H().isNativeApp ? "" : '<p class="al-hint">With Huddle closed, a computer or iPhone rings with its notification sound instead.</p>'}
          </div>
        </section>

        <section class="al-page sub" data-p="vib" aria-label="Vibration">
          ${top("Vibration")}
          <div class="al-box al-vibs"></div>
          <div class="al-box">
            <label class="al-range">Strength<input type="range" class="al-vibstr" min="1" max="3" value="${d.vibStr}"></label>
            <p class="al-hint">Tap a pattern to feel it (on phones that can vibrate).</p>
          </div>
        </section>

        <section class="al-page sub" data-p="screen" aria-label="Alarm screen">
          ${top("Alarm screen")}
          <div class="al-mini"></div>
          <button type="button" class="al-pick" data-pick="pic">${ICON.plus} Choose a photo or video from your phone</button>
          <input type="file" accept="image/*,video/*" class="al-file-pic" hidden>
          <div class="al-box"><b>Pick a look</b><div class="al-looks"></div><p class="al-hint">Videos play muted, on repeat, behind the alarm.</p></div>
          <div class="al-box"><div class="al-line"><span>Darken so the time is easy to read</span><button type="button" class="sw al-shade-sw" role="switch" aria-checked="${d.screen.shade}" aria-label="Darken the picture"><span class="track"></span></button></div></div>
        </section>

        <section class="al-page sub" data-p="color" aria-label="Alarm color">
          ${top("Alarm color")}
          <div class="al-mini"></div>
          <div class="al-box al-wheel-alarm"></div>
          <button type="button" class="btn primary al-done">Done</button>
        </section>

        <section class="al-page sub" data-p="snooze" aria-label="Snooze button color">
          ${top("Snooze button color")}
          <div class="al-mini"></div>
          <div class="al-box al-wheel-snooze"></div>
          <button type="button" class="btn primary al-done">Done</button>
        </section>
      </div>`;
    document.body.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    const $$ = (s) => wrap.querySelectorAll(s);
    const close = () => { stopTry(); wrap.remove(); };
    wrap.onclick = (e) => { if (e.target === wrap) close(); };

    // Pages
    let open = null;
    const show = (name) => {
      open = wrap.querySelector(`[data-p="${name}"]`);
      open.classList.add("open");
      open.scrollTop = 0;
      if (name === "sound") { paintSong(); }
      if (name === "screen" || name === "color" || name === "snooze") paintMini();
      if (name === "color" && !$(".al-wheel-alarm").childElementCount) K.colorWheel($(".al-wheel-alarm"), d.color, (c) => { d.color = c; paintSums(); paintMini(); paintLooks(); });
      if (name === "snooze" && !$(".al-wheel-snooze").childElementCount) K.colorWheel($(".al-wheel-snooze"), d.snoozeColor, (c) => { d.snoozeColor = c; paintSums(); paintMini(); });
      setTimeout(() => { const b = open && open.querySelector(".al-back"); if (b) b.focus({ preventScroll: true }); }, 300);
    };
    // The sheet itself never scrolls sideways (focus moving into a sliding page could do that).
    $(".al-ed").addEventListener("scroll", (e) => { if (e.target.scrollLeft) e.target.scrollLeft = 0; });
    const back = () => { stopTry(); if (open) open.classList.remove("open"); open = null; paintSums(); };
    for (const b of $$("[data-page]")) b.onclick = () => show(b.dataset.page);
    for (const b of $$(".al-back, .al-done")) b.onclick = back;
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (open) back(); else close(); } });

    function paintSums() {
      const set = (k, v) => { const el = wrap.querySelector(`[data-sum="${k}"]`); if (el) el.textContent = v; };
      set("sound", soundText(d)); set("vib", vibText(d)); set("screen", screenText(d));
      set("color", d.color.toUpperCase()); set("snooze", d.snoozeColor.toUpperCase());
      wrap.querySelector('[data-dot="color"]').style.background = d.color;
      wrap.querySelector('[data-dot="snooze"]').style.background = d.snoozeColor;
    }

    // Days: tap one, or drag across several. The first day touched decides on or off.
    const daysEl = $(".al-days");
    const paintDays = () => {
      for (const b of daysEl.children) b.setAttribute("aria-pressed", String(d.days.includes(Number(b.dataset.d))));
      $(".al-days-txt").textContent = d.days.length ? daysText(d.days) : "Once. Drag across the days to pick several at once.";
    };
    const setDay = (i, on) => { d.days = d.days.filter((x) => x !== i); if (on) d.days.push(i); d.days.sort(); paintDays(); };
    let dragOn = null;
    const dayAt = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && el.closest && el.closest("[data-d]"); return b && b.parentElement === daysEl ? Number(b.dataset.d) : null; };
    daysEl.addEventListener("pointerdown", (e) => { const i = dayAt(e); if (i == null) return; dragOn = !d.days.includes(i); setDay(i, dragOn); e.preventDefault(); });
    const onMove = (e) => { if (dragOn == null) return; const i = dayAt(e); if (i != null) setDay(i, dragOn); };
    const onUp = () => { dragOn = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    daysEl.addEventListener("click", (e) => { if (e.detail !== 0) return; const b = e.target.closest("[data-d]"); if (b) { const i = Number(b.dataset.d); setDay(i, !d.days.includes(i)); } }); // keyboard
    new MutationObserver((_, obs) => { if (!wrap.isConnected) { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); obs.disconnect(); } }).observe(document.body, { childList: true });
    paintDays();

    // Routine
    const paintRoutine = () => {
      for (const b of $$("[data-r]")) b.classList.toggle("on", b.dataset.r === d.routine);
      $(".al-routine-txt").textContent = (ROUTINES[d.routine] || ROUTINES.none).hint;
    };
    for (const b of $$("[data-r]")) b.onclick = () => { d.routine = b.dataset.r; paintRoutine(); paintMini(); };
    paintRoutine();

    // Sound
    const tones = H().isNativeApp ? [K.PHONE_TONE, ...K.TONES] : K.TONES;
    $(".al-tones").innerHTML = tones.map((t) => `<button type="button" class="al-opt" data-tone="${t.id}">${esc(t.name)}${t.id === "phone" ? "<small>Android's alarm</small>" : ""}</button>`).join("");
    let songDur = (d.sound.file && d.sound.file.dur) || 0, peaks = null;
    function paintSound() {
      const s = d.sound;
      for (const b of $$("[data-tone]")) b.classList.toggle("on", b.dataset.tone === s.tone && s.kind !== "file");
      for (const b of $$("[data-app]")) b.classList.toggle("on", s.kind === "app" && b.dataset.app === s.app);
      $(".al-link").hidden = s.kind !== "app";
      $(".al-tones-cap").textContent = s.kind === "app" ? "Rings with" : "Huddle sounds";
      paintSums();
    }
    async function paintSong() {
      const s = d.sound, box = $(".al-songbox");
      if (s.kind !== "file" || !s.file) { box.hidden = true; paintSound(); return; }
      box.hidden = false;
      const here = !!(await K.media.get(s.file.id));
      const dur = Math.max(5, songDur || s.file.dur || 180);
      s.end = Math.min(Math.max(Number(s.end) || 30, 1), dur);
      s.start = Math.min(Math.max(0, Number(s.start) || 0), s.end - 1);
      box.innerHTML = `
        <b>${esc(s.file.name)}</b>
        ${here ? "" : '<p class="al-warn">This song isn\'t on this device. Choose it again here, or a Huddle sound plays instead.</p>'}
        <div class="al-chips al-part"><button type="button" data-part="moment">Just a moment</button><button type="button" data-part="full">Full song</button></div>
        <div class="al-wave" aria-hidden="true"><canvas></canvas><div class="al-clip"></div></div>
        <div class="al-ranges" ${s.full ? "hidden" : ""}>
          <label class="al-range">Start <span class="al-st"></span><input type="range" class="al-s" min="0" max="${Math.floor(dur)}" value="${Math.floor(s.start)}"></label>
          <label class="al-range">End <span class="al-en"></span><input type="range" class="al-e" min="0" max="${Math.floor(dur)}" value="${Math.floor(s.end)}"></label>
        </div>
        <button type="button" class="btn al-play">Play preview</button>`;
      const clip = () => {
        let a0 = Number(box.querySelector(".al-s").value), a1 = Number(box.querySelector(".al-e").value);
        if (a1 <= a0) { a1 = Math.min(dur, a0 + 3); box.querySelector(".al-e").value = a1; }
        s.start = a0; s.end = a1;
        const f0 = s.full ? 0 : a0, f1 = s.full ? dur : a1;
        box.querySelector(".al-st").textContent = mmss(a0);
        box.querySelector(".al-en").textContent = mmss(a1) + ` (${a1 - a0} sec)`;
        const c = box.querySelector(".al-clip");
        c.style.left = (f0 / dur) * 100 + "%"; c.style.width = ((f1 - f0) / dur) * 100 + "%";
        for (const b of box.querySelectorAll("[data-part]")) b.classList.toggle("on", (b.dataset.part === "full") === !!s.full);
        box.querySelector(".al-ranges").hidden = !!s.full;
        paintSums();
      };
      box.querySelector(".al-s").oninput = () => { if (preview) stopTry(); clip(); };
      box.querySelector(".al-e").oninput = () => { if (preview) stopTry(); clip(); };
      for (const b of box.querySelectorAll("[data-part]")) b.onclick = () => { s.full = b.dataset.part === "full"; stopTry(); clip(); };
      box.querySelector(".al-play").onclick = () => {
        if (preview) return stopTry();
        preview = K.play(s, { preview: true, maxMs: s.full ? 20000 : Math.min(20, s.end - s.start) * 1000 + 50 });
        box.querySelector(".al-play").textContent = "Stop";
        setTimeout(() => { const pb = box.querySelector(".al-play"); if (pb) pb.textContent = "Play preview"; preview = null; }, s.full ? 20000 : Math.min(20, s.end - s.start) * 1000 + 60);
      };
      clip();
      drawWave(box.querySelector("canvas"), s.file.id);
      paintSound();
    }
    async function drawWave(cv, id) {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      cv.width = Math.round(r.width * 2); cv.height = Math.round(r.height * 2);
      const g = cv.getContext("2d");
      const bars = Math.floor(cv.width / 6);
      if (!peaks || peaks.id !== id) {
        peaks = { id, v: null };
        try {
          const m = await K.media.get(id);
          if (m && m.blob && m.blob.size < 40 * 1024 * 1024) {
            const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 22050);
            const buf = await ctx.decodeAudioData(await m.blob.arrayBuffer());
            const ch = buf.getChannelData(0), step = Math.floor(ch.length / bars), v = [];
            for (let i = 0; i < bars; i++) { let mx = 0; for (let j = i * step; j < (i + 1) * step; j += 50) mx = Math.max(mx, Math.abs(ch[j] || 0)); v.push(mx); }
            const top = Math.max(...v, 0.01);
            peaks.v = v.map((x) => x / top);
          }
        } catch {}
      }
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#5b6190";
      for (let i = 0; i < bars; i++) {
        const v = peaks.v ? peaks.v[Math.floor((i / bars) * peaks.v.length)] : Math.abs(Math.sin(i * 0.13) * Math.cos(i * 0.041)) * 0.8 + 0.15;
        const h = Math.max(2, v * cv.height * 0.9);
        g.fillRect(i * 6, (cv.height - h) / 2, 3, h);
      }
    }
    for (const b of $$("[data-tone]")) b.onclick = () => {
      stopTry();
      d.sound.tone = b.dataset.tone;
      if (d.sound.kind === "file") d.sound.kind = "tone";
      paintSong();
      if (b.dataset.tone !== "phone") { preview = K.play({ ...d.sound, kind: "tone" }, { preview: true, maxMs: 4000 }); }
    };
    for (const b of $$("[data-app]")) b.onclick = () => {
      stopTry();
      if (d.sound.kind === "app" && d.sound.app === b.dataset.app) { d.sound.kind = "tone"; }
      else { d.sound.kind = "app"; d.sound.app = b.dataset.app; }
      paintSong();
    };
    $(".al-link").value = d.sound.link || "";
    $(".al-link").oninput = (e) => { d.sound.link = e.target.value.trim().slice(0, 300); };
    $(".al-vol").oninput = (e) => { d.sound.vol = Number(e.target.value); };
    const sw = (el, fn) => { el.onclick = () => { const v = el.getAttribute("aria-checked") !== "true"; el.setAttribute("aria-checked", String(v)); fn(v); }; };
    sw($(".al-ramp"), (v) => { d.sound.ramp = v; });
    $('[data-pick="song"]').onclick = () => $(".al-file-song").click();
    $(".al-file-song").onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      stopTry();
      try {
        toast("Adding your song…");
        const info = await K.media.addSong(file);
        songDur = info.dur; peaks = null;
        const st = info.dur > 60 ? Math.floor(info.dur * 0.25) : 0;
        Object.assign(d.sound, { kind: "file", file: info, start: st, end: Math.min(info.dur || 30, st + 30), full: false });
        paintSong();
      } catch (err) { toast(err.message || "Couldn't add that song"); }
    };
    paintSound();

    // Vibration
    function paintVibs() {
      $(".al-vibs").innerHTML = K.VIBS.map((v) => {
        const bars = v.p.filter((_, i) => i % 2 === 0).slice(0, 9).map((ms) => `<i style="height:${Math.min(20, 4 + ms / 45)}px;width:${Math.min(14, 3 + ms / 80)}px"></i>`).join("");
        return `<button type="button" class="al-opt${v.id === d.vib ? " on" : ""}" data-vib="${v.id}">${v.name}<span class="bars" aria-hidden="true">${bars || '<small>None</small>'}</span></button>`;
      }).join("");
      for (const b of $$("[data-vib]")) b.onclick = () => {
        d.vib = b.dataset.vib;
        paintVibs(); paintSums();
        stopTry();
        vibing = K.vibrate(d.vib, d.vibStr, true);
        const v = K.VIBS.find((x) => x.id === d.vib);
        if (v && v.p.length) { const sh = $(".al-ed"); sh.classList.add("al-shake"); setTimeout(() => sh.classList.remove("al-shake"), Math.min(1400, v.p.reduce((x, y) => x + y, 0))); }
      };
    }
    $(".al-vibstr").oninput = (e) => { d.vibStr = Number(e.target.value); };
    paintVibs();

    // Alarm screen
    let mediaUrl = null;
    async function loadMedia() { mediaUrl = d.screen.media ? await K.media.url(d.screen.media.id) : null; paintLooks(); paintMini(); }
    function paintLooks() {
      const box = $(".al-looks");
      const mine = d.screen.media && mediaUrl
        ? `<button type="button" data-look="mine" class="${d.screen.kind !== "look" ? "on" : ""}">${d.screen.media.kind === "video" ? `<video src="${mediaUrl}" muted loop autoplay playsinline></video>` : `<img src="${mediaUrl}" alt="">`}<span>${d.screen.media.kind === "video" ? "Your video" : "Your photo"}</span></button>`
        : "";
      box.innerHTML = mine + K.LOOKS.map((l) => `<button type="button" data-look="${l.id}" class="${d.screen.kind === "look" && d.screen.look === l.id ? "on" : ""}" style="background:${l.css(d.color)}"><span>${l.name}</span></button>`).join("");
      for (const b of box.querySelectorAll("[data-look]")) b.onclick = () => {
        if (b.dataset.look === "mine") d.screen.kind = d.screen.media.kind;
        else { d.screen.kind = "look"; d.screen.look = b.dataset.look; }
        paintLooks(); paintMini(); paintSums();
      };
      if (d.screen.kind !== "look" && d.screen.media && !mediaUrl) {
        box.insertAdjacentHTML("afterbegin", '<p class="al-warn" style="grid-column:1/-1">Your picture isn\'t on this device. Choose it again here, or the Glow look shows instead.</p>');
      }
    }
    function paintMini() {
      for (const m of $$(".al-mini")) {
        const pic = d.screen.kind !== "look" && mediaUrl;
        const look = K.LOOKS.find((l) => l.id === d.screen.look) || K.LOOKS[0];
        m.innerHTML = `<div class="bg" style="background:${pic ? "#000" : look.css(d.color)}">${pic ? (d.screen.kind === "video" ? `<video src="${mediaUrl}" muted loop autoplay playsinline></video>` : `<img src="${mediaUrl}" alt="">`) : ""}</div>
          ${d.screen.shade ? '<div class="shade"></div>' : ""}
          <small>${esc(d.routine !== "none" ? ROUTINES[d.routine].name + " routine" : "")}</small>
          <b>${esc(fmt(d.h, d.m).replace(/\s?[AP]M$/i, ""))}</b><small>${esc(d.label || "Alarm")}</small>
          <i class="sn" style="background:${d.snoozeColor}"></i><i class="off"></i>`;
        m.setAttribute("aria-label", "Preview of the alarm screen");
      }
    }
    $('[data-pick="pic"]').onclick = () => $(".al-file-pic").click();
    $(".al-file-pic").onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        toast("Adding your " + (/^video\//.test(file.type) ? "video…" : "photo…"));
        const info = await K.media.addPicture(file);
        d.screen.media = info; d.screen.kind = info.kind;
        await loadMedia(); paintSums();
      } catch (err) { toast(err.message || "Couldn't add that"); }
    };
    sw($(".al-shade-sw"), (v) => { d.screen.shade = v; paintMini(); });
    loadMedia();

    // Set more alarms
    function paintMore() {
      const [h, m] = ($('input[type="time"]').value || `${pad(d.h)}:${pad(d.m)}`).split(":").map(Number);
      d.h = Number.isFinite(h) ? h : d.h; d.m = Number.isFinite(m) ? m : d.m;
      wrap.querySelector('[data-o="every"]').textContent = d.more.every;
      wrap.querySelector('[data-o="count"]').textContent = d.more.count;
      const base = d.h * 60 + d.m;
      const times = Array.from({ length: d.more.count + 1 }, (_, i) => fmtMin(base + i * d.more.every));
      $(".al-last-t").textContent = times[times.length - 1];
      $(".al-times").innerHTML = times.map((t) => `<span>${esc(t)}</span>`).join("");
    }
    for (const b of $$("[data-k]")) b.onclick = () => {
      const k = b.dataset.k, lim = k === "every" ? [1, 60] : [1, 20];
      d.more[k] = Math.max(lim[0], Math.min(lim[1], d.more[k] + Number(b.dataset.by)));
      paintMore();
    };
    sw($(".al-more-sw"), (v) => { d.more.on = v; $(".al-more").hidden = !v; paintMore(); });
    $('input[type="time"]').oninput = () => { paintMore(); paintMini(); };
    paintMore();
    paintSums();

    // Save
    $('[data-act="cancel"]').onclick = close;
    const del = $('[data-act="delete"]');
    if (del) del.onclick = () => { alarms = alarms.filter((x) => x.id !== d.id); save(); K.media.prune(alarms); close(); renderAlarms(); };
    $('[data-act="save"]').onclick = () => {
      const [h, m] = ($('input[type="time"]').value || "").split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;
      Object.assign(d, {
        h, m, on: true,
        label: $(".al-label").value.trim().slice(0, 30),
        pip: $(".al-pipbox").checked,
      });
      delete d.skipUntil;
      if (d.sound.kind === "app" && !K.APPS[d.sound.app]) d.sound.kind = "tone";
      if (isNew) alarms.push(d); else alarms = alarms.map((x) => (x.id === d.id ? d : x));
      alarms.sort((x, y) => x.h * 60 + x.m - (y.h * 60 + y.m));
      save(); K.media.prune(alarms); close(); renderAlarms();
      const at = nextAt(d);
      if (at) toast(untilText(at));
    };
  }

  // ---------- Ringing ----------
  let ringing = null;
  // a: the alarm (with its sound, look and colors), or nothing for the timer.
  function ring({ title, sub, pip, onSnooze, alarm }) {
    if (ringing) ringing.stop();
    const f = K.full(alarm || {});
    const el = document.createElement("div");
    el.className = "al-ring";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-label", title);
    const look = K.LOOKS.find((l) => l.id === f.screen.look) || K.LOOKS[0];
    const later = alarm && alarm.count ? alarm.count - alarm.idx : 0; // extra alarms still to come
    const s = f.sound;
    const nowLine = alarm ? (s.kind === "file" && s.file ? "♪ " + s.file.name : s.kind === "app" && K.APPS[s.app] ? `Opens ${K.APPS[s.app].name} when you turn it off` : "") : "";
    el.innerHTML = `<div class="al-bg" style="background:${alarm ? look.css(f.color) : ""}"></div>${alarm && f.screen.shade ? '<div class="al-shade"></div>' : ""}
      ${alarm && f.routine !== "none" ? `<span class="al-rtag" style="background:${esc(f.color)}">${f.routine === "night" ? "Night routine" : "Morning routine"}</span>` : ""}
      <div class="al-ring-pip"></div><strong>${esc(title)}</strong><span class="al-sub">${esc(sub)}</span>
      ${nowLine ? `<div class="al-now">${esc(nowLine)}</div>` : ""}
      <div class="al-ring-btns">${onSnooze ? `<button type="button" class="btn" data-act="snooze" style="background:${esc(f.snoozeColor)}">Snooze 9 min</button>` : ""}<button type="button" class="btn ${alarm ? "al-off" : "primary"}" data-act="stop">Turn off</button></div>
      ${later > 0 ? `<button type="button" class="al-skip" data-act="skip">Skip the other ${later} alarm${later === 1 ? "" : "s"}</button>` : ""}`;
    document.body.appendChild(el);
    if (window.Pip && !(alarm && f.screen.kind !== "look")) el.querySelector(".al-ring-pip").appendChild(window.Pip.face(110));
    if (alarm && f.screen.kind !== "look" && f.screen.media) {
      K.media.url(f.screen.media.id).then((u) => {
        if (!u || !el.isConnected) return;
        const bg = el.querySelector(".al-bg");
        bg.style.background = "#000";
        bg.innerHTML = f.screen.kind === "video" ? `<video src="${u}" muted loop autoplay playsinline></video>` : `<img src="${u}" alt="">`;
      });
    }
    const sound = pref("sounds") ? K.play(alarm ? s : { kind: "tone", tone: "chime", vol: 80, ramp: false }) : null;
    const vib = pref("vibrate") ? K.vibrate(alarm ? f.vib : "pulse", f.vibStr) : null;
    if (pip && window.Pip && window.Pip.speak) setTimeout(() => { try { window.Pip.speak(pip); } catch {} }, 1500);
    const stop = () => {
      // Stops it ringing on this person's other devices too (and the iPhone repeats).
      if (token()) fetch("/api/alarms/hush", { method: "POST", headers: { authorization: "Bearer " + token() } }).catch(() => {});
      if (sound) sound.stop();
      if (vib) vib.stop();
      try { window.Pip && window.Pip.stopSpeaking && window.Pip.stopSpeaking(); } catch {}
      el.remove();
      ringing = null;
    };
    el.querySelector('[data-act="stop"]').onclick = () => {
      stop();
      if (alarm && s.kind === "app") K.openUrl(K.appLink(s.app, s.link));
    };
    const sn = el.querySelector('[data-act="snooze"]');
    if (sn) sn.onclick = () => { stop(); onSnooze(); };
    const sk = el.querySelector('[data-act="skip"]');
    if (sk) sk.onclick = () => {
      stop();
      const a = alarms.find((x) => x.id === alarm.base);
      if (a) {
        const f2 = K.full(a);
        a.skipUntil = Date.now() + later * f2.more.every * 60000 + 60000;
        if (!a.days || !a.days.length) a.on = false;
        save();
        if (mode === "alarm" && !p.el.hidden) renderAlarms();
      }
      toast("Skipped the rest of this alarm's extra alarms");
    };
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
  function pipLine(a) {
    const n = myFirstName();
    if (a.routine === "morning") return `Good morning${n ? ", " + n : ""}. Time to get up and start your day.`;
    if (a.routine === "night") return `Hey${n ? " " + n : ""}. It's time to start winding down for bed.`;
    return a.h < 12 ? `Good morning${n ? ", " + n : ""}. Time to get up.` : `Hey${n ? " " + n : ""}. It's time${a.label ? " for " + a.label : ""}.`;
  }
  async function fire(a, snoozed) {
    if (!(await ringsHere())) return;
    ring({
      title: fmt(a.h, a.m),
      sub: (a.label || "Alarm") + (snoozed ? " (snoozed)" : a.idx ? ` (extra alarm ${a.idx} of ${a.count})` : ""),
      pip: a.pip ? pipLine(a) : null,
      alarm: a,
      onSnooze: () => { snoozes.push({ at: Date.now() + 9 * 60 * 1000, alarm: a }); },
    });
  }
  function tick() {
    const d = new Date();
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
    let changed = false;
    for (const base of alarms) {
      if (!base.on) continue;
      for (const a of series(base)) {
        if (a.h !== d.getHours() || a.m !== d.getMinutes()) continue;
        if (a.days && a.days.length && !a.days.includes(d.getDay())) continue;
        if (base.skipUntil && Date.now() < base.skipUntil) continue;
        if (firedAt.get(a.id) === key) continue;
        firedAt.set(a.id, key);
        // A one-time alarm turns itself off after it (and its last extra alarm) rang.
        if ((!base.days || !base.days.length) && a.idx === a.count) { base.on = false; changed = true; }
        fire(a);
      }
    }
    const due = snoozes.filter((s) => s.at <= Date.now());
    if (due.length) { snoozes = snoozes.filter((s) => s.at > Date.now()); fire(due[0].alarm, true); }
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
