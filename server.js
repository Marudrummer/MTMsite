const path = require("path");
const fs = require("fs");
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const { pool } = require("./src/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const storageDb = require("./storage_db");
let nodemailer = null;
try {
  // Optional dependency for comment notifications
  nodemailer = require("nodemailer");
} catch (err) {
  nodemailer = null;
}
const SITE_PATH = path.join(__dirname, "db", "site.json");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_BOOTSTRAP_USERNAME = process.env.ADMIN_BOOTSTRAP_USERNAME || "";
const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
const ADMIN_BOOTSTRAP_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || "";
const ADMIN_LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 10
};
const adminLoginAttemptsByIp = new Map();
const EMAIL_ENABLED = Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || "5500000000000";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const SEO_CANONICAL_BASE = "https://www.mtmsolution.com.br";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STORAGE_BUCKET_BRIEFINGS = process.env.SUPABASE_STORAGE_BUCKET_BRIEFINGS || "briefings";
const UPLOAD_MAX_FILES = Number(process.env.UPLOAD_MAX_FILES || 5);
const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB || 25);
const ENABLE_CLIENT_CONFIRMATION_EMAIL = (process.env.ENABLE_CLIENT_CONFIRMATION_EMAIL || "true") !== "false";
const MATERIALS_BUCKET = process.env.MATERIALS_BUCKET || "materials";
const MATERIALS_SIGNED_URL_TTL = Number(process.env.MATERIALS_SIGNED_URL_TTL || 600);
const DOWNLOAD_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };
const downloadAttemptsByIp = new Map();

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const {
  getPosts,
  getPostBySlug,
  getPostById,
  slugExists,
  insertPost,
  updatePost,
  deletePost,
  getCommentsByPostSlug,
  getPendingComments,
  getApprovedComments,
  getPendingCount,
  insertComment,
  updateComment,
  deleteComment
} = storageDb;

const mailer = EMAIL_ENABLED
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function getForwardedHost(req) {
  const forwardedHost = req.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.trim()) {
    return forwardedHost.split(",")[0].trim();
  }
  if (Array.isArray(forwardedHost) && forwardedHost.length) {
    return String(forwardedHost[0]).trim();
  }
  return req.get("host") || "";
}

function getForwardedProto(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.split(",")[0].trim().toLowerCase();
  }
  if (Array.isArray(forwardedProto) && forwardedProto.length) {
    return String(forwardedProto[0]).trim().toLowerCase();
  }
  return (req.protocol || "http").toLowerCase();
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isIndexablePublicPath(pathname) {
  if (pathname.startsWith("/admin")) return false;
  if (pathname.startsWith("/api")) return false;
  if (pathname === "/login" || pathname === "/logout" || pathname === "/lead-rapido" || pathname === "/perfil") return false;
  if (pathname.startsWith("/materiais")) return false;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return false;
  if (
    pathname === "/" ||
    pathname === "/sobre" ||
    pathname === "/servicos" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname === "/contato"
  ) {
    return true;
  }
  return false;
}

app.use((req, res, next) => {
  const hostRaw = getForwardedHost(req).toLowerCase();
  const host = hostRaw.split(":")[0];
  const proto = getForwardedProto(req);
  if (isLocalHost(host)) return next();
  if (host === "mtmsolution.com.br" || host === "www.mtmsolution.com.br") {
    if (host !== "www.mtmsolution.com.br" || proto !== "https") {
      return res.redirect(301, `${SEO_CANONICAL_BASE}${req.originalUrl}`);
    }
  }
  return next();
});

app.use(async (req, res, next) => {
  try {
    res.locals.pendingCount = isAnyAdmin(req) ? await getPendingCount() : 0;
  } catch (err) {
    console.error("Pending count failed:", err && err.message ? err.message : err);
    res.locals.pendingCount = 0;
  }
  res.locals.whatsappPhone = WHATSAPP_PHONE;
  res.locals.supabaseUrl = SUPABASE_URL;
  res.locals.supabaseAnonKey = SUPABASE_ANON_KEY;
  res.locals.briefingsBucket = SUPABASE_STORAGE_BUCKET_BRIEFINGS;
  res.locals.uploadMaxFiles = UPLOAD_MAX_FILES;
  res.locals.uploadMaxMb = UPLOAD_MAX_MB;
  res.locals.enableClientConfirmationEmail = ENABLE_CLIENT_CONFIRMATION_EMAIL;
  const reqPath = req.path || "/";
  res.locals.canonicalUrl = `${SEO_CANONICAL_BASE}${reqPath}`;
  res.locals.robotsMeta = isIndexablePublicPath(reqPath) ? "index, follow" : "noindex, nofollow";
  next();
});

setTimeout(() => {
  ensureBootstrapAdmin();
}, 500);

if (!fs.existsSync(SITE_PATH)) {
  fs.writeFileSync(
    SITE_PATH,
    JSON.stringify(
      {
        stats: [
          { value: "12+", label: "Projetos entregues em espaços culturais e eventos." },
          { value: "24/7", label: "Operação contínua com monitoramento remoto." },
          { value: "3x", label: "Mais interação do público em ativações imersivas." }
        ],
        cases: [
          {
            title: "Galeria Sensorial",
            description: "Instalação imersiva com sensores de movimento e projeção mapeada.",
            meta: "Engajamento +32% • 8 min por visita"
          },
          {
            title: "Totem Inteligente",
            description: "Atendimento automatizado com IA para eventos e espaços públicos.",
            meta: "Fila -41% • Atualização remota"
          },
          {
            title: "Jogo Educacional",
            description: "Experiência lúdica com visão computacional para museus.",
            meta: "Retenção +27% • Feedback instantâneo"
          }
        ]
      },
      null,
      2
    )
  );
}
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function loadSiteData() {
  return JSON.parse(fs.readFileSync(SITE_PATH, "utf8"));
}

function normalizeVideoUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  const ytEmbed = trimmed.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
  if (ytEmbed) return trimmed;
  const vimeoMatch = trimmed.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return trimmed;
}

function getCardImage(post) {
  if (post.image_url) return post.image_url;
  const yt = post.video_url && post.video_url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
  return "/img/projeto-1.jpg";
}

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

async function ensureUniqueSlug(title, requestedSlug) {
  const base = slugify(requestedSlug || title);
  if (!base) return `post-${Date.now()}`;
  let slug = base;
  let counter = 2;
  while (await slugExists(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

async function ensureUniqueSlugForUpdate(title, requestedSlug, excludeId) {
  const base = slugify(requestedSlug || title);
  if (!base) return `post-${Date.now()}`;
  let slug = base;
  let counter = 2;
  while (await slugExists(slug, excludeId)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

function isAnyAdmin(req) {
  return Boolean(req.cookies && req.cookies.mtm_admin_session);
}

const roleRank = {
  reader: 1,
  editor: 2,
  admin: 3,
  super_admin: 4
};

function canEditProfiles(role) {
  return role === "editor" || role === "admin" || role === "super_admin";
}

function canDeleteProfiles(role) {
  return role === "super_admin";
}

async function adminQuery(sql, params) {
  if (!pool) throw new Error("DATABASE_URL not configured.");
  return pool.query(sql, params);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeFilename(name) {
  return String(name || "arquivo")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  } catch (err) {
    return null;
  }
}

function decodeJwtSub(token) {
  const payload = decodeJwtPayload(token);
  return payload && payload.sub ? payload.sub : null;
}

function consumeDownloadRateLimit(ip) {
  const now = Date.now();
  let entry = downloadAttemptsByIp.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + DOWNLOAD_RATE_LIMIT.windowMs };
  }
  entry.count += 1;
  downloadAttemptsByIp.set(ip, entry);
  return entry;
}

function isStrongPassword(value) {
  const text = String(value || "");
  if (text.length < 12) return false;
  return /[A-Za-z]/.test(text) && /\d/.test(text);
}

function parsePublishAt(input) {
  if (!input) return null;
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "";
}

function consumeAdminRateLimit(ip) {
  const now = Date.now();
  let entry = adminLoginAttemptsByIp.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + ADMIN_LOGIN_RATE_LIMIT.windowMs };
  }
  entry.count += 1;
  adminLoginAttemptsByIp.set(ip, entry);
  return entry;
}

function isAdminRateLimited(ip) {
  const entry = adminLoginAttemptsByIp.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    adminLoginAttemptsByIp.delete(ip);
    return false;
  }
  return entry.count > ADMIN_LOGIN_RATE_LIMIT.max;
}

async function getAdminFromSession(token) {
  if (!token) return null;
  const sessionHash = hashToken(token);
  const { rows } = await adminQuery(
    `SELECT a.*, s.csrf_token\n     FROM admin_sessions s\n     JOIN admin_accounts a ON a.id = s.admin_id\n     WHERE s.session_hash = $1 AND s.expires_at > now() AND a.is_active = true\n     LIMIT 1`,
    [sessionHash]
  );
  return rows[0] || null;
}

async function createAdminSession(adminId) {
  const token = crypto.randomBytes(32).toString("hex");
  const sessionHash = hashToken(token);
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
  await adminQuery(
    "INSERT INTO admin_sessions (session_hash, csrf_token, admin_id, expires_at) VALUES ($1,$2,$3,$4)",
    [sessionHash, csrfToken, adminId, expiresAt.toISOString()]
  );
  return { token, csrfToken, expiresAt };
}

