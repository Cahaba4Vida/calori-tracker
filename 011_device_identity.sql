create table if not exists app_events (
  id bigserial primary key,
  user_id text,
  event_name text not null,
  event_props jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_created_idx on app_events(created_at desc);
create index if not exists app_events_name_created_idx on app_events(event_name, created_at desc);
create index if not exists app_events_user_created_idx on app_events(user_id, created_at desc);

create table if not exists admin_audit_log (
  id bigserial primary key,
  action text not null,
  actor text,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log(created_at desc);

create unique index if not exists stripe_webhook_events_event_id_unique
  on stripe_webhook_events(stripe_event_id)
  where stripe_event_id is not null;
