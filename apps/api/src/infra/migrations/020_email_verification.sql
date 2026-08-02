CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES auth_identities(id) ON DELETE CASCADE,
  token_secret_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  requested_ip TEXT,
  requested_user_agent TEXT,
  verified_ip TEXT,
  verified_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_verification_tokens_active_idx
  ON email_verification_tokens (identity_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
