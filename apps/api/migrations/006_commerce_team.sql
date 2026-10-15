create table if not exists billing_subscriptions (
  tenant_id text primary key references tenants(id) on delete cascade,
  provider text not null check (provider in ('mock', 'stripe', 'wechat-pay', 'alipay')),
  package_id text not null,
  status text not null check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  seat_limit integer not null check (seat_limit > 0),
  active_seats integer not null default 1 check (active_seats >= 0),
  watermark_required boolean not null default true,
  commercial_license_enabled boolean not null default false,
  starts_at timestamptz not null,
  renews_at timestamptz,
  updated_at timestamptz not null
);

create index if not exists billing_subscriptions_status_idx on billing_subscriptions (status, updated_at desc);

create table if not exists billing_checkout_sessions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id),
  provider text not null check (provider in ('mock', 'stripe', 'wechat-pay', 'alipay')),
  package_id text not null,
  status text not null check (status in ('created', 'pending', 'completed', 'cancelled', 'expired')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  checkout_url text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists billing_checkout_sessions_tenant_created_idx
  on billing_checkout_sessions (tenant_id, created_at desc);
create index if not exists billing_checkout_sessions_user_created_idx
  on billing_checkout_sessions (user_id, created_at desc);

create table if not exists project_shares (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  shared_with_user_id text references users(id),
  shared_with_email text,
  permission text not null check (permission in ('view', 'comment', 'edit')),
  comment_approval_required boolean not null default true,
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (shared_with_user_id is not null or shared_with_email is not null)
);

create unique index if not exists project_shares_project_user_unique_idx
  on project_shares (project_id, shared_with_user_id)
  where shared_with_user_id is not null;
create unique index if not exists project_shares_project_email_unique_idx
  on project_shares (project_id, lower(shared_with_email))
  where shared_with_email is not null;
create index if not exists project_shares_tenant_status_idx on project_shares (tenant_id, status);
create index if not exists project_shares_user_status_idx on project_shares (shared_with_user_id, status);

create table if not exists project_comments (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  target_type text not null check (target_type in ('project', 'asset', 'shot', 'film')),
  target_id text not null default '',
  author_user_id text references users(id),
  author_name text not null,
  body text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_user_id text references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists project_comments_project_status_idx
  on project_comments (project_id, status, created_at desc);
create index if not exists project_comments_tenant_status_idx
  on project_comments (tenant_id, status, created_at desc);
create index if not exists project_comments_target_idx
  on project_comments (project_id, target_type, target_id, created_at desc);
