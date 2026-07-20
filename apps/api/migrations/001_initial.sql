create table if not exists tenants (
  id text primary key,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists users (
  id text primary key,
  tenant_id text not null references tenants(id),
  email text not null,
  name text not null,
  password_hash text not null,
  roles text[] not null,
  plan text not null check (plan in ('free', 'member')),
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists users_tenant_email_unique_idx on users (tenant_id, lower(email));
create index if not exists users_tenant_idx on users (tenant_id);

create table if not exists projects (
  id text primary key,
  tenant_id text not null references tenants(id),
  owner_id text not null references users(id),
  name text not null,
  content_type text not null check (content_type in ('short-drama', 'advertisement', 'animation')),
  aspect_ratio text not null check (aspect_ratio in ('9:16', '16:9', '1:1')),
  status text not null check (status in ('draft', 'producing', 'completed', 'archived')),
  synopsis text not null default '',
  script text not null default '',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists projects_tenant_updated_idx on projects (tenant_id, updated_at desc);
create index if not exists projects_owner_idx on projects (owner_id);

create table if not exists assets (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id),
  kind text not null check (kind in ('character', 'scene', 'prop', 'costume', 'audio')),
  source_mode text not null check (source_mode in ('import', 'generate')),
  name text not null,
  description text not null default '',
  prompt text not null default '',
  prompt_mode text not null check (prompt_mode in ('standard', 'advanced')),
  custom_prompt_mode text not null check (custom_prompt_mode in ('append', 'replace')),
  custom_prompt text not null default '',
  negative_prompt text not null default '',
  references jsonb not null default '[]'::jsonb,
  attributes jsonb not null,
  image_url text,
  status text not null check (status in ('draft', 'confirmed')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists assets_project_kind_idx on assets (project_id, kind, updated_at desc);
create index if not exists assets_tenant_idx on assets (tenant_id);
create index if not exists assets_attributes_gin_idx on assets using gin (attributes);

create table if not exists shots (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id),
  order_index integer not null check (order_index > 0),
  title text not null,
  framing text not null,
  duration integer not null check (duration > 0),
  prompt text not null default '',
  asset_ids text[] not null default '{}',
  image_url text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (project_id, order_index)
);

create index if not exists shots_project_order_idx on shots (project_id, order_index);

create table if not exists generation_tasks (
  id text primary key,
  client_request_id text not null,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  kind text not null check (kind in ('text', 'image', 'video', 'audio')),
  label text not null,
  prompt text not null default '',
  negative_prompt text not null default '',
  provider text not null,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  estimated_credits integer not null default 0 check (estimated_credits >= 0),
  result_url text,
  outputs jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, client_request_id)
);

create index if not exists generation_tasks_project_idx on generation_tasks (project_id, created_at desc);
create index if not exists generation_tasks_tenant_status_idx on generation_tasks (tenant_id, status, created_at);
create index if not exists generation_tasks_running_user_idx on generation_tasks (user_id, status);

create table if not exists ledger_entries (
  id text primary key,
  user_id text not null references users(id),
  tenant_id text not null references tenants(id),
  amount integer not null,
  balance integer not null check (balance >= 0),
  type text not null check (type in ('grant', 'generation', 'adjustment')),
  description text not null,
  created_at timestamptz not null
);

create index if not exists ledger_entries_user_created_idx on ledger_entries (user_id, created_at desc);
create index if not exists ledger_entries_tenant_created_idx on ledger_entries (tenant_id, created_at desc);

create table if not exists media (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id),
  kind text not null check (kind in ('image', 'video', 'audio')),
  name text not null,
  content_type text not null,
  size integer not null check (size > 0),
  storage_key text not null,
  created_at timestamptz not null
);

create index if not exists media_project_idx on media (project_id, created_at desc);
create index if not exists media_tenant_idx on media (tenant_id);
