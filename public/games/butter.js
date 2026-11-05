// Butter Clicker: everyone on the call taps the same butter and shares one pool of butter.
// The server keeps the real score (games/butter.js) so every player sees the same numbers.
(() => {
  const GAME = "butter";
  const fmt = (n) => {
    n = Math.floor(n);
    if (n < 1000) return String(n);
    const units = ["K", "M", "B", "T", "Qa", "Qi"];
    let i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$/, "") + units[i];
  };
  const rate = (n) => (n % 1 ? n.toFixed(1) : String(n));

  const BUTTER_SVG = `
    <svg viewBox="0 0 200 140" aria-hidden="true">
      <defs>
        <linearGradient id="bcTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#ffd84d"/></linearGradient>
        <linearGradient id="bcSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5c431"/><stop offset="1" stop-color="#d9a312"/></linearGradient>
        <linearGradient id="bcPlate" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b59ff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
      </defs>
      <ellipse cx="100" cy="118" rx="92" ry="16" fill="url(#bcPlate)" opacity=".9"/>
      <ellipse cx="100" cy="114" rx="80" ry="11" fill="#0b0b0f" opacity=".55"/>
      <path d="M30 62 L130 44 L176 62 L176 98 L76 116 L30 98 Z" fill="url(#bcSide)"/>
      <path d="M30 62 L130 44 L176 62 L76 80 Z" fill="url(#bcTop)"/>
      <path d="M76 80 L76 116" stroke="#c38f0c" stroke-width="2"/>
      <path d="M44 63 L120 50" stroke="#fffbe0" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    </svg>`;

  function mount(el, huddle) {
    el.innerHTML = `
      <div class="bc">
        <div class="bc-score">
          <div class="bc-butter"><span id="bcButter">0</span> <small>butter</small></div>
          <div class="bc-rates"><span id="bcPerSec">0</span>/sec · <span id="bcPerClick">1</span>/tap <span class="bc-bonus" id="bcBonus" hidden></span></div>
        </div>
        <button class="bc-stick" id="bcStick" type="button" aria-label="Tap the butter">${BUTTER_SVG}<span class="bc-pops" id="bcPops"></span></button>
        <p class="bc-hint" id="bcHint">Tap the butter! Everyone on the call fills the same tub.</p>
        <h3 class="bc-h">Upgrades <small>shared by the team</small></h3>
        <div class="bc-shop" id="bcShop"></div>
        <h3 class="bc-h">Team</h3>
        <ol class="bc-team" id="bcTeam"></ol>
      </div>`;
    const $ = (id) => el.querySelector("#" + id);
    const stick = $("bcStick"), pops = $("bcPops"), shop = $("bcShop"), team = $("bcTeam");
    let state = null;
    let pending = 0;        // taps not yet sent to the server
    let sent = 0;           // taps sent this session
    let base = null;        // the server's count of our taps when we opened the game
    let shownExtra = 0;     // butter from our own taps the server hasn't counted yet
    let lastBuyAt = null;

    const offline = () => !huddle.room;

    function draw() {
      if (!state) return;
      $("bcButter").textContent = fmt(state.butter + shownExtra);
      $("bcPerSec").textContent = fmt(state.perSec);
      $("bcPerClick").textContent = rate(state.perClick);
      const bonus = $("bcBonus");
      bonus.hidden = state.bonus <= 1;
      bonus.textContent = `Team bonus +${Math.round((state.bonus - 1) * 100)}%`;
      const have = state.butter + shownExtra;
      shop.innerHTML = state.upgrades.map((u) => `
        <button class="bc-up" type="button" data-id="${u.id}" ${have >= u.cost ? "" : "disabled"}>
          <span class="bc-up-icon">${u.icon}</span>
          <span class="bc-up-text"><strong>${u.name}</strong><small>${u.effect}</small></span>
          <span class="bc-up-side"><b>${fmt(u.cost)}</b><small>${u.owned ? "owned " + u.owned : ""}</small></span>
        </button>`).join("");
      team.innerHTML = state.players.length
        ? state.players.map((p) => `<li${p.id === huddle.myId ? ' class="me"' : ""}><span>${esc(p.name)}${p.id === huddle.myId ? " (you)" : ""}</span><b>${fmt(p.made)}</b></li>`).join("")
        : `<li class="empty">Nobody has tapped yet.</li>`;
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    shop.addEventListener("click", (e) => {
      const b = e.target.closest(".bc-up");
      if (!b || b.disabled) return;
      flush();
      huddle.sendGame(GAME, { action: "buy", upgrade: b.dataset.id });
    });

    function pop(x, y) {
      const s = document.createElement("span");
      s.className = "bc-pop";
      s.textContent = "+" + rate(state ? state.perClick : 1);
      s.style.left = x + "px";
      s.style.top = y + "px";
      pops.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
    stick.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (offline()) { huddle.toast("Start or join a call to play together"); return; }
      if (pending >= 5) return; // nobody taps faster than 20 a second
      pending++;
      shownExtra += state ? state.perClick : 1;
      const r = stick.getBoundingClientRect();
      pop(e.clientX - r.left, e.clientY - r.top);
      stick.classList.remove("bump"); void stick.offsetWidth; stick.classList.add("bump");
      $("bcHint").hidden = true;
      draw();
    });

    function flush() {
      if (!pending) return;
      huddle.sendGame(GAME, { action: "click", n: pending });
      sent += pending;
      pending = 0;
    }
    const flushTimer = setInterval(flush, 250);

    let milestone = null;
    const off = huddle.onGame(GAME, (s) => {
      // Show our own taps right away, until the server has counted them.
      const me = s.players.find((p) => p.id === huddle.myId);
      const received = me ? me.received : 0;
      if (base === null) base = received - sent;
      shownExtra = Math.max(0, sent - (received - base) + pending) * s.perClick;
      const buyAt = s.lastBuy ? s.lastBuy.at : 0;
      if (lastBuyAt === null) lastBuyAt = buyAt; // don't announce purchases from before we opened
      else if (s.lastBuy && buyAt !== lastBuyAt) {
        if (s.lastBuy.by !== huddle.name) {
          const u = s.upgrades.find((x) => x.id === s.lastBuy.upgrade);
          if (u) huddle.toast(`${s.lastBuy.by} bought ${u.icon} ${u.name}`);
        }
        lastBuyAt = s.lastBuy.at;
      }
      // Pip cheers the team on at big milestones (only ones reached while we're playing).
      const MILESTONES = [100, 1000, 10000, 100000, 1000000, 10000000];
      const reached = MILESTONES.filter((m) => s.butter >= m).length;
      if (milestone === null) milestone = reached;
      else if (reached > milestone) {
        milestone = reached;
        const n = MILESTONES[reached - 1].toLocaleString();
        if (window.Pip) window.Pip.cheer(`${n} butter. Look at this team go.`);
      }
      state = s;
      draw();
    });
    const sync = () => { sent = 0; base = null; pending = 0; huddle.sendGame(GAME, { action: "sync" }); };
    window.addEventListener("huddle:joined", sync);
    sync();
    if (offline()) {
      state = { butter: 0, perSec: 0, perClick: 1, bonus: 1, players: [], upgrades: [] };
      draw();
      $("bcHint").textContent = "Start or join a call, then tap the butter together.";
    }

    return () => {
      flush();
      clearInterval(flushTimer);
      off();
      window.removeEventListener("huddle:joined", sync);
    };
  }

  window.HuddleGames.register({
    id: GAME,
    kind: "group",
    title: "Butter Clicker",
    subtitle: "Tap the butter together. Everyone shares one tub.",
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 20 30 15 42 20 42 31 18 36 6 31Z" fill="#f5c431"/><path d="M6 20 30 15 42 20 18 25Z" fill="#ffe680"/><path d="M18 25V36" stroke="#c38f0c" stroke-width="1.5"/></svg>',
    mount,
  });
})();
