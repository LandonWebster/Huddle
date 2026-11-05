// Pip: Huddle's calm blob host. Pip greets you, gives a first-time tour, keeps you company in
// calls, hosts group games and plays head-to-head games. Every line is spoken in a slow, warm
// voice and also shown in Pip's speech bubble. Pip follows the app's volume and Silent mode.
(() => {
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const H = () => window.huddle || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Pip's face ----------
  function face(size) {
    const b = document.createElement("div");
    b.className = "pip-blob";
    if (size) b.style.setProperty("--s", size + "px");
    b.innerHTML = '<i class="eye l"></i><i class="eye r"></i><i class="cheek l"></i><i class="cheek r"></i><i class="mouth"></i>';
    return b;
  }
  const bubbleHtml = (text) => `<span class="who">Pip</span><span class="pip-voice"><i></i><i></i><i></i><i></i></span><br>${esc(text)}`;

  // ---------- Voice ----------
  // In the Android app, Android's own text-to-speech is used. In browsers, the Web Speech API.
  let voice = null;
  function pickVoice() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    // Prefer soft, natural-sounding voices when the device has them.
    const pref = [/natural/i, /samantha/i, /karen/i, /moira/i, /serena/i, /google uk english female/i, /zira/i, /female/i, /google us english/i];
    for (const re of pref) { const v = vs.find((x) => re.test(x.name)); if (v) { voice = v; return; } }
    voice = vs[0] || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  let pendingSpeech = null; // browsers only allow speech after you've tapped the page once
  let unlocked = false;
  function speak(text, onEnd) {
    const vol = H().volume == null ? 1 : H().volume;
    const done = () => { if (onEnd) onEnd(); };
    if (!vol) { setTimeout(done, Math.min(6000, 900 + text.length * 55)); return; }
    // On phones, the phone's speech voice can take over the call's audio, so during a call Pip
    // shows his words in the bubble instead of saying them out loud.
    if (H().inCall && (H().isNativeApp || H().isAndroid || H().isIOS)) { setTimeout(done, Math.min(6000, 1200 + text.length * 55)); return; }
    if (H().isNativeApp && !noNativeVoice) {
      let ended = false;
      const end = () => { if (!ended) { ended = true; done(); } };
      // Older app versions don't have Pip's voice yet; then try the browser voice instead.
      H().native("speak", { text, rate: 0.88, pitch: 1.05, volume: vol }).then(end, () => { noNativeVoice = true; if (!ended) { ended = true; speak(text, onEnd); } });
      setTimeout(end, 2500 + text.length * 90);
      return;
    }
    webSpeak(text, vol, done, onEnd);
  }
  let noNativeVoice = false;
  function webSpeak(text, vol, done, onEnd) {
    if (!window.speechSynthesis) { setTimeout(done, Math.min(6000, 900 + text.length * 55)); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 0.88; u.pitch = 1.05; u.volume = vol;
      let ended = false;
      const end = () => { if (!ended) { ended = true; done(); } };
      u.onend = end;
      u.onerror = (e) => {
        // Not allowed yet (no tap on the page): say it once the person taps.
        if (e && e.error === "not-allowed" && !unlocked) pendingSpeech = { text, onEnd };
        end();
      };
      speechSynthesis.speak(u);
      // Safety net in case the browser never reports the end.
      setTimeout(end, 2500 + text.length * 90);
    } catch { done(); }
  }
  function stopSpeaking() {
    pendingSpeech = null;
    if (H().isNativeApp && !noNativeVoice) { H().native("stopSpeaking").catch(() => {}); return; }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch {}
  }
  const unlock = () => {
    unlocked = true;
    if (pendingSpeech) { const p = pendingSpeech; pendingSpeech = null; speak(p.text, p.onEnd); }
  };
  window.addEventListener("pointerdown", unlock, { capture: true, once: true });
  window.addEventListener("keydown", unlock, { capture: true, once: true });

  // ---------- Start screen: greeting and the Pip switch ----------
  const hello = $("pipHello");
  const lobbySw = $("pipLobbySw");
  const pipWanted = () => ls.get("huddle:pip") !== "0";
  function setSwitch(sw, on) { sw.setAttribute("aria-checked", on ? "true" : "false"); }
  setSwitch(lobbySw, pipWanted());
  lobbySw.onclick = () => {
    const on = !pipWanted();
    ls.set("huddle:pip", on ? "1" : "0");
    setSwitch(lobbySw, on);
    helloSay(on ? "I'll come along to your next call." : "Okay. I'll stay here this time. Have fun.");
  };

  const helloFace = face(64);
  const helloBubble = document.createElement("div");
  helloBubble.className = "pip-bubble";
  hello.append(helloFace, helloBubble);
  function helloSay(text) {
    helloBubble.innerHTML = bubbleHtml(text);
    hello.classList.add("talking");
    speak(text, () => hello.classList.remove("talking"));
  }
  function myName() {
    const n = ($("nameInput").value || "").trim();
    return n && n !== "Guest" ? n : "";
  }
  // Every time the app opens: "Welcome back," then your name.
  function greet() {
    const n = myName();
    const seenBefore = ls.get("huddle:visited") === "1";
    ls.set("huddle:visited", "1");
    helloSay(!seenBefore ? "Hi, I'm Pip. Welcome to Huddle." : n ? `Welcome back, ${n}.` : "Welcome back.");
  }

  // ---------- First-time tour ----------
  const STEPS = [
    { el: "startBtn", text: "This button starts a call. I'll give you a little code to send your friends. Take your time." },
    { el: "joinForm", text: "If a friend sends you a code, type it here and tap Join." },
    { el: "lobbyFriends", text: "Your friends show up here. A green dot means they're on Huddle right now, and you can call them with one tap." },
    { el: "pCam", text: "These choose if your mic and camera are on when a call starts. Your camera stays off until then." },
    { el: "pipRow", text: "This decides if I come to your call. In a call, tap the game button to pick a game. That's it. Have fun." },
  ];
  let tour = null;
  function startTour() {
    let i = 0;
    const dim = document.createElement("div");
    dim.className = "pip-tour";
    dim.innerHTML = '<div class="pip-spot"></div><div class="pip-float talking"><div class="pip-bubble tour"></div></div>';
    const fl = dim.querySelector(".pip-float");
    const bub = dim.querySelector(".pip-bubble");
    fl.appendChild(face(54));
    document.body.appendChild(dim);
    const spot = dim.querySelector(".pip-spot");
    tour = { dim };
    const finish = () => {
      stopSpeaking();
      dim.remove(); tour = null;
      ls.set("huddle:tutorialDone", "1");
      window.dispatchEvent(new Event("huddle:tutorialdone"));
      window.removeEventListener("resize", place);
    };
    function place() {
      const el = $(STEPS[i].el);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        const pad = 6;
        Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
        // Pip floats above the spotlight when there's room, otherwise below.
        const above = r.top > innerHeight / 2;
        fl.classList.toggle("below", !above);
        fl.style.top = above ? "" : r.bottom + 16 + "px";
        fl.style.bottom = above ? innerHeight - r.top + 16 + "px" : "";
      }, reduceMotion ? 0 : 260);
    }
    function show() {
      const s = STEPS[i];
      bub.innerHTML = bubbleHtml(s.text) + `
        <div class="tour-nav">
          <button type="button" class="skip">Skip</button>
          <span class="dots">${STEPS.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</span>
          <button type="button" class="next">${i === STEPS.length - 1 ? "Done" : "Next"}</button>
        </div>`;
      bub.querySelector(".skip").onclick = finish;
      bub.querySelector(".next").onclick = () => { if (++i >= STEPS.length) finish(); else show(); };
      fl.classList.add("talking");
      speak(s.text, () => fl.classList.remove("talking"));
      place();
    }
    window.addEventListener("resize", place);
    show();
  }

  // ---------- In calls ----------
  const dock = $("pipDock");
  const callSw = $("pipCallSw");
  const dockFace = face(34);
  const callBubble = document.createElement("div");
  callBubble.className = "pip-bubble drop";
  dock.append(dockFace, callBubble);
  let pipOn = true;
  let hideTimer = null;
  let queue = [];
  let talking = false;
  let lastSaid = 0;

  function applyPip(on) {
    pipOn = on;
    setSwitch(callSw, on);
    document.body.classList.toggle("pip-off", !on);
    if (!on) { stopSpeaking(); queue = []; talking = false; dock.classList.remove("talking", "open"); }
  }
  callSw.onclick = () => {
    const on = !pipOn;
    applyPip(on);
    if (H().sendSettings) H().sendSettings({ pip: on });
    if (on) say("I'm back. Holler if you need me.");
  };

  // Say something in the call. Pip waits for a quiet moment so he never talks over friends.
  function say(text, opts = {}) {
    if (!pipOn || !H().inCall) return;
    if (opts.replace) queue = [];
    queue.push(text);
    pump();
  }
  let waitStarted = 0;
  function pump() {
    if (talking || !queue.length || !pipOn) return;
    if (H().someoneTalking) {
      if (!waitStarted) waitStarted = Date.now();
      if (Date.now() - waitStarted < 8000) { setTimeout(pump, 500); return; }
    }
    waitStarted = 0;
    const text = queue.shift();
    talking = true;
    lastSaid = Date.now();
    clearTimeout(hideTimer);
    callBubble.innerHTML = bubbleHtml(text);
    placeBubble();
    dock.classList.add("talking", "open");
    speak(text, () => {
      talking = false;
      dock.classList.remove("talking");
      hideTimer = setTimeout(() => dock.classList.remove("open"), 2200);
      setTimeout(pump, 400);
    });
  }
  // In game screens the top bar is hidden; Pip's bubble then drops from the top of the game.
  function placeBubble() {
    const call = $("call");
    const inGame = call && call.classList.contains("game-mode");
    dock.classList.toggle("in-game", !!inGame);
    if (inGame) {
      const panel = $("gamePanel").getBoundingClientRect();
      dock.style.top = panel.top + 8 + "px";
    } else dock.style.top = "";
  }

  // When a friend talks, Pip shrinks to a small face so they stay the center of attention.
  setInterval(() => {
    const friendTalking = !!H().someoneTalking;
    dock.classList.toggle("docked", friendTalking && !talking);
  }, 300);

  const IDLE_LINES = [
    "No pressure. I'm happy to just hang out too.",
    "Whenever you feel like a game, the game button is at the bottom.",
    "It's nice having everyone here.",
  ];
  let idleTimer = null;
  function idleCheck() {
    if (!pipOn || !H().inCall || H().gameOpen) return;
    if (Date.now() - lastSaid > 6 * 60 * 1000) say(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]);
  }

  window.addEventListener("huddle:joined", (e) => {
    const d = e.detail || {};
    applyPip(!(d.settings && d.settings.pip === false));
    const me = myName();
    const others = d.peers || [];
    lastSaid = Date.now();
    clearInterval(idleTimer);
    idleTimer = setInterval(idleCheck, 60 * 1000);
    if (d.rejoined) return; // back after a dropped connection: no second hello
    if (!others.length) say(me ? `Hi ${me}. I'll keep you company until your friends get here.` : "Hi. I'll keep you company until your friends get here.");
    else if (others.length === 1) say(`Hey${me ? " " + me : ""}. ${others[0]} is here. It's nice to see you both.`);
    else say("Hey everyone. It's nice to see you all.");
    clearInterval(idleTimer);
    idleTimer = setInterval(idleCheck, 60 * 1000);
  });
  window.addEventListener("huddle:left", () => { clearInterval(idleTimer); stopSpeaking(); queue = []; talking = false; dock.classList.remove("talking", "open"); });
  window.addEventListener("huddle:peer", (e) => {
    const d = e.detail;
    if (d.joined) say(`Hi ${d.name}, glad you're here.`);
    else say(`Bye ${d.name}. See you soon.`);
  });
  window.addEventListener("huddle:settings", (e) => {
    const d = e.detail;
    const on = !!(d.settings && d.settings.pip);
    if (on === pipOn) return;
    applyPip(on);
    if (H().toast) H().toast(on ? `${d.by} brought Pip back` : `${d.by} turned Pip off`);
    if (on) say("Hi again. I'm here if you need me.");
  });
  window.addEventListener("huddle:playing", (e) => {
    if (e.detail === "butter") say("Let's make some butter together. Tap as fast or as slow as you like.");
  });

  // ---------- Talking with Pip (real conversation) ----------
  // Tap Pip on the start screen or in a call. Type, or hold the mic where the browser can listen.
  const callPeople = new Map();
  let currentGame = null;
  window.addEventListener("huddle:joined", (e) => { callPeople.clear(); ((e.detail || {}).peers || []).forEach((n, i) => callPeople.set("p" + i, n)); });
  window.addEventListener("huddle:peer", (e) => { const d = e.detail; if (d.joined) callPeople.set(d.id, d.name); else callPeople.delete(d.id); });
  window.addEventListener("huddle:left", () => { callPeople.clear(); currentGame = null; });
  window.addEventListener("huddle:playing", (e) => { currentGame = e.detail; });
  const GAME_NAMES = { butter: "Butter Clicker", trivia: "Pip's Trivia", tictactoe: "Tic-tac-toe", connect4: "Connect Four" };

  const talkLog = []; // { role: "user" | "assistant", text }
  let chatEl = null, busy = false;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  function openChat() {
    if (chatEl) return;
    chatEl = document.createElement("div");
    chatEl.className = "pip-chat";
    chatEl.setAttribute("role", "dialog");
    chatEl.setAttribute("aria-label", "Talk with Pip");
    chatEl.innerHTML = `
      <div class="pc-card">
        <header class="pc-head"><span class="pc-face"></span><div><strong>Talk with Pip</strong><small>Ask me anything, or just say hi.</small></div><button type="button" class="pc-close" aria-label="Close">✕</button></header>
        <div class="pc-msgs" aria-live="polite"></div>
        <form class="pc-form">
          ${Recognition || H().isNativeApp ? '<button type="button" class="pc-mic" aria-label="Talk to Pip">🎤</button>' : ""}
          <input name="t" maxlength="500" placeholder="Say something to Pip" autocomplete="off">
          <button type="submit" class="pc-send">Send</button>
        </form>
      </div>`;
    chatEl.querySelector(".pc-face").appendChild(face(40));
    document.body.appendChild(chatEl);
    const msgs = chatEl.querySelector(".pc-msgs");
    const form = chatEl.querySelector(".pc-form");
    const draw = () => {
      msgs.innerHTML = (talkLog.length ? "" : `<p class="pc-hint">Try "What should we play?" or "Tell me a joke."</p>`) +
        talkLog.map((m) => `<p class="pc-m ${m.role === "user" ? "me" : "pip"}">${esc(m.text)}</p>`).join("") +
        (busy ? '<p class="pc-m pip typing"><i></i><i></i><i></i></p>' : "");
      msgs.scrollTop = msgs.scrollHeight;
    };
    chatEl._draw = draw;
    draw();
    const close = () => { if (chatEl) chatEl.remove(); chatEl = null; };
    chatEl.querySelector(".pc-close").onclick = close;
    chatEl.addEventListener("click", (e) => { if (e.target === chatEl) close(); });
    form.onsubmit = (e) => { e.preventDefault(); const t = form.t.value.trim(); if (!t || busy) return; form.t.value = ""; ask(t); };
    const mic = chatEl.querySelector(".pc-mic");
    if (mic) mic.onclick = () => listen(mic, form);
    setTimeout(() => form.t.focus(), 50);
  }
  // In the Android app the phone's own speech recognition listens (the app's web view can't).
  let nativeListening = false;
  async function listenNative(mic, form) {
    if (nativeListening) { H().native("stopListening").catch(() => {}); return; }
    nativeListening = true;
    mic.classList.add("on");
    stopSpeaking();
    let sub = null;
    try {
      const Cap = window.Capacitor;
      sub = Cap && Cap.addListener ? await Cap.addListener("HuddleNative", "speechPartial", (d) => { if (d && d.text) form.t.value = d.text; }) : null;
      const r = await H().native("listen");
      const t = String((r && r.text) || form.t.value || "").trim();
      form.t.value = "";
      if (t && !busy) ask(t);
    } catch (e) {
      const msg = String((e && (e.message || e.code)) || e);
      if (/no-mic/.test(msg)) H().toast && H().toast("Allow the microphone for Huddle to talk to Pip");
      else if (/not-available/.test(msg)) H().toast && H().toast("This phone doesn't have speech recognition");
      else if (/not implemented|unimplemented|not available/i.test(msg)) H().toast && H().toast("Update the Huddle app to talk to Pip by voice");
      else H().toast && H().toast("I couldn't hear that. Try again?");
    } finally {
      nativeListening = false;
      mic.classList.remove("on");
      if (sub) { try { sub.remove(); } catch {} }
    }
  }
  function listen(mic, form) {
    if (H().isNativeApp) return listenNative(mic, form);
    try {
      const r = new Recognition();
      r.lang = navigator.language || "en-US";
      r.interimResults = true;
      r.maxAlternatives = 1;
      mic.classList.add("on");
      stopSpeaking();
      let finalText = "";
      r.onresult = (e) => {
        let t = "";
        for (const res of e.results) { t += res[0].transcript; if (res.isFinal) finalText = t; }
        form.t.value = t;
      };
      r.onend = () => { mic.classList.remove("on"); const t = (finalText || form.t.value).trim(); if (t && !busy) { form.t.value = ""; ask(t); } };
      r.onerror = () => mic.classList.remove("on");
      r.start();
    } catch { mic.classList.remove("on"); }
  }
  async function ask(text) {
    talkLog.push({ role: "user", text });
    busy = true;
    if (chatEl) chatEl._draw();
    let answer;
    const context = { name: myName(), inCall: !!H().inCall, peers: [...callPeople.values()], game: H().gameOpen && currentGame ? GAME_NAMES[currentGame] || currentGame : null };
    const brain = () => (window.PipBrain ? window.PipBrain.reply(text, context) : "I'm here. Want to play a game?");
    // Free by default: Pip's own brain answers right on the phone. If the server has a Claude key,
    // Pip uses that for real conversation instead.
    if (!(window.HuddleAccount && window.HuddleAccount.pipChat)) {
      await new Promise((r) => setTimeout(r, 350 + Math.random() * 450)); // a little "thinking" pause
      answer = brain();
    } else try {
      const r = await fetch("/api/pip", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + (ls.get("huddle:token") || "") },
        body: JSON.stringify({
          messages: talkLog.slice(-12),
          context,
        }),
      });
      const j = await r.json().catch(() => ({}));
      answer = j.reply || (j.setup || r.status >= 500 ? brain() : j.error || "Hmm, I didn't catch that. Try again?");
    } catch { answer = brain(); }
    busy = false;
    talkLog.push({ role: "assistant", text: answer });
    if (talkLog.length > 40) talkLog.splice(0, talkLog.length - 40);
    if (chatEl) chatEl._draw();
    // Pip answers out loud too (only to you, through your own speaker).
    speak(answer);
  }
  hello.style.cursor = "pointer";
  hello.title = "Talk with Pip";
  hello.addEventListener("click", () => { if (!document.querySelector(".pip-tour")) openChat(); });
  dockFace.style.cursor = "pointer";
  dockFace.title = "Talk with Pip";
  dockFace.addEventListener("click", openChat);

  // Games and other parts of the app can ask Pip to speak.
  window.Pip = {
    say, face, speak, stopSpeaking, openChat,
    get on() { return pipOn; },
    cheer(text) { say(text); },
  };
  // The account page can open before Pip is loaded; give it Pip's face now.
  for (const el of document.querySelectorAll(".ch-gate-pip:empty")) el.appendChild(face(72));

  // ---------- Start ----------
  function boot() {
    if (ls.get("huddle:tutorialDone") !== "1") {
      ls.set("huddle:visited", "1");
      setTimeout(startTour, 500);
    } else setTimeout(greet, 400);
  }
  // Pip says hello once you're signed in (an account comes first).
  let booted = false;
  const go = () => { if (booted) return; booted = true; setTimeout(boot, 300); };
  if (window.HuddleAccount && window.HuddleAccount.signedIn) go();
  else window.addEventListener("huddle:signedin", go);
})();
