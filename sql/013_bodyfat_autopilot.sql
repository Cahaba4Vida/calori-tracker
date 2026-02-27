-- 013_bodyfat_autopilot.sql
-- Add body fat goal fields and optional body fat % tracking to daily weights.

alter table user_profiles
  add column if not exists goal_body_fat_percent numeric(5,2),
  add column if not exists goal_body_fat_date date;

alter table daily_weights
  add column if not exists body_fat_percent numeric(5,2);
