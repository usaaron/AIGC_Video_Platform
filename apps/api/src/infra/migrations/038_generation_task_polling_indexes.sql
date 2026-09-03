-- Keep the two high-frequency task list queries on narrow, visible-task indexes.
CREATE INDEX IF NOT EXISTS generation_tasks_project_visible_created_idx
  ON generation_tasks (project_id, tenant_id, created_at DESC, id DESC)
  WHERE jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string';

CREATE INDEX IF NOT EXISTS generation_tasks_user_visible_updated_idx
  ON generation_tasks (tenant_id, user_id, updated_at DESC, id DESC)
  WHERE jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string';

-- Worker runtime sync uses a global high-water mark across all tenants.
CREATE INDEX IF NOT EXISTS generation_tasks_runtime_sync_idx
  ON generation_tasks (updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS ai_jobs_runtime_sync_idx
  ON ai_jobs (updated_at ASC, id ASC);
