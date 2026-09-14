CREATE TABLE IF NOT EXISTS script_master_deliveries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_project_id TEXT NOT NULL,
  source_project_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  imported_episodes INTEGER CHECK (imported_episodes IS NULL OR imported_episodes >= 0),
  updated_episodes INTEGER CHECK (updated_episodes IS NULL OR updated_episodes >= 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT script_master_delivery_key_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS script_master_deliveries_project_idx
  ON script_master_deliveries (tenant_id, target_project_id, created_at DESC);
