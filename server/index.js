require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const { router: authRouter, verifyToken, requireAuth } = require("./auth");

const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || false; // false = same-origin only
const MAX_PEERS = parseInt(process.env.MAX_PEERS || "6", 10);

const app = express();
app.set("trust proxy", 1); // correct IPs for rate limiting behind a proxy / host

// ---- Security middleware ----
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // allow plain http on localhost / LAN during development
        "upgrade-insecure-requests": null,
        "connect-src": ["'self'", "ws:", "wss:"],
        "media-src": ["'self'", "blob:"],
      },
    },
  })
);
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "10kb" }));

// Throttle login/register attempts (brute-force protection)
app.use(
  "/api/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })
);
app.use(
  "/api/register",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })
);

// ---- REST API ----
app.use("/api", authRouter);

// ICE servers (STUN + optional TURN) are handed out only to logged-in users
app.get("/api/ice", requireAuth, (req, res) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers });
});

// ---- Serve the frontend ----
app.use(express.static(path.join(__dirname, "..", "client")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN },
  maxHttpBufferSize: 1e6, // 1 MB per message
});

// ---- Socket auth: reject connections without a valid JWT ----
io.use((socket, next) => {
  const user = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error("unauthorized"));
  socket.user = user;
  next();
});

// rooms: roomId -> { peers: Map<socketId, {name}>, board: [] }
const rooms = new Map();
const MAX_BOARD_SEGMENTS = 20000;

function cleanRoomId(id) {
  const s = String(id || "").trim().toLowerCase();
  return /^[a-z0-9-]{3,40}$/.test(s) ? s : null;
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  socket.leave(roomId);
  socket.data.roomId = null;
  if (!room) return;
  room.peers.delete(socket.id);
  socket.to(roomId).emit("peer-left", { id: socket.id });
  if (room.peers.size === 0) rooms.delete(roomId); // free memory (and the whiteboard)
}

io.on("connection", (socket) => {
  socket.on("join-room", (rawId, ack) => {
    if (typeof ack !== "function") return;
    const roomId = cleanRoomId(rawId);
    if (!roomId) return ack({ error: "Room ID must be 3-40 letters, numbers or dashes" });

    leaveRoom(socket);

    let room = rooms.get(roomId);
    if (!room) {
      room = { peers: new Map(), board: [] };
      rooms.set(roomId, room);
    }
    if (room.peers.size >= MAX_PEERS) return ack({ error: "This room is full" });

    const existing = [...room.peers].map(([id, p]) => ({ id, name: p.name }));
    room.peers.set(socket.id, { name: socket.user.name });
    socket.join(roomId);
    socket.data.roomId = roomId;

    ack({ roomId, selfId: socket.id, peers: existing, board: room.board });
    socket.to(roomId).emit("peer-joined", { id: socket.id, name: socket.user.name });
  });

  // WebRTC signaling relay (offer / answer / ICE candidates)
  socket.on("signal", ({ to, data } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.peers.has(to) || !data) return; // only relay inside the same room
    io.to(to).emit("signal", { from: socket.id, name: socket.user.name, data });
  });

  // Chat (text may already be encrypted client-side)
  socket.on("chat", (msg) => {
    const roomId = socket.data.roomId;
    if (!roomId || !msg || typeof msg.data !== "string" || msg.data.length > 20000) return;
    io.to(roomId).emit("chat", {
      from: socket.id,
      name: socket.user.name,
      enc: !!msg.enc,
      data: msg.data,
      ts: Date.now(),
    });
  });

  // Whiteboard
  socket.on("draw", (seg) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !seg) return;
    const clean = {
      x0: +seg.x0, y0: +seg.y0, x1: +seg.x1, y1: +seg.y1,
      color: String(seg.color || "#000").slice(0, 9),
      size: Math.min(Math.max(+seg.size || 3, 1), 40),
    };
    if ([clean.x0, clean.y0, clean.x1, clean.y1].some((n) => !Number.isFinite(n))) return;
    if (room.board.length < MAX_BOARD_SEGMENTS) room.board.push(clean);
    socket.to(socket.data.roomId).emit("draw", clean);
  });

  socket.on("clear-board", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    room.board = [];
    io.to(socket.data.roomId).emit("clear-board");
  });

  socket.on("leave-room", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

server.listen(PORT, () => {
  console.log(`RTC app running on http://localhost:${PORT}`);
});
