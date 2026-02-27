const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { query, ensureUserProfile } = require('./_db');
const { ensureAmbassadorsTables } = require('./_ambassadorAuth');

async function ensureUserProfileReferralColumns() {
  // Add columns to user_profiles if missing; tolerate older schemas.
  const alters = [
    `alter table user_profiles add column if not exists ambassador_id bigint;`,
    `alter table user_profiles add column if not exists ambassador_email text;`,
    `alter table user_profiles add column if not exists ambassador_ref_code text;`,
    `alter table user_profiles add column if not exists ambassador_referred_at timestamptz;`,
    `alter table user_profiles add column if not exists ambassador_last_seen_at timestamptz;`,
  ];
  for (const q of alters) {
    try { await query(q); } catch (e) {}
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const ref = String(body.ref_code || body.ref || '').trim().toLowerCase();
  if (!ref) return json(400, { error: 'ref_code is required' });
  if (!/^[a-z0-9]{6,32}$/.test(ref)) return json(400, { error: 'ref_code format is invalid' });

  try {
    await ensureAmbassadorsTables();
    await ensureUserProfileReferralColumns();

    const ambR = await query(
      `select id, email, referral_code from admin_ambassadors where lower(referral_code)=lower($1) limit 1`,
      [ref]
    );
    const amb = ambR.rows[0];
    if (!amb) return json(404, { error: 'Unknown referral code' });

    // Record/refresh referral row (by user_id if present, else email).
    // Prefer user_id linkage; also store email for convenience.
    const upsertByUserId = await query(
      `select id from ambassador_referrals where ambassador_id=$1 and user_id=$2 limit 1`,
      [amb.id, userId]
    );

    if (upsertByUserId.rows[0]) {
      await query(
        `update ambassador_referrals
            set last_seen_at=now(),
                email=coalesce($3, email),
                ref_code=coalesce(ref_code, $4)
          where ambassador_id=$1 and user_id=$2`,
        [amb.id, userId, (email || null), amb.referral_code || ref]
      );
    } else {
      // If previously seen via email (e.g., device anonymous -> later email login), stitch to user_id.
      if (email) {
        const priorByEmail = await query(
          `select id from ambassador_referrals where ambassador_id=$1 and lower(email)=lower($2) limit 1`,
          [amb.id, email]
        );
        if (priorByEmail.rows[0]) {
          await query(
            `update ambassador_referrals
                set user_id=$3,
                    last_seen_at=now(),
                    ref_code=coalesce(ref_code, $4)
              where ambassador_id=$1 and lower(email)=lower($2)`,
            [amb.id, email, userId, amb.referral_code || ref]
          );
        } else {
          await query(
            `insert into ambassador_referrals(ambassador_id, user_id, email, ref_code, first_seen_at, last_seen_at, status)
             values ($1,$2,$3,$4,now(),now(),'referred')`,
            [amb.id, userId, email, amb.referral_code || ref]
          );
        }
      } else {
        await query(
          `insert into ambassador_referrals(ambassador_id, user_id, email, ref_code, first_seen_at, last_seen_at, status)
           values ($1,$2,null,$3,now(),now(),'referred')`,
          [amb.id, userId, amb.referral_code || ref]
        );
      }
    }

    // Stamp on user_profiles (first touch only for referred_at).
    await query(
      `update user_profiles
          set ambassador_id = coalesce(ambassador_id, $2),
              ambassador_email = coalesce(ambassador_email, $3),
              ambassador_ref_code = coalesce(ambassador_ref_code, $4),
              ambassador_referred_at = coalesce(ambassador_referred_at, now()),
              ambassador_last_seen_at = now()
        where user_id = $1`,
      [userId, amb.id, amb.email, amb.referral_code || ref]
    );

    return json(200, { ok: true, ambassador: { id: amb.id, email: amb.email, ref_code: amb.referral_code || ref } });
  } catch (e) {
    return json(500, { error: 'Could not claim referral' });
  }
};
