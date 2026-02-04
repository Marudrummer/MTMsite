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
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
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

function buildProfileFilters(query, alias = "") {
  const where = [];
  const params = [];
  let idx = 1;
  const prefix = alias ? `${alias}.` : "";
  if (query.provider && query.provider !== "all") {
    where.push(`${prefix}provider = $${idx++}`);
    params.push(query.provider);
  }
  if (query.status === "active") {
    where.push(`${prefix}is_active = true`);
  } else if (query.status === "inactive") {
    where.push(`${prefix}is_active = false`);
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
    where.push(`(${prefix}name ILIKE $${idx} OR ${prefix}email ILIKE $${idx} OR ${prefix}company ILIKE $${idx})`);
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
  const provider = String(req.body.provider || "").trim() || null;
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

  const provider = String(req.body.provider || "").trim() || null;
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

app.get("/", asyncHandler(async (req, res) => {
  const posts = (await getPosts()).slice(0, 3).map((p) => ({ ...p, card_image: getCardImage(p) }));
  const site = loadSiteData();
  res.render("home", { posts, stats: site.stats || [], cases: site.cases || [] });
}));

app.get("/sobre", (req, res) => res.render("sobre"));
app.get("/servicos", (req, res) => res.render("servicos"));
app.get("/materiais", requireUserAuth, asyncHandler(async (req, res) => {
  const { rows } = await adminQuery(
    `SELECT id, title, description, tags, filename, size_bytes, created_at
     FROM materials
     WHERE is_published = true OR (publish_at IS NOT NULL AND publish_at <= now())
     ORDER BY created_at DESC`
  );
  res.render("materiais", { materials: rows || [] });
}));

app.get("/materiais/:id/download", requireUserAuth, asyncHandler(async (req, res) => {
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
  const baseUrl = `${req.protocol}://${req.get("host")}`;
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
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get("/contato", (req, res) => {
  const preset = {
    assunto: req.query.assunto || "",
    mensagem: req.query.mensagem || ""
  };
  res.render("contato", { preset });
});

app.get("/nao-sabe", requireUserAuth, (req, res) => {
  res.render("nao_sabe", {
    whatsappPhone: WHATSAPP_PHONE,
    sent: req.query.sent === "1"
  });
});

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
  const perPage = 25;
  const offset = (page - 1) * perPage;
  const filters = {
    provider: req.query.provider || "all",
    status: req.query.status || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildProfileFilters(filters, "p");
  const countResult = await adminQuery(
    `SELECT COUNT(*)::int AS count FROM profiles p ${clause}`,
    params
  );
  const total = countResult.rows[0]?.count || 0;
  const rowsResult = await adminQuery(
    `SELECT p.id, p.email, p.name, p.company, p.phone, p.provider, p.is_active, p.created_at, p.updated_at,
            COALESCE(l.login_count, 0) AS login_count,
            l.last_login_at
     FROM profiles p
     LEFT JOIN (
       SELECT profile_id, COUNT(*)::int AS login_count, MAX(created_at) AS last_login_at
       FROM profile_logins
       GROUP BY profile_id
     ) l ON l.profile_id = p.id
     ${clause}
     ORDER BY p.created_at DESC
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

app.get("/admin/profiles/export.csv", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    provider: req.query.provider || "all",
    status: req.query.status || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildProfileFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, name, email, company, phone, provider, is_active, created_at, updated_at
     FROM profiles
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  const header = ["id", "name", "email", "company", "phone", "provider", "is_active", "created_at", "updated_at"];
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
  res.setHeader("Content-Disposition", "attachment; filename=profiles.csv");
  res.send(lines.join("\n"));
}));

app.get("/admin/profiles/export.json", requireAdmin("editor"), asyncHandler(async (req, res) => {
  const filters = {
    provider: req.query.provider || "all",
    status: req.query.status || "all",
    from: req.query.from || "",
    to: req.query.to || "",
    q: String(req.query.q || "").trim()
  };
  const { clause, params } = buildProfileFilters(filters);
  const rowsResult = await adminQuery(
    `SELECT id, name, email, company, phone, provider, is_active, created_at, updated_at
     FROM profiles
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  res.json(rowsResult.rows || []);
}));

app.get("/admin/profiles/:id", requireAdmin("reader"), asyncHandler(async (req, res) => {
  const { rows } = await adminQuery(
    `SELECT p.id, p.email, p.name, p.company, p.phone, p.provider, p.is_active, p.deleted_at, p.created_at, p.updated_at,
            COALESCE(l.login_count, 0) AS login_count,
            l.last_login_at
     FROM profiles p
     LEFT JOIN (
       SELECT profile_id, COUNT(*)::int AS login_count, MAX(created_at) AS last_login_at
       FROM profile_logins
       GROUP BY profile_id
     ) l ON l.profile_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [req.params.id]
  );
  const profile = rows[0];
  if (!profile) return res.status(404).render("404");
  await logAudit(req.admin && req.admin.id, "profile_viewed", "profiles", req.params.id, {});
  res.render("admin_profile_view", { profile });
}));

app.post("/admin/profiles/:id/update", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 120);
  const company = String(req.body.company || "").trim().slice(0, 120);
  const phone = String(req.body.phone || "").trim().slice(0, 40);
  const { rows } = await adminQuery(
    "UPDATE profiles SET name = $1, company = $2, phone = $3, updated_at = now() WHERE id = $4 RETURNING id, email, name, company, phone, provider, is_active, deleted_at, created_at, updated_at",
    [name, company, phone, req.params.id]
  );
  await logAudit(req.admin && req.admin.id, "profile_updated", "profiles", req.params.id, { name, company, phone });
  const profile = rows[0];
  if (!profile) return res.status(404).render("404");
  res.render("admin_profile_view", { profile, saved: true });
}));

app.post("/admin/profiles/:id/deactivate", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await adminQuery(
    "UPDATE profiles SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1",
    [req.params.id]
  );
  await logAudit(req.admin && req.admin.id, "profile_deactivated", "profiles", req.params.id, {});
  res.redirect(`/admin/profiles/${req.params.id}`);
}));

app.post("/admin/profiles/:id/reactivate", requireAdmin("editor"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await adminQuery(
    "UPDATE profiles SET is_active = true, deleted_at = NULL, updated_at = now() WHERE id = $1",
    [req.params.id]
  );
  await logAudit(req.admin && req.admin.id, "profile_reactivated", "profiles", req.params.id, {});
  res.redirect(`/admin/profiles/${req.params.id}`);
}));

app.post("/admin/profiles/:id/delete", requireAdmin("super_admin"), requireAdminCsrf, asyncHandler(async (req, res) => {
  await adminQuery("DELETE FROM profiles WHERE id = $1", [req.params.id]);
  await logAudit(req.admin && req.admin.id, "profile_deleted", "profiles", req.params.id, {});
  res.redirect("/admin/profiles");
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

async function sendToN8n(payload) {
  if (!N8N_WEBHOOK_URL) return;
  try {
    await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("N8N webhook failed:", err.message);
  }
}

app.post("/qualificador", asyncHandler(async (req, res) => {
  const { name, email, phone, city, idea, website, deal_type, rental_details, event_location } = req.body;
  if (website) return res.redirect("/nao-sabe");
  if (!name || !email || !idea) return res.redirect("/nao-sabe");
  if (!deal_type) return res.redirect("/nao-sabe");
  const payload = {
    channel: "site_form",
    phone: phone || "",
    name: name || "",
    email: email || "",
    city: city || "",
    answers: {
      idea: idea || "",
      deal_type: deal_type || "",
      rental_details: rental_details || "",
      event_location: event_location || ""
    },
    summary: "",
    status: "WAITING_CONTACT"
  };
  if (mailer && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const subject = "Briefing enviado pelo site (Não sabe o que fazer?)";
    const text = [
      `Nome: ${name || ""}`,
      `Email: ${email || ""}`,
      `Telefone: ${phone || ""}`,
      `Cidade: ${city || ""}`,
      `Compra/Locação: ${deal_type || ""}`,
      `Locação (dias/datas): ${rental_details || ""}`,
      `Local do evento: ${event_location || ""}`,
      "",
      "Ideia:",
      `${idea || ""}`
    ].join("\n");
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject,
        text
      });
      console.log("Email briefing enviado com sucesso.");
    } catch (err) {
      console.error("Email briefing falhou:", err && err.message ? err.message : err);
    }
  } else {
    console.warn("SMTP não configurado. Briefing não enviado por email.");
  }
  await sendToN8n(payload);
  res.redirect("/nao-sabe?sent=1");
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
