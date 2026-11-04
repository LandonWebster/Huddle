// Call server: serves the web app and relays WebRTC signaling between people in a room.
// Media (voice/video) flows directly between browsers; this server only introduces them.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = Number(process.env.MAX_PER_ROOM || 8);
const PUBLIC_DIR = path.join(__dirname, "public");

// Optional TURN server for people on strict networks (cell carriers, corporate wifi).
// Set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL to enable.
function iceServers() {
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(","),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/config") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ iceServers: iceServers(), maxPerRoom: MAX_PER_ROOM }));
  }
  if (url.pathname === "/health") {
    res.writeHead(200);
    return res.end("ok");
  }
  // Any non-file path (e.g. /r/ABCD) serves the app so invite links work.
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(PUBLIC_DIR, "index.html");
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404);
        return res.end("not found");
      }
      const headers = { "content-type": TYPES[path.extname(file)] || "application/octet-stream" };
      // Always check for a new service worker / page so app updates reach installed copies.
      if (file.endsWith("sw.js") || file.endsWith(".html")) headers["cache-control"] = "no-cache";
      res.writeHead(200, headers);
      res.end(data);
    });
  });
});

// rooms: code -> Map(peerId -> { ws, name, state })
const rooms = new Map();
// recent chat per room, so people who join late see the conversation
const chats = new Map();
const CHAT_HISTORY = 50;
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  for (const [id, p] of room) if (id !== exceptId) send(p.ws, msg);
}

function cleanCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function cleanName(name) {
  return String(name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24) || "Guest";
}

wss.on("connection", (ws) => {
  const id = crypto.randomBytes(6).toString("hex");
  let roomCode = null;

  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join" && !roomCode) {
      const code = cleanCode(msg.room);
      if (!code) return send(ws, { type: "error", reason: "bad_room" });
      const room = rooms.get(code) || new Map();
      if (room.size >= MAX_PER_ROOM) return send(ws, { type: "error", reason: "room_full", max: MAX_PER_ROOM });
      rooms.set(code, room);
      roomCode = code;
      const me = { ws, name: cleanName(msg.name), state: sanitizeState(msg.state) };
      // Tell the newcomer who is here; the newcomer starts a connection to each of them.
      send(ws, {
        type: "joined",
        id,
        room: code,
        peers: [...room].map(([pid, p]) => ({ id: pid, name: p.name, state: p.state })),
        chat: chats.get(code) || [],
      });
      room.set(id, me);
      broadcast(room, { type: "peer-joined", id, name: me.name, state: me.state }, id);
      return;
    }

    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (msg.type === "signal") {
      // offer / answer / ice candidate, relayed to exactly one peer in the same room
      const target = room.get(msg.to);
      if (target) send(target.ws, { type: "signal", from: id, data: msg.data });
    } else if (msg.type === "chat") {
      const me = room.get(id);
      const text = String(msg.text || "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 500);
      if (!me || !text) return;
      const now = Date.now();
      // simple flood guard: at most 5 messages per 3 seconds per person
      me.sent = (me.sent || []).filter((t) => now - t < 3000);
      if (me.sent.length >= 5) return;
      me.sent.push(now);
      const entry = { id: crypto.randomBytes(4).toString("hex"), from: id, name: me.name, text, ts: now };
      const log = chats.get(roomCode) || [];
      log.push(entry);
      if (log.length > CHAT_HISTORY) log.shift();
      chats.set(roomCode, log);
      broadcast(room, { type: "chat", ...entry });
    } else if (msg.type === "state") {
      const me = room.get(id);
      if (!me) return;
      me.state = sanitizeState(msg.state);
      broadcast(room, { type: "peer-state", id, state: me.state }, id);
    }
  });

  ws.on("close", () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.delete(id);
    broadcast(room, { type: "peer-left", id });
    if (room.size === 0) {
      rooms.delete(roomCode);
      chats.delete(roomCode); // chat disappears once everyone has left
    }
  });
});

function sanitizeState(s) {
  s = s || {};
  return { mic: !!s.mic, cam: !!s.cam };
}

// Drop dead connections (phones that lost signal) so they leave the call.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Call app running on http://localhost:${PORT}`));
