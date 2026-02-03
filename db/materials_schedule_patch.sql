ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS publish_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_materials_publish_at ON materials(publish_at);
