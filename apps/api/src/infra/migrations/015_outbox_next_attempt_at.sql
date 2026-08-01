ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS outbox_events_pending_due_idx
  ON outbox_events (status, next_attempt_at ASC, created_at ASC)
  WHERE status IN ('pending', 'processing', 'failed');
