// Games area: a list of games to pick from. In-app games (like Butter Clicker) open right here
// next to the call, so the call keeps going while you play. App games (like Roblox) open the
// other app on the phone.
//
// To add an in-app game: HuddleGames.register({ id, title, subtitle, icon, mount(el, huddle) }).
// mount() draws the game into el and returns a cleanup function.
(() => {
  const games = [];
  const apps = [
    {
      id: "roblox",
      title: "Roblox",
      subtitle: "Opens the Roblox app. Your call keeps going.",
      icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="9" width="30" height="30" rx="3" transform="rotate(15 24 24)" fill="#f3f3fb"/><rect x="20" y="20" width="8" height="8" transform="rotate(15 24 24)" fill="#0b0b0f"/></svg>',
      open: openRoblox,
    },
  ];

  window.HuddleGames = {
    register(game) { games.push(game); render(); },
  };

  let area, title, back, current = null, cleanup = null;

  function render() {
    if (!area || current) return;
    area.classList.add("hub");
    area.classList.remove("playing");
    title.textContent = "Games";
    back.hidden = true;
    const tile = (g, kind) => `
      <button class="game-tile ${kind}" type="button" data-id="${g.id}">
        <span class="game-icon">${g.icon}</span>
        <span class="game-text"><strong>${g.title}</strong><small>${g.subtitle}</small></span>
        <span class="game-go">${kind === "app" ? "Open" : "Play"}</span>
      </button>`;
    area.innerHTML =
      `<p class="hub-label">Play together on this call</p>` +
      games.map((g) => tile(g, "inapp")).join("") +
      `<p class="hub-label">Open another app</p>` +
      apps.map((a) => tile(a, "app")).join("");
    for (const b of area.querySelectorAll(".game-tile")) {
      b.onclick = () => {
        const id = b.dataset.id;
        const g = games.find((x) => x.id === id);
        if (g) return start(g);
        const a = apps.find((x) => x.id === id);
        if (a) a.open();
      };
    }
  }

  function start(g) {
    current = g;
    area.classList.remove("hub");
    area.classList.add("playing");
    area.innerHTML = "";
    title.textContent = g.title;
    back.hidden = false;
    cleanup = g.mount(area, window.huddle) || null;
  }

  function stop() {
    if (cleanup) { try { cleanup(); } catch {} }
    cleanup = null;
    current = null;
    render();
  }

  // ---------- Roblox ----------
  const ROBLOX_PKG = "com.roblox.client";
  const ROBLOX_ANDROID_STORE = "https://play.google.com/store/apps/details?id=" + ROBLOX_PKG;
  const ROBLOX_IOS_STORE = "https://apps.apple.com/app/roblox/id431946152";
  function openRoblox() {
    const h = window.huddle;
    if (h.isNativeApp) {
      h.native("openApp", { package: ROBLOX_PKG }).catch(() => h.toast("Couldn't open Roblox"));
      return;
    }
    if (h.isAndroid) {
      // Opens the Roblox app, or its Play Store page if it isn't installed.
      location.href = "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;" +
        `package=${ROBLOX_PKG};S.browser_fallback_url=${encodeURIComponent(ROBLOX_ANDROID_STORE)};end`;
      return;
    }
    if (h.isIOS) {
      // Try the app; if nothing happens (not installed), go to the App Store.
      const t = setTimeout(() => { if (!document.hidden) location.href = ROBLOX_IOS_STORE; }, 1500);
      document.addEventListener("visibilitychange", () => clearTimeout(t), { once: true });
      location.href = "roblox://";
      return;
    }
    window.open("https://www.roblox.com/home", "_blank", "noopener");
  }

  function init() {
    area = document.getElementById("gameArea");
    title = document.getElementById("gameTitle");
    back = document.getElementById("gameBack");
    back.onclick = stop;
    render();
    // Leaving the call ends whatever game was open.
    window.addEventListener("huddle:left", () => { if (current) stop(); });
  }
  if (window.huddle) init();
  else window.addEventListener("huddle:ready", init, { once: true });
})();
