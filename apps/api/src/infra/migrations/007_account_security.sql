ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS device_label TEXT;

ALTER TABLE auth_identities
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_status TEXT NOT NULL DEFAULT 'unverified';

UPDATE auth_identities
SET email_verification_status = 'verified',
    email_verified_at = COALESCE(email_verified_at, created_at),
    updated_at = now()
WHERE provider = 'local'
  AND status = 'active'
  AND email_verification_status = 'unverified';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_identities_email_verification_status_check'
  ) THEN
    ALTER TABLE auth_identities
      ADD CONSTRAINT auth_identities_email_verification_status_check
      CHECK (email_verification_status IN ('unverified', 'verified'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES auth_identities(id) ON DELETE CASCADE,
  token_secret_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  requested_ip TEXT,
  requested_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_tokens_active_idx
  ON password_reset_tokens (identity_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entries_created_idx
  ON audit_log_entries (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entries_tenant_idx
  ON audit_log_entries (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entries_user_idx
  ON audit_log_entries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entries_actor_idx
  ON audit_log_entries (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entries_action_idx
  ON audit_log_entries (action, created_at DESC);
