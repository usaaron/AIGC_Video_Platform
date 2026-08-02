ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_reset_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_required_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_password_reset_required_idx
  ON users (password_reset_required)
  WHERE password_reset_required = true;
