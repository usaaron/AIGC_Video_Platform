CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  organization_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  request_id TEXT,
  trace_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('api', 'worker', 'provider')),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'api_request',
      'provider_usage',
      'job_started',
      'job_finished',
      'job_failed',
      'job_cancelled'
    )
  ),
  route_key TEXT,
  method TEXT,
  status_code INTEGER CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  provider TEXT,
  model TEXT,
  operation TEXT,
  job_id TEXT,
  job_source TEXT CHECK (job_source IS NULL OR job_source IN ('generation_task', 'ai_job')),
  job_kind TEXT,
  task_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  provider_units NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (provider_units >= 0),
  estimated BOOLEAN NOT NULL DEFAULT false,
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_occurred_idx
  ON usage_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_tenant_occurred_idx
  ON usage_events (tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_organization_occurred_idx
  ON usage_events (organization_id, occurred_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_user_occurred_idx
  ON usage_events (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_membership_occurred_idx
  ON usage_events (membership_id, occurred_at DESC)
  WHERE membership_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_request_idx
  ON usage_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_trace_idx
  ON usage_events (trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_source_type_occurred_idx
  ON usage_events (source, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_provider_model_occurred_idx
  ON usage_events (provider, model, occurred_at DESC)
  WHERE provider IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_job_idx
  ON usage_events (job_id, job_source)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_metadata_gin
  ON usage_events USING GIN (metadata);

CREATE TABLE IF NOT EXISTS usage_minute_rollups (
  minute_bucket TIMESTAMPTZ NOT NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  organization_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  tenant_key TEXT NOT NULL DEFAULT 'all',
  organization_key TEXT NOT NULL DEFAULT 'all',
  user_key TEXT NOT NULL DEFAULT 'all',
  source TEXT NOT NULL DEFAULT 'all' CHECK (source IN ('all', 'api', 'worker', 'provider')),
  route_key TEXT NOT NULL DEFAULT 'all',
  provider TEXT NOT NULL DEFAULT 'all',
  model TEXT NOT NULL DEFAULT 'all',
  request_count BIGINT NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  error_count BIGINT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  credits_used BIGINT NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  provider_units NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (provider_units >= 0),
  estimated_event_count BIGINT NOT NULL DEFAULT 0 CHECK (estimated_event_count >= 0),
  max_latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (max_latency_ms >= 0),
  total_latency_ms BIGINT NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
  latency_sample_count BIGINT NOT NULL DEFAULT 0 CHECK (latency_sample_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT usage_minute_rollups_bucket_minute_check
    CHECK (date_trunc('minute', minute_bucket) = minute_bucket),
  CONSTRAINT usage_minute_rollups_scope_key_check
    CHECK (
      (tenant_id IS NULL OR tenant_key = tenant_id)
      AND (organization_id IS NULL OR organization_key = organization_id)
      AND (user_id IS NULL OR user_key = user_id)
    ),
  CONSTRAINT usage_minute_rollups_primary
    PRIMARY KEY (
      minute_bucket,
      tenant_key,
      organization_key,
      user_key,
      source,
      route_key,
      provider,
      model
    )
);

CREATE INDEX IF NOT EXISTS usage_minute_rollups_minute_idx
  ON usage_minute_rollups (minute_bucket DESC);

CREATE INDEX IF NOT EXISTS usage_minute_rollups_tenant_minute_idx
  ON usage_minute_rollups (tenant_key, minute_bucket DESC);

CREATE INDEX IF NOT EXISTS usage_minute_rollups_organization_minute_idx
  ON usage_minute_rollups (organization_key, minute_bucket DESC);

CREATE INDEX IF NOT EXISTS usage_minute_rollups_user_minute_idx
  ON usage_minute_rollups (user_key, minute_bucket DESC);

CREATE INDEX IF NOT EXISTS usage_minute_rollups_source_minute_idx
  ON usage_minute_rollups (source, minute_bucket DESC);

CREATE INDEX IF NOT EXISTS usage_minute_rollups_provider_model_minute_idx
  ON usage_minute_rollups (provider, model, minute_bucket DESC);
