CREATE TABLE IF NOT EXISTS organization_billing_accounts (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_billing_ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  reference_id TEXT NOT NULL,
  related_entry_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('grant', 'generation', 'adjustment')),
  amount INTEGER NOT NULL,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  description TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_billing_ledger_reference_unique
  ON organization_billing_ledger_entries (tenant_id, reference_id);

CREATE INDEX IF NOT EXISTS organization_billing_ledger_tenant_idx
  ON organization_billing_ledger_entries (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_billing_ledger_user_idx
  ON organization_billing_ledger_entries (user_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_billing_ledger_membership_idx
  ON organization_billing_ledger_entries (membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_billing_ledger_related_idx
  ON organization_billing_ledger_entries (related_entry_id);

INSERT INTO organization_billing_accounts (tenant_id, credits, created_at, updated_at)
SELECT id, 0, now(), now()
FROM tenants
WHERE organization_type = 'enterprise'
ON CONFLICT (tenant_id) DO NOTHING;
