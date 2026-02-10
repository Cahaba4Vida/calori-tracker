alter table user_profiles
  add column if not exists plan_tier text not null default 'free',
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_current_period_end timestamptz;

create index if not exists user_profiles_plan_tier_idx on user_profiles(plan_tier);

create table if not exists ai_usage_events (
  id bigserial primary key,
  user_id text not null references user_profiles(user_id) on delete cascade,
  entry_date date not null,
  action_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_user_date_idx on ai_usage_events(user_id, entry_date);
create index if not exists ai_usage_events_user_created_idx on ai_usage_events(user_id, created_at desc);
