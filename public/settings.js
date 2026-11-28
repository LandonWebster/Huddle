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

  // A ringtone for calls that ring inside the app (Huddle invites). Returns stop().
  function ringtone(kind) {
    if (window.huddleQuiet) return () => {}; // on a quiet 911 call
    let ctx = null, loop = null, vib = null;
    const on = (k) => prefs[k] !== false;
    if (on("sounds")) try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const burst = () => {
        const t = ctx.currentTime;
        for (let i = 0; i < 2; i++) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "sine"; o.frequency.value = i ? 660 : 523;
          g.gain.setValueAtTime(0, t + i * 0.4);
          g.gain.linearRampToValueAtTime(0.18, t + i * 0.4 + 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.4 + 0.38);
          o.connect(g).connect(ctx.destination);
          o.start(t + i * 0.4); o.stop(t + i * 0.4 + 0.4);
        }
      };
      burst();
      loop = setInterval(burst, 2400);
    } catch {}
    if (on("vibrate") && navigator.vibrate) {
      try { navigator.vibrate([500, 300, 500]); } catch {}
      vib = setInterval(() => { try { navigator.vibrate([500, 300, 500]); } catch {} }, 2400);
    }
    let done = false;
    const stop = () => {
      if (done) return; done = true;
      clearInterval(loop); clearInterval(vib);
      if (ctx) ctx.close().catch(() => {});
      try { navigator.vibrate && navigator.vibrate(0); } catch {}
    };
    setTimeout(stop, 30000);
    return stop;
  }

  window.HuddlePrefs = {
    ringtone,
    get: (k) => prefs[k] !== false,
    get all() { return { ...prefs }; },
    set, load, open,
  };
})();
