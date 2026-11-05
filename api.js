// Accounts, friends and saved chats: JSON over HTTP at /api/..., with live updates pushed
// over the same WebSocket the app already uses (only while the app is open; Huddle never sends
// notifications).
const store = require("./store");
const pipAi = require("./pip-ai");

const MAX_IMAGE = 6 * 1024 * 1024;
const MAX_VOICE = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/x-m4a"];

// userId -> Set of open sockets
const sockets = new Map();
function attach(ws, user) {
  const set = sockets.get(user.id) || new Set();
  const wasOnline = set.size > 0;
  set.add(ws);
  sockets.set(user.id, set);
  ws.huddleUser = user;
  if (!wasOnline) tellFriends(user);
  ws.on("close", () => {
    set.delete(ws);
    if (!set.size) sockets.delete(user.id);
    tellFriends(user);
  });
}
// Online = the app is open on some device. "In a call" is reported by the app itself.
function presenceOf(userId) {
  const set = sockets.get(userId);
  if (!set || !set.size) return { online: false, inCall: false };
  return { online: true, inCall: [...set].some((w) => w.huddleInCall) };
}
async function tellFriends(user) {
  try {
    const chats = await store.listChats(user);
    const hide = await store.blockSet(user.id);
    const p = presenceOf(user.id);
    for (const c of chats) if (c.friend && !hide.has(c.friend.id)) push(c.friend.id, { type: "presence", userId: user.id, ...p });
  } catch {}
}
// From the app's own socket: { type: "presence", inCall }.
function presence(ws, msg) {
  const user = ws.huddleUser;
  if (!user) return;
  const inCall = !!msg.inCall;
  if (ws.huddleInCall === inCall) return;
  const before = presenceOf(user.id).inCall;
  ws.huddleInCall = inCall;
  if (presenceOf(user.id).inCall !== before) tellFriends(user);
}
function push(userId, msg) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
}
// skip: people who shouldn't get it (blocked either way with the sender).
const pushChat = (chat, msg, skip) => { for (const u of store.chatPeople(chat)) if (!skip || !skip.has(u)) push(u, msg); };
const OFFLINE = { online: false, inCall: false };

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