function requireAdmin(minRole = "reader") {
  return async (req, res, next) => {
    const token = req.cookies && req.cookies.mtm_admin_session;
    const adminUser = await getAdminFromSession(token);
    if (adminUser && roleRank[adminUser.role] >= roleRank[minRole]) {
      req.admin = adminUser;
      req.adminSession = { csrf_token: adminUser.csrf_token };
      res.locals.adminRole = adminUser.role;
      res.locals.adminEmail = adminUser.email;
      res.locals.adminCsrf = adminUser.csrf_token;
      return next();
    }

    if (token) {
      res.clearCookie("mtm_admin_session", { path: "/admin" });
    }
    return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl || "/admin")}`);
  };
}

function requireAdminCsrf(req, res, next) {
  const token = req.body && req.body.csrf_token;
  if (!token || token !== res.locals.adminCsrf) {
    res.clearCookie("mtm_admin_session", { path: "/admin" });
    return res.status(403).render("admin_login", {
      error: "Sessão expirada. Faça login novamente.",
      next: req.originalUrl || "/admin"
    });
  }
  return next();
}

async function logAudit(actorAdminId, action, entityType, entityId, metadata = {}) {
  try {
    await adminQuery(
      "INSERT INTO audit_logs (actor_admin_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)",
      [actorAdminId || null, action, entityType || null, entityId || null, metadata]
    );
  } catch (err) {
    console.error("Audit log failed:", err && err.message ? err.message : err);
  }
}

function buildProfileLoginFilters(query, alias = "") {
  const where = [];
  const params = [];
  let idx = 1;
  const prefix = alias ? `${alias}.` : "";
  if (query.provider && query.provider !== "all") {
    where.push(`${prefix}provider = $${idx++}`);
    params.push(query.provider);
  }
  if (query.from) {
    where.push(`${prefix}created_at >= $${idx++}`);
    params.push(query.from);
  }
  if (query.to) {
    where.push(`${prefix}created_at <= $${idx++}`);
    params.push(query.to);
  }
  if (query.q) {
    where.push(`(${prefix}email ILIKE $${idx})`);
    params.push(`%${query.q}%`);
    idx += 1;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { clause, params };
}

async function ensureBootstrapAdmin() {
  if (!ADMIN_BOOTSTRAP_USERNAME || !ADMIN_BOOTSTRAP_PASSWORD) return;
  if (!isStrongPassword(ADMIN_BOOTSTRAP_PASSWORD)) {
    console.warn("Bootstrap admin password fraca. Use 12+ caracteres com letras e números.");
    return;
  }
  try {
    const { rows } = await adminQuery("SELECT COUNT(*)::int AS count FROM admin_accounts");
    if (rows[0] && rows[0].count > 0) return;
    const hash = await bcrypt.hash(ADMIN_BOOTSTRAP_PASSWORD, 10);
    await adminQuery(
      "INSERT INTO admin_accounts (username, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,true)",
      [ADMIN_BOOTSTRAP_USERNAME, ADMIN_BOOTSTRAP_EMAIL || null, hash, "super_admin"]
    );
    console.log("Bootstrap admin created for", ADMIN_BOOTSTRAP_USERNAME);
  } catch (err) {
    console.error("Bootstrap admin failed:", err && err.message ? err.message : err);
  }
}

function requireUserAuth(req, res, next) {
  const token = req.cookies && req.cookies.mtm_access_token;
  if (!token) {
    const nextUrl = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(`/login?next=${nextUrl}`);
  }
  return next();
}

function getProviderFromPayload(payload) {
  const providerRaw = (payload.app_metadata && payload.app_metadata.provider) || null;
  if (providerRaw) {
    return providerRaw === "email" ? "magiclink" : providerRaw;
  }
  return "magiclink";
}

function normalizePhoneBR(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  let normalized = digits;
  if (normalized.startsWith("55")) {
    normalized = normalized.slice(2);
  }
  if (normalized.length !== 10 && normalized.length !== 11) return null;
  return `+55${normalized}`;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^=+/, "");
}

function isValidEmail(value) {
  const text = String(value || "").trim();
  return Boolean(text && /.+@.+\..+/.test(text));
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [user, domain] = normalized.split("@");
  if (!user || !domain) return "";
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

async function getLeadByProfileOrEmail(profileId, email) {
  const { rows } = await adminQuery(
    "SELECT * FROM leads WHERE profile_id = $1 OR email = $2 LIMIT 1",
    [profileId, email]
  );
  return rows[0] || null;
}

function isLeadComplete(lead) {
  return Boolean(lead && lead.name && lead.company && lead.phone_e164);
}

function resolveLeadSource(current, incoming) {
  if (!incoming || incoming === "login") return current || "login";
  if (!current || current === "login") return incoming;
  if (current === incoming) return current;
  return "ambos";
}

function buildLeadFilters(query) {
  const where = [];
  const params = [];
  let idx = 1;
  if (query.status && query.status !== "all") {
    where.push(`crm_status = $${idx++}`);
    params.push(query.status);
  }
  if (query.provider && query.provider !== "all") {
    where.push(`provider = $${idx++}`);
    params.push(query.provider);
  }
  if (query.source && query.source !== "all") {
    where.push(`source = $${idx++}`);
    params.push(query.source);
  }
  if (query.urgency && query.urgency !== "all") {
    where.push(`urgency = $${idx++}`);
    params.push(query.urgency);
  }
  if (query.next_action_type && query.next_action_type !== "all") {
    where.push(`next_action_type = $${idx++}`);
    params.push(query.next_action_type);
  }
  if (query.overdue === "1") {
    where.push(`next_action_at IS NOT NULL AND next_action_at < now()`);
  }
  if (query.from) {
    where.push(`created_at >= $${idx++}`);
    params.push(query.from);
  }
  if (query.to) {
    where.push(`created_at <= $${idx++}`);
    params.push(query.to);
  }
  if (query.q) {
    where.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR company ILIKE $${idx} OR phone_e164 ILIKE $${idx})`);
    params.push(`%${query.q}%`);
    idx += 1;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { clause, params };
}

function buildBriefingFilters(query) {
  const where = [];
  const params = [];
  let idx = 1;
  if (query.status && query.status !== "all") {
    where.push(`status = $${idx++}`);
    params.push(query.status);
  }
  if (query.source && query.source !== "all") {
    where.push(`source = $${idx++}`);
    params.push(query.source);
  }
  if (query.from) {
    where.push(`created_at >= $${idx++}`);
    params.push(query.from);
  }
  if (query.to) {
    where.push(`created_at <= $${idx++}`);
    params.push(query.to);
  }
  if (query.q) {
    where.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx} OR city ILIKE $${idx} OR idea ILIKE $${idx})`);
    params.push(`%${query.q}%`);
    idx += 1;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { clause, params };
}

function resolveAdminDateRange(query) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let from = query.from ? new Date(query.from) : defaultFrom;
  let to = query.to ? new Date(query.to) : now;
  if (Number.isNaN(from.getTime())) from = defaultFrom;
  if (Number.isNaN(to.getTime())) to = now;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return { from, to, fromIso, toIso };
}

async function requireLeadComplete(req, res, next) {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub || !payload.email) {
    const nextUrl = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(`/login?next=${nextUrl}`);
  }
  const lead = await getLeadByProfileOrEmail(payload.sub, payload.email);
  const src = req.path === "/materiais"
    ? "materiais"
    : (req.path === "/nao-sabe" || req.path === "/diagnostico")
      ? "nao-sabe"
      : "login";
  if (!isLeadComplete(lead)) {
    const nextUrl = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(`/lead-rapido?next=${nextUrl}&src=${encodeURIComponent(src)}`);
  }
  if (lead && src !== "login") {
    const nextSource = resolveLeadSource(lead.source, src);
    if (nextSource !== lead.source) {
      await adminQuery("UPDATE leads SET source = $1, updated_at = now() WHERE id = $2", [nextSource, lead.id]);
    }
  }
  return next();
}

app.post("/api/pending-profile", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim().slice(0, 120);
  const company = String(req.body.company || "").trim().slice(0, 120);
  const phone = String(req.body.phone || "").trim().slice(0, 40);
  if (!email || !name || !company || !phone) {
    return res.status(400).json({ error: "Dados incompletos." });
  }
  await adminQuery(
    `INSERT INTO pending_profiles (email, name, company, phone, created_at, updated_at, expires_at)
     VALUES ($1,$2,$3,$4, now(), now(), now() + interval '7 days')
     ON CONFLICT (email)
     DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company, phone = EXCLUDED.phone,
                   updated_at = now(), expires_at = now() + interval '7 days'`,
    [email, name, company, phone]
  );
  res.json({ ok: true });
}));

app.post("/api/profile/complete", asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub || !payload.email) {
    return res.status(401).json({ error: "Não autenticado." });
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const userId = payload.sub;
  const providerFromTokenRaw = (payload.app_metadata && payload.app_metadata.provider) || null;
  const providerFromToken = providerFromTokenRaw === "email" ? "magiclink" : providerFromTokenRaw;
  const provider = providerFromToken || String(req.body.provider || "").trim() || null;
  const nameInput = String(req.body.name || "").trim();
  const companyInput = String(req.body.company || "").trim();
  const phoneInput = String(req.body.phone || "").trim();

  const { rows } = await adminQuery(
    "SELECT name, company, phone FROM pending_profiles WHERE email = $1 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1",
    [email]
  );
  const pending = rows[0];
  const name = pending && pending.name ? pending.name : (nameInput || null);
  const company = pending && pending.company ? pending.company : (companyInput || null);
  const phone = pending && pending.phone ? pending.phone : (phoneInput || null);

  await adminQuery(
    `INSERT INTO profiles (id, email, name, company, phone, provider, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (id)
     DO UPDATE SET
       name = COALESCE(EXCLUDED.name, profiles.name),
       company = COALESCE(EXCLUDED.company, profiles.company),
       phone = COALESCE(EXCLUDED.phone, profiles.phone),
       provider = COALESCE(EXCLUDED.provider, profiles.provider),
       updated_at = now()`,
    [userId, email, name || null, company || null, phone || null, provider]
  );

  if (pending) {
    await adminQuery("DELETE FROM pending_profiles WHERE email = $1", [email]);
  }

  res.json({ ok: true });
}));

app.post("/api/profile/login-event", asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub || !payload.email) {
    return res.status(401).json({ error: "Não autenticado." });
  }

  const providerFromTokenRaw = (payload.app_metadata && payload.app_metadata.provider) || null;
  const providerFromToken = providerFromTokenRaw === "email" ? "magiclink" : providerFromTokenRaw;
  const provider = providerFromToken || String(req.body.provider || "").trim() || null;
  const ip = getClientIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 512);

  try {
    await adminQuery(
      `INSERT INTO profile_logins (profile_id, email, provider, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [payload.sub, payload.email, provider, ip || null, userAgent || null]
    );
  } catch (err) {
    console.error("Login event failed:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "Falha ao registrar login." });
  }

  res.json({ ok: true });
}));

