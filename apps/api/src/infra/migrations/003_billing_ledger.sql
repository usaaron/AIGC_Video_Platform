CREATE TABLE IF NOT EXISTS billing_ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL,
  related_entry_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('grant', 'generation', 'adjustment')),
  amount INTEGER NOT NULL,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  description TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_ledger_entries_reference_unique
  ON billing_ledger_entries (tenant_id, user_id, reference_id);

CREATE INDEX IF NOT EXISTS billing_ledger_entries_user_idx
  ON billing_ledger_entries (user_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_ledger_entries_related_idx
  ON billing_ledger_entries (related_entry_id);

CREATE INDEX IF NOT EXISTS billing_ledger_entries_created_idx
  ON billing_ledger_entries (created_at DESC);
