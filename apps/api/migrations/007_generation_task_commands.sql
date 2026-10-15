alter table generation_tasks
  drop constraint if exists generation_tasks_status_check;

alter table generation_tasks
  add constraint generation_tasks_status_check
  check (status in ('queued', 'paused', 'running', 'completed', 'failed', 'cancelled'));
