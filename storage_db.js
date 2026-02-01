const { pool } = require("./src/db");

function ensurePool() {
  if (!pool) {
    throw new Error("DATABASE_URL not configured.");
  }
  return pool;
}

async function query(sql, params) {
  const db = ensurePool();
  return db.query(sql, params);
}

function normalizeRow(row) {
  if (!row) return row;
  const next = { ...row };
  if (next.created_at instanceof Date) {
    next.created_at = next.created_at.toISOString();
  }
  return next;
}

async function getPosts() {
  const { rows } = await query("SELECT * FROM posts ORDER BY created_at DESC");
  return rows.map(normalizeRow);
}

async function getPostBySlug(slug) {
  const { rows } = await query("SELECT * FROM posts WHERE slug = $1 LIMIT 1", [slug]);
  return normalizeRow(rows[0]) || null;
}

async function getPostById(id) {
  const { rows } = await query("SELECT * FROM posts WHERE id = $1 LIMIT 1", [id]);
  return normalizeRow(rows[0]) || null;
}

async function slugExists(slug, excludeId) {
  if (excludeId) {
    const { rows } = await query("SELECT 1 FROM posts WHERE slug = $1 AND id <> $2 LIMIT 1", [slug, excludeId]);
    return rows.length > 0;
  }
  const { rows } = await query("SELECT 1 FROM posts WHERE slug = $1 LIMIT 1", [slug]);
  return rows.length > 0;
}

async function insertPost(post) {
  const sql = `
    INSERT INTO posts
      (title, slug, excerpt, content, tags, category, created_at, read_time, image_url, video_url, video_orientation)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `;
  const params = [
    post.title,
    post.slug,
    post.excerpt || "",
    post.content || "",
    post.tags || "",
    post.category || "",
    post.created_at || new Date().toISOString(),
    post.read_time || "",
    post.image_url || "",
    post.video_url || "",
    post.video_orientation || ""
  ];
  const { rows } = await query(sql, params);
  return normalizeRow(rows[0]);
}

async function updatePost(id, updates) {
  const keys = Object.keys(updates || {});
  if (keys.length === 0) return false;
  const setClauses = keys.map((key, idx) => `${key} = $${idx + 1}`);
  const values = keys.map((key) => updates[key]);
  values.push(id);
  const sql = `UPDATE posts SET ${setClauses.join(", ")} WHERE id = $${values.length}`;
  const result = await query(sql, values);
  return result.rowCount > 0;
}

async function deletePost(id) {
  const result = await query("DELETE FROM posts WHERE id = $1", [id]);
  return result.rowCount > 0;
}

async function getCommentsByPostSlug(slug) {
  const { rows } = await query(
    "SELECT * FROM comments WHERE post_slug = $1 AND status = 'approved' ORDER BY created_at ASC",
    [slug]
  );
  return rows.map(normalizeRow);
}

async function getPendingComments() {
  const { rows } = await query(
    "SELECT * FROM comments WHERE status = 'pending' ORDER BY created_at DESC"
  );
  return rows.map(normalizeRow);
}

async function getApprovedComments() {
  const { rows } = await query(
    "SELECT * FROM comments WHERE status = 'approved' ORDER BY created_at DESC"
  );
  return rows.map(normalizeRow);
}

async function getPendingCount() {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM comments WHERE status = 'pending'");
  return rows[0] ? rows[0].count : 0;
}

async function insertComment(comment) {
  const sql = `
    INSERT INTO comments
      (post_slug, name, email, message, created_at, status, parent_id, is_admin_reply)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `;
  const params = [
    comment.post_slug,
    comment.name || "",
    comment.email || "",
    comment.message || "",
    comment.created_at || new Date().toISOString(),
    comment.status || "pending",
    comment.parent_id || null,
    Boolean(comment.is_admin_reply)
  ];
  const { rows } = await query(sql, params);
  return normalizeRow(rows[0]);
}

async function updateComment(id, updates) {
  const keys = Object.keys(updates || {});
  if (keys.length === 0) return false;
  const setClauses = keys.map((key, idx) => `${key} = $${idx + 1}`);
  const values = keys.map((key) => updates[key]);
  values.push(id);
  const sql = `UPDATE comments SET ${setClauses.join(", ")} WHERE id = $${values.length}`;
  const result = await query(sql, values);
  return result.rowCount > 0;
}

async function deleteComment(id) {
  const result = await query("DELETE FROM comments WHERE id = $1", [id]);
  return result.rowCount > 0;
}

module.exports = {
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
};
