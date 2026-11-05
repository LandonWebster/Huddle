// Accounts, friends and saved chats: JSON over HTTP at /api/..., with live updates pushed
// over the same WebSocket the app already uses (only while the app is open; Huddle never sends
// notifications).
const store = require("./store");

const MAX_IMAGE = 6 * 1024 * 1024;
const MAX_VOICE = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/x-m4a"];

// userId -> Set of open sockets
const sockets = new Map();
function attach(ws, user) {
  const set = sockets.get(user.id) || new Set();
  set.add(ws);
  sockets.set(user.id, set);
  ws.on("close", () => { set.delete(ws); if (!set.size) sockets.delete(user.id); });
}
function push(userId, msg) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
}
const pushChat = (chat, msg) => { push(chat.a, msg); push(chat.b, msg); };

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 64 * 1024);
  try { return JSON.parse(buf.toString("utf8") || "{}"); } catch { return {}; }
}
const tokenOf = (req) => (String(req.headers.authorization || "").match(/^Bearer (.+)$/) || [])[1];

// Simple brute-force guard for sign in: 10 tries per name per 10 minutes.
const tries = new Map();
function tooManyTries(key) {
  const t = Date.now();
  const list = (tries.get(key) || []).filter((x) => t - x < 10 * 60 * 1000);
  list.push(t);
  tries.set(key, list);
  return list.length > 10;
}
// Per-person send limit: 30 messages per 10 seconds.
const sendLog = new Map();
function sendingTooFast(userId) {
  const t = Date.now();
  const list = (sendLog.get(userId) || []).filter((x) => t - x < 10000);
  list.push(t);
  sendLog.set(userId, list);
  return list.length > 30;
}

const NAME_RE = /^[A-Za-z0-9_.]{3,20}$/;

async function handle(req, res, url) {
  try {
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
    const route = req.method + " /" + parts.map((p, i) => (i % 2 === 1 && parts[i - 1] !== "users" ? ":id" : p)).join("/");

    // Photos and voice notes are loaded by <img>/<audio>, which can't send a token. Their ids
    // are long and random, so only people who were sent the message can find them.
    if (req.method === "GET" && parts[0] === "media" && parts[1]) {
      const m = await store.getMedia(parts[1]);
      if (!m) return json(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": m.mime, "cache-control": "private, max-age=31536000, immutable", "content-length": m.data.length });
      return res.end(m.data);
    }

    if (route === "POST /signup") {
      const { username, password } = await readJson(req);
      if (!NAME_RE.test(String(username || ""))) return json(res, 400, { error: "Names are 3 to 20 letters, numbers, _ or ." });
      // Any letters, numbers and symbols, 6 to 25 characters.
      const pwLen = [...String(password || "")].length;
      if (pwLen < 6 || pwLen > 25) return json(res, 400, { error: "Passwords are 6 to 25 characters" });
      const r = await store.createUser(String(username), String(password));
      if (r.error) return json(res, 409, r);
      return json(res, 200, { token: await store.newSession(r.user.id), user: store.publicUser(r.user) });
    }
    if (route === "POST /login") {
      const { username, password } = await readJson(req);
      if (tooManyTries(String(username || "").toLowerCase())) return json(res, 429, { error: "Too many tries. Wait a few minutes." });
      const u = await store.login(String(username || ""), String(password || ""));
      if (!u) return json(res, 401, { error: "Wrong name or password" });
      return json(res, 200, { token: await store.newSession(u.id), user: store.publicUser(u) });
    }

    const me = await store.userForToken(tokenOf(req));
    if (!me) return json(res, 401, { error: "Sign in first" });

    if (route === "GET /me") return json(res, 200, { user: store.publicUser(me), saved: store.persistent });
    if (route === "POST /logout") { await store.endSession(tokenOf(req)); return json(res, 200, {}); }
    if (route === "GET /users") return json(res, 200, { users: await store.searchUsers(me, url.searchParams.get("q")) });
    if (route === "POST /friends") {
      const { username } = await readJson(req);
      const r = await store.addFriend(me, username);
      if (r.error) return json(res, 404, r);
      // Let the other person's open app show the new chat.
      push(r.friend.id, { type: "chats-changed" });
      return json(res, 200, r);
    }
    if (route === "GET /chats") return json(res, 200, { chats: await store.listChats(me), saved: store.persistent });

    if (parts[0] === "chats" && parts[1]) {
      const chat = await store.chatFor(me, parts[1]);
      if (!chat) return json(res, 404, { error: "Chat not found" });
      if (route === "GET /chats/:id/messages") {
        const after = url.searchParams.get("after");
        if (after) return json(res, 200, { messages: await store.messagesAfter(chat, after) });
        return json(res, 200, await store.messages(chat, {
          before: url.searchParams.get("before"), around: url.searchParams.get("around"), limit: url.searchParams.get("limit"),
        }));
      }
      if (route === "GET /chats/:id/pinned") return json(res, 200, { messages: await store.pinnedMessages(chat) });
      if (route === "POST /chats/:id/read") {
        const { n } = await readJson(req);
        await store.markRead(me, chat, Number(n) || 0);
        return json(res, 200, {});
      }
      if (route === "POST /chats/:id/messages") {
        if (sendingTooFast(me.id)) return json(res, 429, { error: "Slow down a little" });
        const b = await readJson(req);
        const kind = String(b.kind || "text");
        let msg;
        if (kind === "text") {
          const body = String(b.body || "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 2000);
          if (!body) return json(res, 400, { error: "Empty message" });
          msg = { kind, body };
        } else if (kind === "image" || kind === "voice") {
          if ((await store.mediaOwner(String(b.mediaId || ""))) !== me.id) return json(res, 400, { error: "Upload missing" });
          const duration = kind === "voice" ? Math.max(0, Math.min(600, Number(b.duration) || 0)) : null;
          msg = { kind, mediaId: String(b.mediaId), duration, body: String(b.body || "").slice(0, 500) };
        } else return json(res, 400, { error: "Unknown message type" });
        const saved = await store.addMessage(me, chat, msg);
        pushChat(chat, { type: "chat-message", chatId: chat.id, message: saved });
        return json(res, 200, { message: saved });
      }
    }
    if (parts[0] === "messages" && parts[1] && route === "POST /messages/:id/pin") {
      const { pinned } = await readJson(req);
      const r = await store.setPinned(me, parts[1], !!pinned);
      if (!r) return json(res, 404, { error: "Message not found" });
      pushChat(r.chat, { type: "chat-pin", chatId: r.chat.id, message: r.message });
      return json(res, 200, { message: r.message });
    }
    if (route === "POST /media") {
      const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const isImage = IMAGE_TYPES.includes(mime), isVoice = VOICE_TYPES.includes(mime);
      if (!isImage && !isVoice) return json(res, 415, { error: "Only photos and voice notes" });
      const buf = await readBody(req, isImage ? MAX_IMAGE : MAX_VOICE);
      if (!buf.length) return json(res, 400, { error: "Empty file" });
      return json(res, 200, { id: await store.saveMedia(me, mime, buf) });
    }
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e.status === 413) return json(res, 413, { error: "That file is too big" });
    console.error("api error", e);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong" });
  }
}

module.exports = { handle, attach };
