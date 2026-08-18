ALTER TABLE asset_library_items
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_of_item_id TEXT,
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

UPDATE asset_library_items
SET content_hash = 'legacy:' || id
WHERE content_hash IS NULL OR content_hash = '';

ALTER TABLE asset_library_items
  ALTER COLUMN content_hash SET NOT NULL;

ALTER TABLE asset_library_items
  ADD CONSTRAINT asset_library_items_current_version_positive
    CHECK (current_version > 0) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'asset_library_items_duplicate_of_item_id_fkey'
  ) THEN
    ALTER TABLE asset_library_items
      ADD CONSTRAINT asset_library_items_duplicate_of_item_id_fkey
      FOREIGN KEY (duplicate_of_item_id)
      REFERENCES asset_library_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS asset_library_items_owner_hash_idx
  ON asset_library_items (tenant_id, owner_user_id, kind, content_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS asset_library_items_deleted_idx
  ON asset_library_items (tenant_id, owner_user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS asset_library_item_versions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES asset_library_items(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshot) = 'object'),
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (item_id, version)
);

CREATE INDEX IF NOT EXISTS asset_library_item_versions_owner_item_idx
  ON asset_library_item_versions (tenant_id, owner_user_id, item_id, version DESC);

CREATE INDEX IF NOT EXISTS asset_library_item_versions_hash_idx
  ON asset_library_item_versions (tenant_id, owner_user_id, content_hash);

INSERT INTO asset_library_item_versions (
  id,
  item_id,
  tenant_id,
  owner_user_id,
  version,
  source_snapshot,
  storage_key,
  content_type,
  size_bytes,
  content_hash,
  created_at,
  created_by
)
SELECT
  id || ':v1',
  id,
  tenant_id,
  owner_user_id,
  1,
  source_snapshot,
  storage_key,
  content_type,
  size_bytes,
  content_hash,
  created_at,
  owner_user_id
FROM asset_library_items
ON CONFLICT (item_id, version) DO NOTHING;
