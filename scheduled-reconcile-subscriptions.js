const { json } = require('./_util');
const { requireSignedUser } = require('./_auth');
const { ensureUserProfile } = require('./_db');
const { claimReferralForUser } = require('./_referrals');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireSignedUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const code = body.referral_code || body.code || null;

  const result = await claimReferralForUser({ userId, referralCode: code });
  if (!result.ok) return result.response;
  return json(200, {
    ok: true,
    referral_code: result.referral_code,
    referrer_user_id: result.referrer_user_id,
    already_claimed: !!result.already_claimed
  });
};
