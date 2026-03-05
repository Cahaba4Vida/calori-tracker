-- Adds cent-based pricing fields to allow arbitrary $ amounts (e.g., 4.99) without Stripe Price IDs.
-- Safe: keeps legacy *_price_usd integer columns for backwards compatibility.

alter table app_admin_settings
  add column if not exists monthly_price_cents integer,
  add column if not exists yearly_price_cents integer;

-- Backfill from legacy integer dollars if cents are null
update app_admin_settings
set monthly_price_cents = coalesce(monthly_price_cents, monthly_price_usd * 100),
    yearly_price_cents  = coalesce(yearly_price_cents, yearly_price_usd * 100)
where singleton = true;

-- Ensure not null defaults (if table existed but had no row, admin-goals-set will upsert)
alter table app_admin_settings
  alter column monthly_price_cents set default 500,
  alter column yearly_price_cents  set default 5000;
