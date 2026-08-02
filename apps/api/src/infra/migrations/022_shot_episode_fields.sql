ALTER TABLE shots
  ADD COLUMN IF NOT EXISTS episode_break_before BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS episode_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS episode_title TEXT NOT NULL DEFAULT '主故事',
  ADD COLUMN IF NOT EXISTS episode_kind TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shots_episode_kind_check'
  ) THEN
    ALTER TABLE shots
      ADD CONSTRAINT shots_episode_kind_check
      CHECK (episode_kind IN ('standard', 'hook'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS shots_project_episode_idx
  ON shots (project_id, episode_number, shot_order);
