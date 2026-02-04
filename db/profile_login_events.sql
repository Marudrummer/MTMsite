CREATE TABLE IF NOT EXISTS profile_logins (
  id bigserial PRIMARY KEY,
  profile_id uuid,
  email text,
  provider text,
  ip text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_logins_profile_id ON profile_logins(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_logins_created_at ON profile_logins(created_at DESC);
