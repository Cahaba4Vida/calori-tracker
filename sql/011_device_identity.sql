create table if not exists device_identities (
  device_id text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists user_device_links (
  user_id text not null references user_profiles(user_id) on delete cascade,
  device_id text not null references device_identities(device_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists user_device_links_device_last_seen_idx
  on user_device_links(device_id, last_seen_at desc);

create index if not exists user_device_links_user_last_seen_idx
  on user_device_links(user_id, last_seen_at desc);
