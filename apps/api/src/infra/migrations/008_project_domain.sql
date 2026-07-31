CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('short-drama', 'advertisement', 'animation')),
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('9:16', '16:9', '1:1')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'producing', 'completed', 'archived')),
  synopsis TEXT NOT NULL DEFAULT '',
  script TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS projects_tenant_updated_idx
  ON projects (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS projects_owner_idx
  ON projects (owner_user_id, tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS projects_status_idx
  ON projects (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  script TEXT NOT NULL DEFAULT '',
  project_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(project_snapshot) = 'object'),
  assets_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assets_snapshot) = 'array'),
  shots_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(shots_snapshot) = 'array'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_versions_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT project_versions_project_version_unique UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS project_versions_tenant_created_idx
  ON project_versions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS project_versions_project_snapshot_gin
  ON project_versions USING GIN (project_snapshot);

CREATE INDEX IF NOT EXISTS project_versions_assets_snapshot_gin
  ON project_versions USING GIN (assets_snapshot);

CREATE INDEX IF NOT EXISTS project_versions_shots_snapshot_gin
  ON project_versions USING GIN (shots_snapshot);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('character', 'scene', 'prop', 'costume', 'audio')),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('import', 'generate')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  prompt_mode TEXT NOT NULL DEFAULT 'standard' CHECK (prompt_mode IN ('standard', 'advanced')),
  custom_prompt_mode TEXT NOT NULL DEFAULT 'append' CHECK (custom_prompt_mode IN ('append', 'replace')),
  custom_prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  reference_items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reference_items) = 'array'),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assets_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS assets_project_kind_idx
  ON assets (project_id, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS assets_project_status_idx
  ON assets (project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS assets_tenant_updated_idx
  ON assets (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS assets_attributes_gin
  ON assets USING GIN (attributes);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  shot_order INTEGER NOT NULL CHECK (shot_order > 0),
  title TEXT NOT NULL,
  framing TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  continuity_mode TEXT NOT NULL DEFAULT 'independent' CHECK (continuity_mode IN ('independent', 'continue')),
  continuity_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shots_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT shots_project_order_unique UNIQUE (project_id, shot_order) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS shots_tenant_updated_idx
  ON shots (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'video', 'audio')),
  label TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'local',
  model TEXT,
  tier TEXT CHECK (tier IS NULL OR tier IN ('mini', 'fast', 'pro')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('queued', 'paused', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  estimated_credits INTEGER NOT NULL DEFAULT 0 CHECK (estimated_credits >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER CHECK (max_attempts IS NULL OR (max_attempts >= 1 AND max_attempts <= 10)),
  lease_owner_id TEXT,
  lease_token TEXT,
  lease_acquired_at TIMESTAMPTZ,
  lease_heartbeat_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  result_url TEXT,
  outputs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(outputs) = 'array'),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT generation_tasks_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT generation_tasks_client_request_unique UNIQUE (tenant_id, user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS generation_tasks_project_created_idx
  ON generation_tasks (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generation_tasks_user_created_idx
  ON generation_tasks (user_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generation_tasks_status_created_idx
  ON generation_tasks (status, created_at ASC);

CREATE INDEX IF NOT EXISTS generation_tasks_lease_expires_idx
  ON generation_tasks (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS generation_tasks_metadata_gin
  ON generation_tasks USING GIN (metadata);

CREATE INDEX IF NOT EXISTS generation_tasks_outputs_gin
  ON generation_tasks USING GIN (outputs);

CREATE INDEX IF NOT EXISTS generation_tasks_project_shot_video_idx
  ON generation_tasks (project_id, ((metadata ->> 'shotId')), updated_at DESC)
  WHERE kind = 'video';

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  shot_id TEXT REFERENCES shots(id) ON DELETE SET NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'document', 'other')),
  purpose TEXT NOT NULL DEFAULT 'upload',
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  storage_driver TEXT NOT NULL DEFAULT 'local',
  storage_key TEXT NOT NULL,
  bucket TEXT,
  checksum_sha256 TEXT,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_seconds NUMERIC(12, 3) CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_objects_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS media_objects_storage_unique
  ON media_objects (storage_driver, storage_key);

CREATE INDEX IF NOT EXISTS media_objects_project_created_idx
  ON media_objects (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS media_objects_tenant_created_idx
  ON media_objects (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS media_objects_task_idx
  ON media_objects (generation_task_id);

CREATE INDEX IF NOT EXISTS media_objects_asset_idx
  ON media_objects (asset_id);

CREATE INDEX IF NOT EXISTS media_objects_shot_idx
  ON media_objects (shot_id);

CREATE INDEX IF NOT EXISTS media_objects_metadata_gin
  ON media_objects USING GIN (metadata);
