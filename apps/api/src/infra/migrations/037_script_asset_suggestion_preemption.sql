-- Include slow asset analysis in the account-scoped script preemption lookup.
CREATE INDEX IF NOT EXISTS generation_tasks_script_preemptible_account_active_idx
  ON generation_tasks (tenant_id, user_id, created_at ASC)
  WHERE kind = 'text'
    AND provider = 'text'
    AND status IN ('queued', 'paused', 'running')
    AND metadata->>'generationStage' LIKE 'script-%'
    AND metadata->>'scriptOperation' IN ('generate', 'enrich', 'suggest-assets')
    AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string';
