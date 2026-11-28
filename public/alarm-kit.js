// Alarm parts the Alarms tab (alarms.js) builds on: Huddle's own alarm sounds, playing a song or
// a sound (just a moment of it, on repeat, or the full song), vibration patterns, the looks for
// the alarm screen, a color wheel, and the songs / photos / videos people pick from their phone.
//
// Picked files stay on the device they were picked on (IndexedDB "huddle-alarm-media"); the
// alarm itself (saved with the account) only holds the file's id and name. In the Android app
// the files are also copied into the app (native AlarmMedia) so the phone's own alarm can play
// the song and show the picture with Huddle closed.
(() => {
  "use strict";
  const H = () => window.huddle || {};
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/alarms.css";
  document.head.appendChild(css);

  // ---------- Choices ----------
  const TONES = [
    { id: "chime", name: "Huddle chime" },
    { id: "bells", name: "Soft bells" },
    { id: "rise", name: "Sunrise" },
    { id: "marimba", name: "Marimba" },
    { id: "tune", name: "Pip's wake-up tune" },
    { id: "beep", name: "Classic beep" },
  ];
  const PHONE_TONE = { id: "phone", name: "Phone's alarm sound" }; // Android app only
  const APPS = {
    spotify: { name: "Spotify", home: "https://open.spotify.com", hosts: ["open.spotify.com", "spotify.link", "spotify.app.link"] },
    apple: { name: "Apple Music", home: "https://music.apple.com", hosts: ["music.apple.com", "itunes.apple.com"] },
    youtube: { name: "YouTube Music", home: "https://music.youtube.com", hosts: ["music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"] },
  };
  // Vibration patterns: on, off, on, off... (ms). Repeats until the alarm stops.
  const VIBS = [
    { id: "off", name: "Off", p: [] },
    { id: "gentle", name: "Gentle", p: [200, 800] },
    { id: "pulse", name: "Pulse", p: [400, 200, 400, 600] },
    { id: "heartbeat", name: "Heartbeat", p: [120, 100, 120, 700] },
    { id: "rapid", name: "Rapid", p: [80, 60, 80, 60, 80, 60, 80, 400] },
    { id: "strong", name: "Strong", p: [900, 300] },
    { id: "sos", name: "SOS", p: [100, 100, 100, 100, 100, 300, 300, 100, 300, 100, 300, 300, 100, 100, 100, 100, 100, 900] },
  ];
  const LOOKS = [
    { id: "glow", name: "Glow", css: (c) => `radial-gradient(420px 360px at 50% 35%, ${c}b3, transparent 70%), #07080c` },
    { id: "sunrise", name: "Sunrise", css: (c) => `linear-gradient(180deg, #1b1d4a 0%, ${c} 55%, #f97316 100%)` },
    { id: "night", name: "Night sky", css: (c) => `radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 70%, #fff, transparent), radial-gradient(1px 1px at 85% 60%, #fff, transparent), radial-gradient(1px 1px at 10% 85%, #fff, transparent), radial-gradient(360px 280px at 50% 100%, ${c}88, transparent), #05060f` },
    { id: "ocean", name: "Ocean", css: (c) => `linear-gradient(180deg, #031427, ${c} 70%, #22d3ee)` },
    { id: "plain", name: "Plain", css: (c) => c },
  ];
  const QUICK = ["#2f55e4", "#22d3ee", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#eab308", "#ef4444", "#ffffff", "#111318"];

  const DEFAULTS = () => ({
    routine: "none",
    sound: { kind: "tone", tone: "chime", start: 0, end: 30, full: false, vol: 80, ramp: true },
    vib: "pulse", vibStr: 2,
    screen: { kind: "look", look: "glow", shade: true },
    color: "#2f55e4", snoozeColor: "#22d3ee",
    more: { on: false, every: 5, count: 1 },
  });
  // An alarm with every setting filled in (alarms made before these settings existed get defaults).
  function full(a) {
    const d = DEFAULTS();
    return {
      ...d, ...a,
      sound: { ...d.sound, ...(a.sound || {}) },
      screen: { ...d.screen, ...(a.screen || {}) },
      more: { ...d.more, ...(a.more || {}) },
    };
  }
  const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  function appLink(app, link) {
    const A = APPS[app];
    if (!A) return "";
    try {
      const u = new URL(String(link || "").trim());
      if (u.protocol === "https:" && A.hosts.includes(u.hostname)) return u.href;
    } catch {}
    return A.home;
  }

  // ---------- Saved songs, photos and videos (this device) ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open("huddle-alarm-media", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("media");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function put(id, rec) {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction("media", "readwrite");
      tx.objectStore("media").put(rec, id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error("Not enough space on this device"));
    });
  }
  async function get(id) {
    if (!id) return null;
    try {
      const d = await db();
      return await new Promise((res) => {
        const r = d.transaction("media").objectStore("media").get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    } catch { return null; }
  }
  async function keys() {
    try {
      const d = await db();
      return await new Promise((res) => {
        const r = d.transaction("media").objectStore("media").getAllKeys();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => res([]);
      });
    } catch { return []; }
  }
  async function del(id) {
    try {
      const d = await db();
      d.transaction("media", "readwrite").objectStore("media").delete(id);
    } catch {}
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
  }
  const urls = new Map();
  async function url(id) {
    if (urls.has(id)) return urls.get(id);
    const m = await get(id);
    if (!m || !m.blob) return null;
    const u = URL.createObjectURL(m.blob);
    urls.set(id, u);
    return u;
  }
  const newId = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const MB = 1024 * 1024;
  // A picked song: kept as is (up to 40 MB). Returns { id, name, dur }.
  async function addSong(file) {
    if (file.size > 40 * MB) throw new Error("That song is too big. Pick one under 40 MB.");
    const dur = await new Promise((res) => {
      const a = new Audio();
      const u = URL.createObjectURL(file);
      a.preload = "metadata";
      a.onloadedmetadata = () => { URL.revokeObjectURL(u); res(Number.isFinite(a.duration) ? a.duration : 0); };
      a.onerror = () => { URL.revokeObjectURL(u); res(0); };
      a.src = u;
    });
    const id = newId();
    const name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Your song";
    await put(id, { blob: file, name, type: file.type || "audio/mpeg", kind: "song" });
    return { id, name, dur: Math.round(dur) };
  }
  // A picked photo (made smaller, so it loads fast) or video (up to 60 MB). Returns { id, name, kind }.
  async function addPicture(file) {
    const video = /^video\//.test(file.type);
    if (!video && !/^image\//.test(file.type)) throw new Error("Pick a photo or a video.");
    if (video && file.size > 60 * MB) throw new Error("That video is too big. Pick one under 60 MB.");
    let blob = file;
    if (!video) {
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
        cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
        blob = await new Promise((res) => cv.toBlob((b) => res(b || file), "image/jpeg", 0.86));
      } catch {}
    }
    const id = newId();
    const name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || (video ? "Your video" : "Your photo");
    await put(id, { blob, name, type: blob.type || file.type, kind: video ? "video" : "photo" });
    return { id, name, kind: video ? "video" : "photo" };
  }
  // Removes picked files no alarm uses any more (on this device, and in the Android app).
  async function prune(alarms) {
    const keep = new Set();
    for (const a of alarms) {
      if (a.sound && a.sound.file && a.sound.file.id) keep.add(a.sound.file.id);
      if (a.screen && a.screen.media && a.screen.media.id) keep.add(a.screen.media.id);
    }
    for (const k of await keys()) if (!keep.has(k)) del(k);
    if (H().isNativeApp && H().native) {
      H().native("alarmMedia", { op: "prune", keep: [...keep, ...TONES.map((t) => "tone-" + t.id)] }).catch(() => {});
      for (const id of Object.keys(nativeSaved)) if (!keep.has(id) && !id.startsWith("tone-")) delete nativeSaved[id];
    }
  }

  // ---------- Huddle's own sounds ----------
  // Each is a short loop, made here (no sound files to download), so the same sound plays in the
  // browser and, saved as a WAV file, from the Android app's alarm.
  const RATE = 22050;
  const NOTES = {
    chime: { len: 2, notes: [[660, 0, 0.6], [880, 0.18, 0.6], [990, 0.36, 0.6]] },
    bells: { len: 2.6, bell: true, notes: [[784, 0, 1.6], [1047, 0.55, 1.6], [880, 1.1, 1.4]] },
    rise: { len: 1.8, notes: [[523, 0, 0.45], [659, 0.15, 0.45], [784, 0.3, 0.45], [1047, 0.45, 0.8]] },
    marimba: { len: 1.6, wood: true, notes: [[392, 0, 0.35], [494, 0.25, 0.35], [587, 0.5, 0.35], [494, 0.75, 0.35], [587, 1.0, 0.35], [784, 1.15, 0.4]] },
    tune: { len: 2.6, notes: [[659, 0, 0.3], [784, 0.22, 0.3], [880, 0.44, 0.3], [784, 0.66, 0.3], [659, 0.88, 0.3], [587, 1.1, 0.3], [659, 1.32, 0.6]] },
    beep: { len: 1.2, square: true, notes: [[1000, 0, 0.1], [1000, 0.2, 0.1], [1000, 0.4, 0.1], [1000, 0.6, 0.1]] },
  };
  const toneCache = new Map();
  function samples(tone) {
    const id = NOTES[tone] ? tone : "chime";
    if (toneCache.has(id)) return toneCache.get(id);
    const spec = NOTES[id];
    const out = new Float32Array(Math.round(spec.len * RATE));
    for (const [f, at, dur] of spec.notes) {
      const s0 = Math.round(at * RATE), n = Math.min(out.length - s0, Math.round(dur * RATE));
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const env = Math.min(1, t / 0.01) * (spec.square ? (t < dur - 0.01 ? 1 : 0) : Math.exp(-t * (5 / dur)));
        let v;
        if (spec.square) v = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.35;
        else if (spec.bell) v = Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 3);
        else if (spec.wood) v = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t * 20);
        else v = Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(2 * Math.PI * f * 2 * t);
        out[s0 + i] += v * env * 0.32;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    toneCache.set(id, out);
    return out;
  }
  function wav(tone) {
    const s = samples(tone);
    const buf = new ArrayBuffer(44 + s.length * 2), v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + s.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, s.length * 2, true);
    for (let i = 0; i < s.length; i++) v.setInt16(44 + i * 2, s[i] * 32767, true);
    return new Blob([buf], { type: "audio/wav" });
  }

  // ---------- Playing an alarm's sound ----------
  // play(sound, { preview }) starts it and returns { stop }. A song plays the part picked (on
  // repeat) or the full song; "Start quiet, get louder" fades it in over 30 seconds.
  // Calls back onFallback() when the picked song isn't on this device (a Huddle sound plays).
  function play(sound, opts = {}) {
    const s = { ...DEFAULTS().sound, ...(sound || {}) };
    let ctx = null, src = null, stopped = false, timer = null;
    const handle = {
      stop() {
        stopped = true;
        clearTimeout(timer);
        try { src && src.stop(); } catch {}
        if (ctx) ctx.close().catch(() => {});
      },
    };
    (async () => {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        let buf = null, from = 0, to = 0;
        if (s.kind === "file" && s.file && s.file.id) {
          const m = await get(s.file.id);
          if (m && m.blob) {
            try { buf = await ctx.decodeAudioData(await m.blob.arrayBuffer()); } catch {}
          }
          if (!buf && opts.onFallback) opts.onFallback();
          if (buf && !s.full) {
            from = Math.max(0, Math.min(buf.duration - 1, Number(s.start) || 0));
            to = Math.max(from + 1, Math.min(buf.duration, Number(s.end) || buf.duration));
          }
        }
        if (stopped) return;
        if (!buf) {
          const x = samples(s.tone);
          buf = ctx.createBuffer(1, x.length, RATE);
          buf.copyToChannel(x, 0);
        }
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        if (to > from) { src.loopStart = from; src.loopEnd = to; }
        const g = ctx.createGain();
        const vol = Math.max(0.05, Math.min(1, (Number(s.vol) || 80) / 100));
        const now = ctx.currentTime;
        if (s.ramp && !opts.preview) {
          g.gain.setValueAtTime(vol * 0.08, now);
          g.gain.linearRampToValueAtTime(vol, now + 30);
        } else g.gain.setValueAtTime(vol, now);
        src.connect(g).connect(ctx.destination);
        src.start(0, from);
        if (opts.maxMs) timer = setTimeout(() => handle.stop(), opts.maxMs);
      } catch {}
    })();
    return handle;
  }

  // ---------- Vibration ----------
  function vibPattern(id, strength) {
    const v = VIBS.find((x) => x.id === id) || VIBS[2];
    const k = [0.6, 1, 1.4][Math.max(0, Math.min(2, (Number(strength) || 2) - 1))];
    return v.p.map((ms, i) => (i % 2 ? ms : Math.round(ms * k)));
  }
  // Vibrates in the pattern, over and over, until stop(). (Phones that allow it.)
  function vibrate(id, strength, once) {
    const p = vibPattern(id, strength);
    if (!p.length || !navigator.vibrate) return { stop() {} };
    const total = p.reduce((a, b) => a + b, 0);
    const go = () => { try { navigator.vibrate(p); } catch {} };
    go();
    const t = once ? null : setInterval(go, total);
    return { stop() { clearInterval(t); try { navigator.vibrate(0); } catch {} } };
  }

  // ---------- Color wheel ----------
  function hsv2rgb(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h, s: mx ? d / mx : 0, v: mx };
  }
  const toHex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
  const fromHex = (hex) => rgb2hsv(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  // Puts a color wheel, a brightness slider, a color code box and quick colors into `box`.
  function colorWheel(box, hex, onChange) {
    let hsv = fromHex(isHex(hex) ? hex : "#2f55e4");
    box.innerHTML = `
      <div class="ak-wheel"><canvas width="440" height="440" aria-hidden="true"></canvas><span class="ak-knob"></span></div>
      <label class="ak-lab">Brightness<input type="range" class="ak-bright" min="15" max="100" aria-label="Brightness"></label>
      <div class="ak-hexrow"><span class="ak-dot"></span><input class="ak-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Color code"></div>
      <div class="ak-quick" role="group" aria-label="Quick colors">${QUICK.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join("")}</div>`;
    const cv = box.querySelector("canvas"), g = cv.getContext("2d"), wheel = box.querySelector(".ak-wheel");
    const knob = box.querySelector(".ak-knob"), bright = box.querySelector(".ak-bright"), hexIn = box.querySelector(".ak-hex"), dot = box.querySelector(".ak-dot");
    function draw() {
      const W = cv.width, R = W / 2, img = g.createImageData(W, W);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const dx = x - R, dy = y - R, d = Math.sqrt(dx * dx + dy * dy), i = (y * W + x) * 4;
        if (d > R) continue;
        const [r, gg, b] = hsv2rgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, d / R, hsv.v);
        img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = d > R - 1 ? Math.round((R - d) * 255) : 255;
      }
      g.putImageData(img, 0, 0);
    }
    function show(typed) {
      const c = toHex(hsv2rgb(hsv.h, hsv.s, hsv.v));
      const a = hsv.h * Math.PI / 180;
      knob.style.left = 50 + Math.cos(a) * hsv.s * 50 + "%";
      knob.style.top = 50 + Math.sin(a) * hsv.s * 50 + "%";
      knob.style.background = c;
      dot.style.background = c;
      if (!typed) hexIn.value = c.toUpperCase();
      bright.value = Math.round(hsv.v * 100);
      for (const q of box.querySelectorAll("[data-c]")) q.classList.toggle("on", q.dataset.c === c);
      onChange(c);
    }
    let drag = false;
    const pick = (e) => {
      const r = wheel.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
      hsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      hsv.s = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (r.width / 2));
      show();
    };
    wheel.addEventListener("pointerdown", (e) => { drag = true; try { wheel.setPointerCapture(e.pointerId); } catch {} pick(e); e.preventDefault(); });
    wheel.addEventListener("pointermove", (e) => { if (drag) pick(e); });
    wheel.addEventListener("pointerup", () => { drag = false; });
    wheel.addEventListener("pointercancel", () => { drag = false; });
    bright.oninput = () => { hsv.v = Number(bright.value) / 100; draw(); show(); };
    hexIn.oninput = () => {
      const v = hexIn.value.trim().replace(/^#?/, "#");
      if (isHex(v)) { hsv = fromHex(v.toLowerCase()); draw(); show(true); }
    };
    for (const q of box.querySelectorAll("[data-c]")) q.onclick = () => { hsv = fromHex(q.dataset.c); draw(); show(); };
    draw(); show();
  }

  // ---------- The Android app: files for the phone's own alarm ----------
  let nativeSaved = {}; // id -> path on the phone
  let nativeListed = null;
  const b64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const extOf = (type, kind) => (/wav/.test(type) ? "wav" : /png/.test(type) ? "png" : /jpe?g/.test(type) ? "jpg" : /mp4/.test(type) ? "mp4" : /webm/.test(type) ? "webm" : /ogg/.test(type) ? "ogg" : /aac|m4a|mp4a/.test(type) ? "m4a" : kind === "photo" ? "jpg" : kind === "video" ? "mp4" : "mp3");
  // The file's path in the Android app (copying it there the first time), or "" if it can't be.
  async function nativePath(id) {
    if (!H().isNativeApp || !H().native || !id) return "";
    if (!nativeListed) {
      nativeListed = H().native("alarmMedia", { op: "list" })
        .then((r) => { nativeSaved = (r && r.files) || {}; })
        .catch(() => { nativeListed = null; });
    }
    await nativeListed;
    if (nativeSaved[id]) return nativeSaved[id];
    let blob, type, kind;
    if (id.startsWith("tone-")) { blob = wav(id.slice(5)); type = "audio/wav"; kind = "song"; }
    else {
      const m = await get(id);
      if (!m || !m.blob) return "";
      blob = m.blob; type = m.type || m.blob.type || ""; kind = m.kind;
    }
    const CH = 768 * 1024;
    let path = "";
    try {
      for (let at = 0, n = 0; at < blob.size || n === 0; at += CH, n++) {
        const data = await b64(blob.slice(at, at + CH));
        const last = at + CH >= blob.size;
        const r = await H().native("alarmMedia", { op: "write", id, ext: extOf(type, kind), data, append: n > 0, done: last });
        if (last) path = (r && r.path) || "";
      }
    } catch { return ""; }
    if (path) nativeSaved[id] = path;
    return path;
  }
  function openUrl(link) {
    if (!link) return;
    if (H().isNativeApp && H().native) { H().native("alarmMedia", { op: "open", url: link }).catch(() => { window.open(link, "_blank", "noopener"); }); return; }
    try { window.open(link, "_blank", "noopener"); } catch {}
  }

  window.HuddleAlarmKit = {
    TONES, PHONE_TONE, APPS, VIBS, LOOKS, QUICK, DEFAULTS, full, isHex, appLink,
    media: { get, url, addSong, addPicture, prune },
    play, samples, wav, vibPattern, vibrate, colorWheel, nativePath, openUrl,
  };
})();
