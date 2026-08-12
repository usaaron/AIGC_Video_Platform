ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visual_style TEXT NOT NULL DEFAULT 'cinematic-cg';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS episode_duration_seconds INTEGER NOT NULL DEFAULT 60;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_visual_style_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_visual_style_check
  CHECK (
    visual_style IN (
      'photorealistic',
      'cinematic-cg',
      'chinese-3d',
      'chinese-2d',
      'anime',
      'storybook'
    )
  );

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_episode_duration_seconds_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_episode_duration_seconds_check
  CHECK (episode_duration_seconds BETWEEN 5 AND 300);
