CREATE TABLE IF NOT EXISTS tenant_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_token_hash_unique
  ON tenant_invitations (token_secret_hash);

CREATE INDEX IF NOT EXISTS tenant_invitations_tenant_idx
  ON tenant_invitations (tenant_id);

CREATE INDEX IF NOT EXISTS tenant_invitations_email_idx
  ON tenant_invitations ((lower(email)));

CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_pending_email_unique
  ON tenant_invitations (tenant_id, lower(email))
  WHERE status = 'pending';
