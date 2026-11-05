// Butter Clicker: a co-op clicker. Everyone on the call taps the same butter and shares one
// pool. Upgrades are bought from the shared pool. Each extra player adds a team bonus.
// The tub is saved to the account of the first signed-in person who opens it in the call, so the
// team picks up where it left off next time. Golden pats, achievements and "start fresh" with
// golden butter (a permanent boost) keep it going.
const UPGRADES = [
  { id: "knife",    name: "Butter Knife",   icon: "🔪", base: 15,        growth: 1.5,  click: 1 },
  { id: "churn",    name: "Butter Churn",   icon: "🪣", base: 50,        growth: 1.15, rate: 1 },
  { id: "cow",      name: "Dairy Cow",      icon: "🐄", base: 500,       growth: 1.15, rate: 8 },
  { id: "toast",    name: "Golden Toast",   icon: "🍞", base: 2000,      growth: 1.6,  click: 10 },
  { id: "creamery", name: "Creamery",       icon: "🏭", base: 6000,      growth: 1.15, rate: 50 },
  { id: "farm",     name: "Butter Farm",    icon: "🌾", base: 50000,     growth: 1.15, rate: 300 },
  { id: "whisk",    name: "Diamond Whisk",  icon: "💎", base: 150000,    growth: 1.6,  click: 120 },
  { id: "robot",    name: "Butter Robot",   icon: "🤖", base: 600000,    growth: 1.15, rate: 1500 },
  { id: "rocket",   name: "Space Dairy",    icon: "🚀", base: 5000000,   growth: 1.15, rate: 8000 },
  { id: "volcano",  name: "Butter Volcano", icon: "🌋", base: 60000000,  growth: 1.15, rate: 50000 },
  { id: "galaxy",   name: "Butter Galaxy",  icon: "🌌", base: 800000000, growth: 1.15, rate: 400000 },
];
const MAX_CLICKS_PER_SEC = 20; // nobody taps faster than this; anything more is dropped
const TEAM_BONUS = 0.1;        // +10% butter for each extra person playing
const GOLDEN_BONUS = 0.1;      // +10% butter for each golden butter, forever
const FRESH_START_AT = 1e6;    // butter made this round before you can start fresh
const FRENZY_MS = 20000, FRENZY_X = 3;
const PAT_MS = 9000, PAT_CHANCE = 1 / 75; // a golden pat shows up about every 75 seconds

const ACHIEVEMENTS = [
  { id: "first",    icon: "👆", name: "First pat",        desc: "Tap the butter",                 test: (s) => s.taps >= 1 },
  { id: "k1",       icon: "🧈", name: "Snack size",       desc: "Make 1,000 butter",              test: (s) => s.lifetime >= 1e3 },
  { id: "taps1k",   icon: "🔥", name: "Busy fingers",     desc: "1,000 taps as a team",           test: (s) => s.taps >= 1000 },
  { id: "k100",     icon: "🥞", name: "Pancake stack",    desc: "Make 100,000 butter",            test: (s) => s.lifetime >= 1e5 },
  { id: "churn10",  icon: "🪣", name: "Churn squad",      desc: "Own 10 churns",                  test: (s) => s.owned.churn >= 10 },
  { id: "crowd",    icon: "👨‍👩‍👧‍👦", name: "Full kitchen",  desc: "Play with 4 or more people",     test: (s, n) => n >= 4 },
  { id: "pat",      icon: "✨", name: "Lucky pat",        desc: "Catch a golden pat",             test: (s) => s.pats >= 1 },
  { id: "pat10",    icon: "🍀", name: "Golden touch",     desc: "Catch 10 golden pats",           test: (s) => s.pats >= 10 },
  { id: "fast",     icon: "⚡", name: "Butter rush",      desc: "Make 1,000 butter a second",     test: (s, n, st) => st.rate >= 1000 },
  { id: "m1",       icon: "🏆", name: "Millionaire",      desc: "Make 1,000,000 butter",          test: (s) => s.lifetime >= 1e6 },
  { id: "all",      icon: "🧺", name: "Collector",        desc: "Own one of every upgrade",       test: (s) => UPGRADES.every((u) => s.owned[u.id] > 0) },
  { id: "fresh",    icon: "🌟", name: "Fresh start",      desc: "Trade your tub for golden butter", test: (s) => s.fresh >= 1 },
  { id: "b1",       icon: "👑", name: "Butter royalty",   desc: "Make 1,000,000,000 butter",      test: (s) => s.lifetime >= 1e9 },
];

const emptyOwned = () => Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
function create() {
  return {
    butter: 0, run: 0, lifetime: 0, owned: emptyOwned(), golden: 0, fresh: 0, taps: 0, pats: 0,
    achieved: [], newAch: null, pat: null, frenzyUntil: 0,
    players: {}, lastBuy: null, owner: null, changed: false,
  };
}
// The parts of a tub that are saved to an account.
const SAVED = ["butter", "run", "lifetime", "owned", "golden", "fresh", "taps", "pats", "achieved"];
function save(state) {
  const out = {};
  for (const k of SAVED) out[k] = state[k];
  return out;
}
function load(state, data, owner) {
  state.owner = owner;
  if (data && typeof data === "object") {
    for (const k of SAVED) if (data[k] !== undefined) state[k] = data[k];
    state.owned = Object.assign(emptyOwned(), data.owned || {});
    state.achieved = Array.isArray(data.achieved) ? data.achieved.filter((x) => typeof x === "string") : [];
    for (const k of ["butter", "run", "lifetime", "golden", "fresh", "taps", "pats"]) state[k] = Math.max(0, Number(state[k]) || 0);
  }
}

