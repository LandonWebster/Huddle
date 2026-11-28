// Sleep Mode: a switch next to the Home title (and on the Huddle tab while it's on).
// While it's on, every tab but Huddle is locked, and the Huddle tab shows only your Huddle Buddy
// (one friend you pick) for sleep calls. Alarms still ring, and so do phone calls forwarded from
// your own cell (calls straight to your Huddle number go to voicemail, see phone.js). You answer,
// decline, snooze or stop them from their ringing screens as usual. Huddle calls only ring from
// your Buddy and your Caller Exceptions (friends you marked Work or Parent on their profile in
// Contacts); the rest are skipped here, in chats.js, and in notifications (notify.js).
// Turning it on sends your Buddy a note in your chat. No 911 button here on purpose (Landon: too
// easy to hit by accident while sleepy).
// Saved with your account Settings: prefs "sleep", "buddy" and "exceptions" ({ userId: "work" | "parent" }).
(() => {
  "use strict";
  const T = window.HuddleTabs;
  const P = () => window.HuddlePrefs;
  if (!T) return;
  const H = () => window.huddle || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (t, ms) => { if (H().toast) H().toast(t, ms); };
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  const LABELS = { home: "Home", contacts: "Contacts", phone: "Phone", video: "Video", photos: "Photos", alarms: "Alarms" };
  const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';

  const prefs = () => (P() ? P().all : {});
  const isOn = () => prefs().sleep === true;
  const buddyId = () => prefs().buddy || null;
  const exceptions = () => prefs().exceptions || {};
  const REASONS = { work: "Work", parent: "Parent" };
  let chats = null; // your 1-to-1 chats (friends), from /api/chats
  let bstate = { buddy: null, incoming: [], sent: null }; // Huddle Buddy requests (buddy.js)

  async function api(path, opts = {}) {
    const r = await fetch("/api" + path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: { authorization: "Bearer " + (token() || ""), ...(opts.body ? { "content-type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
    return j;
  }
  async function loadFriends() {
    try { chats = ((await api("/chats")).chats || []).filter((c) => !c.group && c.friend); } catch { if (!chats) chats = []; }
    return chats;
  }
  async function loadBuddy() {
    try { bstate = await api("/buddy/state"); } catch {}
    drawRequests();
    return bstate;
  }
  async function buddyAct(what, userId) {
    bstate = await api("/buddy/" + what, { body: userId ? { userId } : {} });
    if (P() && P().load) await P().load(); // your "buddy" pref changed on the server
    drawRequests(); paint();
    return bstate;
  }
  const buddyChat = () => (chats || []).find((c) => c.friend.id === buddyId()) || null;

  // ---------- The switch ----------
  function makeSwitch() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sleep-sw";
    b.setAttribute("role", "switch");
    b.innerHTML = `<span class="ss-moon">${moon}</span><span class="ss-label">Sleep Mode</span><span class="track"></span>`;
    b.onclick = () => (isOn() ? turnOff() : turnOnAsk());
    return b;
  }
  const homeSw = makeSwitch();
  T.page("home", "Home").right.appendChild(homeSw);
  const lobby = $("lobby");
  const brand = lobby && lobby.querySelector(".brand");
  const huddleSw = makeSwitch();
  huddleSw.classList.add("in-brand");
  if (brand) brand.appendChild(huddleSw);

  // ---------- The sleep screen on the Huddle tab ----------
  const panel = document.createElement("section");
  panel.id = "sleepPanel";
  panel.className = "sleep-panel";
  panel.setAttribute("aria-label", "Sleep Mode");
  if (brand) brand.after(panel);

  function since() {
    let t = 0; try { t = Number(localStorage.getItem("huddle:sleepSince") || 0); } catch {}
    return t ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  }
  function renderPanel() {
    if (!isOn()) { panel.innerHTML = ""; return; }
    const c = buddyChat();
    const at = since();
    let card;
    if (!buddyId()) {
      card = `<p class="sp-none">You don't have a Huddle Buddy yet. Turn off Sleep Mode, then tap a friend on Home to ask them.</p>`;
    } else if (!chats) {
      card = `<p class="sp-none">Loading…</p>`;
    } else if (!c) {
      card = `<p class="sp-none">Your Huddle Buddy isn't on your friends list anymore.</p>`;
    } else {
      const f = c.friend;
      const st = f.inCall ? "In a call" : f.online ? "On Huddle now" : "Away";
      card = `
        <small class="sp-kicker">Your Huddle Buddy</small>
        <span class="sp-av${f.online ? " online" : ""}"></span>
        <b class="sp-name">${esc(f.display)}</b>
        <small class="sp-status${f.online ? " on" : ""}">${st}</small>
        <button type="button" class="btn primary sp-call">${H().inCall ? "Ask them to join" : "Sleep call"}</button>`;
    }
    panel.innerHTML = `
      <p class="sp-since">${at ? `Sleeping since ${esc(at)} · ` : ""}calls to your cell and alarms still ring</p>
      <div class="sp-card">${card}</div>`;
    const av = panel.querySelector(".sp-av");
    if (av && c && H().paintAvatar) H().paintAvatar(av, c.friend, c.friend.display);
    const call = panel.querySelector(".sp-call");
    if (call) call.onclick = () => sleepCall(c);
  }

  async function sleepCall(c) {
    const h = H();
    if (!c || !h.joinRoom) return;
    const code = h.inCall ? h.room : h.newRoomCode();
    if (!h.inCall) h.joinRoom(code);
    try {
      await api(`/chats/${c.id}/messages`, { body: { kind: "text", body: `📹 Join my video call: ${location.origin}/r/${code}` } });
      const r = await api(`/chats/${c.id}/invite`, { body: { room: code } });
      toast(r.online ? `Calling ${c.friend.display}` : `${c.friend.display} isn't on Huddle right now. They'll see the link in your chat.`, 3500);
    } catch (e) { toast(e.message); }
  }

  // ---------- Huddle Buddies: ask a friend, they say yes (one Buddy each) ----------
  // A friend's sheet (tap a friend on Home) and their profile (Contacts) have the Ask button.
  function buddyButtonHtml(u) {
    if (bstate.buddy && bstate.buddy.id === u.id) return `<button type="button" class="sleep-bud on" data-b="end">${moon}<span><b>Huddle Buddies</b><small>You and ${esc(u.display)} are Huddle Buddies. Tap to end it.</small></span></button>`;
    if (bstate.incoming.some((x) => x.id === u.id)) return `<button type="button" class="sleep-bud" data-b="accept">${moon}<span><b>Say yes to Huddle Buddies</b><small>${esc(u.display)} asked you.</small></span></button>`;
    if (bstate.sent && bstate.sent.id === u.id) return `<button type="button" class="sleep-bud" data-b="cancel">${moon}<span><b>Asked to be Huddle Buddies</b><small>Waiting for ${esc(u.display)} to say yes. Tap to cancel.</small></span></button>`;
    return `<button type="button" class="sleep-bud" data-b="ask">${moon}<span><b>Ask to be Huddle Buddies</b><small>${bstate.buddy ? `You're Huddle Buddies with ${esc(bstate.buddy.display)} now. You can only have one.` : "Your Huddle Buddy can call you in Sleep Mode."}</small></span></button>`;
  }
  function wireBuddyButton(holder, u, after) {
    const b = holder.querySelector(".sleep-bud");
    if (!b) return;
    b.onclick = async () => {
      const what = b.dataset.b;
      if (what === "end" && !confirmSoft(`Stop being Huddle Buddies with ${u.display}?`)) return;
      if (what === "ask" && bstate.buddy && !confirmSoft(`You can only have one Huddle Buddy. If ${u.display} says yes, you stop being Huddle Buddies with ${bstate.buddy.display}. Ask anyway?`)) return;
      b.disabled = true;
      try {
        await buddyAct(what, u.id);
        toast({ ask: `Asked ${u.display} to be Huddle Buddies`, accept: `You and ${u.display} are Huddle Buddies`, cancel: "Request canceled", end: `You're not Huddle Buddies with ${u.display} anymore` }[what], 3500);
      } catch (e) { toast(e.message); }
      if (after) after();
    };
  }
  // A plain confirm is fine here: it's a deliberate tap and nothing else is waiting on it.
  const confirmSoft = (t) => window.confirm(t);
  async function friendSheet(f) {
    const wrap = document.createElement("div");
    wrap.className = "ch-sheet-wrap sleep-sheet-wrap";
    wrap.innerHTML = `<div class="ch-sheet sleep-friend" role="dialog" aria-label="${esc(f.display)}">
      <div class="sf-head"><span class="sk-av"></span><span class="sk-txt"><b>${esc(f.display)}</b><small class="${f.online ? "on" : ""}">${f.inCall ? "In a call" : f.online ? "On Huddle now" : "Away"}</small></span></div>
      <div class="sf-bud"></div>
      <button type="button" data-a="chat">Open your chat</button>
      <button type="button" class="cancel">Close</button></div>`;
    document.body.appendChild(wrap);
    if (H().paintAvatar) H().paintAvatar(wrap.querySelector(".sk-av"), f, f.display);
    const close = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    wrap.querySelector(".cancel").onclick = close;
    wrap.querySelector('[data-a="chat"]').onclick = () => { close(); T.select("contacts"); };
    const draw = () => { const h = wrap.querySelector(".sf-bud"); h.innerHTML = buddyButtonHtml(f); wireBuddyButton(h, f, close); };
    draw();
    await loadBuddy();
    if (wrap.isConnected) draw();
  }

  // Requests waiting for you, at the top of Home.
  const homeP = T.page("home", "Home");
  const reqBox = document.createElement("section");
  reqBox.className = "sleep-reqs";
  homeP.body.prepend(reqBox);
  function drawRequests() {
    const list = bstate.incoming || [];
    reqBox.hidden = !list.length;
    reqBox.innerHTML = list.map((u) => `
      <div class="sr-row" data-u="${esc(u.id)}">
        <span class="sk-av"></span>
        <span class="sk-txt"><b>${esc(u.display)} wants to be Huddle Buddies</b><small>Huddle Buddies can call each other in Sleep Mode.${bstate.buddy ? ` Saying yes ends your Buddies with ${esc(bstate.buddy.display)}.` : ""}</small></span>
        <span class="sr-btns"><button type="button" class="btn" data-r="decline">No thanks</button><button type="button" class="btn primary" data-r="accept">Yes</button></span>
      </div>`).join("");
    reqBox.querySelectorAll(".sr-row").forEach((row, i) => {
      const u = list[i];
      if (H().paintAvatar) H().paintAvatar(row.querySelector(".sk-av"), u, u.display);
      for (const b of row.querySelectorAll("[data-r]")) b.onclick = async () => {
        b.disabled = true;
        try { await buddyAct(b.dataset.r, u.id); toast(b.dataset.r === "accept" ? `You and ${u.display} are Huddle Buddies` : "Request declined", 3000); }
        catch (e) { b.disabled = false; toast(e.message); }
      };
    });
  }
  window.addEventListener("huddle:buddy", async (e) => {
    const m = e.detail || {};
    await loadBuddy();
    if (P() && P().load) await P().load();
    paint();
    if (m.what === "request" && m.from) toast(`${m.from.display} wants to be Huddle Buddies. See Home.`, 4000);
    if (m.what === "paired" && m.with) toast(`You and ${m.with.display} are Huddle Buddies`, 3500);
    if (m.what === "declined") toast("Your Huddle Buddy request was declined", 3500);
    if (m.what === "ended") toast("Your Huddle Buddy ended it", 3500);
  });

  // ---------- On and off ----------
  async function turnOnAsk() {
    if (!P()) return;
    await loadFriends();
    if (buddyChat()) { turnOn(); return; }
    // No Buddy yet: they're set before Sleep Mode, by tapping a friend on Home.
    const wrap = document.createElement("div");
    wrap.className = "ch-sheet-wrap sleep-sheet-wrap";
    wrap.innerHTML = `<div class="ch-sheet" role="dialog" aria-label="No Huddle Buddy yet">
      <p class="ch-sheet-title">You don't have a Huddle Buddy yet. Tap a friend on Home (or their profile in Contacts) and ask them first. They're the only one who can call you in Sleep Mode.</p>
      <button type="button" data-a="on">Turn on Sleep Mode anyway</button>
      <button type="button" class="cancel">Not now</button></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    wrap.querySelector(".cancel").onclick = close;
    wrap.querySelector('[data-a="on"]').onclick = () => { close(); turnOn(); };
  }
  async function turnOn() {
    const t = Date.now();
    try { localStorage.setItem("huddle:sleepSince", String(t)); } catch {}
    try { await P().set("sleep", true); } catch (e) { toast(e.message); return; }
    paint();
    T.select("huddle");
    const c = buddyChat();
    if (c) {
      const me = (window.HuddleAccount && window.HuddleAccount.user) || {};
      const at = new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      try {
        await api(`/chats/${c.id}/messages`, { body: { kind: "text", body: `🌙 ${me.display || "I"} went to sleep (Sleep Mode on, ${at}). You're my Huddle Buddy, so your calls still come through.` } });
        toast(`Sleep Mode on. ${c.friend.display} got a note.`, 3500);
      } catch { toast("Sleep Mode on. Couldn't send your Buddy the note.", 4000); }
    } else toast("Sleep Mode on");
  }
  async function turnOff() {
    try { await P().set("sleep", false); } catch (e) { toast(e.message); return; }
    try { localStorage.removeItem("huddle:sleepSince"); } catch {}
    paint();
    T.select("home");
    toast("Sleep Mode off");
  }

  function paint() {
    const on = isOn();
    document.body.classList.toggle("sleep-on", on);
    for (const b of [homeSw, huddleSw]) {
      b.setAttribute("aria-checked", String(on));
      b.setAttribute("aria-label", on ? "Sleep Mode is on. Turn it off" : "Turn on Sleep Mode");
    }
    for (const t of document.querySelectorAll(".tabbar .tab")) {
      const locked = on && t.dataset.tab !== "huddle";
      t.classList.toggle("sleep-locked", locked);
      if (locked) t.setAttribute("aria-label", `${LABELS[t.dataset.tab] || t.dataset.tab} (locked in Sleep Mode)`);
      else t.setAttribute("aria-label", t.querySelector(".tl") ? t.querySelector(".tl").textContent : t.dataset.tab);
    }
    renderPanel();
    // Locked while on: leave any other tab.
    if (on && T.current && T.current !== "huddle") T.select("huddle");
  }

  // ---------- Keep other screens closed while sleeping ----------
  // (a notification tap can open a chat or the phone screen from anywhere)
  function guard(root, name) {
    if (!root) return;
    new MutationObserver(() => {
      if (!isOn() || root.hidden) return;
      if (name === "contacts" && window.HuddleChats) window.HuddleChats.hide();
      if (name === "phone" && window.HuddlePhoneScreen) window.HuddlePhoneScreen.hide();
      locked(name);
    }).observe(root, { attributes: true, attributeFilter: ["hidden"] });
  }
  guard($("chats"), "contacts");
  guard(document.querySelector(".phone-screen"), "phone");

  let lockToast = 0;
  function locked(id) {
    if (Date.now() - lockToast < 1500) return;
    lockToast = Date.now();
    toast(`${LABELS[id] || "That"} is locked in Sleep Mode. Turn Sleep Mode off to open it.`, 3000);
  }

  // ---------- Huddle Sleep Mode Caller Exception (on a friend's profile in Contacts) ----------
  function profileRow(after, u) {
    if (!after || !u || !u.id) return;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sleep-exc";
    const draw = () => {
      const r = exceptions()[u.id];
      row.innerHTML = `${moon}<span><b>Huddle Sleep Mode Caller Exception</b><small>${r ? `On · ${REASONS[r]}. Their Huddle calls ring in Sleep Mode.` : "Off. Let their Huddle calls ring in Sleep Mode."}</small></span>`;
      row.classList.toggle("on", !!r);
    };
    draw();
    after.after(row);
    // Ask to be Huddle Buddies, right above the exception.
    const bud = document.createElement("div");
    bud.className = "sleep-bud-holder";
    const drawBud = () => { bud.innerHTML = buddyButtonHtml(u); wireBuddyButton(bud, u, () => { if (bud.isConnected) drawBud(); }); };
    drawBud();
    row.before(bud);
    loadBuddy().then(() => { if (bud.isConnected) drawBud(); });
    row.onclick = () => {
      const r = exceptions()[u.id];
      const wrap = document.createElement("div");
      wrap.className = "ch-sheet-wrap sleep-sheet-wrap";
      wrap.innerHTML = `<div class="ch-sheet" role="dialog" aria-label="Caller exception reason">
        <p class="ch-sheet-title">Why can ${esc(u.display)} call you in Sleep Mode?</p>
        <button type="button" data-r="work"${r === "work" ? ' aria-pressed="true"' : ""}>Work</button>
        <button type="button" data-r="parent"${r === "parent" ? ' aria-pressed="true"' : ""}>Parent</button>
        ${r ? '<button type="button" class="danger" data-r="">Remove the exception</button>' : ""}
        <button type="button" class="cancel">Cancel</button></div>`;
      document.body.appendChild(wrap);
      const close = () => wrap.remove();
      wrap.onclick = (e) => { if (e.target === wrap) close(); };
      wrap.querySelector(".cancel").onclick = close;
      for (const b of wrap.querySelectorAll("[data-r]")) b.onclick = async () => {
        close();
        const next = { ...exceptions() };
        if (b.dataset.r) next[u.id] = b.dataset.r; else delete next[u.id];
        try {
          await P().set("exceptions", next);
          draw();
          toast(b.dataset.r ? `${u.display} can call you in Sleep Mode (${REASONS[b.dataset.r]})` : `${u.display} is no longer a Sleep Mode exception`, 3500);
        } catch (e) { toast(e.message); }
      };
    };
  }

  // ---------- Settings: Huddle Buddy row ----------
  new MutationObserver(() => {
    const body = document.querySelector(".set-wrap .set-body");
    if (!body || body.querySelector(".set-sleep")) return;
    const sec = document.createElement("div");
    sec.className = "set-sleep";
    sec.innerHTML = `<h2 class="set-h">Sleep Mode</h2>
      <section class="set-card"><div class="set-row">
        <span class="set-txt"><b>Huddle Buddy</b><small class="set-buddy-name">${esc(buddyName() || "None yet. Tap a friend on Home to ask one.")}</small></span>
        <button type="button" class="btn" hidden>End</button>
      </div></section>`;
    body.appendChild(sec);
    const endBtn = sec.querySelector(".btn");
    const fill = () => {
      const n = sec.querySelector(".set-buddy-name");
      if (n) n.textContent = buddyName() || "None yet. Tap a friend on Home to ask one.";
      endBtn.hidden = !bstate.buddy;
    };
    endBtn.onclick = async () => {
      const b = bstate.buddy;
      if (!b || !confirmSoft(`Stop being Huddle Buddies with ${b.display}?`)) return;
      try { await buddyAct("end"); toast(`You're not Huddle Buddies with ${b.display} anymore`); } catch (e) { toast(e.message); }
      fill();
    };
    Promise.all([loadFriends(), loadBuddy()]).then(fill);
  }).observe(document.body, { childList: true });
  function buddyName() { const c = buddyChat(); return c ? c.friend.display : bstate.buddy ? bstate.buddy.display : ""; }

  // ---------- Keep it fresh ----------
  window.addEventListener("huddle:prefs", paint);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (P() && P().load) P().load();
    loadBuddy();
    if (isOn()) loadFriends().then(renderPanel);
  });
  setInterval(() => { if (isOn() && !document.hidden && !panel.hidden) loadFriends().then(renderPanel); }, 30000);
  const start = () => { loadFriends().then(paint); loadBuddy(); };
  window.addEventListener("huddle:signedin", start);
  if (token()) start();
  paint();

  window.HuddleSleep = {
    get on() { return isOn(); },
    // Huddle calls from this person ring? (In Sleep Mode only your Buddy's and Caller Exceptions'.)
    allowsCall: (fromId) => !isOn() || (!!fromId && (fromId === buddyId() || !!exceptions()[fromId])),
    lets: () => false,
    locked, profileRow, friendSheet,
  };
})();
