CREATE TABLE IF NOT EXISTS trusted_validation_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  provider_token TEXT NOT NULL,
  h5_link TEXT NOT NULL,
  qr_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'uploading', 'completed', 'failed', 'expired')),
  group_id TEXT,
  provider_asset_id TEXT,
  error TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trusted_validation_sessions_owner_idx
  ON trusted_validation_sessions (tenant_id, user_id, project_id, asset_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS trusted_validation_sessions_expiry_idx
  ON trusted_validation_sessions (status, expires_at);