function cost(u, owned) {
  return Math.ceil(u.base * Math.pow(u.growth, owned));
}
const goldenFor = (run) => Math.floor(Math.sqrt(run / FRESH_START_AT));

function stats(state, playerCount) {
  let click = 1, rate = 0;
  for (const u of UPGRADES) {
    const n = state.owned[u.id] || 0;
    if (u.click) click += u.click * n;
    if (u.rate) rate += u.rate * n;
  }
  const bonus = 1 + TEAM_BONUS * Math.max(0, playerCount - 1);
  const golden = 1 + GOLDEN_BONUS * (state.golden || 0);
  const frenzy = state.frenzyUntil > Date.now() ? FRENZY_X : 1;
  const mult = bonus * golden * frenzy;
  return { click: click * mult, rate: rate * mult, bonus, golden, frenzy };
}

function add(state, n) {
  state.butter += n;
  state.run += n;
  state.lifetime += n;
  state.changed = true;
}
function checkAchievements(state, playerCount) {
  const st = stats(state, playerCount);
  for (const a of ACHIEVEMENTS) {
    if (state.achieved.includes(a.id) || !a.test(state, playerCount, st)) continue;
    state.achieved.push(a.id);
    state.newAch = { id: a.id, at: Date.now() };
    state.changed = true;
  }
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
    add(state, made);
    state.taps += n;
    me.made += made;
    me.clicks += n;
    checkAchievements(state, playerCount);
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
    state.changed = true;
    checkAchievements(state, playerCount);
    return true;
  }
  // Tapping a golden pat before it melts starts a butter frenzy for everyone.
  if (msg.action === "pat") {
    if (!state.pat || state.pat.id !== msg.id || state.pat.until < Date.now()) return false;
    state.pat = null;
    state.frenzyUntil = Date.now() + FRENZY_MS;
    state.frenzyBy = p.name;
    state.pats += 1;
    state.changed = true;
    checkAchievements(state, playerCount);
    return true;
  }
  // Start fresh: trade this round's butter and upgrades for golden butter, a permanent boost.
  if (msg.action === "fresh") {
    const earn = goldenFor(state.run);
    if (state.run < FRESH_START_AT || earn < 1) return false;
    state.golden += earn;
    state.fresh += 1;
    state.butter = 0;
    state.run = 0;
    state.owned = emptyOwned();
    state.frenzyUntil = 0;
    state.pat = null;
    state.lastFresh = { by: p.name, earned: earn, at: Date.now() };
    state.changed = true;
    checkAchievements(state, playerCount);
    return true;
  }
  return false;
}

// Called once a second: churns, cows and farms make butter on their own, and golden pats come and go.
function tick(state, playerCount) {
  let dirty = false;
  const now = Date.now();
  const { rate } = stats(state, playerCount);
  if (rate) { add(state, rate); dirty = true; }
  if (state.pat && state.pat.until < now) { state.pat = null; dirty = true; }
  if (!state.pat && state.taps > 0 && state.frenzyUntil < now && Math.random() < PAT_CHANCE) {
    state.pat = { id: Math.random().toString(36).slice(2, 10), until: now + PAT_MS, x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.6 };
    dirty = true;
  }
  if (state.frenzyUntil && state.frenzyUntil > now - 1500) dirty = true; // keep the countdown moving
  if (dirty) checkAchievements(state, playerCount);
  return dirty;
}

// What gets sent to everyone.
function view(state, playerCount, inRoom) {
  const s = stats(state, playerCount);
  const now = Date.now();
  // Upgrades show up once the team is getting close to affording them.
  const shown = UPGRADES.filter((u, i) => i < 3 || state.owned[u.id] > 0 || state.lifetime >= u.base * 0.4);
  return {
    butter: Math.floor(state.butter),
    total: Math.floor(state.lifetime),
    run: Math.floor(state.run),
    perClick: s.click,
    perSec: s.rate,
    bonus: s.bonus,
    golden: state.golden,
    goldenBoost: s.golden,
    goldenNext: goldenFor(state.run),
    freshAt: FRESH_START_AT,
    frenzyLeft: Math.max(0, Math.ceil((state.frenzyUntil - now) / 1000)),
    frenzyBy: state.frenzyBy || null,
    frenzyX: FRENZY_X,
    pat: state.pat && state.pat.until > now ? { id: state.pat.id, x: state.pat.x, y: state.pat.y } : null,
    upgrades: shown.map((u) => ({
      id: u.id, name: u.name, icon: u.icon, owned: state.owned[u.id], cost: cost(u, state.owned[u.id]),
      effect: u.click ? `+${u.click.toLocaleString()} per tap` : `+${u.rate.toLocaleString()} per second`,
    })),
    hiddenUpgrades: UPGRADES.length - shown.length,
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc, got: state.achieved.includes(a.id) })),
    newAch: state.newAch,
    players: Object.entries(state.players)
      .filter(([id]) => inRoom.has(id))
      .map(([id, x]) => ({ id, name: x.name, made: Math.floor(x.made), clicks: x.clicks, received: x.received || 0 }))
      .sort((a, b) => b.made - a.made),
    lastBuy: state.lastBuy,
    lastFresh: state.lastFresh || null,
    owner: state.owner ? state.owner.name : null,
  };
}

module.exports = { id: "butter", create, action, tick, view, save, load, UPGRADES, ACHIEVEMENTS, cost, stats };
