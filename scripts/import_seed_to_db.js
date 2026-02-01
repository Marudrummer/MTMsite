const fs = require("fs");
const path = require("path");
const { pool } = require("../src/db");

async function main() {
  if (!pool) {
    throw new Error("DATABASE_URL not configured.");
  }
  const seedPath = path.join(__dirname, "..", "db", "data.seed.json");
  const raw = fs.readFileSync(seedPath, "utf8");
  const data = JSON.parse(raw);
  const posts = Array.isArray(data.posts) ? data.posts : [];

  for (const post of posts) {
    const sql = `
      INSERT INTO posts
        (title, slug, excerpt, content, tags, category, created_at, read_time, image_url, video_url, video_orientation)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        excerpt = EXCLUDED.excerpt,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        category = EXCLUDED.category,
        created_at = EXCLUDED.created_at,
        read_time = EXCLUDED.read_time,
        image_url = EXCLUDED.image_url,
        video_url = EXCLUDED.video_url,
        video_orientation = EXCLUDED.video_orientation
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
    await pool.query(sql, params);
  }

  console.log(`Import complete: ${posts.length} posts.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
