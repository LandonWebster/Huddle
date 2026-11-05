// Huddle client: lobby, in-call UI, and WebRTC mesh calling.
// Every person connects directly to every other person (good up to ~8 people).
(() => {
  "use strict";

  // ---------- Icons ----------
  const I = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 9.3V5a3 3 0 0 0-5.9-.7M9 9v3a3 3 0 0 0 5.1 2.1M19 10a7 7 0 0 1-1.2 3.9M5 10a7 7 0 0 0 11 5.7M12 17v5M3 3l18 18"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/></svg>',
    camOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1m4 0h5a2 2 0 0 1 2 2v3.3l6-3.3v10M3 3l18 18"/></svg>',
    flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l2-3h8l2 3h3v13H3z"/><path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2M14 9v2h-2M10 17v-2h2"/></svg>',
    game: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15 12h.01M18 13.5h.01"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    speakerOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    hangup: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-3.4 0-6.6 1.1-9.2 3.1-.5.4-.7 1-.6 1.6l.5 2.4c.1.7.8 1.1 1.5 1l3.2-.6c.6-.1 1-.6 1-1.2l.1-2.1c1.1-.4 2.3-.6 3.5-.6s2.4.2 3.5.6l.1 2.1c0 .6.5 1.1 1 1.2l3.2.6c.7.1 1.4-.3 1.5-1l.5-2.4c.1-.6-.1-1.2-.6-1.6C18.6 10.1 15.4 9 12 9z"/></svg>',
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    lobby: $("lobby"), call: $("call"),
    previewVideo: $("previewVideo"), previewOff: $("previewOff"), previewAvatar: $("previewAvatar"), previewMsg: $("previewMsg"),
    pMic: $("pMic"), pCam: $("pCam"),
    nameInput: $("nameInput"), startBtn: $("startBtn"), joinForm: $("joinForm"), codeInput: $("codeInput"), lobbyError: $("lobbyError"),
    roomCode: $("roomCode"), peopleCount: $("peopleCount"), inviteBtn: $("inviteBtn"),
    grid: $("grid"), gamePanel: $("gamePanel"), closeGame: $("closeGame"),
    micBtn: $("micBtn"), camBtn: $("camBtn"), flipBtn: $("flipBtn"), gameBtn: $("gameBtn"), leaveBtn: $("leaveBtn"),
    toast: $("toast"),
    emptyState: $("emptyState"),
    speakerBtn: $("speakerBtn"), volumePop: $("volumePop"), silentToggle: $("silentToggle"),
    masterVol: $("masterVol"), masterVolOut: $("masterVolOut"), peerVols: $("peerVols"),
    chatBtn: $("chatBtn"), chatBadge: $("chatBadge"), chatPanel: $("chatPanel"), closeChat: $("closeChat"),
    chatList: $("chatList"), chatEmpty: $("chatEmpty"), chatForm: $("chatForm"), chatInput: $("chatInput"), chatSend: $("chatSend"),
  };
  els.chatBtn.insertAdjacentHTML("afterbegin", I.chat);
  els.flipBtn.innerHTML = I.flip;
  els.gameBtn.innerHTML = I.game;
  els.leaveBtn.innerHTML = I.hangup;

  // ---------- State ----------
  const local = {
    stream: new MediaStream(),
    micOn: true,
    camOn: true,
    facing: "user",
  };
  let config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], maxPerRoom: 8 };
  let ws = null;
  let myId = null;
  let room = null;
  let leaving = false;
  const peers = new Map(); // id -> { pc, name, state, stream, tile, polite, pending: [] }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ---------- Android app ----------
  // Inside the Huddle Android app, the page can ask Android to keep the call running in the
  // background and to share the phone screen. In a normal browser these are all no-ops.
  const Cap = window.Capacitor;
  const isNativeApp = !!(Cap && typeof Cap.nativePromise === "function" &&
    Cap.getPlatform && Cap.getPlatform() === "android" &&
    (Cap.PluginHeaders || []).some((h) => h.name === "HuddleNative"));
  const native = (method, opts) => (isNativeApp ? Cap.nativePromise("HuddleNative", method, opts || {}) : Promise.resolve());
  if (isNativeApp) document.documentElement.classList.add("native-app");

  const loadConfig = () => fetch("/config", { cache: "no-store" }).then((r) => r.json()).then((c) => (config = c)).catch(() => {});
  let configReady = loadConfig();

  // Keep open copies up to date: the Android app can stay open for days, so when a new
  // version is out, reload the next time you're in the lobby (never in the middle of a call).
  let bootVersion = null;
  async function checkVersion() {
    try {
      const v = (await (await fetch("/version", { cache: "no-store" })).json()).version;
      if (!bootVersion) bootVersion = v;
      else if (v !== bootVersion && !room) location.reload();
    } catch {}
  }
  checkVersion();
  setInterval(checkVersion, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });

  // ---------- Helpers ----------
  function toast(msg, ms = 2200) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove("show"), ms);
  }
  const initials = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const randomCode = () => {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    const r = crypto.getRandomValues(new Uint8Array(6));
    for (const b of r) s += a[b % a.length];
    return s;
  };
  const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const myName = () => els.nameInput.value.trim() || "Guest";
  const track = (kind) => local.stream.getTracks().find((t) => t.kind === kind) || null;

  // ---------- What you hear ----------
  // Silent mode and volume only change what YOU hear. Your mic is separate.
  // The app has no beeps or alert sounds; the only audio is other people's voices.
  const sound = {
    silent: store.get("huddle:silent") === "1",
    master: Math.min(1, Math.max(0, Number(store.get("huddle:volume") ?? 1))),
    per: new Map(), // peer id -> 0..1
  };
  if (!Number.isFinite(sound.master)) sound.master = 1;
  // iPhones/iPads ignore <video>.volume, so there we route audio through a gain node.
  const elementVolumeWorks = (() => {
    try { const v = document.createElement("video"); v.volume = 0.5; return v.volume === 0.5; } catch { return false; }
  })();

  function effectiveVolume(id) {
    if (sound.silent) return 0;
    return sound.master * (sound.per.has(id) ? sound.per.get(id) : 1);
  }
  function applyVolume(p) {
    if (!p || !p.pc) return;
    const vol = effectiveVolume(p.id);
    const v = p.tile.video;
    if (p.gain) {
      v.muted = true;
      p.gain.gain.value = vol;
    } else {
      v.muted = vol === 0;
      v.volume = vol;
    }
  }
  function applyAllVolumes() {
    for (const p of peers.values()) applyVolume(p);
    setCtl(els.speakerBtn, !sound.silent && sound.master > 0, I.speaker, I.speakerOff);
    els.volumePop.classList.toggle("silent", sound.silent);
    els.silentToggle.checked = sound.silent;
    els.masterVol.value = String(Math.round(sound.master * 100));
    els.masterVolOut.textContent = `${Math.round(sound.master * 100)}%`;
  }
  function routeThroughGain(p) {
    if (elementVolumeWorks || p.gain || !audioCtx) return;
    try {
      const src = audioCtx.createMediaStreamSource(p.stream);
      const gain = audioCtx.createGain();
      src.connect(gain).connect(audioCtx.destination);
      p.gain = gain;
      p.gainSrc = src;
    } catch {}
  }

  function renderPeerVolumes() {
    els.peerVols.textContent = "";
    for (const p of peers.values()) {
      if (!p.pc) continue;
      const row = document.createElement("div");
      row.className = "vol-row";
      const name = document.createElement("span");
      name.textContent = p.name;
      const range = document.createElement("input");
      range.type = "range"; range.min = "0"; range.max = "100";
      range.id = `vol-${p.id}`;
      range.setAttribute("aria-label", `Volume for ${p.name}`);
      const pct = Math.round((sound.per.has(p.id) ? sound.per.get(p.id) : 1) * 100);
      range.value = String(pct);
      const out = document.createElement("output");
      out.textContent = `${pct}%`;
      range.oninput = () => {
        sound.per.set(p.id, Number(range.value) / 100);
        out.textContent = `${range.value}%`;
        applyVolume(p);
      };
      row.append(name, range, out);
      els.peerVols.append(row);
    }
  }
  function toggleVolumePop(show) {
    if (show) { renderPeerVolumes(); openPanel(window.innerWidth <= 760 ? null : currentPanel); }
    els.volumePop.hidden = !show;
    els.speakerBtn.setAttribute("aria-expanded", String(show));
  }
  els.speakerBtn.onclick = (e) => { e.stopPropagation(); toggleVolumePop(els.volumePop.hidden); };
  els.volumePop.onclick = (e) => e.stopPropagation();
  document.addEventListener("click", () => { if (!els.volumePop.hidden) toggleVolumePop(false); });
  els.silentToggle.onchange = () => {
    sound.silent = els.silentToggle.checked;
    store.set("huddle:silent", sound.silent ? "1" : "0");
    applyAllVolumes();
    toast(sound.silent ? "Silent mode on. You won't hear anything." : "Sound is back on");
  };
  els.masterVol.oninput = () => {
    sound.master = Number(els.masterVol.value) / 100;
    store.set("huddle:volume", String(sound.master));
    applyAllVolumes();
  };

  // ---------- Video quality ----------
  // Every person sends a separate copy of their video to each other person, so quality
  // steps down as the call grows to keep everyone's upload smooth.
  const PROFILES = [
    { upTo: 2, width: 1280, height: 720, fps: 60, kbps: 4000 }, // 1-on-1: 720p at 60fps
    { upTo: 4, width: 1280, height: 720, fps: 30, kbps: 1500 }, // 3-4 people: 720p at 30fps
    { upTo: Infinity, width: 640, height: 360, fps: 24, kbps: 600 }, // 5-8 people: 360p
  ];
  function profile() {
    const people = room ? [...peers.keys()].length : 1; // includes yourself
    return PROFILES.find((q) => people <= q.upTo);
  }
  function videoConstraints(q) {
    return { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps, max: q.fps } };
  }
  let appliedProfile = null;
  async function applyQuality(force) {
    const q = profile();
    const vt = local.sharing ? null : track("video");
    if (vt && (force || q !== appliedProfile)) {
      vt.contentHint = "motion";
      // Prefer keeping full 720p and dropping to the camera's best frame rate (often 30)
      // over a lower resolution at 60fps. Cameras that can't do 720p get their best size.
      try { await vt.applyConstraints({ ...videoConstraints(q), height: { min: q.height, ideal: q.height } }); }
      catch { try { await vt.applyConstraints(videoConstraints(q)); } catch {} }
    }
    appliedProfile = q;
    for (const p of peers.values()) if (p.pc) applySenderQuality(p.pc, q);
  }
  async function applySenderQuality(pc, q) {
    const t = transceiverFor(pc, "video");
    if (!t) return;
    try {
      const params = t.sender.getParameters();
      if (!params.encodings || !params.encodings.length) return; // not negotiated yet
      params.encodings[0].maxBitrate = q.kbps * 1000;
      params.encodings[0].maxFramerate = q.fps;
      if (q.fps >= 60) params.degradationPreference = "maintain-framerate";
      else params.degradationPreference = "balanced";
      await t.sender.setParameters(params);
    } catch (e) { console.warn("quality setting failed", e); }
  }

  // ---------- Local media ----------
  async function getTrack(kind) {
    const constraints = kind === "audio"
      ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
      : { video: { facingMode: local.facing, ...videoConstraints(profile()) } };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    return s.getTracks()[0];
  }

  // Put a new local track in place (or remove it) and send it to everyone without renegotiating.
  function setLocalTrack(kind, newTrack) {
    const old = track(kind);
    if (old) { old.stop(); local.stream.removeTrack(old); }
    if (newTrack) local.stream.addTrack(newTrack);
    if (newTrack && kind === "video" && !local.sharing) { newTrack.contentHint = "motion"; applyQuality(true); }
    for (const p of peers.values()) {
      if (!p.pc) continue;
      const t = transceiverFor(p.pc, kind);
      if (t) t.sender.replaceTrack(newTrack).catch(() => {});
    }
    refreshLocalVideo();
  }

  function transceiverFor(pc, kind) {
    return pc.getTransceivers().find((t) => (t.receiver.track && t.receiver.track.kind) === kind);
  }

  async function setMic(on) {
    if (on && !track("audio")) {
      try { setLocalTrack("audio", await getTrack("audio")); }
      catch (e) { toast(mediaError(e, "microphone")); on = false; }
    }
    local.micOn = on;
    const t = track("audio");
    if (t) t.enabled = on; // keep the mic track alive so unmuting is instant
    renderLocalState();
  }

  async function setCam(on) {
    if (on) {
      if (!track("video")) {
        try { setLocalTrack("video", await getTrack("video")); }
        catch (e) { toast(mediaError(e, "camera")); on = false; }
      }
    } else {
      setLocalTrack("video", null); // fully release the camera so its light turns off
    }
    local.camOn = on && !!track("video");
    renderLocalState();
  }

  // Switch between the front and back camera.
  // Most phones can't open two cameras at once, so the current one is released first,
  // and the other camera is asked for by name ("exact") so the phone can't hand back the same one.
  let flipping = false;
  async function flipCamera() {
    if (flipping || local.sharing) return;
    const target = local.facing === "user" ? "environment" : "user";
    if (!local.camOn) { local.facing = target; renderLocalState(); return; }
    flipping = true;
    const oldId = track("video") && track("video").getSettings().deviceId;
    setLocalTrack("video", null); // release the current camera
    const q = videoConstraints(profile());
    const tries = [
      { video: { ...q, facingMode: { exact: target } } },
      async () => {
        // Some phones ignore facingMode; pick a different camera from the list instead.
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        const want = target === "environment" ? /back|rear|environment/i : /front|user|face/i;
        const pick = cams.find((d) => want.test(d.label)) || cams.find((d) => d.deviceId && d.deviceId !== oldId);
        return pick ? { video: { ...q, deviceId: { exact: pick.deviceId } } } : null;
      },
      { video: { ...q, facingMode: target } },
    ];
    let newTrack = null;
    for (const t of tries) {
      try {
        const c = typeof t === "function" ? await t() : t;
        if (!c) continue;
        const st = await navigator.mediaDevices.getUserMedia(c);
        newTrack = st.getVideoTracks()[0];
        if (newTrack && newTrack.getSettings().deviceId && newTrack.getSettings().deviceId === oldId && t !== tries[2]) {
          newTrack.stop(); newTrack = null; continue; // same camera again, try the next way
        }
        if (newTrack) break;
      } catch {}
    }
    if (newTrack) {
      local.facing = target;
    } else {
      // Couldn't get the other camera: put the original one back.
      toast("Couldn't switch camera");
      try { newTrack = await getTrack("video"); } catch {}
    }
    if (newTrack) setLocalTrack("video", newTrack);
    else { local.camOn = false; }
    flipping = false;
    renderLocalState();
  }

  function mediaError(e, what) {
    if (e && e.name === "NotAllowedError") return `Allow ${what} access in your browser settings`;
    if (e && e.name === "NotFoundError") return `No ${what} found`;
    if (!window.isSecureContext) return `Calls need https to use the ${what}`;
    return `Couldn't start the ${what}`;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => detectFlip());
  }
  async function detectFlip() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      els.flipBtn.hidden = devs.filter((d) => d.kind === "videoinput").length < 2;
    } catch { els.flipBtn.hidden = true; }
  }

  function refreshLocalVideo() {
    const v = track("video") ? new MediaStream([track("video")]) : null;
    els.previewVideo.srcObject = v;
    const self = peers.get("self");
    if (self) self.tile.video.srcObject = v;
  }

  // ---------- Lobby ----------
  function renderLobbyButtons() {
    setCtl(els.pMic, local.micOn, I.mic, I.micOff);
    setCtl(els.pCam, local.camOn, I.cam, I.camOff);
    els.previewOff.hidden = local.camOn;
    els.previewAvatar.textContent = initials(myName());
  }
  function setCtl(btn, on, onIcon, offIcon) {
    btn.innerHTML = on ? onIcon : offIcon;
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-pressed", String(!on));
  }

  function renderLocalState() {
    renderLobbyButtons();
    setCtl(els.micBtn, local.micOn, I.mic, I.micOff);
    setCtl(els.camBtn, local.camOn, I.cam, I.camOff);
    const self = peers.get("self");
    if (self) {
      self.tile.el.classList.toggle("cam-off", !local.camOn);
      self.tile.el.classList.toggle("mic-muted", !local.micOn);
      self.tile.el.classList.toggle("rear", local.facing === "environment");
    }
    sendState();
  }

  async function initPreview() {
    els.nameInput.value = store.get("huddle:name") || "";
    const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
    if (m) els.codeInput.value = cleanCode(m[1]);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      local.micOn = local.camOn = false;
      els.previewMsg.textContent = window.isSecureContext ? "This browser can't do calls" : "Open this page over https to use camera/mic";
      renderLobbyButtons();
      return;
    }
    // Ask for both at once so there's a single permission prompt.
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: "user", ...videoConstraints(profile()) },
      });
      s.getTracks().forEach((t) => local.stream.addTrack(t));
    } catch {
      // Maybe only one device is available or allowed; try them separately.
      try { local.stream.addTrack(await getTrack("audio")); } catch { local.micOn = false; }
      try { local.stream.addTrack(await getTrack("video")); } catch { local.camOn = false; els.previewMsg.textContent = "Camera unavailable"; }
    }
    refreshLocalVideo();
    applyQuality(true);
    detectFlip();
    renderLobbyButtons();
  }

  els.pMic.onclick = () => setMic(!local.micOn);
  els.pCam.onclick = () => setCam(!local.camOn);
  els.nameInput.oninput = renderLobbyButtons;
  els.startBtn.onclick = () => joinRoom(randomCode());
  els.joinForm.onsubmit = (e) => {
    e.preventDefault();
    const code = cleanCode(els.codeInput.value);
    if (!code) { els.lobbyError.textContent = "Enter a room code"; return; }
    joinRoom(code);
  };

  // ---------- Signaling ----------
  function joinRoom(code) {
    els.lobbyError.textContent = "";
    // Start audio during the tap; phones only allow audio that starts from a tap.
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
    } catch {}
    store.set("huddle:name", myName());
    configReady = loadConfig();
    leaving = false;
    els.startBtn.disabled = true;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", room: code, name: myName(), state: myState() }));
    // Handle messages strictly in order, so an offer never arrives before its peer exists.
    let queue = Promise.resolve();
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      queue = queue.then(() => onSignal(m)).catch((e) => console.warn("signal", e));
    };
    ws.onclose = () => {
      els.startBtn.disabled = false;
      if (room && !leaving) {
        if (away && isNativeApp) {
          // The Android app keeps running in the background, so reconnect right away.
          const code = room;
          leaveRoom(true);
          setTimeout(() => { if (!room) joinRoom(code); }, 1500);
        } else if (away) {
          // The phone dropped the connection while locked. Rejoin when they come back.
          rejoinCode = room;
          leaveRoom();
        } else {
          toast("Lost connection to the call");
          leaveRoom();
        }
      }
    };
    ws.onerror = () => {
      if (!room) els.lobbyError.textContent = navigator.onLine === false
        ? "You're offline. Connect to the internet to join a call."
        : "Couldn't reach the call server";
    };
  }

  const myState = () => ({ mic: local.micOn, cam: local.camOn });
  function sendState() {
    if (ws && ws.readyState === 1 && room) ws.send(JSON.stringify({ type: "state", state: myState() }));
  }
  function signal(to, data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "signal", to, data }));
  }

  async function onSignal(msg) {
    switch (msg.type) {
      case "joined":
        // Make sure we know the relay servers before connecting to anyone.
        await Promise.race([configReady, new Promise((r) => setTimeout(r, 3000))]);
        myId = msg.id;
        room = msg.room;
        enterCallUI();
        native("startCall").catch(() => {});
        // The newcomer calls everyone already in the room.
        for (const p of msg.peers) createPeer(p.id, p.name, p.state, true);
        updateCount();
        for (const m of msg.chat || []) addChat(m, false);
        window.dispatchEvent(new Event("huddle:joined"));
        break;
      case "peer-joined":
        await Promise.race([configReady, new Promise((r) => setTimeout(r, 3000))]);
        createPeer(msg.id, msg.name, msg.state, false);
        updateCount();
        if (!els.volumePop.hidden) renderPeerVolumes();
        toast(`${msg.name} joined`);
        break;
      case "peer-left": {
        const p = peers.get(msg.id);
        if (p) { toast(`${p.name} left`); removePeer(msg.id); }
        break;
      }
      case "game-state":
        for (const cb of gameListeners[msg.game] || []) { try { cb(msg.state); } catch (e) { console.error(e); } }
        break;
      case "peer-state": {
        const p = peers.get(msg.id);
        if (p) { p.state = msg.state; renderPeerState(p); }
        break;
      }
      case "chat":
        addChat(msg, true);
        break;
      case "signal":
        handleRtc(msg.from, msg.data);
        break;
      case "error":
        els.startBtn.disabled = false;
        els.lobbyError.textContent = msg.reason === "room_full" ? `That room is full (max ${msg.max})` : "Couldn't join that room";
        leaving = true;
        ws.close();
        break;
    }
  }

  // ---------- WebRTC ----------
  function createPeer(id, name, state, initiator) {
    if (peers.has(id)) removePeer(id);
    const pc = new RTCPeerConnection({ iceServers: config.iceServers });
    const p = { id, pc, name, state: state || {}, stream: new MediaStream(), pending: [], initiator, tile: null, silentTracks: {} };
    peers.set(id, p);
    p.tile = makeTile(name, false);
    p.tile.video.srcObject = p.stream;
    applyVolume(p);
    renderPeerState(p);
    setStatus(p, "Connecting…");
    layoutGrid();
    // After a few seconds, make it clear the badge can be tapped for details.
    setTimeout(() => { if (peers.get(id) === p && pc.connectionState !== "connected") setStatus(p, "Connecting… tap for info"); }, 6000);

    pc.onicecandidate = (e) => { if (e.candidate) signal(id, { candidate: e.candidate }); };
    pc.ontrack = (e) => {
      p.stream.addTrack(e.track);
      // If their phone stops sending (locked, app switched, frozen), show them as off
      // even if their "I'm muted" message never arrived.
      const kind = e.track.kind;
      e.track.onmute = () => { p.silentTracks[kind] = true; renderPeerState(p); };
      e.track.onunmute = () => { p.silentTracks[kind] = false; renderPeerState(p); };
      p.tile.video.srcObject = p.stream;
      p.tile.video.play().catch(() => {});
      if (e.track.kind === "audio") {
        routeThroughGain(p);
        watchSpeaking(p.stream, p.tile.el);
      }
      applyVolume(p);
    };
    // If we still aren't connected after a while, retry with fresh network paths, then report.
    p.tries = 0;
    p.watchdog = setInterval(() => {
      if (!peers.has(id) || pc.connectionState === "connected" || pc.connectionState === "closed") return;
      p.tries++;
      if (p.tries === 3) sendDiag(p);
      if (p.tries > 4) { setStatus(p, "Can't connect. Tap here for info"); return; }
      if (p.initiator) makeOffer(p, true);
      else signal(id, { restart: true });
    }, 9000);
    p.tile.status.onclick = (e) => { e.stopPropagation(); showDiag(p); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") { setStatus(p, ""); p.tries = 0; applySenderQuality(pc, profile()); }
      else if (s === "connecting" || s === "new") setStatus(p, "Connecting… tap for info");
      else if (s === "disconnected") setStatus(p, "Reconnecting…");
      else if (s === "failed") {
        setStatus(p, "Connection trouble…");
        if (p.initiator) makeOffer(p, true);
      }
    };

    if (initiator) {
      // Always create both an audio and a video slot so turning the camera/mic on later
      // just swaps the track in, with no renegotiation.
      for (const kind of ["audio", "video"]) {
        const t = track(kind);
        pc.addTransceiver(t || kind, { direction: "sendrecv", streams: [local.stream] });
      }
      makeOffer(p, false);
    }
    return p;
  }

  async function makeOffer(p, iceRestart) {
    try {
      const offer = await p.pc.createOffer({ iceRestart });
      await p.pc.setLocalDescription(offer);
      signal(p.id, { sdp: p.pc.localDescription });
    } catch (e) { console.warn("offer failed", e); }
  }

  async function handleRtc(from, data) {
    const p = peers.get(from);
    if (!p) return;
    const pc = p.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          for (const t of pc.getTransceivers()) {
            t.direction = "sendrecv";
            const kind = t.receiver.track.kind;
            const lt = track(kind);
            if (lt && t.sender.track !== lt) await t.sender.replaceTrack(lt);
            try { t.sender.setStreams && t.sender.setStreams(local.stream); } catch {}
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(from, { sdp: pc.localDescription });
        }
        for (const c of p.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.restart) {
        if (p.initiator && pc.connectionState !== "connected") makeOffer(p, true);
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else p.pending.push(data.candidate);
      }
    } catch (e) { console.warn("signal handling failed", e); }
  }

  // What network paths did each side find? host = same wifi, srflx = through the internet,
  // relay = through the TURN relay. Shown when you tap "Connecting…", and sent to the server log.
  async function diag(p) {
    const d = { ice: p.pc.iceConnectionState, conn: p.pc.connectionState, gather: p.pc.iceGatheringState,
      signal: p.pc.signalingState, relayConfigured: !!config.relay, native: isNativeApp, ua: navigator.userAgent.slice(0, 160),
      local: {}, remote: {}, pair: null };
    try {
      const stats = await p.pc.getStats();
      const byId = new Map();
      stats.forEach((r) => byId.set(r.id, r));
      stats.forEach((r) => {
        if (r.type === "local-candidate") d.local[r.candidateType + "/" + r.protocol] = (d.local[r.candidateType + "/" + r.protocol] || 0) + 1;
        if (r.type === "remote-candidate") d.remote[r.candidateType + "/" + r.protocol] = (d.remote[r.candidateType + "/" + r.protocol] || 0) + 1;
        if (r.type === "transport" && r.selectedCandidatePairId) {
          const pair = byId.get(r.selectedCandidatePairId);
          if (pair) d.pair = `${(byId.get(pair.localCandidateId) || {}).candidateType}->${(byId.get(pair.remoteCandidateId) || {}).candidateType} ${pair.state}`;
        }
      });
    } catch {}
    return d;
  }
  async function sendDiag(p) {
    const d = await diag(p);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "diag", data: d }));
  }
  async function showDiag(p) {
    const d = await diag(p);
    const list = (o) => Object.keys(o).join(", ") || "none";
    toast(`Connection: ${d.ice}. Your paths: ${list(d.local)}. Their paths: ${list(d.remote)}. Relay: ${d.relayConfigured ? "on" : "off"}.`, 9000);
  }

  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc && p.pc.close(); } catch {}
    clearInterval(p.watchdog);
    p.tile.el.remove();
    if (p.tile.stopSpeaking) p.tile.stopSpeaking();
    if (p.gainSrc) try { p.gainSrc.disconnect(); p.gain.disconnect(); } catch {}
    peers.delete(id);
    sound.per.delete(id);
    if (focusedId === id) setFocus(defaultFocus());
    if (!els.volumePop.hidden) renderPeerVolumes();
    updateCount();
    layoutGrid();
  }

  // ---------- Tiles ----------
  function makeTile(name, isSelf) {
    const el = document.createElement("div");
    el.className = "tile" + (isSelf ? " self" : "");
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    // Android's app view draws a big grey "play" icon on videos without a poster; hide it.
    video.poster = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    if (isSelf) video.muted = true;
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "avatar-wrap";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(name);
    avatarWrap.append(avatar);
    const label = document.createElement("div");
    label.className = "label";
    const mic = document.createElement("span");
    mic.className = "mic-off";
    mic.innerHTML = I.micOff;
    const nm = document.createElement("span");
    nm.textContent = isSelf ? `${name} (you)` : name;
    label.append(mic, nm);
    const status = document.createElement("div");
    status.className = "status";
    el.append(video, avatarWrap, label, status);
    els.grid.append(el);
    return { el, video, status };
  }

  function setStatus(p, text) { p.tile.status.textContent = text; }

  function renderPeerState(p) {
    const st = p.silentTracks || {};
    p.tile.el.classList.toggle("cam-off", !p.state.cam || !!st.video);
    p.tile.el.classList.toggle("mic-muted", !p.state.mic);
  }

  function layoutGrid() {
    const visible = els.grid.querySelectorAll(".tile:not(.self-hidden)").length;
    els.emptyState.hidden = visible > 0 || !room;
    const n = visible || 1;
    const w = els.grid.clientWidth || window.innerWidth;
    const h = els.grid.clientHeight || window.innerHeight;
    // Pick the column count that makes tiles as large as possible (tiles ~4:3).
    let best = 1, bestArea = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const tw = w / cols, th = h / rows;
      const tileW = Math.min(tw, th * 4 / 3);
      const area = tileW * (tileW * 3 / 4);
      if (area > bestArea) { bestArea = area; best = cols; }
    }
    els.grid.style.setProperty("--cols", best);
    els.grid.style.gridTemplateRows = `repeat(${Math.ceil(n / best)}, minmax(0, 1fr))`;
  }
  window.addEventListener("resize", layoutGrid);

  // If someone's video stops arriving (their phone locked and paused the page, or froze),
  // show their avatar instead of a frozen picture, even if they never told us.
  setInterval(async () => {
    for (const p of peers.values()) {
      if (!p.pc || p.pc.connectionState !== "connected") continue;
      try {
        let frames = null;
        (await p.pc.getStats()).forEach((r) => {
          if (r.type === "inbound-rtp" && r.kind === "video") frames = r.framesDecoded || 0;
        });
        if (frames === null) continue;
        const stalled = frames === p.lastFrames;
        p.lastFrames = frames;
        p.stallCount = stalled ? (p.stallCount || 0) + 1 : 0;
        const paused = p.stallCount >= 2; // ~3 seconds with no new frames
        if (paused !== !!p.silentTracks.video) { p.silentTracks.video = paused; renderPeerState(p); }
      } catch {}
    }
  }, 1500);

  function updateCount() {
    els.peopleCount.textContent = String(peers.size);
    applyQuality(false);
  }

  // Speaking indicator: glow the tile when someone's audio level is up.
  let audioCtx = null;
  function watchSpeaking(stream, el) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(stream);
      const an = audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let hold = 0;
      const timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) * (v - 128);
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 6) hold = 4; else if (hold > 0) hold--;
        el.classList.toggle("speaking", hold > 0);
      }, 100);
      const tileRef = [...peers.values()].find((p) => p.tile.el === el);
      if (tileRef) tileRef.tile.stopSpeaking = () => { clearInterval(timer); src.disconnect(); };
    } catch {}
  }

  // ---------- Call screen ----------
  function enterCallUI() {
    els.lobby.hidden = true;
    els.call.hidden = false;
    els.roomCode.textContent = room;
    history.replaceState(null, "", `/r/${room}`);
    const self = { id: "self", name: myName(), tile: makeTile(myName(), true), pc: null };
    peers.set("self", self);
    renderSelfView();
    refreshLocalVideo();
    const at = track("audio");
    if (at) watchSpeaking(new MediaStream([at]), self.tile.el);
    renderLocalState();
    applyAllVolumes();
    layoutGrid();
    updateCount();
  }

  function leaveRoom(keepService) {
    leaving = true;
    if (!keepService) native("endCall").catch(() => {});
    if (local.sharing) stopShare();
    exitFullscreen(true);
    for (const id of [...peers.keys()]) removePeer(id);
    if (ws) { try { ws.close(); } catch {} ws = null; }
    room = null;
    myId = null;
    els.call.hidden = true;
    els.lobby.hidden = false;
    openPanel(null);
    toggleVolumePop(false);
    clearChat();
    els.startBtn.disabled = false;
    history.replaceState(null, "", "/");
    refreshLocalVideo();
    window.dispatchEvent(new Event("huddle:left"));
    setTimeout(checkVersion, 500);
  }

  els.micBtn.onclick = () => setMic(!local.micOn);
  els.camBtn.onclick = async () => {
    if (local.sharing) { camWasOn = true; await stopShare(); return; }
    setCam(!local.camOn);
  };
  els.flipBtn.onclick = flipCamera;

  // ---------- Screen sharing (computers) ----------
  // Phone browsers (Android and iPhone) don't let web pages share the screen, so the button
  // only appears where it works: Chrome, Edge, Firefox and Safari on computers.
  const shareBtn = $("shareBtn");
  const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5"/></svg>';
  // The Huddle Android app can share the screen too, through Android's own screen capture.
  const canShare = isNativeApp || (!!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) &&
    !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  shareBtn.hidden = !canShare;
  shareBtn.innerHTML = SHARE_ICON;
  local.sharing = false;
  let camWasOn = false;
  function renderShare() {
    shareBtn.classList.toggle("on-accent", local.sharing);
    shareBtn.title = local.sharing ? "Stop sharing" : "Share your screen";
    shareBtn.setAttribute("aria-label", shareBtn.title);
    shareBtn.setAttribute("aria-pressed", String(local.sharing));
    const self = peers.get("self");
    if (self) self.tile.el.classList.toggle("sharing", local.sharing);
  }
  // Android app: Android sends screen frames as pictures; we paint them onto a canvas and
  // send that canvas as the video, so everyone in the call sees the phone screen.
  let nativeShare = null;
  async function startNativeShare() {
    try {
      await native("startScreenShare");
    } catch (e) {
      if (!/denied/i.test((e && (e.message || e.code)) || "")) toast("Couldn't share your screen");
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(0);
    const t = stream.getVideoTracks()[0];
    const s = { canvas, ctx, track: t, busy: false, listeners: [] };
    s.listeners.push(Cap.addListener("HuddleNative", "screenFrame", (f) => {
      if (s.busy || !f || !f.data) return; // drop frames while the last one is still drawing
      s.busy = true;
      const img = new Image();
      img.onload = () => {
        if (canvas.width !== f.width || canvas.height !== f.height) { canvas.width = f.width; canvas.height = f.height; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (t.requestFrame) t.requestFrame();
        s.busy = false;
      };
      img.onerror = () => { s.busy = false; };
      img.src = "data:image/jpeg;base64," + f.data;
    }));
    s.listeners.push(Cap.addListener("HuddleNative", "screenShareStopped", () => stopShare()));
    nativeShare = s;
    return t;
  }
  function endNativeShare() {
    const s = nativeShare;
    if (!s) return;
    nativeShare = null;
    for (const l of s.listeners) { try { l.remove(); } catch {} }
    try { s.track.stop(); } catch {}
    native("stopScreenShare").catch(() => {});
  }

  async function startShare() {
    let screen;
    if (isNativeApp) {
      screen = await startNativeShare();
      if (!screen) return;
    } else try {
      const st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
      screen = st.getVideoTracks()[0];
    } catch (e) {
      if (e && e.name !== "NotAllowedError") toast("Couldn't share your screen");
      return;
    }
    camWasOn = local.camOn;
    local.sharing = true;
    screen.contentHint = "detail"; // keep text sharp
    screen.addEventListener("ended", stopShare); // the browser's own "Stop sharing" button
    setLocalTrack("video", screen);
    local.camOn = true; // others see your screen in your tile
    renderShare();
    renderLocalState();
    toast("You're sharing your screen");
  }
  async function stopShare() {
    if (!local.sharing) return;
    local.sharing = false;
    endNativeShare();
    let cam = null;
    if (camWasOn) { try { cam = await getTrack("video"); } catch {} }
    setLocalTrack("video", cam);
    local.camOn = !!cam;
    renderShare();
    renderLocalState();
  }
  shareBtn.onclick = () => (local.sharing ? stopShare() : startShare());
  els.leaveBtn.onclick = () => leaveRoom();
  // One side panel at a time: chat or game.
  let currentPanel = null;
  function openPanel(name) {
    currentPanel = name;
    els.chatPanel.hidden = name !== "chat";
    els.gamePanel.hidden = name !== "game";
    els.call.classList.toggle("panel-open", !!name);
    renderGameMode();
    els.chatBtn.classList.toggle("on-accent", name === "chat");
    els.gameBtn.classList.toggle("on-accent", name === "game");
    if (name === "chat") {
      unread = 0;
      renderBadge();
      els.chatList.scrollTop = els.chatList.scrollHeight;
    } else if (document.activeElement === els.chatInput) {
      els.chatInput.blur();
    }
    requestAnimationFrame(layoutGrid);
    window.dispatchEvent(new CustomEvent("huddle:panel", { detail: name }));
  }
  els.gameBtn.onclick = () => openPanel(currentPanel === "game" ? null : "game");
  els.closeGame.onclick = () => openPanel(null);
  els.chatBtn.onclick = () => {
    const opening = currentPanel !== "chat";
    openPanel(opening ? "chat" : null);
    // On computers, jump straight into typing. On phones, wait for a tap on the box
    // so the keyboard doesn't pop up unexpectedly.
    if (opening && window.matchMedia("(hover: hover) and (pointer: fine)").matches) els.chatInput.focus();
  };
  els.closeChat.onclick = () => openPanel(null);

  // ---------- Chat ----------
  let unread = 0;
  function renderBadge() {
    els.chatBadge.hidden = unread === 0;
    els.chatBadge.textContent = unread > 9 ? "9+" : String(unread);
  }
  function addChat(m, live) {
    const mine = m.from === myId;
    els.chatEmpty.hidden = true;
    const li = document.createElement("li");
    li.className = "msg" + (mine ? " mine" : "");
    const meta = document.createElement("div");
    meta.className = "meta";
    const who = document.createElement("b");
    who.textContent = mine ? "You" : m.name;
    const time = document.createElement("time");
    const d = new Date(m.ts);
    time.dateTime = d.toISOString();
    time.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    meta.append(who, time);
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.text;
    li.append(meta, bubble);
    const atBottom = els.chatList.scrollHeight - els.chatList.scrollTop - els.chatList.clientHeight < 60;
    els.chatList.append(li);
    if (atBottom || mine) els.chatList.scrollTop = els.chatList.scrollHeight;
    if (live && !mine && currentPanel !== "chat") {
      unread++;
      renderBadge();
      toast(`${m.name}: ${m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text}`, 3000);
    }
  }
  function clearChat() {
    for (const li of [...els.chatList.querySelectorAll(".msg")]) li.remove();
    els.chatEmpty.hidden = false;
    unread = 0;
    renderBadge();
  }
  const syncSend = () => (els.chatSend.disabled = !els.chatInput.value.trim());
  els.chatInput.oninput = syncSend;
  els.chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "chat", text }));
    els.chatInput.value = "";
    syncSend();
    els.chatInput.focus(); // keep the keyboard open for the next message
  };
  syncSend();

  // ---------- Phone keyboard ----------
  // Keep the call screen sized to the part of the screen the keyboard isn't covering.
  const root = document.documentElement;
  function syncViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    root.style.setProperty("--app-h", `${vv.height}px`);
    root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    layoutGrid();
    if (document.activeElement === els.chatInput) els.chatList.scrollTop = els.chatList.scrollHeight;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewport);
    window.visualViewport.addEventListener("scroll", syncViewport);
  }
  els.chatInput.addEventListener("focus", () => { document.body.classList.add("typing"); requestAnimationFrame(syncViewport); });
  els.chatInput.addEventListener("blur", () => { document.body.classList.remove("typing"); requestAnimationFrame(syncViewport); });
  els.inviteBtn.onclick = async () => {
    const link = `${location.origin}/r/${room}`;
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        await navigator.share({ title: "Join my Huddle call", url: link });
      } else {
        await navigator.clipboard.writeText(link);
        toast("Invite link copied");
      }
    } catch { toast(link, 5000); }
  };
  window.addEventListener("pagehide", () => { if (ws) ws.close(); });

  // ---------- Locking the phone / leaving the app ----------
  // The call keeps going: mic, camera and sound stay on as long as the phone lets the page run.
  // (iPhones pause web pages soon after locking; if the call drops, we rejoin on return.)
  // In the lobby, the camera preview is released while hidden and restored on return.
  let away = false;
  let rejoinCode = null;
  let lobbyRestore = null;
  function goAway() {
    if (away) return;
    away = true;
    if (!room) {
      lobbyRestore = { mic: local.micOn, cam: local.camOn };
      setLocalTrack("audio", null);
      setLocalTrack("video", null);
    }
  }
  async function comeBack() {
    if (!away) return;
    away = false;
    // iPhones pause videos and audio while locked; start them again.
    resumeAudio();
    for (const p of peers.values()) if (p.pc) p.tile.video.play().catch(() => {});
    // The phone may have stopped the camera/mic while locked; get fresh ones if so.
    if (room) {
      for (const kind of ["audio", "video"]) {
        const t = track(kind);
        const wanted = kind === "audio" ? local.micOn : local.camOn;
        if (wanted && (!t || t.readyState === "ended")) {
          try { setLocalTrack(kind, await getTrack(kind)); if (kind === "audio") track("audio").enabled = local.micOn; } catch {}
        }
      }
    }
    if (rejoinCode) {
      const code = rejoinCode;
      rejoinCode = null;
      joinRoom(code);
      toast("Reconnected to the call", 3000);
    } else if (!room && lobbyRestore) {
      const r = lobbyRestore;
      lobbyRestore = null;
      if (r.mic) await setMic(true);
      if (r.cam) await setCam(true);
    }
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? goAway() : comeBack()));
  if (document.hidden) away = true;

  // ---------- Installable app ----------
  // iPhone Safari suspends audio after interruptions (calls, lock); any tap wakes it back up.
  function resumeAudio() {
    try { if (audioCtx && audioCtx.state !== "running") audioCtx.resume(); } catch {}
  }
  document.addEventListener("touchend", resumeAudio, { passive: true });
  document.addEventListener("click", resumeAudio);

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // "Get the app": the popup shows the right install steps for this phone or computer.
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const browser = (() => {
    if (/SamsungBrowser/i.test(ua)) return "samsung";
    if (/EdgA\//.test(ua)) return "edge-android";
    if (/EdgiOS/.test(ua)) return "edge-ios";
    if (/Edg\//.test(ua)) return "edge";
    if (/OPR\/|Opera/.test(ua)) return "opera";
    if (/CriOS/.test(ua)) return "chrome-ios";
    if (/FxiOS/.test(ua)) return "firefox-ios";
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Chrome\//.test(ua)) return "chrome";
    if (/Safari\//.test(ua)) return "safari";
    return "other";
  })();
  const ICON = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 12v8h14v-8"/></svg>',
    addHome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M12 8v6M9 11l3 3 3-3"/></svg>',
  };
  const key = (icon, label) => `<span class="key">${icon || ""}${label}</span>`;
  const DOTS_V = key(ICON.dots, "");          // ⋮ three dots, Chrome
  const DOTS_H = key("", "···");              // ⋯ three dots, Edge
  const notSeen = "Don't see it? Your browser may not support installing. You can keep using Huddle right here, or open this link in Chrome.";
  function installSteps() {
    // Returns { steps: [...html], note }
    if (isIOS) {
      if (browser === "safari") return { steps: [
        `Tap ${key(ICON.share, "Share")} at the bottom of the screen`,
        `Scroll down and tap ${key(ICON.addHome, "Add to Home Screen")}`,
        `Tap ${key("", "Add")} in the top corner`,
      ], note: "Huddle will show up on your home screen like any other app." };
      return { steps: [
        `Tap ${key(ICON.share, "Share")} next to the address bar`,
        `Tap ${key(ICON.addHome, "Add to Home Screen")}`,
        `Tap ${key("", "Add")}`,
      ], note: "Don't see it? Open this link in Safari and try again." };
    }
    if (isAndroid) {
      if (browser === "samsung") return { steps: [
        `Tap the ${key(ICON.menu, "")} three lines at the bottom right`,
        `Tap ${key("", "Add page to")}, then ${key("", "Home screen")}`,
      ], note: notSeen };
      if (browser === "edge-android") return { steps: [
        `Tap ${DOTS_H} at the bottom of the screen`,
        `Tap ${key(ICON.addHome, "Add to phone")}`,
      ], note: notSeen };
      if (browser === "firefox") return { steps: [
        `Tap the ${DOTS_V} three dots`,
        `Tap ${key(ICON.install, "Install")} or ${key("", "Add to Home screen")}`,
      ], note: notSeen };
      // Chrome on Android. Links opened from other apps (Messages, Instagram, Discord, Snapchat...)
      // often open in that app's built-in browser, which can't install apps. Chrome itself can.
      return { steps: [
        `If this opened inside another app, tap ${DOTS_V} and choose ${key("", "Open in Chrome")} first`,
        `In Chrome, tap ${DOTS_V} at the top right`,
        `Tap ${key(ICON.install, "Install app")} (or ${key(ICON.addHome, "Add to Home screen")}, then ${key("", "Install")})`,
      ], openInChrome: true };
    }
    // Computers
    if (browser === "edge") return { steps: [
      `Click the ${DOTS_H} three dots at the top right`,
      `Click ${key("", "Apps")}, then ${key(ICON.install, "Install Huddle")}`,
    ], note: "You can also click the app icon at the right end of the address bar. Don't see either? Refresh the page and try again." };
    if (browser === "chrome" || browser === "opera") return { steps: [
      `Click the ${key(ICON.install, "")} install icon at the right end of the address bar`,
      `Or click the ${DOTS_V} three dots, then ${key("", "Cast, save, and share")}, then ${key("", "Install page as app")}`,
    ], note: "Don't see either? Refresh the page and try again." };
    if (browser === "safari") return { steps: [
      `In the menu bar, click ${key("", "File")}`,
      `Click ${key(ICON.addHome, "Add to Dock")}`,
    ], note: "Needs macOS Sonoma or newer." };
    if (browser === "firefox") return { steps: [], note: "Firefox can't install web apps. Huddle works fine right here in the browser, or open this link in Chrome or Edge to install it." };
    return { steps: [], note: "This browser can't install web apps. Huddle works fine right here, or open this link in Chrome to install it." };
  }

  const sheet = $("installSheet");
  const sheetBody = $("sheetBody");
  const sheetInstall = $("sheetInstall");
  const getAppBtn = $("getAppBtn");
  let installEvent = window.__installEvent || null;
  const SEEN_KEY = "huddle:installPromptSeen";

  // Android phones can get the full Huddle app (screen sharing, keeps running when locked).
  const APK_URL = "https://github.com/LandonWebster/Huddle/releases/latest/download/huddle.apk";
  const apkBlock = () =>
    `<a class="btn primary apk-btn" href="${APK_URL}" download>Download the Android app</a>` +
    `<ol class="steps apk-steps">` +
    `<li><span>Open ${key("", "huddle.apk")} when it finishes downloading</span></li>` +
    `<li><span>If Android asks, tap ${key("", "Settings")} and turn on ${key("", "Allow from this source")}, then go back</span></li>` +
    `<li><span>Tap ${key("", "Install")}</span></li>` +
    `</ol>` +
    `<p class="sheet-note">The app adds screen sharing and keeps your call going when you lock your phone. Chrome may say the file could be harmful because it isn't from the Play Store; tap ${key("", "Download anyway")}.</p>`;
  function renderSheet() {
    const sub = $("sheetSub");
    if (isAndroid) {
      sheetInstall.hidden = true;
      sub.textContent = "Free, no Play Store needed. Download it straight to your phone.";
      sheetBody.innerHTML = apkBlock();
      return;
    }
    if (installEvent) {
      // The browser can install it in one tap.
      sheetBody.innerHTML = '<p class="sheet-note">One tap and Huddle is added to your home screen and app list.</p>';
      sheetInstall.hidden = false;
      return;
    }
    sheetInstall.hidden = true;
    const { steps, note, openInChrome } = installSteps();
    sheetBody.innerHTML =
      (openInChrome ? `<a class="btn primary open-chrome" href="${chromeIntent()}">Open in Chrome to install</a>` : "") +
      (steps.length ? `<ol class="steps">${steps.map((t) => `<li><span>${t}</span></li>`).join("")}</ol>` : "") +
      (note ? `<p class="sheet-note">${note}</p>` : "");
  }
  // Android link that opens this exact page in the Chrome app, even from another app's browser.
  function chromeIntent() {
    const u = new URL(location.href);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
  }
  function openSheet() {
    renderSheet();
    sheet.hidden = false;
    (sheetInstall.hidden ? $("sheetLater") : sheetInstall).focus({ preventScroll: true });
  }
  function closeSheet() {
    sheet.hidden = true;
    store.set(SEEN_KEY, "1");
  }
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });
  $("sheetLater").onclick = closeSheet;
  // When the browser offers it, "Get the app" starts the real install right away.
  async function startInstall() {
    const ev = installEvent;
    if (!ev) return false;
    installEvent = null;
    window.__installEvent = null;
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      sheet.hidden = true;
      store.set(SEEN_KEY, "1");
      if (choice && choice.outcome === "accepted") { toast("Huddle is installed"); getAppBtn.hidden = true; }
    } catch { return false; }
    return true;
  }
  getAppBtn.onclick = async () => { if (isAndroid || !(await startInstall())) openSheet(); };
  sheetInstall.onclick = async () => { if (!(await startInstall())) renderSheet(); };

  // Chrome, Edge, Opera and Samsung Internet hand us a real install offer (caught in index.html).
  window.addEventListener("huddle:installready", () => {
    installEvent = window.__installEvent;
    if (!sheet.hidden) renderSheet();
  });
  window.addEventListener("appinstalled", () => { getAppBtn.hidden = true; sheet.hidden = true; });

  if (!isStandalone() && !isNativeApp) {
    getAppBtn.hidden = false;
    // First time someone opens the link, show the popup on its own (once per device).
    if (store.get(SEEN_KEY) !== "1") setTimeout(() => { if (!room) openSheet(); }, 900);
  }

  // ---------- Self view & full screen ----------
  const VI = {
    selfOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    selfOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0M3 3l18 18"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 6l3 3-3 3M20 9h-5"/></svg>',
  };
  const selfBtn = $("selfBtn"), fsBtn = $("fsBtn"), fsControls = $("fsControls"), fsName = $("fsName");
  $("fsGame").innerHTML = I.game;
  $("fsFlip").innerHTML = I.flip;
  $("fsExit").innerHTML = VI.shrink;
  $("fsPerson").innerHTML = VI.person;
  fsBtn.innerHTML = VI.expand;

  // You don't see yourself unless you choose to.
  let showSelf = store.get("huddle:showSelf") === "1";
  function renderSelfView() {
    const self = peers.get("self");
    if (self) self.tile.el.classList.toggle("self-hidden", !showSelf);
    selfBtn.innerHTML = showSelf ? VI.selfOn : VI.selfOff;
    selfBtn.classList.toggle("on", showSelf);
    selfBtn.setAttribute("aria-pressed", String(showSelf));
    selfBtn.title = showSelf ? "Hide yourself" : "Show yourself";
    selfBtn.setAttribute("aria-label", selfBtn.title);
    layoutGrid();
  }
  selfBtn.onclick = () => {
    showSelf = !showSelf;
    store.set("huddle:showSelf", showSelf ? "1" : "0");
    renderSelfView();
  };
  renderSelfView();
  $("emptyInvite").onclick = () => els.inviteBtn.click();

  // Full screen: one person fills the screen. Tap anywhere to bring up the controls.
  let focusedId = null;
  let fullscreen = false;
  let uiTimer = null;
  const order = () => [...peers.keys()].filter((id) => id !== "self").concat("self");
  const defaultFocus = () => order()[0];
  function setFocus(id) {
    focusedId = id;
    for (const [pid, p] of peers) p.tile.el.classList.toggle("focused", pid === id);
    const p = peers.get(id);
    fsName.textContent = p ? (id === "self" ? "You" : p.name) : "";
  }
  function showUi() {
    els.call.classList.add("show-ui");
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => els.call.classList.remove("show-ui"), 4000);
  }
  function enterFullscreen() {
    fullscreen = true;
    try { history.pushState({ huddleFullscreen: true }, "", location.href); } catch {}
    setFocus(focusedId && peers.has(focusedId) ? focusedId : defaultFocus());
    els.call.classList.add("fullscreen");
    toggleVolumePop(false);
    if (currentPanel === "chat") openPanel(null);
    $("fsFlip").hidden = els.flipBtn.hidden;
    // Fills the app window with the video. We deliberately don't use the browser's own
    // full screen mode: on Android it pins a grey "To exit full screen, drag from the top" notice.
    els.call.classList.remove("show-ui");
  }
  function exitFullscreen(fromBack) {
    if (!fullscreen) return;
    fullscreen = false;
    if (!fromBack && history.state && history.state.huddleFullscreen) { try { history.back(); } catch {} }
    els.call.classList.remove("fullscreen", "show-ui");
    clearTimeout(uiTimer);
    for (const p of peers.values()) p.tile.el.classList.remove("focused");
    requestAnimationFrame(layoutGrid);
  }
  fsBtn.onclick = (e) => { e.stopPropagation(); enterFullscreen(); };
  selfBtn.addEventListener("click", (e) => e.stopPropagation());
  $("fsExit").onclick = (e) => { e.stopPropagation(); exitFullscreen(); };
  $("fsFlip").onclick = (e) => { e.stopPropagation(); showUi(); flipCamera(); };
  $("fsGame").onclick = (e) => {
    e.stopPropagation(); showUi();
    openPanel(currentPanel === "game" ? null : "game");
    $("fsGame").classList.toggle("on", currentPanel === "game");
  };
  $("fsPerson").onclick = (e) => {
    e.stopPropagation(); showUi();
    const ids = order();
    setFocus(ids[(ids.indexOf(focusedId) + 1) % ids.length]);
  };
  fsControls.addEventListener("click", (e) => e.stopPropagation());
  $("videoArea").addEventListener("click", (e) => {
    if (!fullscreen || e.target.closest(".side-panel")) return;
    if (els.call.classList.contains("show-ui")) { els.call.classList.remove("show-ui"); clearTimeout(uiTimer); }
    else showUi();
  });
  // Android back gesture/button leaves full screen instead of leaving the page.
  window.addEventListener("popstate", () => { if (fullscreen) exitFullscreen(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fullscreen) exitFullscreen(); });

  // ---------- Games ----------
  // While playing an in-app game (like Butter Clicker), the cameras sit in a strip across the
  // top third of the screen, starting at the top right, and the game fills the bottom two-thirds.
  let playingGame = false;
  function renderGameMode() {
    const on = playingGame && currentPanel === "game";
    try { if (on && fullscreen) exitFullscreen(); } catch {}
    els.call.classList.toggle("game-mode", on);
    requestAnimationFrame(layoutGrid);
  }
  window.addEventListener("huddle:playing", (e) => { playingGame = !!e.detail; renderGameMode(); });
  // Games live in public/games/ and render into #gameArea. They talk to the call through
  // window.huddle: send moves to the server, hear back the shared state for everyone.
  const gameListeners = {};
  window.huddle = {
    gameArea: $("gameArea"),
    peers,
    get room() { return room; },
    get myId() { return myId; },
    get name() { return myName(); },
    isNativeApp,
    isAndroid,
    isIOS,
    native,
    toast,
    sendGame(game, payload) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "game", game, ...payload }));
    },
    onGame(game, cb) {
      (gameListeners[game] = gameListeners[game] || []).push(cb);
      return () => { gameListeners[game] = gameListeners[game].filter((x) => x !== cb); };
    },
    get gameOpen() { return currentPanel === "game"; },
  };
  window.dispatchEvent(new Event("huddle:ready"));

  initPreview();
})();
