// Call a real phone number from a Huddle call (through Twilio, set up on the server).
// The phone joins the call through whoever dialed it: their browser mixes the phone's voice
// into what they send to everyone, and mixes everyone's voices into what the phone hears.
// Nothing here rings, buzzes or shows up outside the app: calls only go out, never come in.
(() => {
  "use strict";
  const H = window.huddle;
  if (!H) return;

  const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
  const btn = document.getElementById("phoneBtn");
  if (!btn) return;
  btn.innerHTML = PHONE_ICON;

  // The phone call in progress, and the audio mixes for it.
  let device = null, call = null, toPhone = null, toPeers = null, phoneStream = null, timer = null, startedAt = 0, rejoinCheck = null;

  // The popup: type a number and call, or see the call and hang up.
  const pop = document.createElement("div");
  pop.className = "volume-pop phone-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Call a phone number");
  pop.innerHTML = `
    <form class="phone-dial">
      <strong>Call a phone number</strong>
      <small class="phone-note">Everyone in this call will hear them, and they'll hear everyone. US and Canada numbers.</small>
      <div class="phone-row">
        <input type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 123-4567" aria-label="Phone number" maxlength="22">
        <button class="btn primary" type="submit">Call</button>
      </div>
      <p class="error phone-err"></p>
    </form>
    <div class="phone-live" hidden>
      <strong class="phone-num"></strong>
      <small class="phone-status"></small>
      <div class="phone-keys" hidden></div>
      <div class="phone-row">
        <button class="btn" type="button" data-act="keys">Keypad</button>
        <button class="btn danger" type="button" data-act="hangup">Hang up</button>
      </div>
    </div>`;
  document.getElementById("call").append(pop);
  const q = (s) => pop.querySelector(s);
  const form = q(".phone-dial"), input = q("input"), err = q(".phone-err"), callBtn = q("button[type=submit]");
  const live = q(".phone-live"), numEl = q(".phone-num"), statusEl = q(".phone-status"), keys = q(".phone-keys");
  for (const d of "123456789*0#") {
    const k = document.createElement("button");
    k.type = "button"; k.className = "btn"; k.textContent = d;
    k.onclick = () => { if (call) call.sendDigits(d); };
    keys.append(k);
  }

  function show(on) {
    pop.hidden = !on;
    btn.setAttribute("aria-expanded", String(on));
    if (on && !call) setTimeout(() => input.focus(), 50);
  }
  btn.onclick = (e) => { e.stopPropagation(); show(pop.hidden); };
  pop.onclick = (e) => e.stopPropagation();
  document.addEventListener("click", () => { if (!pop.hidden) show(false); });

  // Only show the button once phone calls are set up on the server.
  function renderBtn() {
    const on = !!(H.config && H.config.phone);
    btn.hidden = !on && !call;
    btn.classList.toggle("on-accent", !!call);
    btn.title = call ? "Phone call" : "Call a phone number";
  }
  renderBtn();
  window.addEventListener("huddle:joined", () => setTimeout(renderBtn, 0));
  fetch("/config", { cache: "no-store" }).then((r) => r.json()).then((c) => { if (c.phone) { H.config.phone = true; renderBtn(); } }).catch(() => {});

  // ---------- Numbers ----------
  function normalize(raw) {
    let s = String(raw || "").trim();
    const plus = s.startsWith("+");
    s = s.replace(/\D/g, "");
    if (!plus) {
      if (s.length === 10) s = "1" + s;
      else if (!(s.length === 11 && s[0] === "1")) return null;
    }
    return s.length >= 8 && s.length <= 15 ? "+" + s : null;
  }
  const pretty = (n) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n);

  // ---------- Audio mixing ----------
  let ctx = null;
  function audioCtx() {
    ctx = H.audioCtx || ctx || new (window.AudioContext || window.webkitAudioContext)();
    try { ctx.resume(); } catch {}
    return ctx;
  }
  // A mixer: a set of tracks in, one track out. Re-checked every second so people who join or
  // leave, and mic changes, are picked up.
  function mixer() {
    const c = audioCtx();
    const dest = c.createMediaStreamDestination();
    const srcs = new Map(); // track id -> source node
    return {
      track: dest.stream.getAudioTracks()[0],
      set(tracks) {
        const want = new Map(tracks.filter((t) => t && t.readyState === "live").map((t) => [t.id, t]));
        for (const [id, s] of srcs) if (!want.has(id)) { try { s.disconnect(); } catch {} srcs.delete(id); }
        for (const [id, t] of want) {
          if (srcs.has(id)) continue;
          try {
            const s = c.createMediaStreamSource(new MediaStream([t]));
            s.connect(dest);
            srcs.set(id, s);
          } catch {}
        }
      },
      stop() { for (const s of srcs.values()) try { s.disconnect(); } catch {} srcs.clear(); dest.track && dest.track.stop(); },
    };
  }
  // On iPhone, reading other people's call audio with Web Audio can silence it, so there the
  // phone hears the person who dialed (and whatever their mic picks up), not a full mix.
  const mixPeers = !H.isIOS;
  const peerTracks = () => (mixPeers
    ? [...H.peers.values()].filter((p) => p.pc && p.stream).flatMap((p) => p.stream.getAudioTracks())
    : []);

  // ---------- The call ----------

  function refreshMix() {
    const mic = H.micTrack();
    if (toPhone) toPhone.set([mic, ...peerTracks()]);
    if (toPeers) toPeers.set([mic, ...(phoneStream ? phoneStream.getAudioTracks() : [])]);
  }
  window.addEventListener("huddle:mic-track", refreshMix);

  function setLive(text) {
    form.hidden = !!call;
    live.hidden = !call;
    statusEl.textContent = text || "";
    renderBtn();
  }
  function tick() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    statusEl.textContent = `On the call · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function loadSdk() {
    if (window.Twilio && window.Twilio.Device) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/twilio.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load the phone service"));
      document.head.append(s);
    });
  }
  async function getToken() {
    let tk = null;
    try { tk = localStorage.getItem("huddle:token"); } catch {}
    if (!tk) throw new Error("Sign in to call a phone number");
    const r = await fetch("/api/phone", { method: "POST", headers: { authorization: "Bearer " + tk } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't start the phone call");
    return j;
  }

  async function dial(num) {
    err.textContent = "";
    callBtn.disabled = true;
    try {
      audioCtx(); // start audio during the tap
      const [{ token }] = await Promise.all([getToken(), loadSdk()]);
      toPhone = mixer();
      refreshMix();
      device = new window.Twilio.Device(token, {
        codecPreferences: ["opus", "pcmu"],
        closeProtection: false,
        logLevel: "warn",
        // Twilio would open the mic again on its own; give it the mix instead (mic + everyone).
        getUserMedia: () => Promise.resolve(new MediaStream([toPhone.track.clone()])),
      });
      // No extra beeps from Twilio; you hear the phone ring through the call itself.
      try { device.audio.outgoing(false); device.audio.disconnect(false); device.audio.incoming(false); } catch {}
      device.on("tokenWillExpire", () => getToken().then((j) => device && device.updateToken(j.token)).catch(() => {}));
      device.on("error", (e) => console.warn("phone", e && e.message));
      call = await device.connect({ params: { To: num } });
      numEl.textContent = pretty(num);
      setLive("Calling…");
      call.on("ringing", () => setLive("Ringing…"));
      call.on("accept", () => {
        startedAt = Date.now();
        phoneStream = call.getRemoteStream() || null;
        toPeers = mixer();
        refreshMix();
        H.setSendAudio(toPeers.track);
        H.setPhoneGuest(num.slice(-4));
        clearInterval(timer);
        timer = setInterval(() => { tick(); refreshMix(); }, 1000);
        tick();
        H.toast(`${pretty(num)} joined the call`);
      });
      const ended = (why) => () => finish(why);
      call.on("disconnect", ended("Phone call ended"));
      call.on("cancel", ended("Phone call ended"));
      call.on("reject", ended("They didn't pick up"));
      call.on("error", (e) => finish(e && e.code === 31005 ? "The phone call dropped" : "The phone call didn't go through"));
    } catch (e) {
      finish(null);
      err.textContent = (e && e.message) || "Couldn't start the phone call";
    } finally {
      callBtn.disabled = false;
    }
  }

  function finish(msg) {
    const had = !!call;
    clearInterval(timer); timer = null;
    clearTimeout(rejoinCheck);
    const c = call; call = null;
    if (c) try { c.disconnect(); } catch {}
    H.setSendAudio(null);
    H.setPhoneGuest(null);
    if (toPeers) toPeers.stop();
    if (toPhone) toPhone.stop();
    toPeers = toPhone = phoneStream = null;
    if (device) { const d = device; device = null; try { d.destroy(); } catch {} }
    keys.hidden = true;
    setLive("");
    if (had && msg) H.toast(msg, 3000);
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    if (call) return;
    const num = normalize(input.value);
    if (!num) { err.textContent = "Type a 10-digit phone number"; return; }
    if (!H.inCall) { err.textContent = "Join a call first"; return; }
    dial(num);
  };
  pop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "hangup") finish("Phone call ended");
    if (act.dataset.act === "keys") keys.hidden = !keys.hidden;
  });

  // Leaving the call hangs up the phone too. If the app is only reconnecting, keep the phone
  // on, and hang up if we don't get back in.
  window.addEventListener("huddle:left", (e) => {
    show(false);
    if (!call) return;
    if (e.detail && e.detail.rejoining) {
      clearTimeout(rejoinCheck);
      rejoinCheck = setTimeout(() => { if (!H.inCall) finish("Phone call ended"); }, 60000);
    } else finish("Phone call ended");
  });
  window.addEventListener("pagehide", () => { if (call) finish(null); });
})();
