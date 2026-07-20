alter table shots
  add column if not exists asset_ids text[] not null default '{}';
