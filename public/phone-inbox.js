// The Phone screen: texts, calls and voicemails with real phone numbers (Huddle's Twilio
// number). Opened from the lobby. New texts and voicemails show up live while the app is open,
// with a badge on the Phone button. Notifications can be turned on here too (public/notifications.js).
(() => {
  "use strict";
  const H = () => window.huddle || {};
  const P = () => window.huddlePhone;
  const openBtn = document.getElementById("phoneOpen");
  const badge = document.getElementById("phoneBadge");
  if (!openBtn) return;

  const root = document.createElement("main");
  root.className = "chats-screen phone-screen";
  root.hidden = true;
  document.body.append(root);

  const IC = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = (n) => (P() ? P().pretty(n) : n);
  const normalize = (n) => (P() ? P().normalize(n) : null);
  const toast = (m, ms) => (H().toast ? H().toast(m, ms) : null);
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  async function api(method, path, body) {
    const r = await fetch("/api/phone/" + path, {
      method,
      headers: { authorization: "Bearer " + (token() || ""), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Something went wrong");
    return j;
  }
  const dur = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, "0")}`;
  function when(t) {
    const d = new Date(t), now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  const TEXT_FAIL = {
    30034: "Not delivered: texting registration isn't approved yet",
    30007: "Not delivered: blocked as spam by the carrier",
    30003: "Not delivered: their phone can't get texts right now",
    30005: "Not delivered: that number doesn't exist",
    30006: "Not delivered: that number can't get texts",
    21610: "Not delivered: they replied STOP",
  };
  function statusLine(it) {
    const st = it.status || "";
    if (st.startsWith("failed") || st === "undelivered") return TEXT_FAIL[st.split(":")[1]] || "Not delivered";
    if (st === "delivered") return "Delivered";
    return "";
  }
  // One line about the latest thing in a conversation, for the list.
  function summary(it) {
    if (it.kind === "text_in" || it.kind === "text_out") return (it.kind === "text_out" ? "You: " : "") + it.body;
    if (it.kind === "voicemail") return `Voicemail · ${dur(it.duration)}`;
    if (it.kind === "missed") return "Missed call";
    if (it.kind === "call_in") return `Incoming call · ${dur(it.duration)}`;
    if (it.kind === "call_out") return it.duration ? `Outgoing call · ${dur(it.duration)}` : "Outgoing call · no answer";
    return "";
  }

  let view = null; // "list" | "thread"
  let tab = "texts"; // list tab: "texts" | "calls"
  let current = null; // number open in the thread view
  let unread = 0;
  function renderBadge() {
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? "99+" : String(unread);
  }

  // ---------- Showing and hiding ----------
  function show() {
    root.hidden = false;
    document.body.classList.add("chats-open");
    if (!history.state || !history.state.huddlePhone) history.pushState({ huddlePhone: 1 }, "");
  }
  function hide() {
    root.hidden = true;
    document.body.classList.remove("chats-open");
    view = null;
    current = null;
  }
  window.addEventListener("popstate", () => {
    if (root.hidden) return;
    if (view === "thread") { openList(); history.pushState({ huddlePhone: 1 }, ""); }
    else hide();
  });
  const goBack = () => {
    if (view === "thread") openList();
    else { hide(); if (history.state && history.state.huddlePhone) history.back(); }
  };
  openBtn.onclick = () => {
    if (!token()) { toast("Sign in to use the phone"); return; }
    show();
    openList();
  };

  // ---------- The list ----------
  async function openList() {
    view = "list";
    current = null;
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>Phone</strong>
        <span class="ch-sp"></span>
      </header>
      <div class="ch-body">
        <p class="ph-mine" hidden></p>
        <form class="ch-add ph-new">
          <input type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone number" aria-label="Phone number" maxlength="22">
          <button class="btn" type="button" data-act="text">Text</button>
          <button class="btn primary" type="submit">Call</button>
        </form>
        <p class="ch-err ph-err"></p>
        <div class="ph-notify" hidden><span></span><button class="btn" type="button" data-act="notify"></button></div>
        <div class="ch-tabs ph-tabs" role="tablist">
          <button type="button" role="tab" data-tab="texts" class="${tab === "texts" ? "on" : ""}">Texts</button>
          <button type="button" role="tab" data-tab="calls" class="${tab === "calls" ? "on" : ""}">Call log</button>
        </div>
        <ul class="ch-list ph-list"><li class="ch-empty">Loading…</li></ul>
      </div>`;
    root.querySelectorAll("[data-tab]").forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab;
        root.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
        loadList();
      };
    });
    renderNotify();
    const $ = (s) => root.querySelector(s);
    $('[data-act="back"]').onclick = goBack;
    const input = $(".ph-new input"), errEl = $(".ph-err");
    const num = () => {
      const n = normalize(input.value);
      errEl.textContent = n ? "" : "Type a 10-digit phone number";
      return n;
    };
    $(".ph-new").onsubmit = (e) => { e.preventDefault(); const n = num(); if (n) callNumber(n); };
    $('[data-act="text"]').onclick = () => { const n = num(); if (n) openThread(n); };
    await loadList();
  }
  async function loadList() {
    if (view !== "list") return;
    let j;
    try { j = await api("GET", "threads"); }
    catch (e) { const l = root.querySelector(".ph-list"); if (l) l.innerHTML = `<li class="ch-empty">${esc(e.message)}</li>`; return; }
    unread = j.unread || 0;
    renderBadge();
    if (view !== "list") return;
    const mine = root.querySelector(".ph-mine");
    if (j.number) { mine.hidden = false; mine.textContent = `Your Huddle number: ${pretty(j.number)}`; }
    const list = root.querySelector(".ph-list");
    if (tab === "calls") return renderCalls(list);
    if (!j.threads.length) {
      list.innerHTML = `<li class="ch-empty">No texts or calls yet. Type a number above to text or call it. Texts and voicemails sent to your Huddle number show up here.</li>`;
      return;
    }
    list.innerHTML = j.threads.map((t) => `
      <li><button type="button" data-n="${esc(t.number)}">
        <span class="ch-av ph-av">${IC.phone}</span>
        <span class="ch-row"><strong>${esc(pretty(t.number))}</strong><small>${esc(summary(t.last))}</small></span>
        <span class="ch-meta"><span>${esc(when(t.last.at))}</span>${t.unread ? `<span class="ch-dot">${t.unread}</span>` : ""}</span>
      </button></li>`).join("");
    list.querySelectorAll("button[data-n]").forEach((b) => { b.onclick = () => openThread(b.dataset.n); });
  }

  // ---------- Call log: every incoming, outgoing and missed call, newest first ----------
  const ARROW = {
    call_in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17M7 9v8h8"/></svg>',
    call_out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    missed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17M7 9v8h8M14 4l6 6"/></svg>',
    voicemail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6.5" cy="12" r="3.5"/><circle cx="17.5" cy="12" r="3.5"/><path d="M6.5 15.5h11"/></svg>',
  };
  function callLabel(c) {
    if (c.kind === "missed") return "Missed call";
    if (c.kind === "voicemail") return `Voicemail · ${dur(c.duration)}`;
    if (c.kind === "call_in") return `Incoming · ${dur(c.duration)}`;
    return c.duration ? `Outgoing · ${dur(c.duration)}` : "Outgoing · no answer";
  }
  function fullTime(t) {
    const d = new Date(t);
    return `${when(t)}${d.toDateString() === new Date().toDateString() ? "" : " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  async function renderCalls(list) {
    let j;
    try { j = await api("GET", "calls"); } catch (e) { list.innerHTML = `<li class="ch-empty">${esc(e.message)}</li>`; return; }
    if (view !== "list" || tab !== "calls") return;
    if (!j.calls.length) { list.innerHTML = `<li class="ch-empty">No calls yet.</li>`; return; }
    list.innerHTML = j.calls.map((c) => `
      <li class="ph-call-row"><button type="button" data-n="${esc(c.number)}">
        <span class="ph-dir ${c.kind}">${ARROW[c.kind] || ""}</span>
        <span class="ch-row"><strong class="${c.kind === "missed" ? "ph-missed" : ""}">${esc(pretty(c.number))}</strong><small>${esc(callLabel(c))}</small></span>
        <span class="ch-meta"><span>${esc(fullTime(c.at))}</span>${c.unread ? '<span class="ch-dot">new</span>' : ""}</span>
      </button><button type="button" class="ch-icon ph-callback" data-call="${esc(c.number)}" aria-label="Call ${esc(pretty(c.number))} back">${IC.phone}</button></li>`).join("");
    list.querySelectorAll("button[data-n]").forEach((b) => { b.onclick = () => openThread(b.dataset.n); });
    list.querySelectorAll("button[data-call]").forEach((b) => { b.onclick = () => callNumber(b.dataset.call); });
  }

  // ---------- Notifications on/off ----------
  async function renderNotify() {
    const box = root.querySelector(".ph-notify");
    if (!box || !window.huddleNotify) return;
    const st = await window.huddleNotify.state();
    if (!root.contains(box)) return;
    box.hidden = false;
    const label = box.querySelector("span"), b = box.querySelector("button");
    const on = st === "on";
    label.textContent = on ? "Notifications are on for calls, texts and chats." : "Get notified about calls, texts and chats, even when Huddle is closed.";
    b.textContent = on ? "Turn off" : "Turn on";
    b.onclick = async () => {
      b.disabled = true;
      try { await (on ? window.huddleNotify.disable() : window.huddleNotify.enable()); toast(on ? "Notifications off" : "Notifications on"); }
      catch (e) { toast(e.message, 7000); }
      b.disabled = false;
      renderNotify();
    };
  }

  // ---------- One conversation ----------
  function openThread(number) {
    view = "thread";
    current = number;
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <span class="ch-who"><span class="ch-av sm ph-av">${IC.phone}</span><strong>${esc(pretty(number))}</strong></span>
        <button class="ch-icon" data-act="call" aria-label="Call ${esc(pretty(number))}" title="Call">${IC.phone}</button>
      </header>
      <div class="ch-msgs"><div class="ch-stream"><div class="ch-empty">Loading…</div></div></div>
      <form class="ch-compose">
        <input name="text" placeholder="Text message" autocomplete="off" maxlength="1000" enterkeyhint="send">
        <button class="ch-send" type="submit" aria-label="Send">${IC.send}</button>
      </form>`;
    const $ = (s) => root.querySelector(s);
    $('[data-act="back"]').onclick = goBack;
    $('[data-act="call"]').onclick = () => callNumber(number);
    const form = $(".ch-compose");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      form.text.value = "";
      try {
        const j = await api("POST", "text", { to: number, text });
        if (j.error) toast(j.error, 5000);
      } catch (x) { toast(x.message, 5000); form.text.value = text; }
      loadThread();
    };
    loadThread();
  }
  async function loadThread() {
    const number = current;
    if (view !== "thread" || !number) return;
    let j;
    try { j = await api("GET", "thread?n=" + encodeURIComponent(number)); } catch { return; }
    if (view !== "thread" || current !== number) return;
    const box = root.querySelector(".ch-msgs"), stream = root.querySelector(".ch-stream");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (!j.items.length) {
      stream.innerHTML = `<div class="ch-empty">Say hi! Texts you send come from your Huddle number.</div>`;
    } else {
      let lastDay = "";
      stream.innerHTML = j.items.map((it) => {
        const day = new Date(it.at).toDateString();
        const head = day !== lastDay ? `<div class="ch-day">${esc(day === new Date().toDateString() ? "Today" : when(it.at))}</div>` : "";
        lastDay = day;
        const time = new Date(it.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        if (it.kind === "text_in" || it.kind === "text_out") {
          const st = it.kind === "text_out" ? statusLine(it) : "";
          const bad = /^Not/.test(st);
          return `${head}<div class="ch-msg${it.kind === "text_out" ? " mine" : ""}"><div class="ch-bubble${bad ? " ph-failed" : ""}"><div class="ch-text">${esc(it.body)}</div><div class="ch-time">${esc(time)}${st ? ` · ${esc(st)}` : ""}</div></div></div>`;
        }
        if (it.kind === "voicemail") {
          return `${head}<div class="ch-msg"><div class="ch-bubble ph-vm"><strong>Voicemail · ${esc(dur(it.duration))}</strong><audio controls preload="none" src="/api/media/${encodeURIComponent(it.mediaId || "")}"></audio><div class="ch-time">${esc(time)}</div></div></div>`;
        }
        return `${head}<div class="ph-event${it.kind === "missed" ? " missed" : ""}">${esc(summary(it))} · ${esc(time)}</div>`;
      }).join("");
    }
    if (atBottom || !box.dataset.loaded) box.scrollTop = box.scrollHeight;
    box.dataset.loaded = "1";
    if (j.items.some((it) => it.unread)) {
      api("POST", "read", { number }).then((r) => { unread = r.unread || 0; renderBadge(); }).catch(() => {});
    }
  }

  async function callNumber(n) {
    if (!P()) return;
    try { await P().dial(n); }
    catch (e) { toast(e.message, 4000); }
  }

  // ---------- Live updates and the lobby badge ----------
  async function refreshBadge() {
    if (!token() || !(H().config && H().config.phone)) { openBtn.hidden = true; return; }
    openBtn.hidden = false;
    try { const j = await api("GET", "threads"); unread = j.unread || 0; renderBadge(); } catch {}
  }
  window.addEventListener("huddle:phone-live", (e) => {
    const m = e.detail || {};
    if (view === "list") loadList();
    else if (view === "thread" && m.number === current) loadThread();
    else refreshBadge();
    if (root.hidden && m.kind === "text") toast(`New text from ${pretty(m.number)}`);
    if (root.hidden && m.kind === "voicemail") toast(`New voicemail from ${pretty(m.number)}`);
  });
  window.addEventListener("huddle:phone-ended", () => { if (view === "thread") setTimeout(loadThread, 1500); else if (view === "list") setTimeout(loadList, 1500); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (view === "thread") loadThread(); else if (view === "list") loadList(); else refreshBadge(); } });
  window.addEventListener("huddle:signed-in", refreshBadge);
  // From a notification: open that number's conversation.
  window.addEventListener("huddle:open-phone", (e) => {
    const n = normalize(e.detail);
    if (!n || !token()) return;
    if (root.hidden) show();
    openThread(n);
  });
  fetch("/config", { cache: "no-store" }).then((r) => r.json()).then((c) => {
    if (c.phone && H().config) H().config.phone = true;
    refreshBadge();
  }).catch(() => {});
})();
