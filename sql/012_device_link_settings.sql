alter table if exists user_device_links
  add column if not exists device_name text,
  add column if not exists is_enabled boolean not null default true;

create index if not exists user_device_links_user_enabled_last_seen_idx
  on user_device_links(user_id, is_enabled, last_seen_at desc);
