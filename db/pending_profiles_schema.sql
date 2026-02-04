CREATE TABLE IF NOT EXISTS pending_profiles (
  email text PRIMARY KEY,
  name text,
  company text,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pending_profiles_expires_at ON pending_profiles(expires_at);
