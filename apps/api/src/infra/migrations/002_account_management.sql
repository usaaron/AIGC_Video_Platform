CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tenants (id, name, status, created_at, updated_at)
SELECT
  tenant_id,
  tenant_id,
  'active',
  min(created_at),
  max(updated_at)
FROM tenant_memberships
GROUP BY tenant_id
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_memberships_tenant_fk'
  ) THEN
    ALTER TABLE tenant_memberships
      ADD CONSTRAINT tenant_memberships_tenant_fk
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants (status);

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
