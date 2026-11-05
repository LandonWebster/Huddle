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
    return n && n !== "Guest" ? n.split(/\s+/)[0] : "";
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
    { el: "pCam", text: "This turns your camera on or off. Your mic button is right next to it." },
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
    if (!others.length) say(me ? `Hi ${me}. I'll keep you company until your friends get here.` : "Hi. I'll keep you company until your friends get here.");
    else if (others.length === 1) say(`Hey${me ? " " + me : ""}. ${others[0]} is here. It's nice to see you both.`);
    else say("Hey everyone. It's nice to see you all.");
    clearInterval(idleTimer);
    idleTimer = setInterval(idleCheck, 60 * 1000);
  });
  window.addEventListener("huddle:left", () => { clearInterval(idleTimer); stopSpeaking(); queue = []; talking = false; dock.classList.remove("talking", "open"); });
  window.addEventListener("huddle:peer", (e) => {
    const d = e.detail;
    if (d.joined) say(`Hi ${d.name.split(/\s+/)[0]}, glad you're here.`);
    else say(`Bye ${d.name.split(/\s+/)[0]}. See you soon.`);
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

  // Games and other parts of the app can ask Pip to speak.
  window.Pip = {
    say, face, speak, stopSpeaking,
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
