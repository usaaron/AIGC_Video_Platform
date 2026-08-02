CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'text',
  input JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  output JSONB CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('queued', 'paused', 'running', 'completed', 'failed', 'cancelled')),
  cost_credits INTEGER NOT NULL DEFAULT 0 CHECK (cost_credits >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER CHECK (max_attempts IS NULL OR (max_attempts >= 1 AND max_attempts <= 10)),
  lease_owner_id TEXT,
  lease_token TEXT,
  lease_acquired_at TIMESTAMPTZ,
  lease_heartbeat_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  error TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_jobs_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ai_jobs_client_request_unique UNIQUE (tenant_id, user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS ai_jobs_project_created_idx
  ON ai_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_jobs_user_created_idx
  ON ai_jobs (user_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_jobs_status_created_idx
  ON ai_jobs (status, created_at ASC);

CREATE INDEX IF NOT EXISTS ai_jobs_kind_status_idx
  ON ai_jobs (kind, status, created_at ASC);

CREATE INDEX IF NOT EXISTS ai_jobs_lease_expires_idx
  ON ai_jobs (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_jobs_input_gin
  ON ai_jobs USING GIN (input);

CREATE INDEX IF NOT EXISTS ai_jobs_output_gin
  ON ai_jobs USING GIN (output);
