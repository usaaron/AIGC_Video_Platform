ALTER TABLE shots
  ADD COLUMN IF NOT EXISTS selected_image_task_id TEXT,
  ADD COLUMN IF NOT EXISTS selected_video_task_id TEXT;

