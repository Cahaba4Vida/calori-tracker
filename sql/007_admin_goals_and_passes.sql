create table if not exists app_admin_settings (
  singleton boolean primary key default true,
  weekly_active_goal integer not null default 500,
  paying_users_goal integer not null default 30,
  updated_at timestamptz not null default now()
);

insert into app_admin_settings(singleton, weekly_active_goal, paying_users_goal)
values (true, 500, 30)
on conflict (singleton) do nothing;

alter table user_profiles
  add column if not exists premium_pass boolean not null default false,
  add column if not exists premium_pass_expires_at timestamptz,
  add column if not exists premium_pass_note text;

create index if not exists user_profiles_premium_pass_idx on user_profiles(premium_pass, premium_pass_expires_at);
