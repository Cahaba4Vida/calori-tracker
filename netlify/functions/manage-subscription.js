const { json } = require('./_util');
const { requireSignedUser } = require('./_auth');
const { ensureUserProfile, query } = require('./_db');
const { getPlanConfig } = require('./_plan');

function asForm(payload) {
  return Object.entries(payload)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireSignedUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const cfg = await getPlanConfig();
  const fallbackUrl = cfg.manage_subscription_url;
  const secret = process.env.STRIPE_SECRET_KEY;

  const userRow = await query(
    `select stripe_customer_id from user_profiles where user_id=$1 limit 1`,
    [userId]
  );
  const customerId = userRow.rows[0]?.stripe_customer_id || null;

  if (secret && customerId) {
    const siteUrl = process.env.URL || process.env.SITE_URL || 'http://localhost:8888';
    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: asForm({ customer: customerId, return_url: siteUrl })
    });

    if (response.ok) {
      const body = await response.json();
      if (body?.url) return json(200, { url: body.url, source: 'stripe_portal' });
    }
  }

  if (fallbackUrl) return json(200, { url: fallbackUrl, source: 'configured_link' });
  return json(404, { error: 'Manage subscription is not configured yet.' });
};
