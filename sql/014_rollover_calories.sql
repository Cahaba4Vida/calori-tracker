-- 014_rollover_calories.sql
alter table user_profiles
  add column if not exists rollover_enabled boolean not null default false,
  add column if not exists rollover_cap integer not null default 500;
