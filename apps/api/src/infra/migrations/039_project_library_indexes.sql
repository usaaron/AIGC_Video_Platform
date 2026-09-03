-- Keep the project library and workspace preview queries index-only for the
-- rows they can actually display.
CREATE INDEX IF NOT EXISTS projects_active_tenant_updated_idx
  ON projects (tenant_id, updated_at DESC)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS projects_active_owner_updated_idx
  ON projects (owner_user_id, tenant_id, updated_at DESC)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS generation_tasks_project_visible_status_updated_idx
  ON generation_tasks (tenant_id, project_id, status, updated_at DESC, id DESC)
  WHERE jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string';

CREATE INDEX IF NOT EXISTS assets_project_preview_updated_idx
  ON assets (tenant_id, project_id, updated_at DESC, created_at DESC, id DESC)
  WHERE kind <> 'audio'
    AND (
      image_url IS NOT NULL
      OR attributes#>>'{faceReference,url}' IS NOT NULL
      OR reference_items->0->>'url' IS NOT NULL
    );

CREATE INDEX IF NOT EXISTS shots_project_image_order_idx
  ON shots (tenant_id, project_id, shot_order ASC, id ASC)
  WHERE image_url IS NOT NULL;
