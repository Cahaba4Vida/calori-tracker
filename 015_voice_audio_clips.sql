-- Stores raw voice clips for DB-first voice features (e.g., "add food via voice").
-- Audio is stored as bytes (bytea) to avoid relying on Blob/FormData in serverless runtimes.

create table if not exists voice_audio_clips (
  id text primary key,
  user_id text not null references user_profiles(user_id) on delete cascade,
  mime text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists voice_audio_clips_user_created_idx
  on voice_audio_clips(user_id, created_at desc);
