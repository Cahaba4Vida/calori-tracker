const crypto = require('crypto');
const { query } = require('./_db');
const { json } = require('./_util');

function randomReferralCode(len = 6) {
  // Base32-ish, avoid ambiguous chars.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function ensureReferralCode(userId) {
  const r = await query(
    `select referral_code from user_profiles where user_id=$1 limit 1`,
    [String(userId)]
  );
  const existing = r.rows[0]?.referral_code ? String(r.rows[0].referral_code) : null;
  if (existing) return existing;

  // Generate + set with retry (handles unique collisions).
  for (let i = 0; i < 8; i++) {
    const code = randomReferralCode(6);
    try {
      await query(
        `update user_profiles set referral_code=$2 where user_id=$1 and referral_code is null`,
        [String(userId), code]
      );
      const check = await query(
        `select referral_code from user_profiles where user_id=$1 limit 1`,
        [String(userId)]
      );
      const got = check.rows[0]?.referral_code ? String(check.rows[0].referral_code) : null;
      if (got) return got;
    } catch (e) {
      // 23505 = unique_violation
      if (e && e.code === '23505') continue;
      throw e;
    }
  }
  throw new Error('Failed to generate referral code');
}

async function claimReferralForUser({ userId, referralCode }) {
  const code = String(referralCode || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{5,12}$/.test(code)) {
    return { ok: false, response: json(400, { error: 'Invalid referral code' }) };
  }

  const ref = await query(
    `select user_id from user_profiles where referral_code=$1 limit 1`,
    [code]
  );
  const referrerId = ref.rows[0]?.user_id ? String(ref.rows[0].user_id) : null;
  if (!referrerId) {
    return { ok: false, response: json(404, { error: 'Referral code not found' }) };
  }
  if (String(referrerId) === String(userId)) {
    return { ok: false, response: json(400, { error: 'You cannot refer yourself' }) };
  }

  // Only allow one referral per referred user.
  const prof = await query(
    `select referred_by from user_profiles where user_id=$1 limit 1`,
    [String(userId)]
  );
  const already = prof.rows[0]?.referred_by ? String(prof.rows[0].referred_by) : null;
  if (already) {
    return { ok: true, referrer_user_id: referrerId, referral_code: already, already_claimed: true };
  }

  await query(
    `update user_profiles set referred_by=$2 where user_id=$1 and referred_by is null`,
    [String(userId), code]
  );
  await query(
    `insert into referrals(referrer_user_id, referred_user_id) values ($1,$2)
     on conflict (referred_user_id) do nothing`,
    [String(referrerId), String(userId)]
  );

  return { ok: true, referrer_user_id: referrerId, referral_code: code, already_claimed: false };
}

async function extendPremiumByDays(userId, days) {
  const d = Number(days || 0);
  if (!Number.isFinite(d) || d <= 0) return;
  await query(
    `update user_profiles
        set premium_expires_at = (
          greatest(coalesce(premium_expires_at, now()), now()) + ($2::text || ' days')::interval
        )
      where user_id=$1`,
    [String(userId), String(Math.round(d))]
  );
}

async function maybeGrantReferralReward(referredUserId) {
  // Only grant once.
  const r = await query(
    `select id, referrer_user_id, reward_granted
       from referrals
      where referred_user_id=$1
      order by created_at desc
      limit 1`,
    [String(referredUserId)]
  );
  const row = r.rows[0] || null;
  if (!row) return { granted: false };
  if (row.reward_granted) return { granted: false };

  // Guard: referred user must have at least 1 food entry (the caller usually runs after insert).
  const hasEntry = await query(
    `select 1 from food_entries where user_id=$1 limit 1`,
    [String(referredUserId)]
  );
  if (!hasEntry.rows.length) return { granted: false };

  const referrerId = String(row.referrer_user_id);

  // Apply rewards.
  await extendPremiumByDays(referrerId, 30);
  await extendPremiumByDays(String(referredUserId), 30);

  // Mark granted + increment count.
  await query(
    `update referrals set reward_granted=true where id=$1`,
    [Number(row.id)]
  );
  await query(
    `update user_profiles set referral_count = coalesce(referral_count,0) + 1 where user_id=$1`,
    [referrerId]
  );

  return { granted: true, referrer_user_id: referrerId };
}

module.exports = {
  ensureReferralCode,
  claimReferralForUser,
  maybeGrantReferralReward
};