app.get("/auth/need-lead", requireUserAuth, asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub || !payload.email) {
    return res.status(401).json({ error: "Não autenticado." });
  }
  const lead = await getLeadByProfileOrEmail(payload.sub, payload.email);
  res.json({ needLead: !isLeadComplete(lead) });
}));

app.get("/lead-rapido", requireUserAuth, asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  const email = payload && payload.email ? String(payload.email) : "";
  const next = req.query.next || "/materiais";
  res.render("lead_rapido", {
    email,
    next,
    src: req.query.src || "login",
    error: null,
    values: { name: "", company: "", phone: "" }
  });
}));

app.post("/lead-rapido", requireUserAuth, asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub || !payload.email) {
    return res.status(401).json({ error: "Não autenticado." });
  }
  const email = String(payload.email || "").trim().toLowerCase();
  const profileId = payload.sub;
  const provider = getProviderFromPayload(payload);
  const name = String(req.body.name || "").trim().slice(0, 120);
  const company = String(req.body.company || "").trim().slice(0, 120);
  const phoneRaw = String(req.body.phone || "").trim();
  const phoneE164 = normalizePhoneBR(phoneRaw);
  const next = req.body.next || "/materiais";
  const src = String(req.body.src || "login");

  if (!name || !company || !phoneE164) {
    return res.status(400).render("lead_rapido", {
      email,
      next,
      src,
      error: "Preencha nome, empresa e WhatsApp válidos.",
      values: { name, company, phone: phoneRaw }
    });
  }

  const existingPhone = await adminQuery(
    "SELECT email FROM leads WHERE phone_e164 = $1 AND email <> $2 LIMIT 1",
    [phoneE164, email]
  );
  if (existingPhone.rows[0]) {
    return res.status(400).render("lead_rapido", {
      email,
      next,
      src,
      error: "Esse WhatsApp já está vinculado a outro cadastro. Fale conosco pelo WhatsApp.",
      values: { name, company, phone: phoneRaw }
    });
  }

  const lead = await getLeadByProfileOrEmail(profileId, email);
  const source = resolveLeadSource(lead && lead.source, src);

  const { rows } = await adminQuery(
    `INSERT INTO leads (profile_id, email, name, company, phone_e164, provider, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (profile_id)
     DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       company = EXCLUDED.company,
       phone_e164 = EXCLUDED.phone_e164,
       provider = EXCLUDED.provider,
       source = EXCLUDED.source,
       updated_at = now()
     RETURNING id`,
    [profileId, email, name, company, phoneE164, provider, source]
  );
  const leadId = rows[0] && rows[0].id;
  await adminQuery(
    "INSERT INTO lead_events (lead_id, event_type, metadata) VALUES ($1,$2,$3)",
    [leadId, lead ? "updated" : "created", { source }]
  );
  await logAudit(null, "lead_created", "leads", leadId || null, { source });

  res.redirect(next);
}));

app.get("/", asyncHandler(async (req, res) => {
  const posts = (await getPosts()).slice(0, 3).map((p) => ({ ...p, card_image: getCardImage(p) }));
  const site = loadSiteData();
  res.render("home", { posts, stats: site.stats || [], cases: site.cases || [] });
}));

app.get("/sobre", (req, res) => res.render("sobre"));
app.get("/servicos", (req, res) => res.render("servicos"));
app.get("/logout", (req, res) => {
  res.clearCookie("mtm_access_token", { path: "/" });
  res.redirect("/");
});
app.get("/materiais", requireUserAuth, requireLeadComplete, asyncHandler(async (req, res) => {
  const { rows } = await adminQuery(
    `SELECT id, title, description, tags, filename, size_bytes, created_at
     FROM materials
     WHERE is_published = true OR (publish_at IS NOT NULL AND publish_at <= now())
     ORDER BY created_at DESC`
  );
  res.render("materiais", { materials: rows || [] });
}));

app.get("/materiais/:id/download", requireUserAuth, requireLeadComplete, asyncHandler(async (req, res) => {
  if (!supabaseAdmin) return res.status(500).send("Storage não configurado.");
  const { rows } = await adminQuery(
    `SELECT * FROM materials
     WHERE id = $1 AND (is_published = true OR (publish_at IS NOT NULL AND publish_at <= now()))
     LIMIT 1`,
    [req.params.id]
  );
  const material = rows[0];
  if (!material) return res.status(404).render("404");

  const ip = getClientIp(req);
  const rateEntry = consumeDownloadRateLimit(ip);
  if (rateEntry.count > DOWNLOAD_RATE_LIMIT.max) {
    return res.status(429).send("Muitas solicitações. Tente novamente em alguns minutos.");
  }

  const { data, error } = await supabaseAdmin.storage
    .from(material.storage_bucket || MATERIALS_BUCKET)
    .createSignedUrl(material.storage_path, MATERIALS_SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return res.status(500).send("Não foi possível gerar o download.");

  const profileId = decodeJwtSub(req.cookies && req.cookies.mtm_access_token);
  await adminQuery(
    "INSERT INTO material_downloads (material_id, profile_id) VALUES ($1,$2)",
    [material.id, profileId || null]
  );
  res.redirect(data.signedUrl);
}));
app.get("/login", (req, res) => res.render("login"));
app.get("/perfil", (req, res) => res.redirect("/"));
app.get("/blog", asyncHandler(async (req, res) => {
  const posts = (await getPosts()).map((p) => ({ ...p, card_image: getCardImage(p) }));
  res.render("lab", { posts });
}));

app.get("/blog/:slug", asyncHandler(async (req, res) => {
  const post = await getPostBySlug(req.params.slug);
  if (!post) return res.status(404).render("404");
  const comments = await getCommentsByPostSlug(req.params.slug);
  res.render("post", { post, comments, whatsappPhone: WHATSAPP_PHONE });
}));

app.get("/lab", (req, res) => res.redirect(301, "/blog"));
app.get("/lab/:slug", (req, res) => res.redirect(301, `/blog/${req.params.slug}`));

app.get("/sitemap.xml", asyncHandler(async (req, res) => {
  const baseUrl = "https://www.mtmsolution.com.br";
  const staticUrls = ["/", "/sobre", "/servicos", "/blog", "/contato"];
  const posts = await getPosts();
  const urls = [
    ...staticUrls.map((path) => `${baseUrl}${path}`),
    ...posts.map((post) => `${baseUrl}/blog/${post.slug}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n") +
    `\n</urlset>`;
  res.type("application/xml").send(xml);
}));

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nAllow: /\n\nSitemap: https://www.mtmsolution.com.br/sitemap.xml\n");
});

app.get("/contato", (req, res) => {
  const preset = {
    assunto: req.query.assunto || "",
    mensagem: req.query.mensagem || ""
  };
  res.render("contato", { preset });
});

app.get("/diagnostico", requireUserAuth, requireLeadComplete, (req, res) => {
  res.render("diagnostico", { sent: req.query.sent === "1" });
});

app.get("/nao-sabe", (req, res) => {
  res.redirect("/diagnostico");
});

app.post("/briefings/:id/attachments", requireUserAuth, requireLeadComplete, asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_access_token;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.email) {
    return res.status(401).json({ error: "Não autenticado." });
  }
  const briefingId = String(req.params.id || "").trim();
  const email = normalizeEmail(payload.email);
  const profileId = payload.sub || null;
  const {
    file_name,
    mime_type,
    file_size,
    storage_bucket,
    storage_path,
    public_url
  } = req.body || {};

  const allowedTypes = [
    "application/pdf",
    "text/plain",
    "image/png",
    "image/jpeg",
    "image/webp",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/wav"
  ];

  if (!briefingId || !file_name || !mime_type || !storage_path || !public_url) {
    return res.status(400).json({ error: "Dados incompletos." });
  }
  if (!allowedTypes.includes(String(mime_type))) {
    return res.status(400).json({ error: "Tipo de arquivo não permitido." });
  }
  const sizeNumber = Number(file_size || 0);
  if (!Number.isFinite(sizeNumber) || sizeNumber <= 0) {
    return res.status(400).json({ error: "Tamanho inválido." });
  }
  if (sizeNumber > UPLOAD_MAX_MB * 1024 * 1024) {
    return res.status(400).json({ error: "Arquivo acima do limite." });
  }
  if (storage_bucket !== SUPABASE_STORAGE_BUCKET_BRIEFINGS) {
    return res.status(400).json({ error: "Bucket inválido." });
  }
  if (!String(storage_path).startsWith(`briefings/${briefingId}/`)) {
    return res.status(400).json({ error: "Caminho inválido." });
  }

  const { rows } = await adminQuery(
    "SELECT id, email, profile_id FROM briefings WHERE id = $1 LIMIT 1",
    [briefingId]
  );
  const briefing = rows[0];
  if (!briefing) {
    return res.status(404).json({ error: "Briefing não encontrado." });
  }
  if (briefing.profile_id && profileId && briefing.profile_id !== profileId) {
    return res.status(403).json({ error: "Acesso negado." });
  }
  if (!briefing.profile_id && normalizeEmail(briefing.email) !== email) {
    return res.status(403).json({ error: "Acesso negado." });
  }

  await adminQuery(
    `INSERT INTO briefing_attachments
     (briefing_id, file_name, mime_type, file_size, storage_bucket, storage_path, public_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      briefingId,
      String(file_name).trim(),
      String(mime_type).trim(),
      sizeNumber,
      String(storage_bucket).trim(),
      String(storage_path).trim(),
      String(public_url).trim()
    ]
  );

  res.json({ ok: true });
}));

app.get("/admin/login", asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_admin_session;
  const adminUser = await getAdminFromSession(token);
  if (adminUser) return res.redirect("/admin");
  if (token) {
    res.clearCookie("mtm_admin_session", { path: "/admin" });
  }
  res.render("admin_login", { error: null, next: req.query.next || "" });
}));

