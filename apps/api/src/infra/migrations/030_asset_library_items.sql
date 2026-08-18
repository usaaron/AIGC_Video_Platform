CREATE TABLE IF NOT EXISTS asset_library_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'character',
      'scene',
      'prop',
      'costume',
      'audio',
      'image',
      'script',
      'video',
      'final-cut'
    )
  ),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_project_id TEXT,
  source_project_name TEXT,
  source_asset_id TEXT,
  source_task_id TEXT,
  source_media_id TEXT,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshot) = 'object'),
  storage_key TEXT NOT NULL,
  preview_storage_key TEXT,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_library_items_storage_key_unique
  ON asset_library_items (storage_key);

CREATE INDEX IF NOT EXISTS asset_library_items_owner_created_idx
  ON asset_library_items (tenant_id, owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS asset_library_items_owner_kind_idx
  ON asset_library_items (tenant_id, owner_user_id, kind, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS asset_library_items_source_project_idx
  ON asset_library_items (tenant_id, owner_user_id, source_project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS asset_library_items_tags_gin
  ON asset_library_items USING GIN (tags);

CREATE INDEX IF NOT EXISTS asset_library_items_source_snapshot_gin
  ON asset_library_items USING GIN (source_snapshot);
