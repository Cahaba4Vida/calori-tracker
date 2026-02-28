-- Keep hot tables lean by archiving old rows and indexing date filters.

create table if not exists food_entries_archive (
  id bigint primary key,
  user_id text not null,
  taken_at timestamptz not null,
  entry_date date not null,
  calories integer not null,
  protein_g integer,
  carbs_g integer,
  fat_g integer,
  raw_extraction jsonb,
  created_at timestamptz,
  archived_at timestamptz not null default now()
);

create index if not exists food_entries_archive_user_date_idx
  on food_entries_archive(user_id, entry_date);

create table if not exists daily_summaries_archive (
  user_id text not null,
  entry_date date not null,
  total_calories integer not null,
  goal_calories integer,
  score integer not null,
  tips text not null,
  created_at timestamptz,
  archived_at timestamptz not null default now(),
  primary key (user_id, entry_date)
);

create index if not exists daily_summaries_archive_user_date_idx
  on daily_summaries_archive(user_id, entry_date);
