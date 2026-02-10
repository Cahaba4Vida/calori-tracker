alter table user_profiles
  add column if not exists quick_fills jsonb not null default '[]'::jsonb;
