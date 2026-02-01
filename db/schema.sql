CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  content TEXT,
  tags TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_time TEXT,
  image_url TEXT,
  video_url TEXT,
  video_orientation TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  post_slug TEXT NOT NULL REFERENCES posts(slug) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  parent_id BIGINT REFERENCES comments(id) ON DELETE SET NULL,
  is_admin_reply BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_slug ON comments(post_slug);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
