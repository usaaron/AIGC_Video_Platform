create table if not exists generation_task_logs (
  id text primary key,
  task_id text not null references generation_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  level text not null check (level in ('info', 'warn', 'error')),
  event text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists generation_task_logs_task_created_idx
  on generation_task_logs (task_id, created_at);

create index if not exists generation_task_logs_project_created_idx
  on generation_task_logs (project_id, created_at desc);

create index if not exists generation_task_logs_tenant_created_idx
  on generation_task_logs (tenant_id, created_at desc);
