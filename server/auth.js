const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET not set - using an insecure dev secret. Set it in .env!");
}

// ---- Tiny JSON "database" (swap for MongoDB/PostgreSQL later) ----
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const RESET_EXPIRY_MS = 15 * 60 * 1000;

function resetUrl(token) {
  const base = String(process.env.APP_URL || "").replace(/\/$/, "");
  return `${base || "http://localhost:" + (process.env.PORT || 5000)}?reset=${encodeURIComponent(token)}`;
}
async function sendResetEmail(user, url) {
  const { RESEND_API_KEY, RESEND_FROM } = process.env;

  if (!RESEND_API_KEY) {
    console.warn("[auth] RESEND_API_KEY is not configured.");
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM || "onboarding@resend.dev",
      to: [user.email],
      subject: "Reset your Huddle password",
      text: `Use this link to reset your Huddle password. It expires in 15 minutes:\n\n${url}`,
      html: `<p>Use the link below to reset your Huddle password. It expires in 15 minutes.</p><p><a href="${url}">Reset password</a></p>`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error: ${response.status} ${errorText}`);
  }

  return true;
}
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---- Helpers ----
function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: "12h",
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

// Express middleware for protected routes
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = token && verifyToken(token);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  next();
}

// ---- Routes ----
const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({ error: "Name must be 2-40 characters" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (password.length < 8 || password.length > 100) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const users = loadUsers();
  if (users.some((u) => u.email === email)) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post("/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const generic = { message: "If an account exists for that email, a password reset link has been sent." };
  if (!EMAIL_RE.test(email)) return res.json(generic);

  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return res.json(generic);

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.resetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  user.resetTokenExpiresAt = Date.now() + RESET_EXPIRY_MS;
  saveUsers(users);

  const url = resetUrl(rawToken);
  try {
    await sendResetEmail(user, url);
  } catch (err) {
    console.error("[auth] Failed to send password reset email:", err.message);
  }

  // In development, the link is also returned so the feature can be tested without SMTP.
  if (!process.env.SMTP_HOST) return res.json({ ...generic, devResetUrl: url });
  return res.json(generic);
});

router.post("/reset-password", async (req, res) => {
  const token = String(req.body.token || "");
  const password = String(req.body.password || "");
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Invalid or expired reset link" });
  if (password.length < 8 || password.length > 100) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const users = loadUsers();
  const user = users.find((u) => u.resetTokenHash === hash && Number(u.resetTokenExpiresAt) > Date.now());
  if (!user) return res.status(400).json({ error: "Invalid or expired reset link" });

  user.passwordHash = await bcrypt.hash(password, 12);
  delete user.resetTokenHash;
  delete user.resetTokenExpiresAt;
  saveUsers(users);
  res.json({ message: "Password reset successful. You can now log in." });
});

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = loadUsers().find((u) => u.email === email);
  // Same error for unknown email / wrong password so accounts can't be enumerated
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Incorrect email or password" });

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email } });
});

module.exports = { router, verifyToken, requireAuth };
