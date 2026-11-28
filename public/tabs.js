// The tab bar along the bottom: Home, Contacts, Phone, Huddle, Video, Photos, Alarms.
// Contacts is the Chats & friends screen (chats.js), Phone is the phone screen (phone-inbox.js),
// Huddle is the start-a-call screen (#lobby). The other pages are made here and filled by
// home.js, feeds.js and alarms.js. Every page has your account picture at the top left.
// The bar hides during calls, on the sign-up screen, and inside a chat or phone sub-screen.
(() => {
  "use strict";
  const H = () => window.huddle || {};
  const $ = (id) => document.getElementById(id);
  const lobby = $("lobby"), call = $("call"), chatsRoot = $("chats");
  const phoneRoot = () => document.querySelector(".phone-screen");
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  };

  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const TABS = [
    { id: "home", label: "Home", icon: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>') },
    { id: "contacts", label: "Contacts", badge: "chatsBadge", icon: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/>') },
    { id: "phone", label: "Phone", badge: "phoneBadge", icon: svg('<path d="M5 3h3.5l1.7 4.5-2.2 1.4a11 11 0 0 0 7.1 7.1l1.4-2.2L21 15.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>') },
    { id: "huddle", label: "Huddle", icon: svg('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>') },
    { id: "video", label: "Video", icon: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9l5 3-5 3z"/>') },
    { id: "photos", label: "Photos", icon: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>') },
    { id: "alarms", label: "Alarms", icon: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2"/><path d="M4 4.5L6.5 2.5M20 4.5L17.5 2.5"/>') },
  ];

  let current = null;
  let started = false;
  let switching = false;
  let beforeCall = null;
  const inCall = () => !!(call && !call.hidden);
  const gateOpen = () => document.body.classList.contains("account-gate");

  // ---------- The bar ----------
  const bar = document.createElement("nav");
  bar.className = "tabbar";
  bar.setAttribute("aria-label", "Main tabs");
  bar.hidden = true;
  bar.innerHTML = `<div class="tabbar-in">${TABS.map((t) => `
    <button type="button" class="tab" data-tab="${t.id}" aria-label="${t.label}">
      <span class="ti">${t.icon}</span><span class="tl">${t.label}</span>${t.badge ? '<span class="tb" hidden></span>' : ""}
    </button>`).join("")}</div>`;
  document.body.appendChild(bar);
  for (const b of bar.querySelectorAll(".tab")) b.onclick = () => select(b.dataset.tab);

  // Copy the unread counts from the old lobby buttons onto the tabs.
  for (const t of TABS) {
    const src = t.badge && $(t.badge);
    if (!src) continue;
    const dst = bar.querySelector(`[data-tab="${t.id}"] .tb`);
    const copy = () => { dst.hidden = src.hidden || !src.textContent.trim(); dst.textContent = src.textContent; };
    new MutationObserver(copy).observe(src, { attributes: true, childList: true, characterData: true, subtree: true });
    copy();
  }

  // ---------- Your account picture (top left of every page) ----------
  const me = () => (window.HuddleAccount && window.HuddleAccount.user) || {};
  function paintMe(b) {
    const u = me();
    if (H().paintAvatar) H().paintAvatar(b, u, u.display || "?");
    else b.textContent = (u.display || "?").slice(0, 1).toUpperCase();
  }
  function avatarButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab-me";
    b.setAttribute("aria-label", "Your account");
    b.title = "Your account";
    b.onclick = () => window.HuddleChats && window.HuddleChats.accountMenu();
    paintMe(b);
    return b;
  }
  const repaintMe = () => document.querySelectorAll(".tab-me").forEach(paintMe);
  // Saving your profile repaints it everywhere.
  if (window.huddle && window.huddle.profileChanged) {
    const orig = window.huddle.profileChanged;
    window.huddle.profileChanged = function () { orig.apply(this, arguments); repaintMe(); };
  }
  window.addEventListener("huddle:signedin", repaintMe);

  // The Huddle tab (start screen) gets the picture in its header.
  const brand = lobby && lobby.querySelector(".brand");
  if (brand) brand.prepend(avatarButton());

  // On the Contacts and Phone list screens, the back arrow becomes your account picture.
  function decorate(root) {
    if (!root) return;
    const head = root.querySelector(":scope > .ch-head.top");
    if (!head || head.querySelector(".tab-me")) return;
    const back = head.querySelector('[data-act="back"]');
    if (back) back.replaceWith(avatarButton());
  }

  // ---------- Pages made here ----------
  const pages = {}; // id -> { el, head, right, body, onShow }
  function page(id, title) {
    if (pages[id]) return pages[id];
    const el = document.createElement("main");
    el.className = "screen tab-page";
    el.id = "tab-" + id;
    el.hidden = true;
    el.innerHTML = `<header class="tp-head"><h1>${title}</h1><div class="tp-right"></div></header><div class="tp-body"></div>`;
    el.querySelector(".tp-head").prepend(avatarButton());
    (lobby ? lobby.parentNode : document.body).insertBefore(el, lobby || null);
    const p = { el, head: el.querySelector(".tp-head"), right: el.querySelector(".tp-right"), body: el.querySelector(".tp-body"), onShow: null };
    pages[id] = p;
    if (current === id && !inCall()) { el.hidden = false; if (p.onShow) p.onShow(); }
    return p;
  }
  // Until feeds.js fills them.
  for (const t of TABS) if (t.id === "video" || t.id === "photos") {
    const p = page(t.id, t.label);
    p.body.innerHTML = `<div class="tp-empty">${t.label} is coming soon.</div>`;
  }

  // ---------- Switching ----------

  function select(id) {
    if (!TABS.some((t) => t.id === id)) id = "home";
    // Sleep Mode (sleep.js) locks every tab but Huddle.
    const S = window.HuddleSleep;
    if (S && S.on && id !== "huddle" && !S.lets(id)) { if (started) S.locked(id); id = "huddle"; }
    current = id;
    started = true;
    if (inCall()) { sync(); return; }
    switching = true;
    try {
      if (id === "contacts") { if (chatsRoot && chatsRoot.hidden) $("chatsOpen").click(); }
      else if (chatsRoot && !chatsRoot.hidden && window.HuddleChats) window.HuddleChats.hide();
      const pr = phoneRoot();
      if (id === "phone") { if (pr && pr.hidden) $("phoneOpen").click(); }
      else if (pr && !pr.hidden && window.HuddlePhoneScreen) window.HuddlePhoneScreen.hide();
      if (lobby) lobby.hidden = id !== "huddle";
      for (const [pid, p] of Object.entries(pages)) p.el.hidden = pid !== id;
    } finally { switching = false; }
    const p = pages[id];
    if (p && p.onShow) p.onShow();
    decorate(chatsRoot); decorate(phoneRoot());
    repaintMe();
    sync();
  }

  function sync() {
    const top = (r) => !!(r && !r.hidden && r.querySelector(":scope > .ch-head.top"));
    const signed = !!(window.HuddleAccount && window.HuddleAccount.signedIn);
    let show = started && signed && !gateOpen() && !inCall();
    if (show && current === "contacts") show = top(chatsRoot);
    if (show && current === "phone") show = top(phoneRoot());
    // A chat or phone screen opened from somewhere else (a notification, Home) covers the page.
    if (show && current !== "contacts" && chatsRoot && !chatsRoot.hidden) show = false;
    if (show && current !== "phone" && phoneRoot() && !phoneRoot().hidden) show = false;
    bar.hidden = !show;
    document.body.classList.toggle("tabs-on", show);
    for (const b of bar.querySelectorAll(".tab")) {
      const on = b.dataset.tab === current;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
  }

  // Back out of Contacts or Phone (Android back, or a screen closing itself): go Home.
  function watch(root, tab) {
    if (!root) return;
    new MutationObserver(() => {
      decorate(root);
      if (!switching && started && root.hidden && current === tab && !inCall()) { select("home"); return; }
      sync();
    }).observe(root, { attributes: true, attributeFilter: ["hidden"], childList: true });
  }
  watch(chatsRoot, "contacts");
  watch(phoneRoot(), "phone");
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // Calls: the bar hides; after the call you land back where you were.
  window.addEventListener("huddle:joined", () => {
    if (current) beforeCall = current;
    for (const p of Object.values(pages)) p.el.hidden = true;
    sync();
  });
  window.addEventListener("huddle:left", (e) => {
    if (e.detail && e.detail.rejoining) return;
    setTimeout(() => select(beforeCall || "huddle"), 0);
  });
  if (call) new MutationObserver(sync).observe(call, { attributes: true, attributeFilter: ["hidden"] });

  // Signed in: start on Home. The first time, start on Huddle so Pip's tour can point at its buttons.
  function begin() {
    if (started) return;
    select(ls.get("huddle:tutorialDone") === "1" ? "home" : "huddle");
  }
  window.addEventListener("huddle:tutorialdone", () => { if (current === "huddle") sync(); });
  if (window.HuddleAccount && window.HuddleAccount.signedIn) setTimeout(begin, 0);
  else window.addEventListener("huddle:signedin", () => setTimeout(begin, 0));

  window.HuddleTabs = {
    page, select, avatarButton, sync,
    get current() { return current; },
  };
})();
