CREATE TABLE IF NOT EXISTS novel_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('txt', 'markdown')),
  character_count INTEGER NOT NULL CHECK (character_count > 0),
  chapter_count INTEGER NOT NULL CHECK (chapter_count > 0),
  content_storage_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  client_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_documents_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_documents_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT novel_documents_client_request_unique UNIQUE (tenant_id, project_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS novel_documents_project_updated_idx
  ON novel_documents (project_id, tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS novel_documents_content_hash_idx
  ON novel_documents (tenant_id, project_id, content_sha256);

CREATE TABLE IF NOT EXISTS novel_chapters (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_order INTEGER NOT NULL CHECK (chapter_order > 0),
  title TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= 0),
  source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
  source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= 0),
  source_chapter_title TEXT,
  split_mode TEXT NOT NULL CHECK (split_mode IN ('auto', 'heading', 'fixed')),
  overlap_before_chars INTEGER NOT NULL DEFAULT 0 CHECK (overlap_before_chars >= 0),
  overlap_after_chars INTEGER NOT NULL DEFAULT 0 CHECK (overlap_after_chars >= 0),
  crosses_chapter_boundary BOOLEAN NOT NULL DEFAULT false,
  character_count INTEGER NOT NULL CHECK (character_count > 0),
  preview TEXT NOT NULL DEFAULT '',
  preview_truncated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_chapters_document_fk
    FOREIGN KEY (document_id, tenant_id) REFERENCES novel_documents(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_chapters_project_fk
    FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_chapters_order_unique UNIQUE (document_id, chapter_order),
  CONSTRAINT novel_chapters_offsets_valid CHECK (end_offset >= start_offset AND source_end_offset >= source_start_offset)
);

CREATE INDEX IF NOT EXISTS novel_chapters_document_order_idx
  ON novel_chapters (document_id, tenant_id, chapter_order ASC);

CREATE INDEX IF NOT EXISTS novel_chapters_project_idx
  ON novel_chapters (project_id, tenant_id);

CREATE TABLE IF NOT EXISTS novel_boundaries (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  previous_chapter_id TEXT NOT NULL,
  next_chapter_id TEXT NOT NULL,
  previous_order INTEGER NOT NULL CHECK (previous_order > 0),
  next_order INTEGER NOT NULL CHECK (next_order > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ignored', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  issues JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  previous_tail TEXT NOT NULL,
  next_head TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_boundaries_document_fk
    FOREIGN KEY (document_id, tenant_id) REFERENCES novel_documents(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_boundaries_previous_chapter_fk
    FOREIGN KEY (previous_chapter_id) REFERENCES novel_chapters(id) ON DELETE CASCADE,
  CONSTRAINT novel_boundaries_next_chapter_fk
    FOREIGN KEY (next_chapter_id) REFERENCES novel_chapters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS novel_boundaries_document_order_idx
  ON novel_boundaries (document_id, tenant_id, previous_order ASC);

CREATE INDEX IF NOT EXISTS novel_boundaries_issues_gin
  ON novel_boundaries USING GIN (issues);

CREATE TABLE IF NOT EXISTS novel_chapter_summaries (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_order INTEGER NOT NULL CHECK (chapter_order > 0),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_events JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_events) = 'array'),
  characters JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(characters) = 'array'),
  locations JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(locations) = 'array'),
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(timeline) = 'array'),
  key_props JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_props) = 'array'),
  foreshadowing JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(foreshadowing) = 'array'),
  world_rules JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(world_rules) = 'array'),
  adaptation_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_chapter_summaries_document_fk
    FOREIGN KEY (document_id, tenant_id) REFERENCES novel_documents(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_chapter_summaries_chapter_fk
    FOREIGN KEY (chapter_id) REFERENCES novel_chapters(id) ON DELETE CASCADE,
  CONSTRAINT novel_chapter_summaries_chapter_unique UNIQUE (document_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS novel_chapter_summaries_document_order_idx
  ON novel_chapter_summaries (document_id, tenant_id, chapter_order ASC);

CREATE INDEX IF NOT EXISTS novel_chapter_summaries_characters_gin
  ON novel_chapter_summaries USING GIN (characters);

CREATE TABLE IF NOT EXISTS novel_summary_queues (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  batch_size INTEGER NOT NULL CHECK (batch_size >= 1 AND batch_size <= 24),
  force BOOLEAN NOT NULL DEFAULT false,
  total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  pending_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  running_count INTEGER NOT NULL DEFAULT 0 CHECK (running_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  client_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_summary_queues_document_fk
    FOREIGN KEY (document_id, tenant_id) REFERENCES novel_documents(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_summary_queues_client_request_unique UNIQUE (tenant_id, document_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS novel_summary_queues_document_created_idx
  ON novel_summary_queues (document_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS novel_summary_queues_status_updated_idx
  ON novel_summary_queues (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS novel_summary_queue_items (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_order INTEGER NOT NULL CHECK (chapter_order > 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts >= 1 AND max_attempts <= 5),
  character_count INTEGER NOT NULL CHECK (character_count > 0),
  source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
  source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= 0),
  source_chapter_title TEXT,
  crosses_chapter_boundary BOOLEAN NOT NULL DEFAULT false,
  summary_id TEXT,
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_message TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_summary_queue_items_queue_fk
    FOREIGN KEY (queue_id) REFERENCES novel_summary_queues(id) ON DELETE CASCADE,
  CONSTRAINT novel_summary_queue_items_document_fk
    FOREIGN KEY (document_id, tenant_id) REFERENCES novel_documents(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_summary_queue_items_chapter_fk
    FOREIGN KEY (chapter_id) REFERENCES novel_chapters(id) ON DELETE CASCADE,
  CONSTRAINT novel_summary_queue_items_summary_fk
    FOREIGN KEY (summary_id) REFERENCES novel_chapter_summaries(id) ON DELETE SET NULL,
  CONSTRAINT novel_summary_queue_items_queue_chapter_unique UNIQUE (queue_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS novel_summary_queue_items_queue_order_idx
  ON novel_summary_queue_items (queue_id, tenant_id, chapter_order ASC);

CREATE INDEX IF NOT EXISTS novel_summary_queue_items_status_idx
  ON novel_summary_queue_items (queue_id, status, chapter_order ASC);

CREATE TABLE IF NOT EXISTS novel_story_bibles (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  logline TEXT NOT NULL,
  premise TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  themes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(themes) = 'array'),
  characters JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(characters) = 'array'),
  locations JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(locations) = 'array'),
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(timeline) = 'array'),
  key_props JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_props) = 'array'),
  foreshadowing JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(foreshadowing) = 'array'),
  world_rules JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(world_rules) = 'array'),
  adaptation_strategy TEXT NOT NULL,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risks) = 'array'),
  next_step TEXT NOT NULL,
  source_summary_count INTEGER NOT NULL CHECK (source_summary_count > 0),
  chapter_count INTEGER NOT NULL CHECK (chapter_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT novel_story_bibles_document_fk
    FOREIGN KEY (document_id, tenant_id) REFERENCES novel_documents(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT novel_story_bibles_document_unique UNIQUE (document_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS novel_story_bibles_tenant_updated_idx
  ON novel_story_bibles (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS novel_story_bibles_characters_gin
  ON novel_story_bibles USING GIN (characters);
