CREATE TABLE IF NOT EXISTS registration_email_codes (
  invitation_id TEXT PRIMARY KEY REFERENCES tenant_invitations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_secret_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  requested_ip TEXT,
  requested_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_email_codes_active_idx
  ON registration_email_codes (expires_at)
  WHERE consumed_at IS NULL;