// Letters, numbers, spaces, _ . - and ' (3 to 20). Spaces only between words.
const NAME_RE = /^[\p{L}\p{N}_.'-]+( [\p{L}\p{N}_.'-]+)*$/u;

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
      const name = store.tidyName(username);
      if (name.length < 3 || name.length > 20 || !NAME_RE.test(name)) return json(res, 400, { error: "Names are 3 to 20 characters: letters, numbers, spaces, _ . - or '" });
      // Any letters, numbers and symbols, 6 to 25 characters.
      const pwLen = [...String(password || "")].length;
      if (pwLen < 6 || pwLen > 25) return json(res, 400, { error: "Passwords are 6 to 25 characters" });
      const r = await store.createUser(name, String(password));
      if (r.error) return json(res, 409, r);
      return json(res, 200, { token: await store.newSession(r.user.id), user: store.publicUser(r.user) });
    }
    if (route === "POST /login") {
      const { username, password } = await readJson(req);
      if (tooManyTries(store.nameKey(username))) return json(res, 429, { error: "Too many tries. Wait a few minutes." });
      const u = await store.login(String(username || ""), String(password || ""));
      if (!u) return json(res, 401, { error: "Wrong name or password" });
      return json(res, 200, { token: await store.newSession(u.id), user: store.publicUser(u) });
    }

    const me = await store.userForToken(tokenOf(req));
    if (!me) return json(res, 401, { error: "Sign in first" });

    if (route === "GET /me") return json(res, 200, { user: store.publicUser(me), saved: store.persistent, pipChat: pipAi.enabled(), blocked: await store.blockedByMe(me.id) });
    if (route === "POST /profile") {
      const r = await store.updateProfile(me, await readJson(req));
      if (r.error) return json(res, 400, r);
      // Friends' open apps refresh their lists so they see the new look.
      for (const c of await store.listChats(me)) if (c.friend) push(c.friend.id, { type: "chats-changed" });
      return json(res, 200, r);
    }
    if (route === "GET /blocks") return json(res, 200, { users: await store.blockedList(me) });
    if (route === "POST /blocks") {
      const { userId } = await readJson(req);
      const r = await store.block(me, String(userId || ""));
      if (r.error) return json(res, 400, r);
      push(r.user.id, { type: "chats-changed" });
      push(r.user.id, { type: "presence", userId: me.id, ...OFFLINE });
      return json(res, 200, r);
    }
    if (route === "POST /unblock") {
      const { userId } = await readJson(req);
      await store.unblock(me, String(userId || ""));
      push(String(userId || ""), { type: "chats-changed" });
      tellFriends(me);
      return json(res, 200, {});
    }
    if (route === "POST /reports") {
      const r = await store.report(me, await readJson(req));
      if (r.error) return json(res, 400, r);
      console.log("report saved", me.id);
      return json(res, 200, {});
    }
    if (route === "POST /pip") {
      const r = await pipAi.reply(me, await readJson(req));
      return json(res, r.status, r.body);
    }
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
    if (route === "POST /groups") {
      const { name, members } = await readJson(req);
      const r = await store.createGroup(me, name, members);
      if (r.error) return json(res, 400, r);
      for (const u of r.members) push(u, { type: "chats-changed" });
      return json(res, 200, r);
    }
    if (route === "GET /chats") {
      const chats = await store.listChats(me);
      const hide = await store.blockSet(me.id);
      const seen = (id) => (hide.has(id) ? OFFLINE : presenceOf(id));
      for (const c of chats) {
        if (c.friend) Object.assign(c.friend, seen(c.friend.id), hide.has(c.friend.id) ? { blockedMe: true } : {});
        if (c.group) for (const m of c.group.members) Object.assign(m, seen(m.id));
      }
      return json(res, 200, { chats, saved: store.persistent });
    }

    if (parts[0] === "chats" && parts[1]) {
      const chat = await store.chatFor(me, parts[1]);
      if (!chat) return json(res, 404, { error: "Chat not found" });
      const hide = await store.blockSet(me.id);
      const iBlocked = new Set(await store.blockedByMe(me.id));
      const cut = (list) => (iBlocked.size ? list.filter((m) => !iBlocked.has(m.sender)) : list);
      const blockedHere = !chat.group && hide.has(store.otherId(chat, me));
      if (route === "GET /chats/:id/messages") {
        const after = url.searchParams.get("after");
        if (after) return json(res, 200, { messages: cut(await store.messagesAfter(chat, after)) });
        const r = await store.messages(chat, {
          before: url.searchParams.get("before"), around: url.searchParams.get("around"), limit: url.searchParams.get("limit"),
        });
        r.messages = cut(r.messages);
        return json(res, 200, r);
      }
      // Ask a friend to join your call. Their app shows it only while it's open (no notification).
      if (route === "POST /chats/:id/invite") {
        const { room } = await readJson(req);
        const code = String(room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
        if (!code) return json(res, 400, { error: "No call to invite to" });
        if (blockedHere) return json(res, 403, { error: "You can't call this person" });
        const others = store.chatPeople(chat).filter((u) => u !== me.id && !hide.has(u));
        for (const u of others) push(u, { type: "call-invite", chatId: chat.id, room: code, from: store.publicUser(me), group: chat.group ? chat.name : null });
        return json(res, 200, { online: others.some((u) => presenceOf(u).online), group: !!chat.group });
      }
      if (chat.group && route === "POST /chats/:id/members") {
        const { userId } = await readJson(req);
        const r = await store.addToGroup(me, chat, String(userId || ""));
        if (r.error) return json(res, 400, r);
        for (const u of r.members) push(u, { type: "chats-changed" });
        return json(res, 200, r);
      }
      if (chat.group && route === "POST /chats/:id/leave") {
        const r = await store.leaveGroup(me, chat);
        for (const u of r.members) push(u, { type: "chats-changed" });
        return json(res, 200, {});
      }
      if (chat.group && route === "POST /chats/:id/name") {
        const { name } = await readJson(req);
        const r = await store.renameGroup(chat, name);
        if (r.error) return json(res, 400, r);
        for (const u of chat.members) push(u, { type: "chats-changed" });
        return json(res, 200, r);
      }
      if (route === "GET /chats/:id/pinned") return json(res, 200, { messages: await store.pinnedMessages(chat) });
      if (route === "POST /chats/:id/read") {
        const { n } = await readJson(req);
        await store.markRead(me, chat, Number(n) || 0);
        return json(res, 200, {});
      }
      if (route === "POST /chats/:id/messages") {
        if (blockedHere) return json(res, 403, { error: "You can't message this person" });
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
        pushChat(chat, { type: "chat-message", chatId: chat.id, message: saved }, hide);
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

module.exports = { handle, attach, presence };
