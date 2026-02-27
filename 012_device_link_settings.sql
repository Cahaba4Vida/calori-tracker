create table if not exists subscription_reconcile_runs (
  id bigserial primary key,
  actor text not null,
  checked int not null default 0,
  updated int not null default 0,
  errors int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_reconcile_runs_created_at on subscription_reconcile_runs(created_at desc);

create table if not exists alert_notifications (
  id bigserial primary key,
  alert_type text not null,
  severity text not null,
  payload jsonb not null,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_alert_notifications_created_at on alert_notifications(created_at desc);
