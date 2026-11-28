// Real phone calls in Huddle (through Twilio, set up on the server):
//  - Call a phone number from a Huddle call. The phone joins the call through whoever dialed:
//    their browser mixes the phone's voice into what they send to everyone, and mixes
//    everyone's voices into what the phone hears.
//  - Call a number from the Phone screen (public/phone-inbox.js) when not in a call.
//  - Call-backs: when someone calls the Huddle number, it shows up here while Huddle is open.
// While Huddle is open, call-backs ring in the app. When it's closed, a notification goes out
// (public/notifications.js) and the caller is held for a few seconds while Huddle opens.
(() => {
  "use strict";
  const H = window.huddle;
  if (!H) return;

  const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
  const btn = document.getElementById("phoneBtn");
  if (btn) btn.innerHTML = PHONE_ICON;

  // The phone call in progress, and the audio mixes for it.
  let device = null, deviceReady = null, call = null, callNum = null, toPhone = null, toPeers = null, phoneStream = null;
  let timer = null, startedAt = 0, rejoinCheck = null, startedInRoom = false, ringing = null;

  // ---------- Popup: type a number and call, or see the call and hang up ----------
  const pop = document.createElement("div");
  pop.className = "volume-pop phone-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Phone call");
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
        <button class="btn" type="button" data-act="mute">Mute</button>
        <button class="btn" type="button" data-act="keys">Keypad</button>
        <button class="btn danger" type="button" data-act="hangup">Hang up</button>
      </div>
    </div>`;
  document.body.append(pop);
  const q = (s) => pop.querySelector(s);
  const form = q(".phone-dial"), input = q("input"), err = q(".phone-err"), callBtn = q("button[type=submit]");
  const liveBox = q(".phone-live"), numEl = q(".phone-num"), statusEl = q(".phone-status"), keys = q(".phone-keys"), muteBtn = q('[data-act="mute"]');
  for (const d of "123456789*0#") {
    const k = document.createElement("button");
    k.type = "button"; k.className = "btn"; k.textContent = d;
    k.onclick = () => { if (call) call.sendDigits(d); };
    keys.append(k);
  }

  // Someone is calling the Huddle number (with a ringtone while the app is open).
  const ring = document.createElement("div");
  ring.className = "phone-ring";
  ring.hidden = true;
  ring.setAttribute("role", "alertdialog");
  ring.innerHTML = `
    <span class="phone-ring-icon">${PHONE_ICON}</span>
    <span class="phone-ring-text"><strong></strong><small>is calling your Huddle number</small></span>
    <button class="btn danger" type="button" data-act="decline">Decline</button>
    <button class="btn ok" type="button" data-act="answer">Answer</button>`;
  document.body.append(ring);

  // In a Huddle call the popup opens from the phone button; outside a call it shows whenever a
  // phone call is going.
  function show(on) {
    pop.hidden = !on;
    if (btn) btn.setAttribute("aria-expanded", String(on));
    if (on && !call) setTimeout(() => input.focus(), 50);
  }
  if (btn) btn.onclick = (e) => { e.stopPropagation(); show(pop.hidden); };
  pop.onclick = (e) => e.stopPropagation();
  ring.onclick = (e) => e.stopPropagation();
  document.addEventListener("click", () => { if (!pop.hidden && (H.inCall || !call)) show(false); });

  const phoneOn = () => !!(H.config && H.config.phone);
  function renderBtn() {
    if (btn) {
      btn.hidden = !phoneOn() && !call;
      btn.classList.toggle("on-accent", !!call);
      btn.title = call ? "Phone call" : "Call a phone number";
    }
    pop.classList.toggle("floating", !H.inCall);
  }
  renderBtn();
  window.addEventListener("huddle:joined", () => setTimeout(() => { renderBtn(); joinMix(); }, 0));
  fetch("/config", { cache: "no-store" }).then((r) => r.json()).then((c) => {
    if (c.phone) { H.config.phone = true; renderBtn(); listen(); }
  }).catch(() => {});

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
  const pretty = (n) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n || "Unknown number");
  // Saved contacts (filled in by the Phone screen): show "Mom" instead of the number.
  const names = new Map();
  const label = (n) => names.get(n) || pretty(n);

  // ---------- Audio mixing ----------
  let ctx = null;
  function audioCtx() {
    ctx = H.audioCtx || ctx || new (window.AudioContext || window.webkitAudioContext)();
    try { ctx.resume(); } catch {}
    return ctx;
  }
  // A mixer: a set of tracks in, one track out.
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
      stop() { for (const s of srcs.values()) try { s.disconnect(); } catch {} srcs.clear(); },
    };
  }
  // On iPhone, reading other people's call audio with Web Audio can silence it, so there the
  // phone hears the person who dialed (and whatever their mic picks up), not a full mix.
  const mixPeers = !H.isIOS;
  const peerTracks = () => (mixPeers
    ? [...H.peers.values()].filter((p) => p.pc && p.stream).flatMap((p) => p.stream.getAudioTracks())
    : []);
  function refreshMix() {
    const mic = H.micTrack();
    if (toPhone) toPhone.set([mic, ...peerTracks()]);
    if (toPeers) toPeers.set([mic, ...(phoneStream ? phoneStream.getAudioTracks() : [])]);
  }
  window.addEventListener("huddle:mic-track", refreshMix);
  // The phone joins the Huddle call: others hear it through us.
  function joinMix() {
    if (!call || !startedAt || !H.inCall || toPeers) return;
    phoneStream = call.getRemoteStream() || null;
    toPeers = mixer();
    refreshMix();
    H.setSendAudio(toPeers.track);
    H.setPhoneGuest(callNum.slice(-4));
  }
  function leaveMix() {
    if (toPeers) { H.setSendAudio(null); H.setPhoneGuest(null); toPeers.stop(); toPeers = null; }
  }
  // What the phone hears. In a Huddle call: our mic plus everyone else. Otherwise: our mic.
  function phoneInput(constraints) {
    if (H.inCall && H.micTrack()) {
      if (!toPhone) toPhone = mixer();
      refreshMix();
      return Promise.resolve(new MediaStream([toPhone.track.clone()]));
    }
    return navigator.mediaDevices.getUserMedia(constraints && constraints.audio ? constraints : { audio: true });
  }

  // ---------- Talking to Twilio ----------
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
  const signedIn = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  async function getToken(listen, emergency) {
    const tk = signedIn();
    if (!tk) throw new Error("Sign in to use the phone");
    const r = await fetch("/api/phone", { method: "POST", headers: { authorization: "Bearer " + tk, "content-type": "application/json" }, body: JSON.stringify({ listen: !!listen, emergency: !!emergency }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't reach the phone service");
    return j;
  }
  // One Twilio connection for the whole time the app is open: for calling out, and (for the
  // person who gets call-backs) for hearing about calls coming in.
  async function getDevice(listenOnly, emergency) {
    if (device) return device;
    if (deviceReady) return deviceReady;
    deviceReady = (async () => {
      const [j] = await Promise.all([getToken(listenOnly, emergency), loadSdk()]);
      if (!j.token) return null; // this person doesn't get call-backs
      const d = new window.Twilio.Device(j.token, {
        codecPreferences: ["opus", "pcmu"],
        closeProtection: false,
        logLevel: "warn",
        allowIncomingWhileBusy: false,
        getUserMedia: phoneInput,
      });
      // A ringtone for call-backs; no extra beeps when calling out or hanging up.
      // (Settings > Phone calls ring, and Sounds, can turn the ringtone off.)
      const ringOn = () => !window.HuddlePrefs || (window.HuddlePrefs.get("phoneRing") && window.HuddlePrefs.get("sounds"));
      try { d.audio.outgoing(false); d.audio.disconnect(false); d.audio.incoming(ringOn()); } catch {}
      window.addEventListener("huddle:prefs", () => { try { d.audio.incoming(ringOn()); } catch {} });
      // Tell the server the line is connected, so a caller waiting on hold gets put through.
      d.on("registered", sayReady);
      d.on("tokenWillExpire", () => getToken(true).then((x) => x.token && d.updateToken(x.token)).catch(() => {}));
      d.on("error", (e) => console.warn("phone", e && e.message));
      d.on("incoming", onIncoming);
      if (j.line) d.register().catch((e) => console.warn("phone register", e && e.message));
      device = d;
      return d;
    })().finally(() => { deviceReady = null; });
    return deviceReady;
  }
  function sayReady() {
    const tk = signedIn();
    if (!tk || !device || device.state !== "registered") return;
    fetch("/api/phone/ready", { method: "POST", headers: { authorization: "Bearer " + tk } }).catch(() => {});
  }
  // The app's live connection came back (it was asleep or offline): say the line is ready again.
  window.addEventListener("huddle:signed-in", () => { if (device) sayReady(); else listen(); });
  // When the app opens (signed in, phone set up): get ready for call-backs.
  let listenTries = 0;
  function listen() {
    if (!phoneOn() || !signedIn() || device || deviceReady || listenTries > 3) return;
    listenTries++;
    getDevice(true).catch(() => {});
  }
  window.addEventListener("huddle:phone-live", () => { listenTries = 0; listen(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) listen(); });
  setTimeout(listen, 1200);

  // ---------- Calls ----------
  function setLive(text) {
    form.hidden = !!call;
    liveBox.hidden = !call;
    statusEl.textContent = text || "";
    renderBtn();
    if (call && !H.inCall) show(true);
  }
  function tick() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    statusEl.textContent = `On the call · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function wire(c, num) {
    call = c;
    callNum = num;
    startedAt = 0;
    startedInRoom = !!H.inCall;
    muteBtn.textContent = "Mute";
    numEl.textContent = label(num);
    c.on("ringing", () => { if (!startedAt) setLive("Ringing…"); });
    c.on("accept", () => {
      startedAt = Date.now();
      joinMix();
      clearInterval(timer);
      timer = setInterval(() => { tick(); refreshMix(); }, 1000);
      tick();
      renderBtn();
      if (H.inCall) H.toast(`${label(num)} joined the call`);
    });
    c.on("disconnect", () => finish("Phone call ended"));
    c.on("cancel", () => finish(null));
    c.on("reject", () => finish("They didn't pick up"));
    c.on("error", (e) => finish(e && e.code === 31005 ? "The phone call dropped" : "The phone call didn't go through"));
  }

  // 911 (and 933, Twilio's free test that reads back your registered address). Never blocked:
  // any phone call already going is hung up first.
  // Quiet 911 (on unless switched off on the 911 page): no ringing sound while it connects, and
  // Huddle makes no sounds of its own during the call, in case you need to stay hidden. The
  // dispatcher's voice still plays as soon as they answer.
  const quiet911 = () => { try { return localStorage.getItem("huddle:quiet911") !== "0"; } catch { return true; } };
  function silenceUntilAnswered(c) {
    let answered = false;
    const hush = () => {
      if (answered) return;
      try { const st = c.getRemoteStream && c.getRemoteStream(); if (st) for (const t of st.getAudioTracks()) t.enabled = false; } catch {}
    };
    c.on("ringing", hush);
    c.on("volume", hush);
    c.on("accept", () => {
      answered = true;
      try { const st = c.getRemoteStream && c.getRemoteStream(); if (st) for (const t of st.getAudioTracks()) t.enabled = true; } catch {}
    });
  }
  async function dialEmergency(short) {
    if (call) { try { call.disconnect(); } catch {} await new Promise((r) => setTimeout(r, 300)); }
    audioCtx();
    const d = await getDevice(false, true);
    if (!d) throw new Error("Couldn't reach the phone service. Use your phone's own dialer to call 911.");
    const quiet = quiet911();
    const c = await d.connect({ params: { To: short } });
    if (quiet) {
      silenceUntilAnswered(c);
      window.huddleQuiet = true; // other Huddle sounds stay off (settings.js, alarms.js)
      const done = () => { window.huddleQuiet = false; };
      c.on("disconnect", done); c.on("cancel", done); c.on("reject", done); c.on("error", done);
      try { if (navigator.vibrate) navigator.vibrate(0); } catch {}
    }
    wire(c, short);
    setLive(short === "911" ? "Calling 911…" : "Calling the 933 address test…");
    show(true);
    return true;
  }
  async function dial(raw) {
    const short = String(raw || "").replace(/\D/g, "");
    if (short === "911" || short === "933") return dialEmergency(short);
    const num = normalize(raw);
    if (!num) throw new Error("Type a 10-digit phone number");
    if (call) throw new Error("You're already on a phone call");
    audioCtx(); // start audio during the tap
    const d = await getDevice(false);
    if (!d) throw new Error("Couldn't reach the phone service");
    const c = await d.connect({ params: { To: num } });
    wire(c, num);
    setLive("Calling…");
    // Calling out makes this person the one who gets call-backs from now on.
    if (d.state !== "registered") d.register().catch(() => {});
    return true;
  }

  function onIncoming(c) {
    if (call || ringing) { try { c.reject(); } catch {} return; }
    const from = (c.customParameters && c.customParameters.get && c.customParameters.get("from")) || (c.parameters && c.parameters.From) || "";
    ringing = { c, from };
    try { if (navigator.vibrate) navigator.vibrate([400, 200, 400]); } catch {}
    const saved = c.customParameters && c.customParameters.get && c.customParameters.get("name");
    ring.querySelector("strong").textContent = saved || label(normalize(from) || from);
    const viaCell = c.customParameters && c.customParameters.get && c.customParameters.get("via") === "cell";
    ring.querySelector("small").textContent = viaCell ? "is calling your cell" : "is calling your Huddle number";
    ring.hidden = false;
    const gone = () => { if (ringing && ringing.c === c) { ringing = null; ring.hidden = true; } };
    c.on("cancel", gone);
    c.on("disconnect", gone);
    c.on("reject", gone);
    maybeAutoAnswer();
  }
  // Opened by tapping Answer on a ringing notification: answer this caller without another tap.
  function maybeAutoAnswer() {
    const a = window.huddleAutoAnswer;
    if (!a || !ringing || Date.now() > a.until) return;
    const want = normalize(a.from) || a.from, got = normalize(ringing.from) || ringing.from;
    if (want !== got) return;
    window.huddleAutoAnswer = null;
    ring.querySelector('[data-act="answer"]').click();
  }
  window.addEventListener("huddle:auto-answer", maybeAutoAnswer);
  ring.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act || !ringing) return;
    const { c, from } = ringing;
    ringing = null;
    ring.hidden = true;
    if (act.dataset.act === "decline") { try { c.reject(); } catch {} return; }
    audioCtx();
    wire(c, normalize(from) || from);
    setLive("Connecting…");
    c.accept();
  });

  function finish(msg) {
    const had = !!call;
    clearInterval(timer); timer = null;
    clearTimeout(rejoinCheck);
    const c = call; call = null;
    if (c) try { c.disconnect(); } catch {}
    leaveMix();
    if (toPhone) { toPhone.stop(); toPhone = null; }
    phoneStream = null;
    startedAt = 0;
    keys.hidden = true;
    setLive("");
    if (!H.inCall) show(false);
    if (had && msg) H.toast(msg, 3000);
    window.dispatchEvent(new Event("huddle:phone-ended"));
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (call) return;
    err.textContent = "";
    callBtn.disabled = true;
    try { await dial(input.value); }
    catch (x) { finish(null); err.textContent = (x && x.message) || "Couldn't start the phone call"; }
    finally { callBtn.disabled = false; }
  };
  pop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act || !call) return;
    if (act.dataset.act === "hangup") finish("Phone call ended");
    if (act.dataset.act === "keys") keys.hidden = !keys.hidden;
    if (act.dataset.act === "mute") {
      const m = !call.isMuted();
      call.mute(m);
      muteBtn.textContent = m ? "Unmute" : "Mute";
      muteBtn.classList.toggle("on", m);
    }
  });

  // Leaving the Huddle call hangs up a phone call that was added to it. A phone call started
  // outside a call (from the Phone screen, or a call-back) keeps going.
  window.addEventListener("huddle:left", (e) => {
    if (!call) { show(false); renderBtn(); return; }
    if (e.detail && e.detail.rejoining) {
      clearTimeout(rejoinCheck);
      rejoinCheck = setTimeout(() => { if (!H.inCall && startedInRoom) finish("Phone call ended"); }, 60000);
    } else if (startedInRoom) finish("Phone call ended");
    else { leaveMix(); renderBtn(); show(true); }
  });
  window.addEventListener("pagehide", () => { if (call) finish(null); });

  // For the Phone screen.
  window.huddlePhone = {
    dial,
    emergency: dialEmergency,
    pretty,
    label,
    normalize,
    setContacts(list) { names.clear(); for (const c of list || []) names.set(c.number, c.name); },
    get busy() { return !!call; },
    open() { show(true); },
  };
})();
