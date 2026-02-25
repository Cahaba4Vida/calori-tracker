const crypto = require('crypto');
const { json } = require('./_util');
const { query } = require('./_db');

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex');
}

async function ensureTables() {
  // Tables for ambassador auth + pricing + referral attribution.
  await query(`
    create table if not exists admin_ambassadors (
      id bigserial primary key,
      email text unique not null,
      referral_code text unique,
      name text,
      notes text,
      token_hash text not null,
      monthly_price_cents integer,
      yearly_price_cents integer,
      currency text default 'usd',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  // Backfill/upgrade older schemas safely.
  try {
    await query(`alter table admin_ambassadors add column if not exists referral_code text unique;`);
  } catch (e) {
    // ignore if not supported by older Postgres (should be supported on modern versions)
  }

  // Add yearly pricing (safe upgrade).
  try {
    await query(`alter table admin_ambassadors add column if not exists yearly_price_cents integer;`);
  } catch (e) {}

  await query(`
    create table if not exists ambassador_referrals (
      id bigserial primary key,
      ambassador_id bigint not null references admin_ambassadors(id) on delete cascade,
      user_id text,
      email text,
      ref_code text,
      first_seen_at timestamptz default now(),
      last_seen_at timestamptz default now(),
      price_paid_cents integer,
      currency text default 'usd',
      stripe_session_id text,
      stripe_customer_id text,
      stripe_subscription_id text,
      stripe_subscription_status text,
      stripe_current_period_end timestamptz,
      ambassador_interval text,
      status text default 'referred'
    );
  `);

  // Safe upgrades for older schemas.
  try { await query(`alter table ambassador_referrals add column if not exists stripe_subscription_status text;`); } catch (e) {}
  try { await query(`alter table ambassador_referrals add column if not exists stripe_current_period_end timestamptz;`); } catch (e) {}
  try { await query(`alter table ambassador_referrals add column if not exists ambassador_interval text;`); } catch (e) {}

  // Helpful indexes.
  await query(`create index if not exists ambassador_referrals_ambassador_id_idx on ambassador_referrals(ambassador_id);`);
  await query(`create index if not exists ambassador_referrals_user_id_idx on ambassador_referrals(user_id);`);
  await query(`create index if not exists ambassador_referrals_email_idx on ambassador_referrals(lower(email));`);
}


async function requireAmbassador(event) {
  const token = (event.headers && (event.headers['x-ambassador-token'] || event.headers['X-Ambassador-Token'] || event.headers['x-ambassador-token'.toLowerCase()])) || '';
  const email = (event.headers && (event.headers['x-ambassador-email'] || event.headers['X-Ambassador-Email'] || event.headers['x-ambassador-email'.toLowerCase()])) || '';

  const t = String(token || '').trim();
  const e = String(email || '').trim().toLowerCase();
  if (!t || !e) return { ok: false, response: json(401, { error: 'Missing ambassador token or email' }) };

  try {
    await ensureTables();
    const h = sha256Hex(t);
    const r = await query(`select id, email, referral_code, name, monthly_price_cents, yearly_price_cents, currency from admin_ambassadors where lower(email)=lower($1) and token_hash=$2 limit 1`, [e, h]);
    const amb = r.rows[0];
    if (!amb) return { ok: false, response: json(403, { error: 'Invalid ambassador token' }) };
    return { ok: true, ambassador: amb };
  } catch (e2) {
    return { ok: false, response: json(500, { error: 'Ambassador auth failed' }) };
  }
}

module.exports = {
  sha256Hex,
  ensureAmbassadorsTables: ensureTables,
  requireAmbassador,
};