app.post("/admin/login", asyncHandler(async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) {
    return res.render("admin_login", { error: "Não foi possível entrar. Verifique os dados.", next: req.body.next || "" });
  }
  const ip = getClientIp(req);
  const rateEntry = consumeAdminRateLimit(ip);
  if (rateEntry.count > ADMIN_LOGIN_RATE_LIMIT.max) {
    return res.status(429).render("admin_login", { error: "Muitas tentativas. Aguarde alguns minutos.", next: req.body.next || "" });
  }
  const { rows } = await adminQuery(
    "SELECT * FROM admin_accounts WHERE username = $1 LIMIT 1",
    [username]
  );
  const admin = rows[0];
  if (!admin || !admin.is_active) {
    await logAudit(null, "admin_login_failed", "admin_accounts", username, { ip, reason: "not_found_or_inactive" });
    return res.render("admin_login", { error: "Não foi possível entrar. Verifique os dados.", next: req.body.next || "" });
  }
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    await logAudit(admin.id, "admin_login_failed", "admin_accounts", admin.id, { ip, reason: "locked" });
    return res.render("admin_login", { error: "Não foi possível entrar. Tente novamente em alguns minutos.", next: req.body.next || "" });
  }
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    const failedCount = Number(admin.failed_login_count || 0) + 1;
    let lockedUntil = null;
    if (failedCount >= 5) {
      lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await logAudit(admin.id, "admin_lockout_triggered", "admin_accounts", admin.id, { ip, failedCount });
    }
    await adminQuery(
      "UPDATE admin_accounts SET failed_login_count = $1, last_failed_login_at = now(), locked_until = $2 WHERE id = $3",
      [failedCount, lockedUntil ? lockedUntil.toISOString() : null, admin.id]
    );
    await logAudit(admin.id, "admin_login_failed", "admin_accounts", admin.id, { ip, reason: "bad_password" });
    return res.render("admin_login", { error: "Não foi possível entrar. Verifique os dados.", next: req.body.next || "" });
  }
  await adminQuery(
    "UPDATE admin_accounts SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL WHERE id = $1",
    [admin.id]
  );
  adminLoginAttemptsByIp.delete(ip);
  const session = await createAdminSession(admin.id);
  res.cookie("mtm_admin_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: session.expiresAt.getTime() - Date.now()
  });
  await logAudit(admin.id, "admin_login_success", "admin_accounts", admin.id, { ip });
  const nextUrl = req.body.next || "/admin";
  res.redirect(nextUrl);
}));

app.post("/admin/logout", requireAdmin("reader"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.mtm_admin_session;
  if (token) {
    const sessionHash = hashToken(token);
    await adminQuery("DELETE FROM admin_sessions WHERE session_hash = $1", [sessionHash]);
  }
  await logAudit(req.admin && req.admin.id, "admin_logout", "admin_accounts", req.admin && req.admin.id);
  res.clearCookie("mtm_admin_session", { path: "/admin" });
  res.redirect("/admin/login");
}));

app.get("/admin", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const posts = await getPosts();
  const pendingComments = await getPendingComments();
  const approvedComments = await getApprovedComments();
  res.render("admin", { posts, pendingComments, approvedComments });
}));

app.get("/admin/posts/:id/edit", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const post = await getPostById(req.params.id);
  if (!post) return res.status(404).render("404");
  res.render("admin_edit", { post });
}));

app.get("/admin/users", requireAdmin("admin"), asyncHandler(async (req, res) => {
  const { rows } = await adminQuery("SELECT * FROM admin_accounts ORDER BY created_at DESC");
  res.render("admin_users", { admins: rows || [] });
}));

app.post("/admin/users", requireAdmin("admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim();
  const role = String(req.body.role || "reader").trim();
  const password = String(req.body.password || "");
  if (!username || !password) {
    return res.redirect("/admin/users");
  }
  if (!roleRank[role]) return res.redirect("/admin/users");
  const hash = await bcrypt.hash(password, 10);
  await adminQuery(
    "INSERT INTO admin_accounts (username, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,true)",
    [username, email || null, hash, role]
  );
  await logAudit(req.admin && req.admin.id, "create_admin", "admin_accounts", username, { role });
  res.redirect("/admin/users");
}));

app.post("/admin/users/:id", requireAdmin("admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const role = String(req.body.role || "").trim();
  const isActive = req.body.is_active === "true";
  const password = String(req.body.password || "");
  const updates = [];
  const params = [];
  let idx = 1;
  if (role && roleRank[role]) {
    updates.push(`role = $${idx++}`);
    params.push(role);
  }
  updates.push(`is_active = $${idx++}`);
  params.push(isActive);
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    updates.push(`password_hash = $${idx++}`);
    params.push(hash);
  }
  updates.push(`updated_at = now()`);
  params.push(req.params.id);
  if (updates.length > 0) {
    await adminQuery(`UPDATE admin_accounts SET ${updates.join(", ")} WHERE id = $${idx}`, params);
  }
  if (!isActive) {
    await adminQuery("DELETE FROM admin_sessions WHERE admin_id = $1", [req.params.id]);
    await logAudit(req.admin && req.admin.id, "admin_session_revoked", "admin_accounts", req.params.id, { reason: "deactivated" });
  }
  await logAudit(req.admin && req.admin.id, "update_admin", "admin_accounts", req.params.id, { role, isActive });
  res.redirect("/admin/users");
}));

app.post("/admin/users/:id/delete", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await adminQuery("DELETE FROM admin_sessions WHERE admin_id = $1", [req.params.id]);
  await logAudit(req.admin && req.admin.id, "admin_session_revoked", "admin_accounts", req.params.id, { reason: "deleted" });
  await adminQuery("DELETE FROM admin_accounts WHERE id = $1", [req.params.id]);
  await logAudit(req.admin && req.admin.id, "delete_admin", "admin_accounts", req.params.id);
  res.redirect("/admin/users");
}));

