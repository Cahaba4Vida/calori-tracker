alter table user_profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists macro_protein_g integer,
  add column if not exists macro_carbs_g integer,
  add column if not exists macro_fat_g integer,
  add column if not exists goal_weight_lbs numeric,
  add column if not exists activity_level text,
  add column if not exists goal_date date;
