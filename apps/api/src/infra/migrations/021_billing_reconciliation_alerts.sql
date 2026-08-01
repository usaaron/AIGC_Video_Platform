CREATE TABLE IF NOT EXISTS billing_reconciliation_alerts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  payment_session_id TEXT REFERENCES billing_payment_sessions(id) ON DELETE SET NULL,
  reconciliation_item_id TEXT REFERENCES billing_payment_reconciliation_items(id) ON DELETE SET NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  notified_at TIMESTAMPTZ,
  acknowledged_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_reconciliation_alerts_provider_event_unique
  ON billing_reconciliation_alerts (provider, provider_event_id, alert_type);

CREATE INDEX IF NOT EXISTS billing_reconciliation_alerts_status_idx
  ON billing_reconciliation_alerts (status, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_reconciliation_alerts_membership_idx
  ON billing_reconciliation_alerts (membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_reconciliation_alerts_created_idx
  ON billing_reconciliation_alerts (created_at DESC);
