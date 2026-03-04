-- Referral system + timeboxed premium.

alter table user_profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by text,
  add column if not exists referral_count integer default 0,
  add column if not exists premium_expires_at timestamptz;

create table if not exists referrals (
  id bigserial primary key,
  referrer_user_id text not null,
  referred_user_id text not null,
  created_at timestamptz default now(),
  reward_granted boolean default false
);

create unique index if not exists referrals_referred_user_uniq
  on referrals(referred_user_id);

create index if not exists referrals_referrer_idx
  on referrals(referrer_user_id, created_at desc);