app.get("/admin/profiles", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = 30;
  const offset = (page - 1) * perPage;
  const filters = {
    provider: req.query.provider || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildProfileLoginFilters(filters, "l");
  const countResult = await adminQuery(
    `SELECT COUNT(*)::int AS count FROM profile_logins l ${clause}`,
    params
  );
  const total = countResult.rows[0]?.count || 0;
  const rowsResult = await adminQuery(
    `SELECT l.id, l.profile_id, l.email, l.provider, l.ip, l.user_agent, l.created_at
     FROM profile_logins l
     ${clause}
     ORDER BY l.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  res.render("admin_profiles", {
    profiles: rowsResult.rows || [],
    filters,
    page,
    total,
    perPage
  });
}));

app.post("/admin/profiles/delete-selected", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const ids = []
    .concat(req.body.ids || [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  if (ids.length) {
    await adminQuery(
      `DELETE FROM profile_logins WHERE id = ANY($1::bigint[])`,
      [ids]
    );
    await logAudit(req.admin && req.admin.id, "profile_logins_deleted", "profile_logins", null, { ids_count: ids.length });
  }
  res.redirect(`/admin/profiles?${new URLSearchParams({
    provider: req.body.provider || "all",
    from: req.body.from || "",
    to: req.body.to || "",
    q: req.body.q || ""
  }).toString()}`);
}));

app.post("/admin/profiles/delete-all", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const filters = {
    provider: req.body.provider || "all",
    from: req.body.from || "",
    to: req.body.to || "",
    q: String(req.body.q || "").trim()
  };
  const { clause, params } = buildProfileLoginFilters(filters, "l");
  const result = await adminQuery(
    `DELETE FROM profile_logins l ${clause} RETURNING id`,
    params
  );
  await logAudit(req.admin && req.admin.id, "profile_logins_deleted_all", "profile_logins", null, { deleted_count: result.rows.length, filters });
  res.redirect(`/admin/profiles?${new URLSearchParams(filters).toString()}`);
}));

app.get("/admin/profiles/export.csv", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    provider: req.query.provider || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildProfileLoginFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, profile_id, email, provider, ip, user_agent, created_at
     FROM profile_logins
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  const header = ["id", "profile_id", "email", "provider", "ip", "user_agent", "created_at"];
  const lines = [header.join(",")];
  rowsResult.rows.forEach((row) => {
    const values = header.map((key) => {
      const value = row[key] === null || row[key] === undefined ? "" : String(row[key]);
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    lines.push(values.join(","));
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=cadastros-logins.csv");
  res.send(lines.join("\n"));
}));

app.get("/admin/profiles/export.json", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    provider: req.query.provider || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildProfileLoginFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, profile_id, email, provider, ip, user_agent, created_at
     FROM profile_logins
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  res.json(rowsResult.rows || []);
}));

app.get("/admin/profiles/:id", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const { rows } = await adminQuery(
    `SELECT id, profile_id, email, provider, ip, user_agent, created_at
     FROM profile_logins
     WHERE id = $1
     LIMIT 1`,
    [req.params.id]
  );
  const login = rows[0];
  if (!login) return res.status(404).render("404");
  await logAudit(req.admin && req.admin.id, "profile_login_viewed", "profile_logins", req.params.id, {});
  res.render("admin_profile_view", { profile: login });
}));

app.get("/admin/leads", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = 30;
  const offset = (page - 1) * perPage;
  const filters = {
    status: req.query.status || "all",
    provider: req.query.provider || "all",
    source: req.query.source || "all",
    urgency: req.query.urgency || "all",
    next_action_type: req.query.next_action_type || "all",
    overdue: req.query.overdue || "",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildLeadFilters(filters);
  const countResult = await adminQuery(
    `SELECT COUNT(*)::int AS count FROM leads ${clause}`,
    params
  );
  const total = countResult.rows[0]?.count || 0;
  const rowsResult = await adminQuery(
    `SELECT id, name, email, company, phone_e164, provider, source, crm_status, urgency,
            next_action_type, next_action_at, created_at, updated_at
     FROM leads
     ${clause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  res.render("admin_leads", {
    leads: rowsResult.rows || [],
    filters,
    page,
    total,
    perPage
  });
}));

app.get("/admin/leads/analytics", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const { from, to, fromIso, toIso } = resolveAdminDateRange(req.query);

  const totalResult = await adminQuery(
    `SELECT COUNT(*)::int AS count
     FROM leads
     WHERE created_at >= $1 AND created_at <= $2`,
    [fromIso, toIso]
  );
  const total = totalResult.rows[0]?.count || 0;

  const statusResult = await adminQuery(
    `SELECT COALESCE(crm_status, 'sem_status') AS key, COUNT(*)::int AS count
     FROM leads
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY 1
     ORDER BY count DESC`,
    [fromIso, toIso]
  );

  const sourceResult = await adminQuery(
    `SELECT COALESCE(source, 'desconhecido') AS key, COUNT(*)::int AS count
     FROM leads
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY 1
     ORDER BY count DESC`,
    [fromIso, toIso]
  );

  const providerResult = await adminQuery(
    `SELECT COALESCE(provider, 'desconhecido') AS key, COUNT(*)::int AS count
     FROM leads
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY 1
     ORDER BY count DESC`,
    [fromIso, toIso]
  );

  const nextActionResult = await adminQuery(
    `SELECT COALESCE(next_action_type, 'sem_acao') AS key, COUNT(*)::int AS count
     FROM leads
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY 1
     ORDER BY count DESC`,
    [fromIso, toIso]
  );

  const overdueResult = await adminQuery(
    `SELECT
        SUM(CASE WHEN next_action_at IS NOT NULL AND next_action_at < now() THEN 1 ELSE 0 END)::int AS overdue,
        SUM(CASE WHEN next_action_at IS NOT NULL AND next_action_at >= now() THEN 1 ELSE 0 END)::int AS ontime,
        SUM(CASE WHEN next_action_at IS NULL THEN 1 ELSE 0 END)::int AS no_action
     FROM leads
     WHERE created_at >= $1 AND created_at <= $2`,
    [fromIso, toIso]
  );

  const overdue = overdueResult.rows[0] || { overdue: 0, ontime: 0, no_action: 0 };

  res.render("admin_leads_analytics", {
    from,
    to,
    total,
    statusCounts: statusResult.rows || [],
    sourceCounts: sourceResult.rows || [],
    providerCounts: providerResult.rows || [],
    nextActionCounts: nextActionResult.rows || [],
    overdue
  });
}));

app.get("/admin/leads/export.csv", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status || "all",
    provider: req.query.provider || "all",
    source: req.query.source || "all",
    urgency: req.query.urgency || "all",
    next_action_type: req.query.next_action_type || "all",
    overdue: req.query.overdue || "",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildLeadFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, name, email, company, phone_e164, provider, source, crm_status, urgency,
            next_action_type, next_action_at, created_at, updated_at
     FROM leads
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  const header = ["id", "name", "email", "company", "phone_e164", "provider", "source", "crm_status", "urgency", "next_action_type", "next_action_at", "created_at", "updated_at"];
  const lines = [header.join(",")];
  rowsResult.rows.forEach((row) => {
    const values = header.map((key) => {
      const value = row[key] === null || row[key] === undefined ? "" : String(row[key]);
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    lines.push(values.join(","));
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
  res.send(lines.join("\n"));
}));

app.get("/admin/leads/export.json", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status || "all",
    provider: req.query.provider || "all",
    source: req.query.source || "all",
    urgency: req.query.urgency || "all",
    next_action_type: req.query.next_action_type || "all",
    overdue: req.query.overdue || "",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildLeadFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, name, email, company, phone_e164, provider, source, crm_status, urgency,
            next_action_type, next_action_at, created_at, updated_at
     FROM leads
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  res.json(rowsResult.rows || []);
}));

app.get("/admin/leads/:id", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const { rows } = await adminQuery(
    `SELECT * FROM leads WHERE id = $1 LIMIT 1`,
    [req.params.id]
  );
  const lead = rows[0];
  if (!lead) return res.status(404).render("404");

  const logins = await adminQuery(
    `SELECT email, provider, created_at
     FROM profile_logins
     WHERE email = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [lead.email]
  );
  const downloads = await adminQuery(
    `SELECT material_id, created_at
     FROM material_downloads
     WHERE profile_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [lead.profile_id]
  );
  res.render("admin_lead_view", {
    lead,
    logins: logins.rows || [],
    downloads: downloads.rows || []
  });
}));

app.post("/admin/leads/:id/update", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 120);
  const company = String(req.body.company || "").trim().slice(0, 120);
  const phoneRaw = String(req.body.phone_e164 || "").trim();
  const phoneE164 = normalizePhoneBR(phoneRaw) || phoneRaw;
  const interestTags = String(req.body.interest_tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const urgency = String(req.body.urgency || "").trim() || null;
  const nextActionType = String(req.body.next_action_type || "").trim() || null;
  const nextActionAt = req.body.next_action_at ? new Date(req.body.next_action_at) : null;
  const notes = String(req.body.notes || "").trim().slice(0, 2000);

  await adminQuery(
    `UPDATE leads
     SET name = $1, company = $2, phone_e164 = $3, interest_tags = $4::jsonb,
         urgency = $5, next_action_type = $6, next_action_at = $7, notes = $8, updated_at = now()
     WHERE id = $9`,
    [name, company, phoneE164, JSON.stringify(interestTags), urgency, nextActionType, nextActionAt, notes || null, req.params.id]
  );
  await adminQuery(
    "INSERT INTO lead_events (lead_id, event_type, metadata) VALUES ($1,$2,$3)",
    [req.params.id, "updated", { name, company, phone_e164: phoneE164 }]
  );
  await logAudit(req.admin && req.admin.id, "lead_updated", "leads", req.params.id, {});
  res.redirect(`/admin/leads/${req.params.id}`);
}));

