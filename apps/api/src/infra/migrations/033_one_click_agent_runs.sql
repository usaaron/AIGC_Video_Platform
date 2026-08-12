CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id TEXT,
  original_prompt TEXT NOT NULL,
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'queued', 'running', 'pausing', 'paused', 'failed', 'completed', 'cancelled')
  ),
  pause_requested BOOLEAN NOT NULL DEFAULT false,
  current_stage TEXT CHECK (
    current_stage IS NULL OR current_stage IN (
      'script', 'asset-analysis', 'asset-generation', 'identity-baseline',
      'storyboard', 'video-generation', 'film-compose', 'delivery'
    )
  ),
  stages JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stages) = 'array'),
  deliveries JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deliveries) = 'array'),
  last_error TEXT,
  lease_owner_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT agent_runs_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_runs_client_request_unique UNIQUE (tenant_id, user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS agent_runs_owner_updated_idx
  ON agent_runs (tenant_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_runnable_idx
  ON agent_runs (status, updated_at ASC)
  WHERE status IN ('queued', 'running', 'pausing');

CREATE INDEX IF NOT EXISTS agent_runs_project_idx
  ON agent_runs (project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;
