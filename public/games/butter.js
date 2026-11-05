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
        <div class="bc-frenzy" id="bcFrenzy" hidden></div>
        <div class="bc-stage">
          <button class="bc-stick" id="bcStick" type="button" aria-label="Tap the butter">${BUTTER_SVG}<span class="bc-pops" id="bcPops"></span></button>
          <button class="bc-pat" id="bcPat" type="button" aria-label="Catch the golden pat" hidden>✨🧈✨</button>
        </div>
        <p class="bc-hint" id="bcHint">Tap the butter! Everyone on the call fills the same tub.</p>
        <p class="bc-owner" id="bcOwner" hidden></p>
        <h3 class="bc-h">Upgrades <small>shared by the team</small></h3>
        <div class="bc-shop" id="bcShop"></div>
        <p class="bc-more" id="bcMore" hidden></p>
        <h3 class="bc-h">Golden butter <small id="bcGoldSmall"></small></h3>
        <div class="bc-fresh" id="bcFresh"></div>
        <h3 class="bc-h">Achievements <small id="bcAchCount"></small></h3>
        <div class="bc-ach" id="bcAch"></div>
        <h3 class="bc-h">Team</h3>
        <ol class="bc-team" id="bcTeam"></ol>
      </div>`;
    const $ = (id) => el.querySelector("#" + id);
    const stick = $("bcStick"), pops = $("bcPops"), shop = $("bcShop"), team = $("bcTeam");
    const patBtn = $("bcPat"), frenzyEl = $("bcFrenzy"), freshEl = $("bcFresh"), achEl = $("bcAch");
    let lastAchAt = null, lastFreshAt = null, lastFrenzy = 0, confirmFresh = false;
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
      // Golden pat: tap it before it melts for a frenzy.
      if (state.pat) {
        patBtn.hidden = false;
        patBtn.dataset.id = state.pat.id;
        patBtn.style.left = (state.pat.x * 100) + "%";
        patBtn.style.top = (state.pat.y * 100) + "%";
      } else patBtn.hidden = true;
      frenzyEl.hidden = !state.frenzyLeft;
      if (state.frenzyLeft) frenzyEl.textContent = `✨ Butter frenzy! Everything x${state.frenzyX} for ${state.frenzyLeft}s`;
      stick.classList.toggle("frenzy", !!state.frenzyLeft);
      const owner = $("bcOwner");
      owner.hidden = !state.owner;
      if (state.owner) owner.textContent = `💾 Saved to ${state.owner}'s tub`;
      const more = $("bcMore");
      more.hidden = !state.hiddenUpgrades;
      if (state.hiddenUpgrades) more.textContent = `🔒 ${state.hiddenUpgrades} more upgrade${state.hiddenUpgrades === 1 ? "" : "s"} unlock as you make more butter`;
      // Start fresh for golden butter.
      if (state.golden !== undefined) {
        $("bcGoldSmall").textContent = state.golden ? `${state.golden} owned · +${Math.round((state.goldenBoost - 1) * 100)}% butter forever` : "a boost that lasts forever";
        const ready = state.run >= state.freshAt && state.goldenNext > 0;
        const pct = Math.min(100, (state.run / state.freshAt) * 100);
        freshEl.innerHTML = ready
          ? `<p>Trade this round's butter and upgrades for <b>${state.goldenNext} golden butter</b>. Each one gives +10% butter forever.</p>
             <button class="bc-fresh-btn${confirmFresh ? " sure" : ""}" type="button">${confirmFresh ? "Tap again to start fresh (resets the tub for everyone)" : `🌟 Start fresh for ${state.goldenNext} golden`}</button>`
          : `<p>Make ${fmt(state.freshAt)} butter in one round to trade it for golden butter.</p>
             <div class="bc-bar"><span style="width:${pct.toFixed(1)}%"></span></div><small>${fmt(state.run)} / ${fmt(state.freshAt)}</small>`;
        const fb = freshEl.querySelector(".bc-fresh-btn");
        if (fb) fb.onclick = () => {
          if (!confirmFresh) { confirmFresh = true; draw(); setTimeout(() => { confirmFresh = false; draw(); }, 4000); return; }
          confirmFresh = false;
          flush();
          huddle.sendGame(GAME, { action: "fresh" });
        };
      }
      if (state.achievements) {
        const got = state.achievements.filter((a) => a.got).length;
        $("bcAchCount").textContent = `${got} of ${state.achievements.length}`;
        achEl.innerHTML = state.achievements.map((a) => `<span class="bc-badge${a.got ? " got" : ""}" title="${esc(a.name + ": " + a.desc)}"><i>${a.got ? a.icon : "🔒"}</i><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span>`).join("");
      }
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

    patBtn.addEventListener("click", () => {
      if (!patBtn.dataset.id) return;
      huddle.sendGame(GAME, { action: "pat", id: patBtn.dataset.id });
      patBtn.hidden = true;
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
      const reached = MILESTONES.filter((m) => s.run >= m).length;
      if (milestone === null) milestone = reached;
      else if (reached > milestone) {
        milestone = reached;
        const n = MILESTONES[reached - 1].toLocaleString();
        if (window.Pip) window.Pip.cheer(`${n} butter. Look at this team go.`);
      }
      // New achievements, frenzies and fresh starts get a cheer from Pip (only ones that happen now).
      const achAt = s.newAch ? s.newAch.at : 0;
      if (lastAchAt === null) lastAchAt = achAt;
      else if (s.newAch && achAt !== lastAchAt) {
        lastAchAt = achAt;
        const a = (s.achievements || []).find((x) => x.id === s.newAch.id);
        if (a) { huddle.toast(`${a.icon} Achievement: ${a.name}`); if (window.Pip) window.Pip.cheer(`Achievement unlocked: ${a.name}!`); }
      }
      if (s.frenzyLeft && !lastFrenzy && window.Pip) window.Pip.cheer(`${s.frenzyBy || "Someone"} caught a golden pat. Butter frenzy, tap tap tap!`);
      lastFrenzy = s.frenzyLeft;
      const freshAt = s.lastFresh ? s.lastFresh.at : 0;
      if (lastFreshAt === null) lastFreshAt = freshAt;
      else if (s.lastFresh && freshAt !== lastFreshAt) {
        lastFreshAt = freshAt;
        milestone = 0;
        huddle.toast(`🌟 ${s.lastFresh.by} started fresh for ${s.lastFresh.earned} golden butter`);
      }
      state = s;
      draw();
    });
    const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
    const sync = () => {
      sent = 0; base = null; pending = 0;
      huddle.sendGame(GAME, { action: "sync" });
      const t = token();
      if (t) huddle.sendGame(GAME, { action: "claim", token: t }); // load your saved tub, if the call doesn't have one yet
    };
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
    subtitle: "Tap the butter together. Golden pats, achievements, and your tub saves.",
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 20 30 15 42 20 42 31 18 36 6 31Z" fill="#f5c431"/><path d="M6 20 30 15 42 20 18 25Z" fill="#ffe680"/><path d="M18 25V36" stroke="#c38f0c" stroke-width="1.5"/></svg>',
    mount,
  });
})();