app.post("/admin/leads/:id/status", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const status = String(req.body.crm_status || "").trim();
  await adminQuery("UPDATE leads SET crm_status = $1, updated_at = now() WHERE id = $2", [status, req.params.id]);
  await adminQuery(
    "INSERT INTO lead_events (lead_id, event_type, metadata) VALUES ($1,$2,$3)",
    [req.params.id, "status_changed", { crm_status: status }]
  );
  await logAudit(req.admin && req.admin.id, "lead_status_changed", "leads", req.params.id, { crm_status: status });
  res.redirect(`/admin/leads/${req.params.id}`);
}));

app.post("/admin/leads/:id/delete", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const { rows } = await adminQuery("SELECT email FROM leads WHERE id = $1", [req.params.id]);
  const email = rows[0] && rows[0].email;
  await adminQuery("DELETE FROM leads WHERE id = $1", [req.params.id]);
  if (email) {
    await adminQuery("DELETE FROM pending_profiles WHERE email = $1", [email]);
  }
  await logAudit(req.admin && req.admin.id, "lead_deleted", "leads", req.params.id, {});
  res.redirect("/admin/leads");
}));

app.post("/admin/leads/delete-selected", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const ids = []
    .concat(req.body.ids || [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  if (ids.length) {
    const emailsResult = await adminQuery("SELECT email FROM leads WHERE id = ANY($1::uuid[])", [ids]);
    await adminQuery("DELETE FROM leads WHERE id = ANY($1::uuid[])", [ids]);
    const emails = (emailsResult.rows || []).map((row) => row.email).filter(Boolean);
    if (emails.length) {
      await adminQuery("DELETE FROM pending_profiles WHERE email = ANY($1::text[])", [emails]);
    }
    await logAudit(req.admin && req.admin.id, "leads_deleted", "leads", null, { ids_count: ids.length });
  }
  res.redirect(`/admin/leads?${new URLSearchParams({
    status: req.body.status || "all",
    provider: req.body.provider || "all",
    source: req.body.source || "all",
    urgency: req.body.urgency || "all",
    next_action_type: req.body.next_action_type || "all",
    overdue: req.body.overdue || "",
    from: req.body.from || "",
    to: req.body.to || "",
    q: req.body.q || ""
  }).toString()}`);
}));

app.post("/admin/leads/delete-all", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const filters = {
    status: req.body.status || "all",
    provider: req.body.provider || "all",
    source: req.body.source || "all",
    urgency: req.body.urgency || "all",
    next_action_type: req.body.next_action_type || "all",
    overdue: req.body.overdue || "",
    from: req.body.from || "",
    to: req.body.to || "",
    q: String(req.body.q || "").trim()
  };
  const { clause, params } = buildLeadFilters(filters);
  const emailsResult = await adminQuery(
    `SELECT email FROM leads ${clause}`,
    params
  );
  const result = await adminQuery(
    `DELETE FROM leads ${clause} RETURNING id`,
    params
  );
  const emails = (emailsResult.rows || []).map((row) => row.email).filter(Boolean);
  if (emails.length) {
    await adminQuery("DELETE FROM pending_profiles WHERE email = ANY($1::text[])", [emails]);
  }
  await logAudit(req.admin && req.admin.id, "leads_deleted_all", "leads", null, { deleted_count: result.rows.length, filters });
  res.redirect(`/admin/leads?${new URLSearchParams(filters).toString()}`);
}));

app.get("/admin/briefings", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = 30;
  const offset = (page - 1) * perPage;
  const filters = {
    status: req.query.status || "all",
    source: req.query.source || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildBriefingFilters(filters);
  const countResult = await adminQuery(
    `SELECT COUNT(*)::int AS count FROM briefings ${clause}`,
    params
  );
  const total = countResult.rows[0]?.count || 0;
  const rowsResult = await adminQuery(
    `SELECT id, name, email, phone, city, status, source, created_at
     FROM briefings
     ${clause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  res.render("admin_briefings", {
    briefings: rowsResult.rows || [],
    filters,
    page,
    total,
    perPage
  });
}));

app.get("/admin/briefings/export.csv", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status || "all",
    source: req.query.source || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildBriefingFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, name, email, phone, city, status, source, idea, deal_type, rental_details, event_location, created_at
     FROM briefings
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  const header = ["id", "name", "email", "phone", "city", "status", "source", "idea", "deal_type", "rental_details", "event_location", "created_at"];
  const lines = [header.join(",")];
  rowsResult.rows.forEach((row) => {
    const values = header.map((key) => {
      const value = row[key] === null || row[key] === undefined ? "" : String(row[key]);
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    lines.push(values.join(","));
  });
  await logAudit(req.admin && req.admin.id, "briefings_export_csv", "briefings", null, { filters });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=briefings.csv");
  res.send(lines.join("\n"));
}));

app.get("/admin/briefings/export.json", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status || "all",
    source: req.query.source || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildBriefingFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, name, email, phone, city, status, source, idea, deal_type, rental_details, event_location, created_at
     FROM briefings
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  await logAudit(req.admin && req.admin.id, "briefings_export_json", "briefings", null, { filters });
  res.json(rowsResult.rows || []);
}));

app.get("/admin/briefings/:id", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const { rows } = await adminQuery(
    "SELECT * FROM briefings WHERE id = $1 LIMIT 1",
    [req.params.id]
  );
  const briefing = rows[0];
  if (!briefing) return res.status(404).render("404");
  const attachmentsResult = await adminQuery(
    `SELECT * FROM briefing_attachments
     WHERE briefing_id = $1
     ORDER BY created_at DESC`,
    [req.params.id]
  );
  await logAudit(req.admin && req.admin.id, "briefing_viewed", "briefings", req.params.id, {});
  res.render("admin_briefing_view", {
    briefing,
    attachments: attachmentsResult.rows || []
  });
}));

app.post("/admin/briefings/delete-selected", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const ids = []
    .concat(req.body.ids || [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  if (!ids.length) {
    return res.redirect(`/admin/briefings?${new URLSearchParams({
      status: req.body.status || "all",
      source: req.body.source || "all",
      from: req.body.from || "",
      to: req.body.to || "",
      q: req.body.q || ""
    }).toString()}`);
  }
  await adminQuery(
    `DELETE FROM briefings WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  await logAudit(req.admin && req.admin.id, "briefings_deleted", "briefings", null, { ids_count: ids.length });
  res.redirect(`/admin/briefings?${new URLSearchParams({
    status: req.body.status || "all",
    source: req.body.source || "all",
    from: req.body.from || "",
    to: req.body.to || "",
    q: req.body.q || ""
  }).toString()}`);
}));

app.post("/admin/briefings/delete-all", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const filters = {
    status: req.body.status || "all",
    source: req.body.source || "all",
    from: req.body.from || "",
    to: req.body.to || "",
    q: String(req.body.q || "").trim()
  };
  const { clause, params } = buildBriefingFilters(filters);
  const result = await adminQuery(
    `DELETE FROM briefings ${clause} RETURNING id`,
    params
  );
  await logAudit(req.admin && req.admin.id, "briefings_deleted_all", "briefings", null, { deleted_count: result.rows.length, filters });
  res.redirect(`/admin/briefings?${new URLSearchParams(filters).toString()}`);
}));

