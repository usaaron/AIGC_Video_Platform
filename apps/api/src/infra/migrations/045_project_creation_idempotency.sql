CREATE TABLE IF NOT EXISTS project_creation_requests (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  project_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_creation_requests_pk PRIMARY KEY (tenant_id, user_id, idempotency_key),
  CONSTRAINT project_creation_requests_project_id_present CHECK (length(project_id) > 0)
);

CREATE INDEX IF NOT EXISTS project_creation_requests_created_idx
  ON project_creation_requests (created_at);
