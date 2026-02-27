create table if not exists feedback_campaigns (
  id bigserial primary key,
  title text not null,
  question text not null,
  placeholder text,
  submit_label text,
  is_active boolean not null default false,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists feedback_campaigns_active_idx
  on feedback_campaigns(is_active, id desc);

create table if not exists feedback_responses (
  campaign_id bigint not null references feedback_campaigns(id) on delete cascade,
  user_id text not null,
  response_text text not null,
  submitted_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create index if not exists feedback_responses_campaign_idx
  on feedback_responses(campaign_id, submitted_at desc);
