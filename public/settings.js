// Settings (Account picture > Settings): what rings and what notifies. Everything is on until
// the person turns it off. The switches are saved with the account (so they apply on every
// device, and to notifications sent while Huddle is closed) and copied here for the app itself.
// window.HuddlePrefs.get("sounds") etc. is read by alarms.js, chats.js and phone.js.
(() => {
  "use strict";
  const H = () => window.huddle || {};
  const KEY = "huddle:prefs";
  const DEFAULTS = { phoneRing: true, phoneAlerts: true, huddleRing: true, chats: true, alarms: true, sounds: true, vibrate: true };
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (t, ms) => { if (H().toast) H().toast(t, ms); };

  let prefs = { ...DEFAULTS };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} window.dispatchEvent(new Event("huddle:prefs")); };

  async function api(method, body) {
    const r = await fetch("/api/push/prefs", {
      method,
      headers: { authorization: "Bearer " + (token() || ""), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't save that. Try again.");
    return j.prefs;
  }
  async function load() {
    if (!token()) return;
    try { prefs = { ...DEFAULTS, ...(await api("GET")) }; keep(); } catch {}
  }
  async function set(k, v) {
    const old = prefs[k];
    prefs[k] = v; keep();
    try { prefs = { ...DEFAULTS, ...(await api("POST", { prefs: { [k]: v } })) }; keep(); }
    catch (e) { prefs[k] = old; keep(); throw e; }
  }
  window.addEventListener("huddle:signedin", load);
  window.addEventListener("huddle:signed-in", load, { once: true });
  if (token()) load();

  // ---------- Native (Android app) helpers ----------
  const native = (m, o) => (H().isNativeApp && H().native ? H().native(m, o || {}) : Promise.reject(new Error("not native")));

  // ---------- The Settings screen ----------
  const ROWS = [
    { head: "Ringing" },
    { k: "phoneRing", t: "Phone calls ring", s: "Calls to your Huddle number ring like a phone." },
    { k: "huddleRing", t: "Huddle calls ring", s: "Friends calling you in Huddle ring." },
    { k: "alarms", t: "Alarms and timers", s: "Your alarms ring, even with Huddle closed." },
    { head: "Notifications" },
    { k: "chats", t: "Chat messages", s: "New messages from friends and groups." },
    { k: "phoneAlerts", t: "Voicemails and missed calls" },
    { k: "sounds", t: "Sounds", s: "Notifications and ringing make a sound." },
    { k: "vibrate", t: "Vibration" },
  ];

  let el = null;
  function close() { if (el) { el.remove(); el = null; } }
  function open() {
    close();
    el = document.createElement("div");
    el.className = "set-wrap";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Settings");
    el.innerHTML = `
      <div class="set-panel">
        <header class="set-head">
          <button type="button" class="ch-icon" data-act="close" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
          <h1>Settings</h1>
        </header>
        <div class="set-body">
          <section class="set-card set-device">
            <div class="set-row"><span class="set-txt"><b>Notifications on this device</b><small class="set-dev-sub">Checking…</small></span><button type="button" class="btn set-dev-btn" hidden></button></div>
          </section>
          <section class="set-card set-native" hidden></section>
          ${ROWS.map((r) => r.head ? `<h2 class="set-h">${esc(r.head)}</h2>` : `
            <div class="set-row">
              <span class="set-txt"><b>${esc(r.t)}</b>${r.s ? `<small>${esc(r.s)}</small>` : ""}</span>
              <button type="button" class="sw" role="switch" aria-checked="${!!prefs[r.k]}" aria-label="${esc(r.t)}" data-k="${r.k}"><span class="track"></span></button>
            </div>`).join("")}
          <h2 class="set-h">Phone</h2>
          <div class="set-row">
            <span class="set-txt"><b>Calls to your cell</b><small>Make Huddle ring when you miss a call on your cell.</small></span>
            <button type="button" class="btn" data-act="cell">Open</button>
          </div>
          <div class="set-row">
            <span class="set-txt"><b>Emergency 911</b><small>Your 911 address, the 933 test, and 911 call volume.</small></span>
            <button type="button" class="btn" data-act="e911">Open</button>
          </div>
          <h2 class="set-h">Good to know</h2>
          <div class="set-card set-notes">
            <p>When Huddle is closed, calls and alarms ring with your phone's notification sound, over and over until you answer or stop them.</p>
            <p>iPhone: add Huddle to your Home Screen (Safari, Share, Add to Home Screen) and open it from there, or nothing can ring while it's closed.</p>
            <p>Android app: alarms are real phone alarms, with their own alarm sound and a full-screen alarm. They work even with Huddle closed or your phone restarted.</p>
            <p>Silent mode or Do Not Disturb on your phone can still quiet Huddle.</p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('[data-act="close"]').onclick = close;
    el.querySelector('[data-act="e911"]').onclick = () => { close(); if (window.HuddlePhoneScreen && window.HuddlePhoneScreen.openE911) window.HuddlePhoneScreen.openE911(); };
    el.querySelector('[data-act="cell"]').onclick = () => { close(); if (window.HuddlePhoneScreen && window.HuddlePhoneScreen.openCell) window.HuddlePhoneScreen.openCell(); };
    for (const b of el.querySelectorAll(".sw[data-k]")) {
      b.onclick = async () => {
        const v = b.getAttribute("aria-checked") !== "true";
        b.setAttribute("aria-checked", String(v));
        try { await set(b.dataset.k, v); }
        catch (e) { b.setAttribute("aria-checked", String(!v)); toast(e.message, 5000); }
      };
    }
    renderDevice();
    renderNative();
  }

  async function renderDevice() {
    const box = el && el.querySelector(".set-device");
    if (!box || !window.huddleNotify) return;
    const sub = box.querySelector(".set-dev-sub"), b = box.querySelector(".set-dev-btn");
    const st = await window.huddleNotify.state();
    if (!el) return;
    if (st === "android-app") { box.hidden = true; return; }
    const on = st === "on";
    sub.textContent = on ? "On. Calls, alarms and messages reach you even with Huddle closed."
      : window.huddleNotify.HELP[st] || "Off. Turn them on so calls and alarms can ring with Huddle closed.";
    b.hidden = !(on || st === "off");
    b.textContent = on ? "Turn off" : "Turn on";
    b.classList.toggle("primary", !on);
    b.onclick = async () => {
      b.disabled = true;
      try { await (on ? window.huddleNotify.disable() : window.huddleNotify.enable()); toast(on ? "Notifications off on this device" : "Notifications on"); }
      catch (e) { toast(e.message, 7000); }
      b.disabled = false;
      renderDevice();
    };
  }

  // The Android app: ask for permission to notify and to set exact alarms.
  async function renderNative() {
    const box = el && el.querySelector(".set-native");
    if (!box || !H().isNativeApp) return;
    let st;
    try { st = await native("notifyStatus"); } catch { return; }
    if (!el) return;
    box.hidden = false;
    const row = (t, s, act, label) => `<div class="set-row"><span class="set-txt"><b>${esc(t)}</b><small>${esc(s)}</small></span>${act ? `<button type="button" class="btn primary" data-n="${act}">${esc(label)}</button>` : ""}</div>`;
    box.innerHTML =
      row("Notifications", st.notifications ? "Allowed." : "Not allowed yet. Huddle can't ring or notify.", st.notifications ? null : "notify", "Allow") +
      row("Alarms", st.exactAlarms ? "Allowed. Alarms ring right on time." : "Not allowed yet. Alarms might ring late.", st.exactAlarms ? null : "alarms", "Allow");
    for (const b of box.querySelectorAll("[data-n]")) {
      b.onclick = async () => {
        try { await native(b.dataset.n === "notify" ? "requestNotifications" : "openAlarmSettings"); } catch {}
        setTimeout(renderNative, 800);
      };
    }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && el) { renderDevice(); renderNative(); } });

  // A real looping ringtone, played by the app itself (not a notification sound).
  //   kind "call": a phone-style double ring (two tones together, trilled), every 3 seconds.
  //   kind "alarm": quick rising beeps.
  // Returns stop(). Stops by itself after `ms` (30 s for calls, 60 s for alarms).
  let sharedCtx = null;
  function audio() {
    if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sharedCtx.state === "suspended") sharedCtx.resume().catch(() => {});
    return sharedCtx;
  }
  // The first tap or key press anywhere unlocks sound, so a later call can ring with no tap.
  const unlock = () => { try { audio(); } catch {} };
  document.addEventListener("pointerdown", unlock, { once: true, capture: true });
  document.addEventListener("keydown", unlock, { once: true, capture: true });
  function ringtone(kind, ms) {
    if (window.huddleQuiet) return () => {}; // on a quiet 911 call
    let loop = null, vib = null, out = null;
    const on = (k) => prefs[k] !== false;
    if (on("sounds")) try {
      const ctx = audio();
      out = ctx.createGain(); out.gain.value = 1; out.connect(ctx.destination);
      const ring = () => {
        const t = ctx.currentTime + 0.02;
        const bursts = kind === "alarm" ? [[0, 0.16], [0.24, 0.16], [0.48, 0.16], [0.72, 0.16]] : [[0, 0.9], [1.2, 0.9]];
        bursts.forEach(([at, len], n) => {
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t + at);
          g.gain.linearRampToValueAtTime(0.32, t + at + 0.02);
          g.gain.setValueAtTime(0.32, t + at + len - 0.05);
          g.gain.linearRampToValueAtTime(0, t + at + len);
          g.connect(out);
          const freqs = kind === "alarm" ? [880 + n * 110] : [440, 480];
          for (const f of freqs) {
            const o = ctx.createOscillator();
            o.type = "sine"; o.frequency.value = f;
            if (kind !== "alarm") {
              // A 20 Hz trill, like a phone bell.
              const lfo = ctx.createOscillator(), depth = ctx.createGain();
              lfo.frequency.value = 20; depth.gain.value = 0.35;
              const trem = ctx.createGain(); trem.gain.value = 0.65;
              lfo.connect(depth).connect(trem.gain);
              o.connect(trem).connect(g);
              lfo.start(t + at); lfo.stop(t + at + len);
            } else o.connect(g);
            o.start(t + at); o.stop(t + at + len);
          }
        });
      };
      ring();
      loop = setInterval(ring, kind === "alarm" ? 1400 : 3000);
    } catch {}
    if (on("vibrate") && navigator.vibrate) {
      const buzz = () => { try { navigator.vibrate(kind === "alarm" ? [300, 150, 300, 150, 300] : [900, 300, 900]); } catch {} };
      buzz();
      vib = setInterval(buzz, kind === "alarm" ? 1400 : 3000);
    }
    let done = false;
    const stop = () => {
      if (done) return; done = true;
      clearInterval(loop); clearInterval(vib);
      try { if (out) out.disconnect(); } catch {}
      try { navigator.vibrate && navigator.vibrate(0); } catch {}
    };
    setTimeout(stop, ms || (kind === "alarm" ? 60000 : 30000));
    return stop;
  }

  // ---------- Ringing, one place for all of it ----------
  // start(tag, kind, cat) rings until stop(tag) (or it times out). The same tag never rings
  // twice, so the app's own call screens and a message from the service worker (a call arriving
  // while Huddle is open in the background) don't double up.
  const ringingNow = new Map(); // tag -> stop
  const CAT_PREF = { "phone-call": "phoneRing", "huddle-call": "huddleRing", alarm: "alarms" };
  const HuddleRing = {
    start(tag, kind, cat) {
      if (!tag || ringingNow.has(tag)) return;
      if (CAT_PREF[cat] && prefs[CAT_PREF[cat]] === false) return;
      const stop = ringtone(kind === "alarm" ? "alarm" : "call");
      ringingNow.set(tag, stop);
      setTimeout(() => { if (ringingNow.get(tag) === stop) ringingNow.delete(tag); }, kind === "alarm" ? 60000 : 30000);
    },
    stop(tag) {
      const s = ringingNow.get(tag);
      if (s) { s(); ringingNow.delete(tag); }
    },
    stopAll() { for (const t of [...ringingNow.keys()]) HuddleRing.stop(t); },
    has: (tag) => ringingNow.has(tag),
  };
  window.HuddleRing = HuddleRing;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "huddle-ring") HuddleRing.start(d.tag, d.kind, d.cat);
      else if (d.type === "huddle-ring-stop") HuddleRing.stop(d.tag);
    });
  }


  window.HuddlePrefs = {
    ringtone,
    get: (k) => prefs[k] !== false,
    get all() { return { ...prefs }; },
    set, load, open,
  };
})();
