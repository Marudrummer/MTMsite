const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { getData, saveData } = require("./storage");
let nodemailer = null;
try {
  // Optional dependency for comment notifications
  nodemailer = require("nodemailer");
} catch (err) {
  nodemailer = null;
}
const SITE_PATH = path.join(__dirname, "db", "site.json");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mtm-admin-123";
const EMAIL_ENABLED = Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || "5500000000000";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";

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

app.use((req, res, next) => {
  res.locals.pendingCount = isAuthed(req) ? getPendingComments().length : 0;
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
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9-_]/gi, "").toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${base || "image"}-${unique}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

function loadSiteData() {
  return JSON.parse(fs.readFileSync(SITE_PATH, "utf8"));
}

function getPosts() {
  return getData().posts.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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

function getPostBySlug(slug) {
  return getData().posts.find((p) => p.slug === slug);
}

function getPostById(id) {
  return getData().posts.find((p) => String(p.id) === String(id));
}

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function ensureUniqueSlug(title, requestedSlug) {
  const base = slugify(requestedSlug || title);
  if (!base) return `post-${Date.now()}`;
  const data = getData();
  let slug = base;
  let counter = 2;
  while (data.posts.find((p) => p.slug === slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

function insertPost(post) {
  const data = getData();
  const slug = ensureUniqueSlug(post.title, post.slug);
  data.posts.push({ id: Date.now(), ...post, slug });
  saveData(data);
}

function updatePost(id, updates) {
  const data = getData();
  const idx = data.posts.findIndex((p) => String(p.id) === String(id));
  if (idx === -1) return false;
  data.posts[idx] = { ...data.posts[idx], ...updates };
  saveData(data);
  return true;
}

function deletePost(id) {
  const data = getData();
  const next = data.posts.filter((p) => String(p.id) !== String(id));
  if (next.length === data.posts.length) return false;
  data.posts = next;
  saveData(data);
  return true;
}

function generateId() {
  return Date.now() + Math.floor(Math.random() * 100000);
}

function getCommentsByPostSlug(slug) {
  const data = getData();
  return data.comments
    .filter((c) => c.post_slug === slug && c.approved)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

function getPendingComments() {
  const data = getData();
  return data.comments
    .filter((c) => !c.approved)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function getApprovedComments() {
  const data = getData();
  return data.comments
    .filter((c) => c.approved)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function insertComment(comment) {
  const data = getData();
  data.comments.push({ id: generateId(), ...comment });
  saveData(data);
}

function updateComment(id, updates) {
  const data = getData();
  const idx = data.comments.findIndex((c) => String(c.id) === String(id));
  if (idx === -1) return false;
  data.comments[idx] = { ...data.comments[idx], ...updates };
  saveData(data);
  return true;
}

function deleteComment(id) {
  const data = getData();
  const next = data.comments.filter((c) => String(c.id) !== String(id));
  if (next.length === data.comments.length) return false;
  data.comments = next;
  saveData(data);
  return true;
}

function getProjects() {
  return getData().projects.slice().reverse();
}

function insertProject(project) {
  const data = getData();
  data.projects.push({ id: Date.now(), ...project });
  saveData(data);
}

function seedIfEmpty() {
  const data = getData();
  const postCount = data.posts.length;
  const projectCount = data.projects.length;

  if (postCount < 10) {
    const now = new Date().toISOString();
    const seedPosts = [
      {
      title: "Como a IA transforma experiências em museus",
      slug: "ia-transforma-experiencias-museus",
      excerpt: "Visão computacional e IA criando interações memoráveis em espaços culturais.",
      content: "<p>Exploramos como a IA aplicada a experiências interativas eleva o engajamento do público em museus e exposições.</p>",
      tags: "IA, visão computacional, museus",
      category: "Inteligência Artificial",
      read_time: "5 min"
      },
      {
      title: "Instalações imersivas: do conceito ao público",
      slug: "instalacoes-imersivas-do-conceito-ao-publico",
      excerpt: "Processo ponta a ponta para criar instalações interativas.",
      content: "<p>Da engenharia do sistema ao design de interação, mostramos o caminho completo para instalações robustas.</p>",
      tags: "imersão, UX, interatividade",
      category: "Experiências Interativas",
      read_time: "6 min"
      },
      {
      title: "Sistemas embarcados em tempo real",
      slug: "sistemas-embarcados-em-tempo-real",
      excerpt: "Raspberry Pi, ESP32 e Arduino para aplicações críticas.",
      content: "<p>Boas práticas para criar sistemas embarcados confiáveis em ambientes com alto fluxo.</p>",
      tags: "embarcados, raspberry pi, esp32",
      category: "Sistemas Embarcados",
      read_time: "4 min"
      },
      {
      title: "Totens inteligentes com reconhecimento de público",
      slug: "totens-inteligentes-reconhecimento-publico",
      excerpt: "Como integrar visão computacional para personalizar atendimento.",
      content: "<p>Implementamos reconhecimento anônimo para adaptar conteúdos e reduzir filas em eventos.</p>",
      tags: "totem, visão computacional, eventos",
      category: "Inteligência Artificial",
      read_time: "5 min"
      },
      {
      title: "Museus interativos com sensores de presença",
      slug: "museus-interativos-sensores-presenca",
      excerpt: "Sensores e efeitos de luz para criar narrativas dinâmicas.",
      content: "<p>Projetos com presença e resposta imediata elevam o engajamento e a imersão.</p>",
      tags: "sensores, interatividade, museus",
      category: "Experiências Interativas",
      read_time: "4 min"
      },
      {
      title: "Jogos educacionais para aprendizagem ativa",
      slug: "jogos-educacionais-aprendizagem-ativa",
      excerpt: "Gamificação e feedback em tempo real.",
      content: "<p>Jogos com metas claras e feedback imediato aumentam retenção e participação.</p>",
      tags: "jogos, educação, UX",
      category: "Jogos Interativos",
      read_time: "6 min"
      },
      {
      title: "Projeção mapeada com tracking de objetos",
      slug: "projecao-mapeada-tracking-objetos",
      excerpt: "Mapeamento dinâmico com visão computacional.",
      content: "<p>Tracking permite que projeções reajam ao movimento físico em tempo real.</p>",
      tags: "projeção, tracking, visão computacional",
      category: "Experiências Interativas",
      read_time: "5 min"
      },
      {
      title: "Painéis de conteúdo dinâmico para eventos",
      slug: "paineis-conteudo-dinamico-eventos",
      excerpt: "Digital signage com atualização em nuvem.",
      content: "<p>Conteúdo centralizado e atualizado automaticamente reduz custo operacional.</p>",
      tags: "digital signage, conteúdo, eventos",
      category: "Digital Signage",
      read_time: "4 min"
      },
      {
      title: "Integrações com WhatsApp e automação",
      slug: "integracoes-whatsapp-automacao",
      excerpt: "Fluxos de atendimento integrados a IA.",
      content: "<p>Integramos canais de atendimento para respostas rápidas e métricas em tempo real.</p>",
      tags: "whatsapp, automação, IA",
      category: "Sistemas Sob Medida",
      read_time: "5 min"
      },
      {
      title: "Raspberry Pi em instalações 24/7",
      slug: "raspberry-pi-instalacoes-24-7",
      excerpt: "Confiabilidade e manutenção em ambientes críticos.",
      content: "<p>Monitoramento e watchdog para manter instalações operando continuamente.</p>",
      tags: "raspberry pi, manutenção, embarcados",
      category: "Sistemas Embarcados",
      read_time: "4 min"
      }
    ];

    seedPosts.forEach((p) => {
      if (!getPostBySlug(p.slug)) {
        insertPost({ ...p, created_at: now });
      }
    });
  }

  if (projectCount === 0) {
    insertProject({
      title: "Galeria Sensorial",
      description: "Experiência imersiva com sensores de movimento e projeção mapeada.",
      tags: "imersão, sensores, projeção",
      category: "Experiências Interativas",
      image_url: "/img/projeto-1.jpg",
      link: "#"
    });
    insertProject({
      title: "Jogo Educacional para Museu",
      description: "Jogo interativo com visão computacional para aprendizado lúdico.",
      tags: "jogos, educação, visão computacional",
      category: "Jogos Interativos",
      image_url: "/img/projeto-2.jpg",
      link: "#"
    });
    insertProject({
      title: "Totem Inteligente",
      description: "Sistema embarcado para atendimento com IA e integração de dados.",
      tags: "embarcados, IA, atendimento",
      category: "Sistemas Sob Medida",
      image_url: "/img/projeto-3.jpg",
      link: "#"
    });
  }
}

seedIfEmpty();

function isAuthed(req) {
  return req.cookies && req.cookies.mtm_admin === "1";
}

app.get("/", (req, res) => {
  const posts = getPosts().slice(0, 3).map((p) => ({ ...p, card_image: getCardImage(p) }));
  const site = loadSiteData();
  res.render("home", { posts, stats: site.stats || [], cases: site.cases || [] });
});

app.get("/sobre", (req, res) => res.render("sobre"));
app.get("/servicos", (req, res) => res.render("servicos"));
app.get("/blog", (req, res) => {
  const posts = getPosts().map((p) => ({ ...p, card_image: getCardImage(p) }));
  res.render("lab", { posts });
});

app.get("/blog/:slug", (req, res) => {
  const post = getPostBySlug(req.params.slug);
  if (!post) return res.status(404).render("404");
  const comments = getCommentsByPostSlug(req.params.slug);
  res.render("post", { post, comments, whatsappPhone: WHATSAPP_PHONE });
});

app.get("/lab", (req, res) => res.redirect(301, "/blog"));
app.get("/lab/:slug", (req, res) => res.redirect(301, `/blog/${req.params.slug}`));

app.get("/sitemap.xml", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const staticUrls = ["/", "/sobre", "/servicos", "/blog", "/contato"];
  const posts = getPosts();
  const urls = [
    ...staticUrls.map((path) => `${baseUrl}${path}`),
    ...posts.map((post) => `${baseUrl}/blog/${post.slug}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n") +
    `\n</urlset>`;
  res.type("application/xml").send(xml);
});

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

app.get("/admin", (req, res) => {
  if (!isAuthed(req)) return res.render("admin_login", { error: null });
  const posts = getPosts();
  const pendingComments = getPendingComments();
  const approvedComments = getApprovedComments();
  res.render("admin", { posts, pendingComments, approvedComments });
});

app.get("/admin/posts/:id/edit", (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const post = getPostById(req.params.id);
  if (!post) return res.status(404).render("404");
  res.render("admin_edit", { post });
});

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

app.post("/admin/posts", upload.single("image"), (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const { title, slug, excerpt, content, tags, category, read_time, video_url, video_orientation } = req.body;
  const image_url = req.file ? `/uploads/${req.file.filename}` : "";
  const normalizedVideo = normalizeVideoUrl(video_url);
  const tagList = Array.isArray(tags)
    ? tags
    : (tags ? String(tags).split(",").map(t => t.trim()).filter(Boolean) : []);
  insertPost({
    title,
    slug,
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
});

app.post("/admin/posts/:id", upload.single("image"), (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const { title, slug, excerpt, content, tags, category, read_time, video_url, video_orientation } = req.body;
  const removeImage = req.body.remove_image === "1";
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
    updates.slug = ensureUniqueSlug(title, slug);
  }
  if (removeImage) updates.image_url = "";
  if (req.file) updates.image_url = `/uploads/${req.file.filename}`;
  updatePost(req.params.id, updates);
  res.redirect("/admin");
});

app.post("/admin/posts/:id/delete", (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  deletePost(req.params.id);
  res.redirect("/admin");
});

app.post("/blog/:slug/comments", (req, res) => {
  const post = getPostBySlug(req.params.slug);
  if (!post) return res.status(404).render("404");
  const { name, email, message, website } = req.body;
  if (website) return res.redirect(`/blog/${req.params.slug}`);
  if (!name || !email || !message) return res.redirect(`/blog/${req.params.slug}#comentarios`);
  if (!String(name).trim() || !String(email).trim() || !String(message).trim()) {
    return res.redirect(`/blog/${req.params.slug}#comentarios`);
  }
  insertComment({
    post_slug: req.params.slug,
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message).trim(),
    created_at: new Date().toISOString(),
    approved: false,
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
});

app.post("/admin/comments/:id/approve", (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  updateComment(req.params.id, { approved: true });
  res.redirect("/admin");
});

app.post("/admin/comments/:id/delete", (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  deleteComment(req.params.id);
  res.redirect("/admin");
});

app.post("/admin/comments/:id/update", (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const { message } = req.body;
  if (!message || !String(message).trim()) return res.redirect("/admin");
  updateComment(req.params.id, { message: String(message).trim() });
  res.redirect("/admin");
});

app.post("/admin/comments/:id/reply", (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Não autorizado");
  const { message, post_slug } = req.body;
  if (!message || !post_slug || !String(message).trim()) return res.redirect("/admin");
  insertComment({
    post_slug: post_slug,
    name: "MTM Solution",
    email: "",
    message: String(message).trim(),
    created_at: new Date().toISOString(),
    approved: true,
    parent_id: req.params.id,
    is_admin_reply: true
  });
  res.redirect("/admin");
});

app.post("/contato", (req, res) => {
  res.render("contato", { sent: true });
});

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

app.post("/qualificador", async (req, res) => {
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
  await sendToN8n(payload);
  res.redirect("/nao-sabe?sent=1");
});

app.use((req, res) => res.status(404).render("404"));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MTM Solution rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
