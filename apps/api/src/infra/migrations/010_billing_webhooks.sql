CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed')),
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  reference_id TEXT,
  plan TEXT CHECK (plan IS NULL OR plan IN ('free', 'member')),
  amount INTEGER,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_webhook_events_provider_event_unique
  ON billing_webhook_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS billing_webhook_events_membership_idx
  ON billing_webhook_events (membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_webhook_events_created_idx
  ON billing_webhook_events (created_at DESC);