app.get("/admin/materials", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status || "all",
    q: String(req.query.q || "").trim(),
    from: req.query.from || "",
    to: req.query.to || "",
    tag: String(req.query.tag || "").trim()
  };
  const where = [];
  const params = [];
  let idx = 1;
  if (filters.status === "published") {
    where.push(`is_published = true`);
  } else if (filters.status === "draft") {
    where.push(`is_published = false`);
  }
  if (filters.from) {
    where.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }
  if (filters.q) {
    where.push(`(title ILIKE $${idx} OR description ILIKE $${idx})`);
    params.push(`%${filters.q}%`);
    idx += 1;
  }
  if (filters.tag) {
    where.push(`tags ? $${idx++}`);
    params.push(filters.tag);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await adminQuery(
    `SELECT id, title, description, tags, filename, size_bytes, is_published, publish_at, created_at
     FROM materials
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  res.render("admin_materials", { materials: rows || [], filters });
}));

app.get("/admin/materials/new", requireAdmin("editor"), asyncHandler(async (req, res) => {
  res.render("admin_material_new");
}));

app.post("/admin/materials/upload-url", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: "Storage não configurado." });
  const filename = String(req.body.filename || "").trim();
  const contentType = String(req.body.content_type || "").trim();
  if (!filename || !contentType) return res.status(400).json({ error: "Arquivo inválido." });
  const ext = safeFilename(filename);
  const now = new Date();
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const storagePath = `${folder}/${crypto.randomUUID()}-${ext}`;
  const { data, error } = await supabaseAdmin.storage
    .from(MATERIALS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data?.signedUrl) {
    return res.status(500).json({ error: "Falha ao gerar URL de upload." });
  }
  res.json({ signedUrl: data.signedUrl, storagePath });
}));

app.post("/admin/materials", requireAdmin("editor"), upload.single("file"), requireAdminCsrf, asyncHandler(async (req, res) => {
  if (!supabaseAdmin) return res.status(500).send("Storage não configurado.");
  const file = req.file;
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const tagsRaw = String(req.body.tags || "").trim();
  const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];
  const publishMode = String(req.body.publish_mode || "publish").trim();
  const publishAtInput = String(req.body.publish_at || "").trim();
  const publishAt = publishMode === "schedule" ? parsePublishAt(publishAtInput) : null;
  const isPublished = publishAt ? false : true;
  if (!title) return res.status(400).send("Título é obrigatório.");

  let storagePath = String(req.body.storage_path || "").trim();
  let filename = String(req.body.filename || "").trim();
  let contentType = String(req.body.content_type || "").trim();
  let sizeBytes = Number(req.body.size_bytes || 0);

  if (file) {
    const allowed = ["application/pdf", "application/zip", "image/png", "image/jpeg", "video/mp4"];
    if (!allowed.includes(file.mimetype)) {
      return res.status(400).send("Tipo de arquivo não permitido.");
    }
    const ext = safeFilename(file.originalname);
    const now = new Date();
    const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    storagePath = `${folder}/${crypto.randomUUID()}-${ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(MATERIALS_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploadError) return res.status(500).send("Falha ao enviar arquivo.");
    filename = file.originalname;
    contentType = file.mimetype;
    sizeBytes = file.size;
  }

  if (!storagePath) return res.status(400).send("Arquivo é obrigatório.");

  await adminQuery(
    `INSERT INTO materials (title, description, tags, storage_bucket, storage_path, filename, content_type, size_bytes, is_published, publish_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [title, description, JSON.stringify(tags), MATERIALS_BUCKET, storagePath, filename, contentType, sizeBytes, isPublished, publishAt]
  );
  await logAudit(req.admin && req.admin.id, "material_created", "materials", storagePath, { title, is_published: isPublished });
  res.redirect("/admin/materials");
}));

app.get("/admin/materials/:id", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const { rows } = await adminQuery("SELECT * FROM materials WHERE id = $1", [req.params.id]);
  const material = rows[0];
  if (!material) return res.status(404).render("404");
  res.render("admin_material_edit", { material });
}));

app.post("/admin/materials/:id/update", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const tagsRaw = String(req.body.tags || "").trim();
  const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];
  const publishMode = String(req.body.publish_mode || "publish").trim();
  const publishAtInput = String(req.body.publish_at || "").trim();
  const publishAt = publishMode === "schedule" ? parsePublishAt(publishAtInput) : null;
  const isPublished = publishAt ? false : true;
  await adminQuery(
    "UPDATE materials SET title=$1, description=$2, tags=$3, is_published=$4, publish_at=$5, updated_at=now() WHERE id=$6",
    [title, description, JSON.stringify(tags), isPublished, publishAt, req.params.id]
  );
  await logAudit(req.admin && req.admin.id, isPublished ? "material_published" : "material_unpublished", "materials", req.params.id, { title });
  res.redirect(`/admin/materials/${req.params.id}`);
}));

app.post("/admin/materials/:id/replace-url", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: "Storage não configurado." });
  const filename = String(req.body.filename || "").trim();
  const contentType = String(req.body.content_type || "").trim();
  if (!filename || !contentType) return res.status(400).json({ error: "Arquivo inválido." });
  const { rows } = await adminQuery("SELECT id FROM materials WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Material não encontrado." });
  const ext = safeFilename(filename);
  const now = new Date();
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const storagePath = `${folder}/${crypto.randomUUID()}-${ext}`;
  const { data, error } = await supabaseAdmin.storage
    .from(MATERIALS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data?.signedUrl) {
    return res.status(500).json({ error: "Falha ao gerar URL de upload." });
  }
  res.json({ signedUrl: data.signedUrl, storagePath });
}));

app.post("/admin/materials/:id/replace", requireAdmin("editor"), upload.single("file"), requireAdminCsrf, asyncHandler(async (req, res) => {
  if (!supabaseAdmin) return res.status(500).send("Storage não configurado.");
  const file = req.file;
  const { rows } = await adminQuery("SELECT * FROM materials WHERE id = $1", [req.params.id]);
  const material = rows[0];
  if (!material) return res.status(404).render("404");

  let storagePath = String(req.body.storage_path || "").trim();
  let filename = String(req.body.filename || "").trim();
  let contentType = String(req.body.content_type || "").trim();
  let sizeBytes = Number(req.body.size_bytes || 0);

  if (file) {
    const allowed = ["application/pdf", "application/zip", "image/png", "image/jpeg", "video/mp4"];
    if (!allowed.includes(file.mimetype)) {
      return res.status(400).send("Tipo de arquivo não permitido.");
    }
    const ext = safeFilename(file.originalname);
    const now = new Date();
    const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    storagePath = `${folder}/${crypto.randomUUID()}-${ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(MATERIALS_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploadError) return res.status(500).send("Falha ao enviar arquivo.");
    filename = file.originalname;
    contentType = file.mimetype;
    sizeBytes = file.size;
  }

  if (!storagePath) return res.status(400).send("Arquivo obrigatório.");

  if (material.storage_path) {
    await supabaseAdmin.storage.from(MATERIALS_BUCKET).remove([material.storage_path]);
  }

  await adminQuery(
    "UPDATE materials SET storage_path=$1, filename=$2, content_type=$3, size_bytes=$4, updated_at=now() WHERE id=$5",
    [storagePath, filename, contentType, sizeBytes, req.params.id]
  );
  await logAudit(req.admin && req.admin.id, "material_file_replaced", "materials", req.params.id, { storage_path: storagePath });
  res.redirect(`/admin/materials/${req.params.id}`);
}));

app.post("/admin/materials/:id/delete", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  if (!supabaseAdmin) return res.status(500).send("Storage não configurado.");
  const { rows } = await adminQuery("SELECT * FROM materials WHERE id = $1", [req.params.id]);
  const material = rows[0];
  if (!material) return res.status(404).render("404");
  if (material.storage_path) {
    await supabaseAdmin.storage.from(MATERIALS_BUCKET).remove([material.storage_path]);
  }
  await adminQuery("DELETE FROM materials WHERE id = $1", [req.params.id]);
  await logAudit(req.admin && req.admin.id, "material_deleted", "materials", req.params.id, { title: material.title });
  res.redirect("/admin/materials");
}));

app.post("/admin/posts", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const { title, slug, excerpt, content, tags, category, read_time, video_url, video_orientation, image_url: imageUrlInput } = req.body;
  if (!title || !excerpt || !content || !category) {
    return res.status(400).send("Campos obrigatórios ausentes.");
  }
  const image_url = imageUrlInput || "";
  const normalizedVideo = normalizeVideoUrl(video_url);
  const tagList = Array.isArray(tags)
    ? tags
    : (tags ? String(tags).split(",").map(t => t.trim()).filter(Boolean) : []);
  const finalSlug = await ensureUniqueSlug(title, slug);
  await insertPost({
    title,
    slug: finalSlug,
    excerpt,
    content,
    tags: tagList.join(", "),
    category,
    created_at: new Date().toISOString(),
    read_time,
    image_url,
    video_url: normalizedVideo,
    video_orientation: video_orientation || ""
  });
  res.redirect("/admin");
}));

app.post("/admin/posts/:id", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const { title, slug, excerpt, content, tags, category, read_time, video_url, video_orientation, image_url: imageUrlInput } = req.body;
  const removeImage = req.body.remove_image === "1";
  if (!title || !excerpt || !content || !category) {
    return res.status(400).send("Campos obrigatórios ausentes.");
  }
  const tagList = Array.isArray(tags)
    ? tags
    : (tags ? String(tags).split(",").map(t => t.trim()).filter(Boolean) : []);
  const updates = {
    title,
    slug,
    excerpt,
    content,
    tags: tagList.join(", "),
    category,
    read_time,
    video_url: normalizeVideoUrl(video_url),
    video_orientation: video_orientation || ""
  };
  if (!slug && title) {
    updates.slug = await ensureUniqueSlugForUpdate(title, slug, req.params.id);
  } else if (slug) {
    updates.slug = await ensureUniqueSlugForUpdate(title || slug, slug, req.params.id);
  }
  if (removeImage) updates.image_url = "";
  if (imageUrlInput && !removeImage) updates.image_url = imageUrlInput;
  await updatePost(req.params.id, updates);
  res.redirect("/admin");
}));

app.post("/admin/posts/:id/delete", requireAdmin("admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await deletePost(req.params.id);
  res.redirect("/admin");
}));

app.post("/blog/:slug/comments", asyncHandler(async (req, res) => {
  const post = await getPostBySlug(req.params.slug);
  if (!post) return res.status(404).render("404");
  const { name, email, message, website } = req.body;
  if (website) return res.redirect(`/blog/${req.params.slug}`);
  if (!name || !email || !message) return res.redirect(`/blog/${req.params.slug}#comentarios`);
  if (!String(name).trim() || !String(email).trim() || !String(message).trim()) {
    return res.redirect(`/blog/${req.params.slug}#comentarios`);
  }
  await insertComment({
    post_slug: String(req.params.slug || "").trim().toLowerCase(),
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message).trim(),
    created_at: new Date().toISOString(),
    status: "pending",
    parent_id: null,
    is_admin_reply: false
  });
  if (mailer && process.env.NOTIFY_EMAIL) {
    const subject = `Novo comentário pendente: ${post.title}`;
    const text = `Nome: ${name}\nEmail: ${email}\nPost: ${post.title}\nMensagem: ${message}\n`;
    mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL,
      subject,
      text
    }).catch(() => {});
  }
  res.redirect(`/blog/${req.params.slug}#comentarios`);
}));

