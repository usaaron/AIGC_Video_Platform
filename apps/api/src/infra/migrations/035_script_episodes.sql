CREATE TABLE IF NOT EXISTS script_episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL CHECK (episode_number > 0),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  draft_content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved')),
  summary TEXT NOT NULL DEFAULT '',
  continuity_state JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(continuity_state) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_edited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT script_episodes_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT script_episodes_project_number_unique UNIQUE (project_id, episode_number),
  CONSTRAINT script_episodes_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS script_episodes_project_updated_idx
  ON script_episodes (project_id, episode_number, updated_at DESC);

INSERT INTO script_episodes (
  id, project_id, tenant_id, episode_number, title, content, status, summary,
  last_edited_by, created_at, updated_at
)
SELECT
  'legacy-' || project.id,
  project.id,
  project.tenant_id,
  1,
  '第 1 集',
  project.script,
  'saved',
  LEFT(regexp_replace(project.script, E'\\s+', ' ', 'g'), 500),
  project.owner_user_id,
  project.created_at,
  project.updated_at
FROM projects project
WHERE project.content_type = 'short-drama'
  AND btrim(project.script) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM script_episodes episode WHERE episode.project_id = project.id
  )
ON CONFLICT DO NOTHING;

ALTER TABLE shots
  ADD COLUMN IF NOT EXISTS script_episode_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shots_script_episode_fk'
  ) THEN
    ALTER TABLE shots
      ADD CONSTRAINT shots_script_episode_fk
      FOREIGN KEY (script_episode_id)
      REFERENCES script_episodes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE shots shot
SET script_episode_id = episode.id
FROM script_episodes episode
WHERE shot.script_episode_id IS NULL
  AND shot.project_id = episode.project_id
  AND shot.tenant_id = episode.tenant_id
  AND shot.episode_number = episode.episode_number;

CREATE INDEX IF NOT EXISTS shots_script_episode_order_idx
  ON shots (script_episode_id, shot_order)
  WHERE script_episode_id IS NOT NULL;
