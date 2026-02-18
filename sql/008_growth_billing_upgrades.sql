alter table app_admin_settings
  add column if not exists free_food_entries_per_day integer not null default 5,
  add column if not exists free_ai_actions_per_day integer not null default 5,
  add column if not exists free_history_days integer not null default 20,
  add column if not exists monthly_price_usd integer not null default 5,
  add column if not exists yearly_price_usd integer not null default 50,
  add column if not exists monthly_upgrade_url text,
  add column if not exists yearly_upgrade_url text,
  add column if not exists manage_subscription_url text;

create table if not exists stripe_webhook_events (
  id bigserial primary key,
  stripe_event_id text,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed boolean not null default false,
  process_result text,
  error_message text,
  user_id text,
  subscription_id text,
  subscription_status text,
  payload jsonb
);

create index if not exists stripe_webhook_events_received_idx on stripe_webhook_events(received_at desc);
create index if not exists stripe_webhook_events_event_id_idx on stripe_webhook_events(stripe_event_id);
create index if not exists stripe_webhook_events_processed_idx on stripe_webhook_events(processed, received_at desc);
