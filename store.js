// Saved data for accounts, friends and chats.
// Uses Postgres when DATABASE_URL is set (needed on Render so chats survive restarts).
// Without it, an in-memory copy of Postgres is used, which is wiped on every restart.
const crypto = require("crypto");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_n BIGINT NOT NULL DEFAULT 0,
  UNIQUE (a, b)
);
CREATE TABLE IF NOT EXISTS messages (
  n BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT,
  media_id TEXT,
  duration REAL,
  pinned_at BIGINT,
  pinned_by TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat_n ON messages (chat_id, n);
CREATE TABLE IF NOT EXISTS reads (
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  last_n BIGINT NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at BIGINT NOT NULL
);
`;

let pool = null;
let persistent = false;

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    persistent = true;
  } else {
    const { newDb } = require("pg-mem");
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    console.warn("DATABASE_URL is not set: accounts and chats are kept in memory and lost on restart.");
  }
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await pool.query(stmt);
}

const q = async (sql, params) => (await pool.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0] || null;
const id = (bytes = 9) => crypto.randomBytes(bytes).toString("base64url");
const now = () => Date.now();

// ---------- Passwords and sessions ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `s1$${salt.toString("base64")}$${key.toString("base64")}`;
}
function checkPassword(pw, stored) {
  const [, salt, key] = String(stored).split("$");
  if (!salt || !key) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, "base64"), 32);
  const want = Buffer.from(key, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const tokenHash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

const publicUser = (u) => u && { id: u.id, username: u.username, display: u.display };

async function createUser(username, password) {
  const uname = username.toLowerCase();
  if (await one("SELECT id FROM users WHERE username = $1", [uname])) return { error: "That name is taken" };
  const user = { id: id(), username: uname, display: username, pass_hash: hashPassword(password), created_at: now() };
  await q("INSERT INTO users (id, username, display, pass_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
    [user.id, user.username, user.display, user.pass_hash, user.created_at]);
  return { user };
}
async function login(username, password) {
  const u = await one("SELECT * FROM users WHERE username = $1", [String(username).toLowerCase()]);
  if (!u || !checkPassword(password, u.pass_hash)) return null;
  return u;
}
async function newSession(userId) {
  const token = id(24);
  await q("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, now()]);
  return token;
}
async function userForToken(token) {
  if (!token) return null;
  return one("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1", [tokenHash(token)]);
}
async function endSession(token) {
  await q("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

// ---------- Friends and chats ----------
async function searchUsers(me, text) {
  const t = String(text || "").toLowerCase().replace(/[^a-z0-9_.]/g, "");
  if (!t) return [];
  const rows = await q("SELECT * FROM users WHERE username LIKE $1 AND id <> $2 ORDER BY username LIMIT 10", [t + "%", me.id]);
  return rows.map(publicUser);
}
async function chatBetween(x, y) {
  const [a, b] = [x, y].sort();
  let c = await one("SELECT * FROM chats WHERE a = $1 AND b = $2", [a, b]);
  if (!c) {
    c = { id: id(), a, b, created_at: now(), last_n: 0 };
    await q("INSERT INTO chats (id, a, b, created_at, last_n) VALUES ($1, $2, $3, $4, 0)", [c.id, a, b, c.created_at]);
  }
  return c;
}
// Adding someone puts you on each other's list and opens a chat between you.
async function addFriend(me, username) {
  const other = await one("SELECT * FROM users WHERE username = $1", [String(username || "").toLowerCase()]);
  if (!other) return { error: "No one has that name" };
  if (other.id === me.id) return { error: "That's you" };
  for (const [u, f] of [[me.id, other.id], [other.id, me.id]]) {
    if (!(await one("SELECT 1 AS x FROM friends WHERE user_id = $1 AND friend_id = $2", [u, f]))) {
      await q("INSERT INTO friends (user_id, friend_id, created_at) VALUES ($1, $2, $3)", [u, f, now()]);
    }
  }
  const chat = await chatBetween(me.id, other.id);
  return { friend: publicUser(other), chatId: chat.id };
}
async function chatFor(me, chatId) {
  const c = await one("SELECT * FROM chats WHERE id = $1", [chatId]);
  if (!c || (c.a !== me.id && c.b !== me.id)) return null;
  return c;
}
const otherId = (c, me) => (c.a === me.id ? c.b : c.a);

async function listChats(me) {
  const chats = await q("SELECT * FROM chats WHERE a = $1 OR b = $1", [me.id]);
  const out = [];
  for (const c of chats) {
    const other = publicUser(await one("SELECT * FROM users WHERE id = $1", [otherId(c, me)]));
    const last = await one("SELECT * FROM messages WHERE chat_id = $1 ORDER BY n DESC LIMIT 1", [c.id]);
    const read = await one("SELECT last_n FROM reads WHERE user_id = $1 AND chat_id = $2", [me.id, c.id]);
    const unread = await one("SELECT COUNT(*) AS k FROM messages WHERE chat_id = $1 AND n > $2 AND sender <> $3",
      [c.id, read ? read.last_n : 0, me.id]);
    out.push({ id: c.id, friend: other, last: last && msgOut(last), unread: Number(unread ? unread.k : 0), at: Number(last ? last.created_at : c.created_at) });
  }
  out.sort((x, y) => y.at - x.at);
  return out;
}

// ---------- Messages ----------
function msgOut(m) {
  return {
    id: m.id, n: Number(m.n), chatId: m.chat_id, sender: m.sender, kind: m.kind, body: m.body || "",
    mediaId: m.media_id || null, duration: m.duration == null ? null : Number(m.duration),
    pinned: m.pinned_at != null, pinnedAt: m.pinned_at == null ? null : Number(m.pinned_at), pinnedBy: m.pinned_by || null,
    at: Number(m.created_at),
  };
}
async function addMessage(me, chat, { kind, body, mediaId, duration }) {
  const m = { id: id(), chat_id: chat.id, sender: me.id, kind, body: body || null, media_id: mediaId || null,
    duration: duration == null ? null : duration, created_at: now() };
  const row = await one(
    "INSERT INTO messages (id, chat_id, sender, kind, body, media_id, duration, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
    [m.id, m.chat_id, m.sender, m.kind, m.body, m.media_id, m.duration, m.created_at]);
  await q("UPDATE chats SET last_n = $1 WHERE id = $2", [row.n, chat.id]);
  await markRead(me, chat, row.n);
  return msgOut(row);
}
async function messages(chat, { before, around, limit = 50 }) {
  limit = Math.max(1, Math.min(100, Number(limit) || 50));
  if (around) {
    const target = await one("SELECT n FROM messages WHERE id = $1 AND chat_id = $2", [around, chat.id]);
    if (!target) return { messages: [], more: false };
    const older = await q("SELECT * FROM messages WHERE chat_id = $1 AND n <= $2 ORDER BY n DESC LIMIT $3", [chat.id, target.n, 30]);
    const newer = await q("SELECT * FROM messages WHERE chat_id = $1 AND n > $2 ORDER BY n ASC LIMIT $3", [chat.id, target.n, 30]);
    const list = older.reverse().concat(newer);
    return { messages: list.map(msgOut), more: older.length === 30, newer: newer.length === 30 };
  }
  const rows = before
    ? await q("SELECT * FROM messages WHERE chat_id = $1 AND n < $2 ORDER BY n DESC LIMIT $3", [chat.id, Number(before), limit + 1])
    : await q("SELECT * FROM messages WHERE chat_id = $1 ORDER BY n DESC LIMIT $2", [chat.id, limit + 1]);
  const more = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map(msgOut), more };
}
async function messagesAfter(chat, after, limit = 100) {
  const rows = await q("SELECT * FROM messages WHERE chat_id = $1 AND n > $2 ORDER BY n ASC LIMIT $3", [chat.id, Number(after), limit]);
  return rows.map(msgOut);
}
async function markRead(me, chat, n) {
  const cur = await one("SELECT last_n FROM reads WHERE user_id = $1 AND chat_id = $2", [me.id, chat.id]);
  if (!cur) await q("INSERT INTO reads (user_id, chat_id, last_n) VALUES ($1, $2, $3)", [me.id, chat.id, Number(n)]);
  else if (Number(n) > Number(cur.last_n)) await q("UPDATE reads SET last_n = $1 WHERE user_id = $2 AND chat_id = $3", [Number(n), me.id, chat.id]);
}
async function setPinned(me, messageId, pinned) {
  const m = await one("SELECT * FROM messages WHERE id = $1", [messageId]);
  if (!m) return null;
  const chat = await chatFor(me, m.chat_id);
  if (!chat) return null;
  const row = pinned
    ? await one("UPDATE messages SET pinned_at = $1, pinned_by = $2 WHERE id = $3 RETURNING *", [now(), me.id, messageId])
    : await one("UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = $1 RETURNING *", [messageId]);
  return { chat, message: msgOut(row) };
}
async function pinnedMessages(chat) {
  const rows = await q("SELECT * FROM messages WHERE chat_id = $1 AND pinned_at IS NOT NULL ORDER BY pinned_at DESC LIMIT 200", [chat.id]);
  return rows.map(msgOut);
}

// ---------- Photos and voice notes ----------
async function saveMedia(me, mime, buf) {
  const mid = id(16);
  await q("INSERT INTO media (id, owner, mime, size, data, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [mid, me.id, mime, buf.length, buf, now()]);
  return mid;
}
async function getMedia(mid) {
  return one("SELECT mime, data FROM media WHERE id = $1", [mid]);
}
async function mediaOwner(mid) {
  const r = await one("SELECT owner FROM media WHERE id = $1", [mid]);
  return r && r.owner;
}

module.exports = {
  init, get persistent() { return persistent; },
  createUser, login, newSession, userForToken, endSession, publicUser,
  searchUsers, addFriend, listChats, chatFor, otherId,
  addMessage, messages, messagesAfter, markRead, setPinned, pinnedMessages,
  saveMedia, getMedia, mediaOwner,
};
