const path = require("path");
const fs = require("fs");
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mtm-admin-123";
const EMAIL_ENABLED = Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || "5500000000000";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";

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
    res.locals.pendingCount = isAuthed(req) ? await getPendingCount() : 0;
  } catch (err) {
    console.error("Pending count failed:", err && err.message ? err.message : err);
    res.locals.pendingCount = 0;
  }
  res.locals.whatsappPhone = WHATSAPP_PHONE;
  next();
});

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

function isAuthed(req) {
  return req.cookies && req.cookies.mtm_admin === "1";
}

app.get("/", asyncHandler(async (req, res) => {
  const posts = (await getPosts()).slice(0, 3).map((p) => ({ ...p, card_image: getCardImage(p) }));
  const site = loadSiteData();
  res.render("home", { posts, stats: site.stats || [], cases: site.cases || [] });
}));

app.get("/sobre", (req, res) => res.render("sobre"));
app.get("/servicos", (req, res) => res.render("servicos"));
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

app.get("/nao-sabe", (req, res) => {
  res.render("nao_sabe", {
    whatsappPhone: WHATSAPP_PHONE,
    sent: req.query.sent === "1"
  });
});

app.get("/admin", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.render("admin_login", { error: null });
  const posts = await getPosts();
  const pendingComments = await getPendingComments();
  const approvedComments = await getApprovedComments();
  res.render("admin", { posts, pendingComments, approvedComments });
}));

app.get("/admin/posts/:id/edit", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const post = await getPostById(req.params.id);
  if (!post) return res.status(404).render("404");
  res.render("admin_edit", { post });
}));

app.post("/admin/login", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie("mtm_admin", "1", { httpOnly: true });
    return res.redirect("/admin");
  }
  res.render("admin_login", { error: "Senha inválida." });
});

app.post("/admin/logout", (req, res) => {
  res.clearCookie("mtm_admin");
  res.redirect("/admin");
});

app.post("/admin/posts", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
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

app.post("/admin/posts/:id", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
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

app.post("/admin/posts/:id/delete", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
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

app.post("/admin/comments/:id/approve", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  await updateComment(req.params.id, { status: "approved" });
  res.redirect("/admin");
}));

app.post("/admin/comments/:id/delete", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  await deleteComment(req.params.id);
  res.redirect("/admin");
}));

app.post("/admin/comments/:id/update", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const { message } = req.body;
  if (!message || !String(message).trim()) return res.redirect("/admin");
  await updateComment(req.params.id, { message: String(message).trim() });
  res.redirect("/admin");
}));

app.post("/admin/comments/:id/reply", asyncHandler(async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
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
