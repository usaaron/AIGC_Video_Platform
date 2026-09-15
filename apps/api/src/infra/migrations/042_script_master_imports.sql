CREATE TABLE IF NOT EXISTS script_master_imports (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  source_project_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  payload_hash TEXT NOT NULL,
  receipt JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS script_master_imports_source_idx
  ON script_master_imports (tenant_id, actor_id, target_project_id, source_project_id, source_revision);
