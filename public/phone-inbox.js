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

  let view = null; // "list" | "thread" | "contact" | "cell" | "billing" | "e911"
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
    if (view === "contact" || view === "thread" || view === "cell" || view === "billing" || view === "e911") { goBack(); history.pushState({ huddlePhone: 1 }, ""); }
    else hide();
  });
  const goBack = () => {
    if (view === "contact" && editBack) editBack();
    else if (view === "thread" || view === "contact" || view === "cell" || view === "billing" || view === "e911") openList();
    else { hide(); if (history.state && history.state.huddlePhone) history.back(); }
  };
  // For the tab bar (public/tabs.js).
  window.HuddlePhoneScreen = { hide: () => hide() };
  openBtn.onclick = () => {
    if (!token()) { toast("Sign in to use the phone"); return; }
    show();
    openList();
  };

  // ---------- The list ----------
  const $0 = (s) => root.querySelector(s);
  async function openList() {
    view = "list";
    current = null;
    root.innerHTML = `
      <header class="ch-head top">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>Phone</strong>
        <span class="ch-sp"></span>
      </header>
      <div class="ch-body">
        <p class="ph-mine" hidden></p>
        <button type="button" class="ph-cell-row ph-bal-row" data-act="billing" hidden><span></span><b>Add money</b></button>
        <button type="button" class="ph-cell-row" data-act="cell" hidden><span></span><b></b></button>
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
        <button type="button" class="ph-cell-row ph-sos-row ph-sos-bottom" data-act="e911"><span>Emergency: call 911</span><b>Open</b></button>
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
    renderCellRow();
    $0('[data-act="cell"]').onclick = openCell;
    $0('[data-act="billing"]').onclick = openBilling;
    $0('[data-act="e911"]').onclick = openE911;
    const $ = (s) => root.querySelector(s);
    $('[data-act="back"]').onclick = goBack;
    const input = $(".ph-new input"), errEl = $(".ph-err");
    const num = () => {
      const n = normalize(input.value);
      errEl.textContent = n ? "" : "Type a 10-digit phone number";
      return n;
    };
    $(".ph-new").onsubmit = (e) => {
      e.preventDefault();
      const short = input.value.replace(/\D/g, "");
      if (short === "911" || short === "933") { callNumber(short); return; }
      const n = num(); if (n) callNumber(n);
    };
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
    try { [j] = await Promise.all([api("GET", "calls"), loadContacts(), loadBilling().then(renderBalRow)]); } catch (e) { list.innerHTML = `<li class="ch-empty">${esc(e.message)}</li>`; return; }
    if (view !== "list") return;
    if (!j.calls.length) { list.innerHTML = `<li class="ch-empty">No calls yet. Type a number above to call it. Missed calls and voicemails to your Huddle number show up here.</li>`; return; }
    list.innerHTML = j.calls.map((c) => `
      <li class="ph-call-row"><button type="button" data-n="${esc(c.number)}">
        <span class="ph-dir ${c.kind}">${ARROW[c.kind] || ""}</span>
        <span class="ch-row"><strong class="${c.kind === "missed" ? "ph-missed" : ""}">${esc(label(c.number))}</strong><small>${esc(callLabel(c))}${costOf(c.sid) && costOf(c.sid).status === "done" ? " \u00b7 " + esc(money(costOf(c.sid).amount)) : ""}</small></span>
        <span class="ch-meta"><span>${esc(fullTime(c.at))}</span>${c.unread ? '<span class="ch-dot">new</span>' : ""}</span>
      </button><button type="button" class="ch-icon ph-callback" data-call="${esc(c.number)}" aria-label="Call ${esc(label(c.number))} back">${IC.phone}</button></li>`).join("");
    list.querySelectorAll("button[data-n]").forEach((b) => { b.onclick = () => openThread(b.dataset.n); });
    list.querySelectorAll("button[data-call]").forEach((b) => { b.onclick = () => callNumber(b.dataset.call); });
  }

  // ---------- 911 ----------
  async function openE911() {
    view = "e911";
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>Emergency 911</strong>
        <span class="ch-sp"></span>
      </header>
      <div class="ch-body ph-cell ph-sos">
        <button class="btn ph-sos-btn" type="button" data-act="call911">Call 911</button>
        <p class="ph-small ph-center">In an emergency, use your phone's own dialer if you can. Huddle's 911 needs internet, and the dispatcher sees the address saved below, <b>not your GPS location</b>. Always say where you are.</p>
        <div class="ph-e911"><p class="ch-empty">Loading…</p></div>
      </div>`;
    $0('[data-act="back"]').onclick = goBack;
    const b = $0('[data-act="call911"]');
    let armed = null;
    b.onclick = () => {
      if (!armed) {
        b.textContent = "Tap again to call 911";
        b.classList.add("armed");
        armed = setTimeout(() => { armed = null; b.textContent = "Call 911"; b.classList.remove("armed"); }, 4000);
        return;
      }
      clearTimeout(armed); armed = null;
      b.textContent = "Calling 911…";
      callNumber("911");
    };
    let j;
    try { j = await api("GET", "e911"); } catch (e) { $0(".ph-e911").innerHTML = `<p class="ch-err">${esc(e.message)}</p>`; return; }
    renderE911(j);
  }
  const E911_STATUS = {
    registered: "✓ Registered: 911 dispatchers see this address",
    "pending-registration": "Being registered (this can take a few minutes)",
    "registration-failure": "Registration failed. Check the address and save it again.",
    unregistered: "Not registered yet",
  };
  function renderE911(j) {
    if (view !== "e911") return;
    const box = $0(".ph-e911");
    if (!j.number) {
      box.innerHTML = `<p class="ph-warn">Your 911 address isn't set. 911 calls from Huddle still go through, but the dispatcher won't know where you are and may see a different address. Say your address right away, or use your phone's own dialer.</p>
        <p class="ph-small">To save your address, get your own Huddle number first (Phone &gt; Make Huddle ring when you miss a call).</p>`;
      return;
    }
    const a = j.address || {};
    const st = j.status ? E911_STATUS[j.status] || j.status : null;
    box.innerHTML = `
      <h3 class="ph-log-head">Your 911 address</h3>
      <p class="ph-small">Registered on your Huddle number ${esc(pretty(j.number))}. Update it whenever you move.</p>
      ${st ? `<p class="${j.status === "registered" ? "ph-ok" : "ph-warn"}">${esc(st)}</p>` : '<p class="ph-warn">No address saved yet. 911 calls still go through, but say where you are.</p>'}
      <form class="ph-contact">
        <label>Name<input name="name" maxlength="60" autocomplete="name" value="${esc(a.name || "")}" required></label>
        <label>Street address<input name="street" maxlength="100" autocomplete="address-line1" value="${esc(a.street || "")}" required></label>
        <label>Apt, suite, floor (optional)<input name="street2" maxlength="60" autocomplete="address-line2" value="${esc(a.street2 || "")}"></label>
        <label>City<input name="city" maxlength="60" autocomplete="address-level2" value="${esc(a.city || "")}" required></label>
        <div class="ph-row2">
          <label>State<input name="region" maxlength="2" autocomplete="address-level1" placeholder="PA" value="${esc(a.region || "")}" required></label>
          <label>ZIP<input name="postal" maxlength="10" inputmode="numeric" autocomplete="postal-code" value="${esc(a.postal || "")}" required></label>
        </div>
        <p class="ch-err"></p>
        <button class="btn primary" type="submit">Save 911 address</button>
      </form>
      ${st ? `<button class="btn" type="button" data-act="test933">Test it: call 933 (free, reads back your address)</button>` : ""}`;
    const form = box.querySelector("form"), err = form.querySelector(".ch-err");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(["name", "street", "street2", "city", "region", "postal"].map((k) => [k, form[k].value]));
      form.querySelector('[type="submit"]').disabled = true;
      try { renderE911(await api("POST", "e911", body)); toast("911 address saved"); }
      catch (x) { err.textContent = x.message; form.querySelector('[type="submit"]').disabled = false; }
    };
    const t = box.querySelector('[data-act="test933"]');
    if (t) t.onclick = () => callNumber("933");
  }

  // ---------- Phone balance (pay-as-you-go calls; the phone's owner doesn't pay) ----------
  let bill = null; // last /billing answer: { active, balance, items, amounts, test }
  function money(d) {
    const a = Math.abs(d);
    if (a >= 1) return "$" + a.toFixed(2);
    const c = a * 100;
    return (c < 10 ? c.toFixed(1) : c.toFixed(0)) + "\u00a2";
  }
  function costOf(sid) {
    if (!bill || !bill.active || !sid) return null;
    return bill.items.find((i) => i.kind === "call" && i.ref === sid) || null;
  }
  async function loadBilling() {
    try { bill = await api("GET", "billing"); } catch { bill = null; }
    return bill;
  }
  function renderBalRow() {
    const row = $0(".ph-bal-row");
    if (!row || !bill || !bill.active) return;
    row.hidden = false;
    row.classList.toggle("low", bill.balance <= 0.05);
    row.querySelector("span").textContent = "Phone balance: $" + Math.max(0, bill.balance).toFixed(2);
  }
  function billRow(i) {
    const t = fullTime(i.at);
    if (i.kind === "topup") {
      const feeNote = i.paid ? ` \u00b7 paid $${Number(i.paid).toFixed(2)}${i.fee ? " (card fee " + money(i.fee) + ")" : ""}` : "";
      return `<li><span class="ch-row"><strong>Added money</strong><small>${esc(t + feeNote)}${i.status === "pending" ? " \u00b7 waiting for payment" : ""}</small></span><span class="ph-amt plus">+$${i.amount.toFixed(2)}</span></li>`;
    }
    if (i.kind === "number") return `<li><span class="ch-row"><strong>Your Huddle number, 1 month</strong><small>${esc(t + " \u00b7 " + pretty(i.number))}</small></span><span class="ph-amt">-${esc(money(i.amount))}</span></li>`;
    const what = (i.dir === "in" ? "Call from " : "Call to ") + label(i.number);
    const len = i.seconds != null ? " \u00b7 " + dur(i.seconds) : "";
    const amt = i.status === "pending" ? "\u2026" : "-" + money(i.amount);
    return `<li><span class="ch-row"><strong>${esc(what)}</strong><small>${esc(t + len)}${i.status === "pending" ? " \u00b7 working out the cost" : ""}</small></span><span class="ph-amt">${esc(amt)}</span></li>`;
  }
  async function openBilling() {
    view = "billing";
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>Phone balance</strong>
        <span class="ch-sp"></span>
      </header>
      <div class="ch-body ph-cell ph-bill"><p class="ch-empty">Loading\u2026</p></div>`;
    $0('[data-act="back"]').onclick = goBack;
    await loadBilling();
    if (view !== "billing") return;
    const box = $0(".ph-bill");
    if (!bill || !bill.active) { box.innerHTML = "<p>Phone calls are free for you.</p>"; return; }
    const amounts = bill.amounts.map((a) => `<button class="btn primary" type="button" data-amt="${a.credit}">Add $${a.credit}<small>pay $${a.pay.toFixed(2)}${a.fee ? " (" + money(a.fee) + " card fee)" : ""}</small></button>`).join("");
    box.innerHTML = `
      <p class="ph-balance">$${Math.max(0, bill.balance).toFixed(2)}</p>
      <p class="ph-small ph-center">Each phone call costs exactly what it costs to run (about 2\u00a2 a minute). Calls stop when this reaches $0, and calls to you go to voicemail.</p>
      ${bill.test ? '<p class="ph-small ph-test">Test mode: use card 4242 4242 4242 4242, any future date, any CVC. No real money moves.</p>' : ""}
      <div class="ph-amounts">${amounts}</div>
      <h3 class="ph-log-head">History</h3>
      <ul class="ch-list ph-bill-list">${bill.items.map(billRow).join("") || '<li class="ch-empty">Nothing yet.</li>'}</ul>`;
    box.querySelectorAll("[data-amt]").forEach((b) => {
      b.onclick = async () => {
        box.querySelectorAll("[data-amt]").forEach((x) => (x.disabled = true));
        try { const j = await api("POST", "billing", { amount: Number(b.dataset.amt) }); location.href = j.url; }
        catch (e) { toast(e.message, 5000); box.querySelectorAll("[data-amt]").forEach((x) => (x.disabled = false)); }
      };
    });
  }

  // ---------- Your cell: link it so calls to it ring here ----------
  async function renderCellRow() {
    const row = $0('[data-act="cell"]');
    if (!row) return;
    let j;
    try { j = await api("GET", "cell"); } catch { return; }
    if (!root.contains(row)) return;
    row.hidden = false;
    row.querySelector("span").textContent = j.ownNumber ? `Your Huddle number: ${pretty(j.huddleNumber)}` : "Make Huddle ring when you miss a call on your cell";
    row.querySelector("b").textContent = j.ownNumber || j.cell ? "Setup" : "Set up";
  }
  let cellPoll = null;
  async function openCell() {
    view = "cell";
    clearTimeout(cellPoll);
    root.innerHTML = `
      <header class="ch-head">
        <button class="ch-icon" data-act="back" aria-label="Back">${IC.back}</button>
        <strong>Calls to your cell</strong>
        <span class="ch-sp"></span>
      </header>
      <div class="ch-body ph-cell"><p class="ch-empty">Loading…</p></div>`;
    $0('[data-act="back"]').onclick = goBack;
    let j;
    try { j = await api("GET", "cell"); } catch (e) { $0(".ph-cell").innerHTML = `<p class="ch-empty">${esc(e.message)}</p>`; return; }
    renderCell(j);
  }
  // The "Your cell" screen. 1) People who pay get their own Huddle number first (the owner uses
  // the main one). 2) Forwarding codes to dial on their cell, filled in with that number.
  // 3) Optional: prove the cell is theirs, so it can show as their caller ID.
  async function renderCell(j) {
    if (view !== "cell") return;
    clearTimeout(cellPoll);
    const box = $0(".ph-cell");
    let html = "";
    if (j.needsNumber) {
      await loadBilling();
      if (view !== "cell") return;
      const monthly = bill && bill.monthly ? bill.monthly : 1.15;
      const bal = bill && bill.active ? bill.balance : 0;
      const up = bill && bill.upgrade;
      const enough = bal >= monthly;
      html += `
        <p class="ph-step">Step 1: get your own Huddle number</p>
        <p>Calls you don't answer on your cell will go to this number and ring you in Huddle. It costs $${monthly.toFixed(2)} a month, taken from your phone balance (you have $${Math.max(0, bal).toFixed(2)}). Calls cost exactly what they cost to run, about 2\u00a2 a minute.</p>
        ${enough ? '<button class="btn primary" type="button" data-act="buy">Get my Huddle number</button>'
          : up ? `<button class="btn primary" type="button" data-act="upgrade">Get my number: pay $${up.pay.toFixed(2)}</button>
            <p class="ph-small ph-center">$${up.month.toFixed(2)} first month + $${up.credit.toFixed(2)} call credit + ${money(up.fee)} card fee</p>` : ""}`;
    } else if (j.huddleNumber) {
      const hn = j.huddleNumber.replace(/^\+/, ""), hn10 = hn.replace(/^1(?=\d{10}$)/, ""); // Verizon wants 10 digits
      // AT&T/T-Mobile (GSM) let you pick how long your cell rings first: 5 to 30 seconds.
      let secs = 20;
      try { secs = Number(localStorage.getItem("huddle:ringSecs")) || 20; } catch {}
      if (![5, 10, 15, 20, 25, 30].includes(secs)) secs = 20;
      html += `
        <p class="ph-ok">Your Huddle number: <b>${esc(pretty(j.huddleNumber))}</b></p>
        <p>Set your cell to forward calls you don't answer to it. Your cell still rings first; if you don't pick up, Huddle rings. Open your phone's dialer, type the code for your carrier, and press call:</p>
        <label class="ph-ring">Ring my cell for
          <select data-act="ringsecs" aria-label="Seconds your cell rings before Huddle">
            ${[5, 10, 15, 20, 25, 30].map((n) => `<option value="${n}"${n === secs ? " selected" : ""}>${n} seconds</option>`).join("")}
          </select>
          then send the call to Huddle</label>
        <ul class="ph-steps">
          <li><b>AT&amp;T or T-Mobile</b><code class="ph-gsm">**61*${esc(hn)}**${secs}#</code></li>
          <li><b>Verizon</b><code>*71${esc(hn10)}</code></li>
        </ul>
        <p class="ph-small">The number at the end of the AT&amp;T/T-Mobile code (<b class="ph-secs">${secs}</b>) is how many seconds your cell rings before the call goes to Huddle. Verizon's code has no timer: your cell rings about 4 or 5 times (around 25 seconds) first. To change the time later, just dial the new code.</p>
        <p class="ph-small">To stop forwarding: <code>##61#</code> on AT&amp;T or T-Mobile, <code>*73</code> on Verizon. Other carriers: search "call forwarding" plus your carrier's name.</p>`;
    }
    // Optional: your cell as caller ID.
    let cellHtml = "";
    if (j.cell && j.callerReady !== false) {
      cellHtml = `<p class="ph-ok">&#10003; Your cell <b>${esc(pretty(j.cell))}</b> is linked. It can show as your caller ID (pick it under "Calls show").</p>
        <button class="btn" type="button" data-act="unlink">Unlink this cell</button>`;
    } else if (j.cell && !(j.pending && !j.pending.failed)) {
      cellHtml = `<p class="ph-ok">&#10003; Your cell <b>${esc(pretty(j.cell))}</b> is linked.</p>
        <p class="ph-small">To also show it as your caller ID, the phone company needs one quick call: we call your cell and you type the code shown here.</p>
        <button class="btn" type="button" data-act="callcell">Call me with a code</button>
        <button class="btn" type="button" data-act="unlink">Unlink this cell</button>`;
    } else if (j.pending && !j.pending.failed && j.pending.via === "text") {
      cellHtml = `<p>We texted a 6-digit code to <b>${esc(pretty(j.pending.number))}</b>. Type it here:</p>
        <form class="ph-contact ph-codeform">
          <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" required aria-label="Code from the text">
          <p class="ch-err"></p>
          <button class="btn primary" type="submit">Link my cell</button>
        </form>
        <button class="btn" type="button" data-act="restart">Use a different number</button>`;
    } else if (j.pending && !j.pending.failed) {
      cellHtml = `<p>We're calling <b>${esc(pretty(j.pending.number))}</b> now. Answer it and type this code on the keypad:</p>
        <p class="ph-code">${esc(j.pending.code)}</p>
        <p class="ph-small">This page updates by itself when it works.</p>
        <button class="btn" type="button" data-act="restart">Use a different number</button>`;
      cellPoll = setTimeout(async () => { try { renderCell(await api("GET", "cell")); } catch {} }, 3000);
    } else {
      const known = (j.verifiedCells || []).map((n) => `<button class="btn primary" type="button" data-act="linkv" data-n="${esc(n)}">Link ${esc(pretty(n))}</button>`).join("");
      cellHtml = (known ? `<p class="ph-small">Already verified in your Twilio account, so no code needed:</p>${known}<p class="ph-small">Or link a different cell:</p>` : "") +
        `<p class="ph-small">Want people you call from Huddle to see your cell number? Prove the cell is yours with a code: we either call your cell (you type the code shown here on the keypad) or text you a code (you type it here).</p>
        ${j.pending && j.pending.failed ? '<p class="ch-err">That didn\'t work. Check the number and try again.</p>' : ""}
        <form class="ph-contact">
          <label>Your cell number<input name="number" type="tel" inputmode="tel" maxlength="22" placeholder="(555) 123-4567" value="${esc(j.pending ? pretty(j.pending.number) : "")}" required></label>
          <p class="ch-err"></p>
          <button class="btn" type="submit" data-via="call">Call me with a code</button>
          <button class="btn" type="submit" data-via="text">Text me a code</button>
        </form>`;
    }
    html += `<h3 class="ph-log-head">Your cell as caller ID</h3>` + cellHtml;
    if (j.ownNumber) html += `<button class="btn danger ph-giveup" type="button" data-act="giveup">Give up my Huddle number</button>`;
    box.innerHTML = html;
    const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
    const ringSel = box.querySelector('[data-act="ringsecs"]');
    if (ringSel) ringSel.onchange = () => {
      const n = ringSel.value;
      try { localStorage.setItem("huddle:ringSecs", n); } catch {}
      const code = box.querySelector(".ph-gsm");
      code.textContent = code.textContent.replace(/\*\*\d+#$/, `**${n}#`);
      box.querySelector(".ph-secs").textContent = n;
    };
    on('[data-act="money"]', openBilling);
    on('[data-act="upgrade"]', async (e) => {
      e.target.disabled = true;
      try { const r = await api("POST", "billing", { action: "upgrade" }); location.href = r.url; }
      catch (x) { toast(x.message, 5000); e.target.disabled = false; }
    });
    on('[data-act="buy"]', async (e) => {
      e.target.disabled = true;
      try { const r = await api("POST", "billing", { action: "buy-number" }); toast("Your Huddle number is " + pretty(r.number)); openCell(); }
      catch (x) { toast(x.message, 6000); e.target.disabled = false; }
    });
    on('[data-act="giveup"]', async (e) => {
      if (e.target.dataset.sure !== "1") { e.target.dataset.sure = "1"; e.target.textContent = "Tap again to give it up for good"; return; }
      try { await api("POST", "billing", { action: "release-number" }); toast("Number given up. Turn off forwarding on your cell."); openCell(); }
      catch (x) { toast(x.message, 5000); }
    });
    on('[data-act="unlink"]', async () => {
      try { renderCell(await api("POST", "cell", { action: "unlink" })); toast("Cell unlinked"); } catch (x) { toast(x.message, 5000); }
    });
    on('[data-act="restart"]', () => renderCell({ ...j, pending: null }));
    on('[data-act="callcell"]', async (e) => {
      e.target.disabled = true;
      try { renderCell(await api("POST", "cell", { number: j.cell })); }
      catch (x) { toast(x.message, 5000); e.target.disabled = false; }
    });
    box.querySelectorAll('[data-act="linkv"]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { renderCell(await api("POST", "cell", { action: "link-verified", number: b.dataset.n })); toast("Cell linked"); }
      catch (x) { toast(x.message, 5000); b.disabled = false; }
    });
    const codeForm = box.querySelector("form.ph-codeform");
    if (codeForm) {
      const err = codeForm.querySelector(".ch-err");
      codeForm.code.focus();
      codeForm.onsubmit = async (e) => {
        e.preventDefault();
        codeForm.querySelector("button").disabled = true;
        try { renderCell(await api("POST", "cell", { action: "code", code: codeForm.code.value })); toast("Cell linked"); }
        catch (x) { err.textContent = x.message; codeForm.querySelector("button").disabled = false; }
      };
    }
    const form = box.querySelector("form.ph-contact:not(.ph-codeform)");
    if (form) {
      const err = form.querySelector(".ch-err");
      form.onsubmit = async (e) => {
        e.preventDefault();
        const n = normalize(form.number.value);
        if (!n) { err.textContent = "Type a 10-digit phone number"; return; }
        const via = (e.submitter && e.submitter.dataset.via) || "call";
        const btns = form.querySelectorAll("button");
        btns.forEach((b) => b.disabled = true);
        try { renderCell(await api("POST", "cell", via === "text" ? { action: "text", number: n } : { number: n })); }
        catch (x) { err.textContent = x.message; btns.forEach((b) => b.disabled = false); }
      };
    }
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
    if (m.kind === "cell") { if (view === "cell") openCell(); else if (view === "list") renderCellRow(); toast("Your cell is linked to Huddle"); return; }
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
    if (e.detail === "billing" && token()) { if (root.hidden) show(); openBilling(); return; }
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