app.post("/admin/comments/:id/approve", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await updateComment(req.params.id, { status: "approved" });
  res.redirect("/admin");
}));

app.post("/admin/comments/:id/delete", requireAdmin("admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await deleteComment(req.params.id);
  res.redirect("/admin");
}));

app.post("/admin/comments/:id/update", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || !String(message).trim()) return res.redirect("/admin");
  await updateComment(req.params.id, { message: String(message).trim() });
  res.redirect("/admin");
}));

app.post("/admin/comments/:id/reply", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const { message, post_slug } = req.body;
  if (!message || !post_slug || !String(message).trim()) return res.redirect("/admin");
  await insertComment({
    post_slug: String(post_slug || "").trim().toLowerCase(),
    name: "MTM Solution",
    email: "",
    message: String(message).trim(),
    created_at: new Date().toISOString(),
    status: "approved",
    parent_id: req.params.id,
    is_admin_reply: true
  });
  res.redirect("/admin");
}));

app.post("/contato", asyncHandler(async (req, res) => {
  const { nome, email, empresa, assunto, mensagem } = req.body;
  console.log("Contato recebido:", { nome, email, empresa, assunto });
  if (mailer && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const subject = assunto && String(assunto).trim()
      ? `[Contato] ${assunto}`
      : "Contato pelo site";
    const text = [
      `Nome: ${nome || ""}`,
      `Email: ${email || ""}`,
      `Empresa: ${empresa || ""}`,
      `Assunto: ${assunto || ""}`,
      "",
      `Mensagem:`,
      `${mensagem || ""}`
    ].join("\n");
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject,
        text
      });
      console.log("Email contato enviado com sucesso.");
    } catch (err) {
      console.error("Email contato falhou:", err && err.message ? err.message : err);
    }
  } else {
    console.warn("SMTP não configurado. Contato não enviado por email.");
  }
  res.render("contato", { sent: true });
}));

async function sendToN8n(payload, options = {}) {
  if (!N8N_WEBHOOK_URL) return;
  const timeoutMs = Number(options.timeoutMs || 2500);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    console.error("N8N webhook failed:", err && err.message ? err.message : err);
  } finally {
    clearTimeout(timeoutId);
  }
}

app.post("/api/leads/diagnostico", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const normalize = (value) => String(value || "").trim();
  const payload = {
    tipoEspaco: normalize(body.tipoEspaco),
    cidadeEstado: normalize(body.cidadeEstado),
    areaM2: normalize(body.areaM2),
    objetivo: normalize(body.objetivo),
    conceito: normalize(body.conceito),
    prazo: normalize(body.prazo),
    orcamento: normalize(body.orcamento),
    nome: normalize(body.nome),
    cargo: normalize(body.cargo),
    email: normalize(body.email).toLowerCase(),
    whatsapp: normalize(body.whatsapp)
  };

  const requiredFields = [
    ["tipoEspaco", "Informe o tipo de espaço."],
    ["cidadeEstado", "Informe cidade/estado."],
    ["objetivo", "Informe o objetivo principal."],
    ["prazo", "Informe o prazo estimado."],
    ["nome", "Informe seu nome."],
    ["cargo", "Informe seu cargo."],
    ["email", "Informe um e-mail válido."],
    ["whatsapp", "Informe telefone ou WhatsApp."]
  ];
  for (const [field, message] of requiredFields) {
    if (!payload[field]) {
      return res.status(400).json({ ok: false, error: message, field });
    }
  }
  if (!isValidEmail(payload.email)) {
    return res.status(400).json({ ok: false, error: "Informe um e-mail válido.", field: "email" });
  }

  const leadId = crypto.randomUUID();
  const logPayload = {
    lead_id: leadId,
    route: "/api/leads/diagnostico",
    tipoEspaco: payload.tipoEspaco,
    objetivo: payload.objetivo,
    prazo: payload.prazo,
    orcamento: payload.orcamento,
    cidadeEstado: payload.cidadeEstado,
    contato: {
      nome: payload.nome,
      cargo: payload.cargo,
      email: maskEmail(payload.email)
    },
    created_at: new Date().toISOString()
  };
  console.log("diagnostico_lead_received", JSON.stringify(logPayload));

  sendToN8n(
    {
      event: "diagnostico_tecnico",
      lead_id: leadId,
      payload
    },
    { timeoutMs: 2500 }
  ).catch((err) => {
    console.warn("diagnostico webhook warning:", err && err.message ? err.message : err);
  });

  return res.status(200).json({ ok: true, lead_id: leadId });
}));

app.post("/qualificador", asyncHandler(async (req, res) => {
  const { name, email, phone, city, idea, website, deal_type, rental_details, event_location } = req.body;
  if (website) return res.redirect("/diagnostico");
  const nameText = String(name || "").trim();
  const emailText = String(email || "").trim();
  const phoneText = String(phone || "").trim();
  const ideaText = String(idea || "").trim();
  if (!nameText || !emailText || !phoneText || !ideaText) return res.redirect("/diagnostico");
  if (!deal_type) return res.redirect("/diagnostico");
  if (!pool) return res.status(500).json({ error: "Banco não configurado." });
  const token = req.cookies && req.cookies.mtm_access_token;
  const authPayload = decodeJwtPayload(token);
  const profileId = authPayload && authPayload.sub ? authPayload.sub : null;
  const normalizedEmail = normalizeEmail(emailText);
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    idempotency_key: idempotencyKey,
    source: "nao-sabe",
    channel: "site_form",
    phone: phoneText,
    name: nameText,
    email: normalizedEmail || "",
    city: String(city || "").trim(),
    answers: {
      idea: ideaText,
      deal_type: deal_type || "",
      rental_details: String(rental_details || "").trim(),
      event_location: String(event_location || "").trim()
    },
    summary: "",
    status: "new"
  };
  const insertResult = await adminQuery(
    `INSERT INTO briefings
     (profile_id, idempotency_key, source, status, name, email, phone, city, idea, deal_type, rental_details, event_location, summary, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      profileId,
      idempotencyKey,
      "nao-sabe",
      "new",
      nameText,
      normalizedEmail,
      phoneText,
      String(city || "").trim(),
      ideaText,
      String(deal_type || "").trim(),
      String(rental_details || "").trim(),
      String(event_location || "").trim(),
      "",
      payload
    ]
  );
  const briefingId = insertResult.rows[0] && insertResult.rows[0].id;

  const wantsJson = (req.headers.accept || "").includes("application/json") ||
    String(req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest";
  if (wantsJson) {
    res.json({ ok: true, briefing_id: briefingId });
  } else {
    res.redirect("/diagnostico?sent=1");
  }

  setImmediate(async () => {
    try {
      if (mailer && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const subject = "Briefing enviado pelo site (Não sabe o que fazer?)";
        const text = [
          `Nome: ${nameText || ""}`,
          `Email: ${normalizedEmail || ""}`,
          `Telefone: ${phoneText || ""}`,
          `Cidade: ${city || ""}`,
          `Compra/Locação: ${deal_type || ""}`,
          `Locação (dias/datas): ${rental_details || ""}`,
          `Local do evento: ${event_location || ""}`,
          "",
          "Ideia:",
          `${ideaText || ""}`
        ].join("\n");
        await mailer.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
          subject,
          text
        });
        console.log("Email briefing enviado com sucesso.");
      } else {
        console.warn("SMTP não configurado. Briefing não enviado por email.");
      }
    } catch (err) {
      console.error("Email briefing falhou:", err && err.message ? err.message : err);
    }

    if (ENABLE_CLIENT_CONFIRMATION_EMAIL && mailer && isValidEmail(normalizedEmail)) {
      const subject = "Recebemos seu briefing — MTM Solution";
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const text = [
        `Olá, ${nameText || "tudo bem"}!`,
        "",
        "Recebemos seu briefing e já estamos analisando.",
        "Em breve um especialista da MTM Solution entrará em contato com os próximos passos.",
        "",
        `Enquanto isso, você pode conhecer mais em: ${baseUrl}`,
        "",
        "Obrigado,",
        "Equipe MTM Solution"
      ].join("\n");
      try {
        await mailer.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: normalizedEmail,
          subject,
          text
        });
        console.log("Email confirmação enviado com sucesso.");
      } catch (err) {
        console.error("Email confirmação falhou:", err && err.message ? err.message : err);
      }
    }

    await sendToN8n({ ...payload, briefing_id: briefingId });
  });
}));

app.use((err, req, res, next) => {
  console.error("Request failed:", err && err.message ? err.message : err);
  res.status(500).send("Internal Server Error");
});

app.use((req, res) => res.status(404).render("404"));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MTM Solution rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
