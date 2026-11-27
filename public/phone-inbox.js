// The Phone screen: calls, voicemails and saved contacts with real phone numbers (Huddle's Twilio number).
// Opened from the lobby. New missed calls and voicemails show up live while the app is open,
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
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = (n) => (P() ? P().pretty(n) : n);
  // A saved contact's name, else the number.
  const label = (n) => (P() && P().label ? P().label(n) : pretty(n));
  const saved = (n) => contacts.find((c) => c.number === n);
  const initials = (s) => (String(s).match(/[A-Za-z0-9]/g) || ["#"]).slice(0, 1).join("").toUpperCase() + ((String(s).split(/\s+/)[1] || "").match(/[A-Za-z0-9]/) || [""])[0].toUpperCase();
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
  // One line about the latest thing in a conversation, for the list.
  function summary(it) {
    if (it.kind === "voicemail") return `Voicemail · ${dur(it.duration)}`;
    if (it.kind === "missed") return "Missed call";
    if (it.kind === "call_in") return `Incoming call · ${dur(it.duration)}`;
    if (it.kind === "call_out") return it.duration ? `Outgoing call · ${dur(it.duration)}` : "Outgoing call · no answer";
    return "";
  }

  let view = null; // "list" | "thread" | "contact"
  let current = null; // number open in the thread view
  let tab = "calls"; // list tab: "calls" | "contacts"
  let contacts = []; // [{ number, name }], sorted by name
  let editBack = null; // where the contact form goes back to
  async function loadContacts() {
    try {
      const j = await api("GET", "contacts");
      contacts = j.contacts || [];
      if (P() && P().setContacts) P().setContacts(contacts);
    } catch {}
    return contacts;
  }
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
    if (view === "contact" || view === "thread") { goBack(); history.pushState({ huddlePhone: 1 }, ""); }
    else hide();
  });
  const goBack = () => {
    if (view === "contact" && editBack) editBack();
    else if (view === "thread" || view === "contact") openList();
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
        <label class="ph-show" hidden><span>Calls show</span><select aria-label="Number people see when you call"></select></label>
        <form class="ch-add ph-new">
          <input type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone number" aria-label="Phone number" maxlength="22">
          <button class="btn primary" type="submit">Call</button>
        </form>
        <p class="ch-err ph-err"></p>
        <div class="ph-notify" hidden><span></span><button class="btn" type="button" data-act="notify"></button></div>
        <div class="ch-tabs ph-tabs" role="tablist">
          <button type="button" role="tab" data-tab="calls" class="${tab === "calls" ? "on" : ""}">Call log</button>
          <button type="button" role="tab" data-tab="contacts" class="${tab === "contacts" ? "on" : ""}">Contacts</button>
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
    renderCallerId();
    const $ = (s) => root.querySelector(s);
    $('[data-act="back"]').onclick = goBack;
    const input = $(".ph-new input"), errEl = $(".ph-err");
    const num = () => {
      const n = normalize(input.value);
      errEl.textContent = n ? "" : "Type a 10-digit phone number";
      return n;
    };
    $(".ph-new").onsubmit = (e) => { e.preventDefault(); const n = num(); if (n) callNumber(n); };
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
    if (j.number) { mine.hidden = false; mine.textContent = `Your Huddle number: ${pretty(j.number)} (call-backs and voicemail)`; }
    const list = root.querySelector(".ph-list");
    if (tab === "contacts") return renderContacts(list);
    return renderCalls(list);
  }

  // ---------- Contacts: names saved to numbers ----------
  async function renderContacts(list) {
    await loadContacts();
    if (view !== "list" || tab !== "contacts") return;
    list.innerHTML = `<li class="ph-add-row"><button type="button" data-act="add"><span class="ch-av ph-av">${IC.person}</span><span class="ch-row"><strong>Add contact</strong><small>Save a name to a phone number</small></span></button></li>` +
      (contacts.length ? contacts.map((c) => `
      <li class="ph-call-row"><button type="button" data-edit="${esc(c.number)}">
        <span class="ch-av">${esc(initials(c.name))}</span>
        <span class="ch-row"><strong>${esc(c.name)}</strong><small>${esc(pretty(c.number))}</small></span>
      </button><button type="button" class="ch-icon ph-callback" data-call="${esc(c.number)}" aria-label="Call ${esc(c.name)}">${IC.phone}</button></li>`).join("")
      : `<li class="ch-empty">No contacts yet. Tap Add contact, or open a number from your call log and tap Save.</li>`);
    list.querySelector('[data-act="add"]').onclick = () => openContact(null, openList);
    list.querySelectorAll("button[data-edit]").forEach((b) => { b.onclick = () => openThread(b.dataset.edit); });
    list.querySelectorAll("button[data-call]").forEach((b) => { b.onclick = () => callNumber(b.dataset.call); });
  }
  // Add or edit one contact. back: where Back / Save goes.
  function openContact(number, back) {
    view = "contact";
    editBack = back;
    const c = number ? saved(number) : null;
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>${c ? "Edit contact" : "New contact"}</strong>
        <span class="ch-sp"></span>
      </header>
      <div class="ch-body">
        <form class="ph-contact">
          <label>Name<input name="name" maxlength="40" autocomplete="off" placeholder="Name" value="${esc(c ? c.name : "")}" required></label>
          <label>Phone number<input name="number" type="tel" inputmode="tel" maxlength="22" placeholder="(555) 123-4567" value="${esc(number ? pretty(number) : "")}" required></label>
          <p class="ch-err"></p>
          <button class="btn primary" type="submit">Save</button>
          ${c ? '<button class="btn danger" type="button" data-act="delete">Delete contact</button>' : ""}
        </form>
      </div>`;
    const form = root.querySelector(".ph-contact"), err = root.querySelector(".ch-err");
    root.querySelector('[data-act="back"]').onclick = goBack;
    setTimeout(() => form.name.focus(), 50);
    const save = async (name) => {
      const n = normalize(form.number.value);
      if (!n) { err.textContent = "Type a 10-digit phone number"; return; }
      if (name !== "" && !name.trim()) { err.textContent = "Type a name"; return; }
      try {
        const j = await api("POST", "contacts", { number: n, oldNumber: number, name });
        contacts = j.contacts || [];
        if (P() && P().setContacts) P().setContacts(contacts);
        toast(name ? `Saved ${name.trim()}` : "Contact deleted");
        if (back === openList) { tab = "contacts"; openList(); } else openThread(n);
      } catch (x) { err.textContent = x.message; }
    };
    form.onsubmit = (e) => { e.preventDefault(); save(form.name.value); };
    const del = root.querySelector('[data-act="delete"]');
    if (del) del.onclick = () => { form.number.value = pretty(number); save(""); };
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
    try { [j] = await Promise.all([api("GET", "calls"), loadContacts()]); } catch (e) { list.innerHTML = `<li class="ch-empty">${esc(e.message)}</li>`; return; }
    if (view !== "list") return;
    if (!j.calls.length) { list.innerHTML = `<li class="ch-empty">No calls yet. Type a number above to call it. Missed calls and voicemails to your Huddle number show up here.</li>`; return; }
    list.innerHTML = j.calls.map((c) => `
      <li class="ph-call-row"><button type="button" data-n="${esc(c.number)}">
        <span class="ph-dir ${c.kind}">${ARROW[c.kind] || ""}</span>
        <span class="ch-row"><strong class="${c.kind === "missed" ? "ph-missed" : ""}">${esc(label(c.number))}</strong><small>${esc(callLabel(c))}</small></span>
        <span class="ch-meta"><span>${esc(fullTime(c.at))}</span>${c.unread ? '<span class="ch-dot">new</span>' : ""}</span>
      </button><button type="button" class="ch-icon ph-callback" data-call="${esc(c.number)}" aria-label="Call ${esc(label(c.number))} back">${IC.phone}</button></li>`).join("");
    list.querySelectorAll("button[data-n]").forEach((b) => { b.onclick = () => openThread(b.dataset.n); });
    list.querySelectorAll("button[data-call]").forEach((b) => { b.onclick = () => callNumber(b.dataset.call); });
  }

  // ---------- Which number people see when you call ----------
  async function renderCallerId() {
    const box = root.querySelector(".ph-show");
    if (!box) return;
    let j;
    try { j = await api("GET", "callerid"); } catch { return; }
    if (!root.contains(box) || !j.canChoose) return;
    const sel = box.querySelector("select");
    sel.innerHTML = j.options.map((o) => `<option value="${esc(o.number)}"${o.number === j.selected ? " selected" : ""}>${esc(o.label)}: ${esc(pretty(o.number))}</option>`).join("");
    box.hidden = false;
    sel.onchange = async () => {
      try { await api("POST", "callerid", { number: sel.value }); toast("Saved. Your calls show " + pretty(sel.value)); }
      catch (e) { toast(e.message, 5000); renderCallerId(); }
    };
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
    label.textContent = on ? "Notifications are on for calls and chats." : "Get notified about calls and chats, even when Huddle is closed.";
    b.textContent = on ? "Turn off" : "Turn on";
    b.onclick = async () => {
      b.disabled = true;
      try { await (on ? window.huddleNotify.disable() : window.huddleNotify.enable()); toast(on ? "Notifications off" : "Notifications on"); }
      catch (e) { toast(e.message, 7000); }
      b.disabled = false;
      renderNotify();
    };
  }

  // ---------- One number's history: calls and voicemails ----------
  function openThread(number) {
    view = "thread";
    current = number;
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <span class="ch-who"><span class="ch-av sm ph-av">${IC.phone}</span><span class="ph-who"><strong>${esc(label(number))}</strong>${saved(number) ? `<small>${esc(pretty(number))}</small>` : ""}</span></span>
        <button class="ch-icon ph-save" data-act="save" aria-label="${saved(number) ? "Edit contact" : "Save contact"}" title="${saved(number) ? "Edit contact" : "Save contact"}">${IC.person}</button>
        <button class="ch-icon" data-act="call" aria-label="Call ${esc(label(number))}" title="Call">${IC.phone}</button>
      </header>
      <div class="ch-msgs"><div class="ch-stream"><div class="ch-empty">Loading…</div></div></div>`;
    const $ = (s) => root.querySelector(s);
    $('[data-act="back"]').onclick = goBack;
    $('[data-act="call"]').onclick = () => callNumber(number);
    $('[data-act="save"]').onclick = () => openContact(number, () => openThread(number));
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
      stream.innerHTML = `<div class="ch-empty">No calls with this number yet. Tap the phone button to call.</div>`;
    } else {
      let lastDay = "";
      stream.innerHTML = j.items.map((it) => {
        const day = new Date(it.at).toDateString();
        const head = day !== lastDay ? `<div class="ch-day">${esc(day === new Date().toDateString() ? "Today" : when(it.at))}</div>` : "";
        lastDay = day;
        const time = new Date(it.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
    loadContacts();
  }
  window.addEventListener("huddle:phone-live", (e) => {
    const m = e.detail || {};
    if (view === "list") loadList();
    else if (view === "thread" && m.number === current) loadThread();
    else refreshBadge();
    if (root.hidden && m.kind === "voicemail") toast(`New voicemail from ${label(m.number)}`);
  });
  window.addEventListener("huddle:phone-ended", () => { if (view === "thread") setTimeout(loadThread, 1500); else if (view === "list") setTimeout(loadList, 1500); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (view === "thread") loadThread(); else if (view === "list") loadList(); else refreshBadge(); } });
  window.addEventListener("huddle:signed-in", refreshBadge);
  // From a notification: open that number's call history.
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
