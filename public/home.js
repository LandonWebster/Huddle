// The Home tab: Pip says hello, a quick look at your day (voicemails, next alarm, unread chats),
// friends who are online, and the newest videos and photos (feeds.js adds those).
(() => {
  "use strict";
  const T = window.HuddleTabs;
  if (!T) return;
  const H = () => window.huddle || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };

  const p = T.page("home", "Home");
  p.body.innerHTML = `
    <section class="home-hello">
      <div class="home-pip"></div>
      <button type="button" class="btn primary home-start">Start a huddle</button>
    </section>
    <section class="home-tiles" aria-label="Today">
      <button type="button" class="home-tile" data-go="phone"><span class="ht-ic">${icon("phone")}</span><b data-v="phone">0</b><small>New voicemails &amp; missed calls</small></button>
      <button type="button" class="home-tile" data-go="alarms"><span class="ht-ic">${icon("alarm")}</span><b data-v="alarm">None</b><small>Next alarm</small></button>
      <button type="button" class="home-tile" data-go="contacts"><span class="ht-ic">${icon("chat")}</span><b data-v="chats">0</b><small>Unread chats</small></button>
    </section>
    <section class="home-sec">
      <div class="home-sec-head"><h2>Friends online</h2><button type="button" class="home-link" data-go="contacts">See all</button></div>
      <div class="home-friends"><span class="home-muted">Loading…</span></div>
    </section>
    <div class="home-feeds"></div>`;

  // Pip's greeting lives on Home now (pip.js fills #pipHello).
  const hello = $("pipHello");
  if (hello) p.body.querySelector(".home-pip").appendChild(hello);

  p.body.querySelector(".home-start").onclick = () => T.select("huddle");
  for (const b of p.body.querySelectorAll("[data-go]")) b.onclick = () => T.select(b.dataset.go);

  function icon(k) {
    const d = {
      phone: '<path d="M5 3h3.5l1.7 4.5-2.2 1.4a11 11 0 0 0 7.1 7.1l1.4-2.2L21 15.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
      alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2"/><path d="M4 4.5L6.5 2.5M20 4.5L17.5 2.5"/>',
      chat: '<path d="M4 5h16v11H9l-5 4z"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
    }[k];
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  const count = (id) => { const b = $(id); return b && !b.hidden ? b.textContent.trim() || "0" : "0"; };
  function renderTiles() {
    p.body.querySelector('[data-v="phone"]').textContent = count("phoneBadge");
    p.body.querySelector('[data-v="chats"]').textContent = count("chatsBadge");
    const next = window.HuddleAlarms && window.HuddleAlarms.next();
    p.body.querySelector('[data-v="alarm"]').textContent = next ? next.time : "None";
  }
  for (const id of ["phoneBadge", "chatsBadge"]) {
    const b = $(id);
    if (b) new MutationObserver(renderTiles).observe(b, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  window.addEventListener("huddle:alarms", renderTiles);

  async function loadFriends() {
    const box = p.body.querySelector(".home-friends");
    if (!token()) return;
    let chats;
    try {
      const r = await fetch("/api/chats", { headers: { authorization: "Bearer " + token() } });
      if (!r.ok) throw new Error();
      chats = (await r.json()).chats || [];
    } catch { box.innerHTML = '<span class="home-muted">Can\'t load friends right now.</span>'; return; }
    const on = chats.filter((c) => c.friend && c.friend.online && !c.friend.blockedMe).map((c) => c.friend);
    box.innerHTML = on.slice(0, 8).map((f) => `
      <button type="button" class="home-friend" data-id="${esc(f.id)}" aria-label="${esc(f.display)}${f.inCall ? ", in a call" : ", online"}">
        <span class="hf-av"></span><small>${esc(f.display.split(" ")[0])}</small>
      </button>`).join("") +
      `<button type="button" class="home-friend add" aria-label="Add a friend"><span class="hf-av">${icon("plus")}</span><small>Add</small></button>` +
      (on.length ? "" : '<span class="home-muted">No friends online right now.</span>');
    on.slice(0, 8).forEach((f, i) => {
      const el = box.querySelectorAll(".home-friend:not(.add) .hf-av")[i];
      if (H().paintAvatar) H().paintAvatar(el, f, f.display);
      if (f.inCall) el.classList.add("in-call");
    });
    for (const b of box.querySelectorAll(".home-friend")) b.onclick = () => T.select("contacts");
  }

  let timer = null;
  p.onShow = () => {
    renderTiles();
    loadFriends();
    clearInterval(timer);
    timer = setInterval(() => { if (!p.el.hidden) { renderTiles(); loadFriends(); } }, 30000);
  };

  // feeds.js puts "New in Video" and "New photos" here.
  T.homeFeeds = p.body.querySelector(".home-feeds");
})();
