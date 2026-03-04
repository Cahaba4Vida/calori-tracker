-- Onboarding V2 fields (adds basic attribution + personalization)
-- Safe to run multiple times.

alter table user_profiles
  add column if not exists goal_mode text,
  add column if not exists age_years integer,
  add column if not exists height_in integer,
  add column if not exists current_weight_lbs numeric,
  add column if not exists target_weight_lbs numeric,
  add column if not exists tracking_experience text,
  add column if not exists heard_about text,
  add column if not exists previous_app text;

create index if not exists user_profiles_onboarding_v2_idx
  on user_profiles(onboarding_completed, created_at);
