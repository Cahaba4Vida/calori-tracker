-- 013_voice_threads.sql
-- Voice mode server-side threads (auto-rotates after 4 hours of inactivity)

create table if not exists voice_threads (
  id text primary key,
  user_id text not null,
  created_at timestamptz default now(),
  last_active_at timestamptz default now()
);

create index if not exists voice_threads_user_last_active_idx
  on voice_threads(user_id, last_active_at desc);

create table if not exists voice_messages (
  id text primary key,
  thread_id text not null references voice_threads(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists voice_messages_thread_created_idx
  on voice_messages(thread_id, created_at asc);
