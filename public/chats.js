// Chats & friends: accounts, a friends list, and saved one-to-one chats with photos, voice
// notes and pinned messages. Live updates arrive while the app is open; Huddle never sends
// notifications.
(() => {
  const root = document.getElementById("chats");
  const openBtn = document.getElementById("chatsOpen");
  const badge = document.getElementById("chatsBadge");
  const TOKEN_KEY = "huddle:token";
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const H = () => window.huddle || {};
  const toast = (m, ms) => (H().toast ? H().toast(m, ms) : alert(m));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => {
    const w = String(n || "?").trim().split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase();
  };
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  const IC = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10l6-4v12l-6-4z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7c2 0 3.8.7 5.2 1.6M22 12s-3.5 7-10 7c-2 0-3.8-.7-5.2-1.6"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  // ---------- Server ----------
  let token = ls.get(TOKEN_KEY);
  let me = null;
  let saved = true;
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers.authorization = "Bearer " + token;
    let body = opts.body;
    if (body && !(body instanceof Blob) && typeof body !== "string") { body = JSON.stringify(body); headers["content-type"] = "application/json"; }
    const r = await fetch("/api" + path, { method: opts.method || (body ? "POST" : "GET"), headers, body, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token && !path.startsWith("/login")) { signedOut(); }
    if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong"), { status: r.status });
    return j;
  }

  // Live updates over a WebSocket of our own (separate from the call).
  let ws = null, wsTries = 0, wsTimer = null;
  function connect() {
    if (!token || (ws && ws.readyState <= 1)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { wsTries = 0; ws.send(JSON.stringify({ type: "auth", token })); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onLive(m); };
    ws.onclose = () => {
      ws = null;
      if (!token) return;
      clearTimeout(wsTimer);
      wsTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** wsTries++));
    };
  }
  function disconnect() { clearTimeout(wsTimer); if (ws) { const w = ws; ws = null; try { w.close(); } catch {} } }
  // Keep the connection only while the app is on screen.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (token && !ws) connect();
    if (view === "room" && room) catchUp();
    if (view === "list") loadList();
    else refreshBadge();
  });
  setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 25000);

  function onLive(m) {
    if (m.type === "auth-ok") { if (view === "room" && room) catchUp(); sendPresence(); loadLobbyFriends(); return; }
    if (m.type === "presence") { updatePresence(m); return; }
    if (m.type === "call-invite") { showInvite(m); return; }
    if (m.type === "auth-failed") { signedOut(); return; }
    if (m.type === "chats-changed") { if (view === "list") loadList(); else refreshBadge(); loadLobbyFriends(); return; }
    if (m.type === "chat-message") {
      if (view === "room" && room && room.id === m.chatId) { addMessages([m.message], true); markRead(); }
      else if (view === "list") loadList();
      else refreshBadge();
      return;
    }
    if (m.type === "chat-pin") {
      if (view === "room" && room && room.id === m.chatId) updateMessage(m.message);
    }
  }

  // ---------- Screens ----------
  let view = null; // "auth" | "list" | "room"
  let room = null; // { id, friend, messages: Map, oldest, newest, more }

  function show() {
    root.hidden = false;
    document.body.classList.add("chats-open");
    if (!history.state || !history.state.huddleChats) history.pushState({ huddleChats: 1 }, "");
  }
  function hide() {
    root.hidden = true;
    document.body.classList.remove("chats-open");
    stopRecording(true);
    view = null;
    room = null;
    refreshBadge();
  }
  window.addEventListener("popstate", () => {
    if (root.hidden || gate) return;
    if (view === "room") { openList(); history.pushState({ huddleChats: 1 }, ""); }
    else hide();
  });
  const goBack = () => { if (view === "room") openList(); else { hide(); if (history.state && history.state.huddleChats) history.back(); } };

  openBtn.onclick = () => { show(); token ? openList() : openAuth(); };

  // ----- Sign up / sign in -----
  // An account is needed to use Huddle. Until you have one, this screen can't be closed.
  let gate = false;
  function openGate(mode) {
    gate = true;
    root.hidden = false;
    document.body.classList.add("chats-open", "account-gate");
    openAuth(mode);
  }
  function openAuth(mode = "signup") {
    view = "auth";
    root.innerHTML = `
      <header class="ch-head">
        ${gate ? '<span class="ch-sp"></span>' : `<button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>`}
        <strong>${gate ? "Welcome to Huddle" : "Chats &amp; friends"}</strong><span class="ch-sp"></span>
      </header>
      <div class="ch-auth">
        ${gate ? '<div class="ch-gate-pip"></div>' : ""}
        <p class="ch-lead">${mode === "signup"
          ? (gate ? "Make an account to get started. This is the name friends see in calls and use to add you." : "Pick a name so friends can add you. Your chats are saved to your account.")
          : "Welcome back. Sign in to keep going."}</p>
        <div class="ch-tabs" role="tablist">
          <button class="${mode === "signup" ? "on" : ""}" data-mode="signup" type="button">Make an account</button>
          <button class="${mode === "login" ? "on" : ""}" data-mode="login" type="button">Sign in</button>
        </div>
        <form class="ch-form">
          <label><span>Name</span><input name="username" maxlength="20" autocomplete="username" autocapitalize="words" spellcheck="false" placeholder="e.g. Landon Webster" required></label>
          <label><span>Password</span><span class="ch-pw"><input name="password" type="password" minlength="6" maxlength="25" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required><button type="button" class="ch-eye" aria-label="Show password" aria-pressed="false">${IC.eye}</button></span></label>
          <p class="ch-err" role="alert"></p>
          <button class="btn primary" type="submit">${mode === "signup" ? "Make my account" : "Sign in"}</button>
          ${mode === "signup" ? '<p class="ch-fine">Names can use letters, numbers and spaces (3 to 20). Passwords can use any letters, numbers and symbols (6 to 25).</p>' : ""}
        </form>
      </div>`;
    const backBtn = root.querySelector('[data-act="back"]');
    if (backBtn) backBtn.onclick = goBack;
    if (gate && window.Pip) root.querySelector(".ch-gate-pip").appendChild(window.Pip.face(72));
    for (const b of root.querySelectorAll("[data-mode]")) b.onclick = () => openAuth(b.dataset.mode);
    const form = root.querySelector("form");
    // Carry over the name you used before as a guest.
    const guest = (ls.get("huddle:name") || "").trim();
    if (mode === "signup" && guest && guest !== "Guest") form.username.value = guest.slice(0, 20);
    // Eye button: show or hide what you typed.
    const eye = form.querySelector(".ch-eye");
    eye.onclick = () => {
      const showing = form.password.type === "text";
      form.password.type = showing ? "password" : "text";
      eye.innerHTML = showing ? IC.eye : IC.eyeOff;
      eye.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      eye.setAttribute("aria-pressed", String(!showing));
      form.password.focus();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = form.querySelector(".ch-err");
      err.textContent = "";
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const r = await api(mode === "signup" ? "/signup" : "/login", { body: { username: form.username.value.trim(), password: form.password.value } });
        token = r.token; ls.set(TOKEN_KEY, token); me = r.user;
        if (H().setName) H().setName(me.display);
        connect();
        if (gate) {
          gate = false;
          document.body.classList.remove("account-gate");
          hide();
          signedIn();
        } else openList();
      } catch (ex) { err.textContent = ex.message; }
      btn.disabled = false;
    };
    setTimeout(() => form.username.focus(), 50);
  }
  function signedOut() {
    token = null; me = null; ls.set(TOKEN_KEY, null); disconnect();
    badge.hidden = true;
    window.HuddleAccount.signedIn = false;
    if (!gate) openGate("login");
  }
  function signedIn() {
    window.HuddleAccount.signedIn = true;
    window.HuddleAccount.user = me;
    window.dispatchEvent(new CustomEvent("huddle:signedin", { detail: me }));
  }
  window.HuddleAccount = { signedIn: false, user: null };

  // ----- Chats list -----
  let chatsCache = [];
  function openList() {
    view = "list";
    room = null;
    stopRecording(true);
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>Chats</strong>
        <button class="ch-icon" data-act="account" aria-label="Account">${IC.menu}</button>
      </header>
      <div class="ch-body">
        <form class="ch-add">
          <input name="q" placeholder="Add a friend by name" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20">
          <button class="btn small" type="submit">Add</button>
        </form>
        <div class="ch-suggest" hidden></div>
        <div class="ch-warn" hidden>Chats are not being saved yet. They'll disappear when the server restarts.</div>
        <ul class="ch-list"><li class="ch-empty">Loading…</li></ul>
      </div>`;
    root.querySelector('[data-act="back"]').onclick = goBack;
    root.querySelector('[data-act="account"]').onclick = openAccountMenu;
    const form = root.querySelector(".ch-add");
    const sug = root.querySelector(".ch-suggest");
    let t = null;
    form.q.oninput = () => {
      clearTimeout(t);
      const v = form.q.value.trim();
      if (!v) { sug.hidden = true; return; }
      t = setTimeout(async () => {
        try {
          const { users } = await api("/users?q=" + encodeURIComponent(v));
          sug.hidden = !users.length;
          sug.innerHTML = users.map((u) => `<button type="button" data-u="${esc(u.username)}"><span class="ch-av sm">${esc(initials(u.display))}</span>${esc(u.display)}</button>`).join("");
          for (const b of sug.querySelectorAll("button")) b.onclick = () => addFriend(b.dataset.u);
        } catch {}
      }, 200);
    };
    form.onsubmit = (e) => { e.preventDefault(); if (form.q.value.trim()) addFriend(form.q.value.trim()); };
    loadList();
  }
  async function addFriend(username) {
    try {
      const r = await api("/friends", { body: { username } });
      toast(`${r.friend.display} is on your list`);
      const c = (await api("/chats")).chats.find((x) => x.id === r.chatId);
      if (c) openRoom(c); else loadList();
    } catch (ex) { toast(ex.message); }
  }
  async function loadList() {
    if (view !== "list") return;
    try {
      const r = await api("/chats");
      if (view !== "list") return;
      saved = r.saved;
      chatsCache = r.chats;
      root.querySelector(".ch-warn").hidden = saved;
      const list = root.querySelector(".ch-list");
      if (!r.chats.length) { list.innerHTML = '<li class="ch-empty">No chats yet. Add a friend by their name above.</li>'; }
      else list.innerHTML = r.chats.map((c) => `
        <li><button type="button" data-id="${c.id}">
          <span class="ch-av${c.friend.online ? " online" : ""}" data-u="${c.friend.id}">${esc(initials(c.friend.display))}</span>
          <span class="ch-row"><strong>${esc(c.friend.display)}</strong><small>${esc(preview(c.last))}</small></span>
          <span class="ch-meta"><small>${c.last ? when(c.last.at) : ""}</small>${c.unread ? `<b class="ch-dot">${c.unread > 99 ? "99+" : c.unread}</b>` : ""}</span>
        </button></li>`).join("");
      for (const b of list.querySelectorAll("button[data-id]")) b.onclick = () => openRoom(r.chats.find((c) => c.id === b.dataset.id));
      setBadge(r.chats.reduce((a, c) => a + c.unread, 0));
    } catch (ex) { if (ex.status !== 401) toast(ex.message); }
  }
  function preview(m) {
    if (!m) return "Say hi 👋";
    const who = me && m.sender === me.id ? "You: " : "";
    if (m.kind === "image") return who + "📷 Photo";
    if (m.kind === "voice") return who + "🎤 Voice note";
    return who + m.body;
  }
  function when(t) {
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function openAccountMenu() {
    sheet(`<p class="ch-sheet-title">Signed in as <b>${esc(me ? me.display : "")}</b></p>`, [
      { label: "Sign out", danger: true, run: async () => { try { await api("/logout", { method: "POST" }); } catch {} signedOut(); } },
    ]);
  }

  // ----- Badge on the lobby button (inside the app only) -----
  function setBadge(n) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
  async function refreshBadge() {
    if (!token) { badge.hidden = true; return; }
    try { const r = await api("/chats"); setBadge(r.chats.reduce((a, c) => a + c.unread, 0)); } catch {}
  }

  // ----- One chat -----
  function openRoom(c) {
    view = "room";
    room = { id: c.id, friend: c.friend, msgs: new Map(), oldest: null, newest: 0, more: false, loading: false, hasNewer: false };
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <span class="ch-who"><span class="ch-av sm">${esc(initials(c.friend.display))}</span><strong>${esc(c.friend.display)}</strong></span>
        <button class="ch-icon" data-act="call" aria-label="Video call ${esc(c.friend.display)}" title="Call">${IC.video}</button>
        <button class="ch-icon" data-act="menu" aria-label="Menu" title="Menu">${IC.menu}</button>
      </header>
      <div class="ch-msgs" tabindex="-1"><div class="ch-older" hidden>Loading…</div><div class="ch-stream"></div><button class="ch-jump" type="button" hidden>Back to latest ↓</button></div>
      <form class="ch-compose">
        <button class="ch-icon" type="button" data-act="photo" aria-label="Send a photo">${IC.photo}</button>
        <input type="file" accept="image/*" hidden>
        <input name="text" placeholder="Message…" autocomplete="off" maxlength="2000" enterkeyhint="send">
        <button class="ch-send" type="button" data-act="mic" aria-label="Record a voice note">${IC.mic}</button>
        <button class="ch-send" type="submit" data-act="send" aria-label="Send" hidden>${IC.send}</button>
      </form>
      <div class="ch-rec" hidden>
        <button class="ch-icon" type="button" data-act="cancel-rec" aria-label="Cancel">${IC.close}</button>
        <span class="ch-rec-dot"></span><span class="ch-rec-time">0:00</span><span class="ch-rec-label">Recording…</span>
        <button class="ch-send" type="button" data-act="send-rec" aria-label="Send voice note">${IC.send}</button>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    $('[data-act="back"]').onclick = goBack;
    $('[data-act="menu"]').onclick = openRoomMenu;
    $('[data-act="call"]').onclick = startCallWith;
    const form = $(".ch-compose");
    const file = form.querySelector("input[type=file]");
    const text = form.text;
    const micBtn = $('[data-act="mic"]'), sendBtn = $('[data-act="send"]');
    text.oninput = () => { const has = !!text.value.trim(); micBtn.hidden = has; sendBtn.hidden = !has; };
    form.onsubmit = (e) => { e.preventDefault(); const v = text.value.trim(); if (!v) return; text.value = ""; text.oninput(); sendText(v); text.focus(); };
    $('[data-act="photo"]').onclick = () => file.click();
    file.onchange = () => { const f = file.files && file.files[0]; file.value = ""; if (f) sendPhoto(f); };
    micBtn.onclick = startRecording;
    $('[data-act="cancel-rec"]').onclick = () => stopRecording(true);
    $('[data-act="send-rec"]').onclick = () => stopRecording(false);
    const box = $(".ch-msgs");
    box.addEventListener("scroll", () => {
      if (box.scrollTop < 80 && room.more && !room.loading) loadOlder();
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      $(".ch-jump").hidden = nearBottom && !room.hasNewer;
      if (nearBottom && room.hasNewer && !room.loading) loadNewer();
    });
    $(".ch-jump").onclick = () => loadLatest();
    loadLatest();
  }
  const stream = () => root.querySelector(".ch-stream");
  const box = () => root.querySelector(".ch-msgs");

  async function loadLatest() {
    const r = room;
    r.msgs.clear(); stream().innerHTML = ""; r.hasNewer = false;
    try {
      const j = await api(`/chats/${r.id}/messages?limit=50`);
      if (room !== r) return;
      r.more = j.more;
      addMessages(j.messages, false);
      scrollToBottom();
      markRead();
    } catch (ex) { toast(ex.message); }
  }
  async function loadOlder() {
    const r = room;
    if (!r.oldest) return;
    r.loading = true;
    root.querySelector(".ch-older").hidden = false;
    try {
      const j = await api(`/chats/${r.id}/messages?before=${r.oldest}&limit=50`);
      if (room !== r) return;
      const b = box(), h = b.scrollHeight;
      r.more = j.more;
      addMessages(j.messages, false);
      b.scrollTop += b.scrollHeight - h; // keep your place
    } catch {}
    r.loading = false;
    root.querySelector(".ch-older").hidden = true;
  }
  async function loadNewer() {
    const r = room;
    r.loading = true;
    try {
      const j = await api(`/chats/${r.id}/messages?after=${r.newest}`);
      if (room !== r) return;
      addMessages(j.messages, false);
      r.hasNewer = j.messages.length >= 100;
      if (!r.hasNewer) markRead();
    } catch {}
    r.loading = false;
  }
  // After being away (screen off, lost connection), fetch anything we missed.
  async function catchUp() {
    const r = room;
    if (!r || r.hasNewer) return;
    try {
      const j = await api(`/chats/${r.id}/messages?after=${r.newest}`);
      if (room === r && j.messages.length) { addMessages(j.messages, true); markRead(); }
    } catch {}
  }
  let readTimer = null;
  function markRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => { if (room && room.newest) api(`/chats/${room.id}/read`, { body: { n: room.newest } }).catch(() => {}); }, 300);
  }
  function scrollToBottom() { const b = box(); if (b) b.scrollTop = b.scrollHeight; }

  // Messages are kept in order by their number (n). New ones go in the right place.
  function addMessages(list, live) {
    const r = room;
    if (!r) return;
    const b = box();
    const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 150;
    for (const m of list) {
      if (r.msgs.has(m.id)) { updateMessage(m); continue; }
      r.msgs.set(m.id, m);
      const el = renderMessage(m);
      const s = stream();
      const after = [...s.children].find((c) => Number(c.dataset.n) > m.n);
      s.insertBefore(el, after || null);
      if (r.oldest == null || m.n < r.oldest) r.oldest = m.n;
      if (m.n > r.newest) r.newest = m.n;
    }
    regroup();
    if (live && (atBottom || list.some((m) => me && m.sender === me.id))) scrollToBottom();
  }
  // Day labels between days, like other chat apps.
  function regroup() {
    const s = stream();
    for (const d of s.querySelectorAll(".ch-day")) d.remove();
    let last = "";
    for (const el of [...s.children]) {
      const day = new Date(Number(el.dataset.at)).toDateString();
      if (day !== last) {
        const d = document.createElement("div");
        d.className = "ch-day";
        const t = new Date(Number(el.dataset.at));
        d.textContent = day === new Date().toDateString() ? "Today" : t.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
        s.insertBefore(d, el);
        last = day;
      }
    }
  }
  function renderMessage(m) {
    const mine = me && m.sender === me.id;
    const el = document.createElement("div");
    el.className = "ch-msg" + (mine ? " mine" : "") + (m.pinned ? " pinned" : "");
    el.dataset.id = m.id; el.dataset.n = m.n; el.dataset.at = m.at;
    el.innerHTML = bubbleHtml(m);
    wireBubble(el, m);
    return el;
  }
  function bubbleHtml(m) {
    const time = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    let inner;
    if (m.kind === "image") inner = `<img class="ch-img" src="/api/media/${esc(m.mediaId)}" alt="Photo" loading="lazy">`;
    else if (m.kind === "voice") inner = `<div class="ch-voice"><button class="ch-play" type="button" aria-label="Play voice note">${IC.play}</button><span class="ch-wave"><i></i></span><span class="ch-dur">${fmtDur(m.duration)}</span></div>`;
    else inner = `<span class="ch-text">${linkify(m.body)}</span>`;
    return `<div class="ch-bubble ${m.kind}">${inner}<span class="ch-time">${m.pinned ? `<span class="ch-pin-mark" title="Pinned">${IC.pin}</span>` : ""}${time}</span></div>`;
  }
  function updateMessage(m) {
    if (!room || !room.msgs.has(m.id)) return;
    room.msgs.set(m.id, m);
    const el = stream().querySelector(`[data-id="${CSS.escape(m.id)}"]`);
    if (!el) return;
    el.classList.toggle("pinned", m.pinned);
    el.innerHTML = bubbleHtml(m);
    wireBubble(el, m);
  }
  const fmtDur = (s) => { s = Math.round(Number(s) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  function wireBubble(el, m) {
    const bubble = el.querySelector(".ch-bubble");
    // Hold (or right-click) a message to pin it.
    let timer = null, sx = 0, sy = 0, held = false;
    bubble.addEventListener("pointerdown", (e) => {
      held = false; sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { held = true; if (navigator.vibrate) try { navigator.vibrate(10); } catch {} messageMenu(room.msgs.get(m.id) || m); }, 450);
    });
    const cancel = () => clearTimeout(timer);
    bubble.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
    bubble.addEventListener("pointerup", cancel);
    bubble.addEventListener("pointercancel", cancel);
    bubble.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!held) messageMenu(room.msgs.get(m.id) || m); });
    bubble.addEventListener("click", (e) => { if (held) { e.preventDefault(); e.stopPropagation(); held = false; } }, true);
    const img = bubble.querySelector(".ch-img");
    if (img) img.onclick = () => { if (!held) viewPhoto(img.src); };
    const play = bubble.querySelector(".ch-play");
    if (play) play.onclick = () => { if (!held) toggleVoice(bubble, m); };
  }
  function messageMenu(m) {
    const items = [{ label: m.pinned ? "Unpin" : "Pin message", run: () => pin(m, !m.pinned) }];
    if (m.kind === "text") items.push({ label: "Copy", run: () => { navigator.clipboard && navigator.clipboard.writeText(m.body).then(() => toast("Copied")).catch(() => {}); } });
    sheet(`<div class="ch-sheet-preview">${esc(previewText(m))}</div>`, items);
  }
  const previewText = (m) => (m.kind === "image" ? "📷 Photo" : m.kind === "voice" ? `🎤 Voice note (${fmtDur(m.duration)})` : m.body);
  async function pin(m, on) {
    try { const r = await api(`/messages/${m.id}/pin`, { body: { pinned: on } }); updateMessage(r.message); toast(on ? "Pinned" : "Unpinned"); }
    catch (ex) { toast(ex.message); }
  }

  // ----- ☰ menu and pinned messages -----
  function openRoomMenu() {
    sheet(`<p class="ch-sheet-title">${esc(room.friend.display)}</p>`, [
      { label: "📌 Pinned messages", run: openPinned },
      { label: "📹 Start a video call", run: startCallWith },
    ]);
  }
  async function openPinned() {
    const r = room;
    let list = [];
    try { list = (await api(`/chats/${r.id}/pinned`)).messages; } catch (ex) { toast(ex.message); return; }
    if (room !== r) return;
    const wrap = document.createElement("div");
    wrap.className = "ch-overlay";
    wrap.innerHTML = `
      <div class="ch-panel" role="dialog" aria-label="Pinned messages">
        <header class="ch-head"><button class="ch-icon" data-act="x" aria-label="Close">${IC.back}</button><strong>Pinned messages</strong><span class="ch-sp"></span></header>
        <ul class="ch-pins">${list.length ? list.map((m) => `
          <li><button type="button" data-id="${esc(m.id)}">
            <span class="ch-pin-who">${esc(me && m.sender === me.id ? "You" : r.friend.display)} · ${when(m.at)}</span>
            <span class="ch-pin-text">${m.kind === "image" ? `<img src="/api/media/${esc(m.mediaId)}" alt="">` : ""}${esc(previewText(m))}</span>
          </button></li>`).join("") : '<li class="ch-empty">Nothing pinned yet. Hold a message to pin it.</li>'}</ul>
      </div>`;
    root.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('[data-act="x"]').onclick = close;
    for (const b of wrap.querySelectorAll("button[data-id]")) b.onclick = () => { close(); jumpTo(b.dataset.id); };
  }
  // Take you back to a message in the chat, loading the part of the chat around it if needed.
  async function jumpTo(id) {
    const r = room;
    let el = stream().querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el) {
      try {
        const j = await api(`/chats/${r.id}/messages?around=${encodeURIComponent(id)}`);
        if (room !== r) return;
        r.msgs.clear(); stream().innerHTML = ""; r.oldest = null; r.newest = 0;
        r.more = j.more; r.hasNewer = !!j.newer;
        addMessages(j.messages, false);
        root.querySelector(".ch-jump").hidden = !r.hasNewer;
        el = stream().querySelector(`[data-id="${CSS.escape(id)}"]`);
      } catch (ex) { toast(ex.message); return; }
    }
    if (!el) { toast("That message is gone"); return; }
    el.scrollIntoView({ block: "center" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }

  // ----- Video call from a chat -----
  function startCallWith() {
    const h = H();
    if (!h.joinRoom) return;
    const code = h.newRoomCode();
    sendText(`📹 Join my video call: ${location.origin}/r/${code}`);
    hide();
    if (history.state && history.state.huddleChats) history.back();
    setTimeout(() => h.joinRoom(code), 50);
  }

  // ----- Sending -----
  async function sendText(body) {
    const r = room;
    try { const j = await api(`/chats/${r.id}/messages`, { body: { kind: "text", body } }); if (room === r) addMessages([j.message], true); }
    catch (ex) { toast(ex.message); }
  }
  // Photos are shrunk to a sensible size before sending, so they upload fast on phones.
  async function shrinkImage(f) {
    if (f.type === "image/gif" && f.size < 6e6) return f;
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b || f), "image/jpeg", 0.82));
    } catch { return f; } finally { URL.revokeObjectURL(url); }
  }
  async function upload(blob, type) {
    const r = await fetch("/api/media", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": type }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Upload failed");
    return j.id;
  }
  async function sendPhoto(f) {
    const r = room;
    if (!/^image\//.test(f.type)) { toast("That isn't a photo"); return; }
    toast("Sending photo…", 1500);
    try {
      const blob = await shrinkImage(f);
      const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
      const mediaId = await upload(blob, type);
      const j = await api(`/chats/${r.id}/messages`, { body: { kind: "image", mediaId } });
      if (room === r) addMessages([j.message], true);
    } catch (ex) { toast(ex.message); }
  }

  // ----- Voice notes -----
  let rec = null; // { mr, stream, chunks, start, timer, cancelled }
  function pickAudioType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return (window.MediaRecorder && types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t))) || "";
  }
  async function startRecording() {
    if (rec) return;
    if (!window.MediaRecorder) { toast("Voice notes aren't supported here"); return; }
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast("Allow the microphone to record a voice note"); return; }
    const type = pickAudioType();
    const mr = new MediaRecorder(s, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    rec = { mr, stream: s, chunks: [], start: Date.now(), cancelled: false, chat: room };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) rec && rec.chunks.push(e.data); };
    mr.onstop = finishRecording;
    mr.start(250);
    const ui = root.querySelector(".ch-rec");
    ui.hidden = false;
    root.querySelector(".ch-compose").hidden = true;
    const time = ui.querySelector(".ch-rec-time");
    rec.timer = setInterval(() => {
      const secs = (Date.now() - rec.start) / 1000;
      time.textContent = fmtDur(secs);
      if (secs >= 180) stopRecording(false); // voice notes up to 3 minutes
    }, 250);
  }
  function stopRecording(cancel) {
    if (!rec) return;
    rec.cancelled = cancel;
    clearInterval(rec.timer);
    try { rec.mr.state !== "inactive" ? rec.mr.stop() : finishRecording(); } catch { finishRecording(); }
    const ui = root.querySelector(".ch-rec");
    if (ui) { ui.hidden = true; root.querySelector(".ch-compose").hidden = false; }
  }
  async function finishRecording() {
    const r = rec;
    if (!r) return;
    rec = null;
    for (const t of r.stream.getTracks()) t.stop();
    const duration = (Date.now() - r.start) / 1000;
    if (r.cancelled || duration < 0.7 || !r.chunks.length) { if (!r.cancelled) toast("Hold on a bit longer to record"); return; }
    const type = (r.mr.mimeType || r.chunks[0].type || "audio/webm").split(";")[0];
    const blob = new Blob(r.chunks, { type });
    try {
      const mediaId = await upload(blob, type);
      const j = await api(`/chats/${r.chat.id}/messages`, { body: { kind: "voice", mediaId, duration } });
      if (room === r.chat) addMessages([j.message], true);
    } catch (ex) { toast(ex.message); }
  }
  // One voice note plays at a time.
  let playing = null; // { audio, bubble }
  function toggleVoice(bubble, m) {
    if (playing && playing.bubble === bubble) {
      if (playing.audio.paused) playing.audio.play().catch(() => {}); else playing.audio.pause();
      return;
    }
    if (playing) { playing.audio.pause(); setPlayUi(playing.bubble, false, 0); }
    const audio = new Audio(`/api/media/${m.mediaId}`);
    playing = { audio, bubble };
    const dur = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : m.duration || 1);
    audio.ontimeupdate = () => setPlayUi(bubble, !audio.paused, audio.currentTime / dur(), audio.currentTime);
    audio.onplay = () => setPlayUi(bubble, true, audio.currentTime / dur());
    audio.onpause = () => setPlayUi(bubble, false, audio.currentTime / dur());
    audio.onended = () => { setPlayUi(bubble, false, 0); if (playing && playing.audio === audio) playing = null; };
    audio.play().catch(() => toast("Couldn't play that voice note"));
  }
  function setPlayUi(bubble, on, frac, t) {
    const b = bubble.querySelector(".ch-play");
    if (b) b.innerHTML = on ? IC.pause : IC.play;
    const bar = bubble.querySelector(".ch-wave i");
    if (bar) bar.style.width = Math.max(0, Math.min(100, frac * 100)) + "%";
    const d = bubble.querySelector(".ch-dur");
    if (d && t != null) d.textContent = fmtDur(t);
  }

  // ----- Photo viewer -----
  function viewPhoto(src) {
    const v = document.createElement("div");
    v.className = "ch-viewer";
    v.innerHTML = `<img src="${esc(src)}" alt="Photo"><button class="ch-icon" aria-label="Close">${IC.close}</button>`;
    v.onclick = () => v.remove();
    root.appendChild(v);
  }

  // ----- Bottom sheet menu -----
  function sheet(headHtml, items) {
    const wrap = document.createElement("div");
    wrap.className = "ch-sheet-wrap";
    wrap.innerHTML = `<div class="ch-sheet" role="menu">${headHtml}${items.map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`).join("")}<button type="button" class="cancel">Cancel</button></div>`;
    (root.hidden ? document.body : root).appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    wrap.querySelector(".cancel").onclick = close;
    for (const b of wrap.querySelectorAll("[data-i]")) b.onclick = () => { close(); items[Number(b.dataset.i)].run(); };
  }

  // ---------- Start ----------
  // ----- Friends on the start screen, who's online, and call invites -----
  const lfList = document.getElementById("lfList");
  const lfCount = document.getElementById("lfCount");
  let lobbyChats = [];
  function statusText(f) { return f.inCall ? "In a call" : f.online ? "On Huddle now" : "Away"; }
  async function loadLobbyFriends() {
    if (!lfList || !token) return;
    try {
      const r = await api("/chats");
      lobbyChats = r.chats;
      chatsCache = r.chats;
      setBadge(r.chats.reduce((a, c) => a + c.unread, 0));
      drawLobbyFriends();
    } catch {}
  }
  function drawLobbyFriends() {
    if (!lfList) return;
    const list = [...lobbyChats].sort((a, b) => (b.friend.online - a.friend.online) || a.friend.display.localeCompare(b.friend.display));
    const on = list.filter((c) => c.friend.online).length;
    lfCount.textContent = list.length ? `${on} online` : "";
    if (!list.length) {
      lfList.innerHTML = '<li class="lf-empty"><span>No friends yet.</span><button type="button" class="lf-add">Add a friend</button></li>';
      lfList.querySelector(".lf-add").onclick = () => { show(); openList(); setTimeout(() => { const i = root.querySelector(".ch-add input"); if (i) i.focus(); }, 50); };
      return;
    }
    lfList.innerHTML = list.slice(0, 8).map((c) => `
      <li class="${c.friend.online ? "on" : ""}">
        <span class="ch-av sm${c.friend.online ? " online" : ""}${c.friend.inCall ? " busy" : ""}">${esc(initials(c.friend.display))}</span>
        <span class="lf-text"><strong>${esc(c.friend.display)}</strong><small>${statusText(c.friend)}</small></span>
        <button type="button" class="lf-chat" data-id="${c.id}" aria-label="Chat with ${esc(c.friend.display)}">${IC.chat || "💬"}</button>
        <button type="button" class="lf-call" data-id="${c.id}">Call</button>
      </li>`).join("") + (list.length > 8 ? `<li class="lf-more"><button type="button">See all ${list.length} friends</button></li>` : "");
    for (const b of lfList.querySelectorAll(".lf-call")) b.onclick = () => callFriend(lobbyChats.find((c) => c.id === b.dataset.id));
    for (const b of lfList.querySelectorAll(".lf-chat")) b.onclick = () => { const c = lobbyChats.find((x) => x.id === b.dataset.id); show(); openRoom(c); };
    const more = lfList.querySelector(".lf-more button");
    if (more) more.onclick = () => { show(); openList(); };
  }
  function updatePresence(m) {
    for (const c of [...lobbyChats, ...chatsCache]) if (c.friend.id === m.userId) Object.assign(c.friend, { online: m.online, inCall: m.inCall });
    drawLobbyFriends();
    if (view === "list") for (const av of root.querySelectorAll(`.ch-av[data-u="${m.userId}"]`)) av.classList.toggle("online", m.online);
  }
  async function callFriend(c) {
    const h = H();
    if (!c || !h.joinRoom) return;
    if (h.inCall) { invite(c, h.room); return; }
    const code = h.newRoomCode();
    h.joinRoom(code);
    invite(c, code);
  }
  async function invite(c, code) {
    try {
      await api(`/chats/${c.id}/messages`, { body: { kind: "text", body: `📹 Join my video call: ${location.origin}/r/${code}` } });
      const r = await api(`/chats/${c.id}/invite`, { body: { room: code } });
      toast(r.online ? `Asked ${c.friend.display.split(/\s+/)[0]} to join` : `${c.friend.display.split(/\s+/)[0]} isn't on Huddle right now. They'll see the link in your chat.`, 3500);
    } catch (ex) { toast(ex.message); }
  }
  // An in-app card only (no sound, no notification): it shows while Huddle is open.
  let inviteEl = null, inviteTimer = null;
  function showInvite(m) {
    const h = H();
    if (h.inCall && h.room === m.room) return;
    if (inviteEl) inviteEl.remove();
    clearTimeout(inviteTimer);
    inviteEl = document.createElement("div");
    inviteEl.className = "invite-card";
    inviteEl.setAttribute("role", "dialog");
    inviteEl.innerHTML = `
      <span class="ch-av">${esc(initials(m.from.display))}</span>
      <span class="ic-text"><strong>${esc(m.from.display)}</strong><small>wants you in a call</small></span>
      <button type="button" class="ic-no">Not now</button>
      <button type="button" class="ic-yes">Join</button>`;
    document.body.appendChild(inviteEl);
    const close = () => { if (inviteEl) inviteEl.remove(); inviteEl = null; clearTimeout(inviteTimer); };
    inviteEl.querySelector(".ic-no").onclick = close;
    inviteEl.querySelector(".ic-yes").onclick = () => {
      close();
      if (!root.hidden && !gate) { hide(); if (history.state && history.state.huddleChats) history.back(); }
      const go = () => h.joinRoom(m.room);
      if (h.inCall) { document.getElementById("leaveBtn").click(); setTimeout(go, 400); } else go();
    };
    inviteTimer = setTimeout(close, 60000);
  }
  function sendPresence() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "presence", inCall: !!H().inCall }));
  }
  window.addEventListener("huddle:joined", () => setTimeout(sendPresence, 50));
  window.addEventListener("huddle:left", () => setTimeout(sendPresence, 50));
  window.addEventListener("huddle:signedin", () => loadLobbyFriends());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadLobbyFriends(); });

  async function boot() {
    if (!token) { openGate("signup"); return; }
    try {
      const r = await api("/me");
      me = r.user; saved = r.saved;
      window.HuddleAccount.pipChat = !!r.pipChat;
      if (H().setName) H().setName(me.display);
      connect();
      refreshBadge();
      signedIn();
    } catch (ex) {
      // Offline or server asleep: let you in with the account you already have on this device.
      if (ex.status !== 401 && token) signedIn();
    }
  }
  boot();
})();
