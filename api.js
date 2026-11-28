// Accounts, friends and saved chats: JSON over HTTP at /api/..., with live updates pushed
// over the same WebSocket the app already uses while the app is open, and as notifications
// (notify.js) for people who turned them on.
const store = require("./store");
const pipAi = require("./pip-ai");
const phone = require("./phone");
const { notify, route: pushRoute, getPrefs } = require("./notify");
const storage = require("./post-storage");
const alarmServer = require("./alarm-server");
const crypto = require("crypto");

const MAX_IMAGE = 6 * 1024 * 1024;
const MAX_VOICE = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Posts on the Video and Photos tabs.
const MAX_POST_PHOTO = 8 * 1024 * 1024;
const MAX_POST_VIDEO = 100 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const POSTS_PER_DAY = 30;
const MAX_VIDEO_SECONDS = 60; // keeps videos small, so free storage holds more (the app shrinks them too)
const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/x-m4a"];

// userId -> Set of open sockets
const sockets = new Map();
// When each person last closed the app (so we know their phone line needs to reconnect).
const offlineAt = new Map();
function attach(ws, user) {
  const set = sockets.get(user.id) || new Set();
  const wasOnline = set.size > 0;
  set.add(ws);
  sockets.set(user.id, set);
  ws.huddleUser = user;
  if (!wasOnline) tellFriends(user);
  ws.on("close", () => {
    set.delete(ws);
    if (!set.size) { sockets.delete(user.id); offlineAt.set(user.id, Date.now()); }
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

// Sent / Delivered / Read. "Read" is only shared by people who keep "Send read receipts" on.
async function shareable(r) {
  const p = await getPrefs(r.userId);
  return p.readReceipts === false ? { ...r, read: 0 } : r;
}
async function receiptsFor(chat, me) {
  const out = [];
  for (const r of await store.receipts(chat)) if (r.userId !== me.id) out.push(await shareable(r));
  return out;
}
// Tell everyone else in the chat how far this person has got.
async function sendReceipt(chat, userId) {
  try {
    const r = (await store.receipts(chat)).find((x) => x.userId === userId);
    if (!r) return;
    const msg = { type: "chat-receipt", chatId: chat.id, ...(await shareable(r)) };
    const hide = await store.blockSet(userId);
    for (const u of store.chatPeople(chat)) if (u !== userId && !hide.has(u)) push(u, msg);
  } catch {}
}
// This person's app now has every message up to n in the chat.
async function gotUpTo(chat, userId, n) {
  if (await store.markGot(userId, chat.id, n)) await sendReceipt(chat, userId);
}

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

    // A post's video or photo (and its preview picture). Like /media, ids are long and random.
    if (req.method === "GET" && parts[0] === "post-media" && parts[1] && (parts[2] === "main" || parts[2] === "thumb")) {
      const p = await store.postRow(parts[1]);
      if (!p) return json(res, 404, { error: "Not found" });
      const src = parts[2] === "thumb" && p.thumb ? "db:" + p.thumb : p.src;
      if (src.startsWith("db:")) {
        const m = await store.getMedia(src.slice(3));
        if (!m) return json(res, 404, { error: "Not found" });
        res.writeHead(200, { "content-type": m.mime, "cache-control": "public, max-age=31536000, immutable", "content-length": m.data.length });
        return res.end(m.data);
      }
      const key = src.slice(3);
      if (storage.publicUrl()) { res.writeHead(302, { location: storage.publicUrl() + "/" + key, "cache-control": "public, max-age=86400" }); return res.end(); }
      if (!storage.configured()) return json(res, 404, { error: "Not found" });
      return storage.pipeTo(key, req, res);
    }

    // Snooze / Stop tapped on an alarm notification (the service worker has no sign-in; the
    // link's token is random and only works for that one ring).
    if (req.method === "POST" && (parts[0] === "alarm-snooze" || parts[0] === "alarm-stop") && parts[1] && parts.length === 2) {
      const ok = parts[0] === "alarm-snooze" ? alarmServer.snooze(parts[1]) : alarmServer.stop(parts[1]);
      return json(res, ok ? 200 : 404, {});
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
    // A short-lived pass for calling a real phone number from a call (Twilio).
    if (route === "POST /phone") {
      const body = await readJson(req);
      if (!body.listen && tooManyTries("phone:" + me.id)) return json(res, 429, { error: "Too many tries. Wait a few minutes." });
      const r = await phone.tokenFor(me, req, body);
      return json(res, r.status, r.body);
    }
    // Alarms (so they ring with Huddle closed).
    if (route === "GET /alarms") return json(res, 200, await alarmServer.get(me.id));
    if (route === "POST /alarms") return json(res, 200, await alarmServer.set(me.id, await readJson(req)));
    // Notifications on/off for this device, and Settings switches (/push/prefs).
    if (parts[0] === "push" && parts[1] && parts.length === 2) {
      const body = req.method === "POST" ? await readJson(req) : {};
      const r = await pushRoute(req.method, parts[1], me, body);
      return json(res, r.status, r.body);
    }
    // The Phone screen: calls and voicemails with real phone numbers.
    if (parts[0] === "phone" && parts[1] && parts.length === 2) {
      const body = req.method === "POST" ? await readJson(req) : {};
      const r = await phone.appRoute(req.method, parts[1], me, url, body, req);
      return json(res, r.status, r.body);
    }
    // ---------- Posts (Video and Photos tabs) ----------
    if (route === "GET /posts") {
      const kind = url.searchParams.get("kind") === "video" ? "video" : "photo";
      const r = await store.listPosts(me, { kind, feed: url.searchParams.get("feed") || "all", before: url.searchParams.get("before"), limit: url.searchParams.get("limit") });
      return json(res, 200, { ...r, canVideo: storage.configured() });
    }
    if (route === "POST /posts") {
      const kind = url.searchParams.get("kind") === "video" ? "video" : "photo";
      const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (kind === "photo" && !IMAGE_TYPES.includes(mime)) return json(res, 415, { error: "That isn't a photo Huddle can show" });
      if (kind === "video" && !VIDEO_TYPES.includes(mime)) return json(res, 415, { error: "That video type isn't supported. Try an MP4." });
      if (kind === "video" && !storage.configured()) return json(res, 503, { error: "Posting videos isn't turned on yet (Huddle needs a place to keep them)." });
      if ((await store.postsToday(me.id)) >= POSTS_PER_DAY) return json(res, 429, { error: "That's a lot of posts today. Try again tomorrow." });
      const num = (k) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
      if (kind === "video" && (num("duration") || 0) > MAX_VIDEO_SECONDS + 2) return json(res, 400, { error: `Videos can be up to ${MAX_VIDEO_SECONDS} seconds long.` });
      let thumb = url.searchParams.get("thumb") || null;
      if (thumb && (await store.mediaOwner(thumb)) !== me.id) thumb = null;
      let src;
      if (storage.configured()) {
        const key = `${kind}s/${crypto.randomBytes(16).toString("base64url")}`;
        await storage.put(key, req, mime, kind === "video" ? MAX_POST_VIDEO : MAX_POST_PHOTO);
        src = "s3:" + key;
      } else {
        const buf = await readBody(req, MAX_POST_PHOTO);
        if (!buf.length) return json(res, 400, { error: "Empty file" });
        src = "db:" + (await store.saveMedia(me, mime, buf));
      }
      const row = await store.createPost(me, { kind, caption: url.searchParams.get("caption"), src, mime, thumb, w: num("w"), h: num("h"), duration: num("duration") });
      const [post] = await store.postsOut(me, [row]);
      return json(res, 200, { post });
    }
    if (parts[0] === "posts" && parts[1]) {
      const pid = parts[1];
      if (route === "POST /posts/:id/delete") {
        const p = await store.removePost(me, pid);
        if (!p) return json(res, 404, { error: "Post not found" });
        if (p.src.startsWith("s3:") && storage.configured()) storage.remove(p.src.slice(3)).catch(() => {});
        return json(res, 200, {});
      }
      if (route === "POST /posts/:id/report") {
        const r = await store.reportPost(me, pid, await readJson(req));
        if (r.error) return json(res, 400, r);
        console.log("post report saved", me.id);
        return json(res, 200, {});
      }
      const p = await store.visiblePost(me, pid);
      if (!p) return json(res, 404, { error: "That post is gone" });
      if (route === "GET /posts/:id") return json(res, 200, { post: (await store.postsOut(me, [p]))[0] });
      if (route === "POST /posts/:id/like" || route === "POST /posts/:id/save") {
        const { on } = await readJson(req);
        await (parts[2] === "like" ? store.likePost : store.savePost)(me, p.id, !!on);
        return json(res, 200, { post: (await store.postsOut(me, [p]))[0] });
      }
      if (route === "GET /posts/:id/comments") return json(res, 200, { comments: await store.postComments(me, p.id) });
      if (route === "POST /posts/:id/comments") {
        if (sendingTooFast(me.id)) return json(res, 429, { error: "Slow down a little" });
        const r = await store.addComment(me, p.id, (await readJson(req)).body);
        if (r.error) return json(res, 400, r);
        return json(res, 200, r);
      }
    }
    if (route === "POST /comments/:id/delete") {
      if (!(await store.removeComment(me, parts[1]))) return json(res, 404, { error: "Comment not found" });
      return json(res, 200, {});
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
        if (c.last && c.last.sender !== me.id) {
          const ch = await store.chatFor(me, c.id);
          if (ch) await gotUpTo(ch, me.id, c.last.n);
        }
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
        const newest = (list) => list.reduce((a, m) => Math.max(a, m.n), 0);
        if (after) {
          const list = await store.messagesAfter(chat, after);
          await gotUpTo(chat, me.id, newest(list));
          return json(res, 200, { messages: cut(list), receipts: await receiptsFor(chat, me) });
        }
        const r = await store.messages(chat, {
          before: url.searchParams.get("before"), around: url.searchParams.get("around"), limit: url.searchParams.get("limit"),
        });
        await gotUpTo(chat, me.id, newest(r.messages));
        r.messages = cut(r.messages);
        r.receipts = await receiptsFor(chat, me);
        return json(res, 200, r);
      }
      // Ask a friend to join your call: shown in their app, or as a notification if it's closed.
      if (route === "POST /chats/:id/invite") {
        const { room } = await readJson(req);
        const code = String(room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
        if (!code) return json(res, 400, { error: "No call to invite to" });
        if (blockedHere) return json(res, 403, { error: "You can't call this person" });
        const others = store.chatPeople(chat).filter((u) => u !== me.id && !hide.has(u));
        for (const u of others) {
          push(u, { type: "call-invite", chatId: chat.id, room: code, from: store.publicUser(me), group: chat.group ? chat.name : null });
          notify(u, { kind: "call", cat: "huddle-call", ring: true, title: chat.group ? `${me.display} is calling ${chat.name}` : `${me.display} is calling`, body: chat.group ? "Group call" : "Huddle call", tag: "invite-" + code, url: "/r/" + code, ttl: 60 });
        }
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
        await store.markRead(me, chat, Math.min(Number(n) || 0, Number(chat.last_n) || Infinity));
        await sendReceipt(chat, me.id);
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
        pushChat(chat, { type: "chat-message", chatId: chat.id, message: saved, from: me.display, group: chat.group ? chat.name : null }, hide);
        // Anyone with Huddle open gets it right away: that's "Delivered".
        for (const u of store.chatPeople(chat)) if (u !== me.id && !hide.has(u) && sockets.has(u)) await gotUpTo(chat, u, saved.n);
        const preview = kind === "text" ? msg.body.slice(0, 140) : kind === "image" ? "Sent a photo" : "Sent a voice note";
        for (const u of store.chatPeople(chat)) {
          if (u === me.id || hide.has(u)) continue;
          notify(u, { kind: "text", cat: "chat", title: chat.group ? `${me.display} in ${chat.name}` : me.display, body: preview, tag: "chat-" + chat.id, url: "/?chat=" + encodeURIComponent(chat.id) });
        }
        return json(res, 200, { message: saved, receipts: await receiptsFor(chat, me) });
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
    console.error("api error", req.method, url.pathname, e);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong" });
  }
}

alarmServer.start(push);

module.exports = { handle, attach, presence, push, presenceOf, offlineAt: (id) => offlineAt.get(id) || 0 };
