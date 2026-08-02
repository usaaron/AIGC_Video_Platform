CREATE TABLE IF NOT EXISTS billing_payment_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  checkout_type TEXT NOT NULL CHECK (checkout_type IN ('subscription', 'credits')),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  provider_payment_intent_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'expired', 'cancelled', 'refunded')),
  plan TEXT CHECK (plan IS NULL OR plan IN ('free', 'member')),
  credits INTEGER CHECK (credits IS NULL OR credits > 0),
  amount_total INTEGER CHECK (amount_total IS NULL OR amount_total >= 0),
  amount_refunded INTEGER NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  currency TEXT,
  checkout_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_sessions_provider_session_unique
  ON billing_payment_sessions (provider, provider_session_id);

CREATE INDEX IF NOT EXISTS billing_payment_sessions_membership_idx
  ON billing_payment_sessions (membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_payment_sessions_subscription_idx
  ON billing_payment_sessions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_payment_sessions_payment_intent_idx
  ON billing_payment_sessions (provider, provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_payment_reconciliation_items (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_session_id TEXT REFERENCES billing_payment_sessions(id) ON DELETE SET NULL,
  billing_webhook_event_id TEXT REFERENCES billing_webhook_events(id) ON DELETE SET NULL,
  ledger_entry_id TEXT REFERENCES billing_ledger_entries(id) ON DELETE SET NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'ignored', 'failed')),
  amount INTEGER,
  currency TEXT,
  credits INTEGER,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_reconciliation_provider_event_unique
  ON billing_payment_reconciliation_items (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS billing_payment_reconciliation_membership_idx
  ON billing_payment_reconciliation_items (membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_payment_reconciliation_created_idx
  ON billing_payment_reconciliation_items (created_at DESC);
