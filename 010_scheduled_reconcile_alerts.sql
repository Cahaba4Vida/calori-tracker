create table if not exists user_profiles (
  user_id text primary key,
  email text,
  created_at timestamptz default now()
);

create table if not exists calorie_goals (
  user_id text primary key references user_profiles(user_id) on delete cascade,
  daily_calories integer not null,
  updated_at timestamptz default now()
);

create table if not exists food_entries (
  id bigserial primary key,
  user_id text not null references user_profiles(user_id) on delete cascade,
  taken_at timestamptz not null default now(),
  entry_date date not null,
  calories integer not null,
  protein_g integer,
  carbs_g integer,
  fat_g integer,
  raw_extraction jsonb,
  created_at timestamptz default now()
);

create index if not exists food_entries_user_date_idx on food_entries(user_id, entry_date);

create table if not exists daily_weights (
  user_id text not null references user_profiles(user_id) on delete cascade,
  entry_date date not null,
  weight_lbs numeric(6,2) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, entry_date)
);

create index if not exists daily_weights_user_date_idx on daily_weights(user_id, entry_date);

create table if not exists daily_summaries (
  user_id text not null references user_profiles(user_id) on delete cascade,
  entry_date date not null,
  total_calories integer not null,
  goal_calories integer,
  score integer not null,
  tips text not null,
  created_at timestamptz default now(),
  primary key (user_id, entry_date)
);
