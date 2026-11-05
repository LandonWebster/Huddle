// Butter Clicker: a co-op clicker. Everyone on the call taps the same butter and shares one
// pool. Upgrades are bought from the shared pool. Each extra player adds a team bonus.
const UPGRADES = [
  { id: "knife",    name: "Butter Knife",  icon: "🔪", base: 15,     growth: 1.5,  click: 1 },
  { id: "churn",    name: "Butter Churn",  icon: "🪣", base: 50,     growth: 1.15, rate: 1 },
  { id: "cow",      name: "Dairy Cow",     icon: "🐄", base: 500,    growth: 1.15, rate: 8 },
  { id: "toast",    name: "Golden Toast",  icon: "🍞", base: 2000,   growth: 1.6,  click: 10 },
  { id: "creamery", name: "Creamery",      icon: "🏭", base: 6000,   growth: 1.15, rate: 50 },
  { id: "farm",     name: "Butter Farm",   icon: "🌾", base: 50000,  growth: 1.15, rate: 300 },
];
const MAX_CLICKS_PER_SEC = 20; // nobody taps faster than this; anything more is dropped
const TEAM_BONUS = 0.1;        // +10% butter for each extra person playing

function create() {
  return { butter: 0, total: 0, owned: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])), players: {}, lastBuy: null };
}

function cost(u, owned) {
  return Math.ceil(u.base * Math.pow(u.growth, owned));
}

function stats(state, playerCount) {
  let click = 1, rate = 0;
  for (const u of UPGRADES) {
    const n = state.owned[u.id] || 0;
    if (u.click) click += u.click * n;
    if (u.rate) rate += u.rate * n;
  }
  const bonus = 1 + TEAM_BONUS * Math.max(0, playerCount - 1);
  return { click: click * bonus, rate: rate * bonus, bonus };
}

function player(state, p) {
  const me = state.players[p.id] || (state.players[p.id] = { name: p.name, made: 0, clicks: 0, window: [] });
  me.name = p.name;
  return me;
}

function action(state, p, msg, playerCount) {
  const me = player(state, p);
  if (msg.action === "click") {
    const raw = Math.max(0, Math.min(100, Math.floor(Number(msg.n) || 0)));
    if (!raw) return false;
    const now = Date.now();
    me.received = (me.received || 0) + raw;
    me.window = me.window.filter((t) => now - t.at < 1000);
    const used = me.window.reduce((a, t) => a + t.n, 0);
    const n = Math.max(0, Math.min(raw, MAX_CLICKS_PER_SEC - used));
    if (!n) return true; // still tell the tapper so their screen catches up
    me.window.push({ at: now, n });
    const made = n * stats(state, playerCount).click;
    state.butter += made;
    state.total += made;
    me.made += made;
    me.clicks += n;
    return true;
  }
  if (msg.action === "buy") {
    const u = UPGRADES.find((x) => x.id === msg.upgrade);
    if (!u) return false;
    const price = cost(u, state.owned[u.id]);
    if (state.butter < price) return false;
    state.butter -= price;
    state.owned[u.id] += 1;
    state.lastBuy = { by: p.name, upgrade: u.id, at: Date.now() };
    return true;
  }
  return false;
}

// Called once a second: churns, cows and farms make butter on their own.
function tick(state, playerCount) {
  const { rate } = stats(state, playerCount);
  if (!rate) return false;
  state.butter += rate;
  state.total += rate;
  return true;
}

// What gets sent to everyone.
function view(state, playerCount, inRoom) {
  const s = stats(state, playerCount);
  return {
    butter: Math.floor(state.butter),
    total: Math.floor(state.total),
    perClick: s.click,
    perSec: s.rate,
    bonus: s.bonus,
    upgrades: UPGRADES.map((u) => ({
      id: u.id, name: u.name, icon: u.icon, owned: state.owned[u.id], cost: cost(u, state.owned[u.id]),
      effect: u.click ? `+${u.click} per tap` : `+${u.rate} per second`,
    })),
    players: Object.entries(state.players)
      .filter(([id]) => inRoom.has(id))
      .map(([id, x]) => ({ id, name: x.name, made: Math.floor(x.made), clicks: x.clicks, received: x.received || 0 }))
      .sort((a, b) => b.made - a.made),
    lastBuy: state.lastBuy,
  };
}

module.exports = { id: "butter", create, action, tick, view, UPGRADES, cost, stats };
