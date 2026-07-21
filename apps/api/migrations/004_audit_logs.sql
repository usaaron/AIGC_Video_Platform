create table if not exists audit_logs (
  id text primary key,
  request_id text not null,
  trace_id text not null,
  tenant_id text,
  user_id text,
  roles text[] not null default '{}'::text[],
  method text not null,
  route_pattern text,
  path text not null,
  action text not null,
  status_code integer not null,
  outcome text not null check (outcome in ('success', 'failure')),
  ip text,
  user_agent text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);
create index if not exists audit_logs_request_idx on audit_logs (request_id);
