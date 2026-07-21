create unique index if not exists users_id_tenant_unique_idx on users (id, tenant_id);
create unique index if not exists projects_id_tenant_unique_idx on projects (id, tenant_id);
create unique index if not exists media_storage_key_unique_idx on media (storage_key);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_owner_tenant_fk') then
    alter table projects
      add constraint projects_owner_tenant_fk
      foreign key (owner_id, tenant_id) references users (id, tenant_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'assets_project_tenant_fk') then
    alter table assets
      add constraint assets_project_tenant_fk
      foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'shots_project_tenant_fk') then
    alter table shots
      add constraint shots_project_tenant_fk
      foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'generation_tasks_project_tenant_fk') then
    alter table generation_tasks
      add constraint generation_tasks_project_tenant_fk
      foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'generation_tasks_user_tenant_fk') then
    alter table generation_tasks
      add constraint generation_tasks_user_tenant_fk
      foreign key (user_id, tenant_id) references users (id, tenant_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_user_tenant_fk') then
    alter table ledger_entries
      add constraint ledger_entries_user_tenant_fk
      foreign key (user_id, tenant_id) references users (id, tenant_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'media_project_tenant_fk') then
    alter table media
      add constraint media_project_tenant_fk
      foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade;
  end if;
end $$;
