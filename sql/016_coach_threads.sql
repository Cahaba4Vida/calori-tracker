-- 016_coach_threads.sql
-- Server-side threads for coach chat (typed + voice), maintains conversational context.

create table if not exists coach_threads (
  id text primary key,
  user_id text not null,
  created_at timestamptz default now(),
  last_active_at timestamptz default now()
);

create index if not exists coach_threads_user_last_active_idx
  on coach_threads(user_id, last_active_at desc);

create table if not exists coach_messages (
  id text primary key,
  thread_id text not null references coach_threads(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists coach_messages_thread_created_idx
  on coach_messages(thread_id, created_at asc);
