ALTER TABLE admin_accounts
  ADD COLUMN IF NOT EXISTS failed_login_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz;

ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS session_hash text,
  ADD COLUMN IF NOT EXISTS csrf_token text;

DELETE FROM admin_sessions WHERE session_hash IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'admin_sessions'
      AND column_name = 'token'
  ) THEN
    ALTER TABLE admin_sessions DROP COLUMN token;
  END IF;
END $$;

ALTER TABLE admin_sessions
  ALTER COLUMN session_hash SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'audit_logs'
      AND tc.constraint_name = 'audit_logs_actor_admin_id_fkey'
  ) THEN
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_admin_id_fkey;
  END IF;
END $$;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_admin_id_fkey
  FOREIGN KEY (actor_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_accounts_locked_until ON admin_accounts(locked_until);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_hash ON admin_sessions(session_hash);
