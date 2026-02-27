const { json } = require('./_util');
const { requireSignedUser } = require('./_auth');
const { ensureUserProfile } = require('./_db');
const { getPlanConfig } = require('./_plan');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireSignedUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const interval = String(body.interval || 'monthly').toLowerCase();
  if (!['monthly', 'yearly'].includes(interval)) {
    return json(400, { error: 'interval must be monthly or yearly' });
  }

  const cfg = await getPlanConfig();
  const monthly = process.env.STRIPE_MONTHLY_PAYMENT_LINK_URL || cfg.monthly_upgrade_url;
  const yearly = process.env.STRIPE_YEARLY_PAYMENT_LINK_URL || cfg.yearly_upgrade_url;
  const checkoutUrl = interval === 'yearly' ? yearly : monthly;

  if (!checkoutUrl) {
    return json(503, { error: 'Stripe payment links are not configured.' });
  }

  return json(200, { url: checkoutUrl, checkout_url: checkoutUrl, interval });
};
