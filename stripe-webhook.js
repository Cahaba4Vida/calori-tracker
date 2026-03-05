const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile } = require('./_db');
const { ensureReferralCode } = require('./_referrals');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const code = await ensureReferralCode(userId);
  return json(200, { referral_code: code });
};
