const { requireSignedUser } = require('./_auth');
const { getPlanConfig } = require('./_plan');
const { json, pickBaseUrl } = require('./_util');

// Creates a Stripe Checkout Session using dynamic price data.
// This avoids Stripe Price IDs and allows admin-controlled pricing (NeonDB) to
// instantly update what users are charged.
//
// ENV required:
// - STRIPE_SECRET_KEY
// - DATABASE_URL
// Optional:
// - PUBLIC_BASE_URL (falls back to request origin)

function toCents(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const user = await requireSignedUser(event);
    const body = JSON.parse(event.body || '{}');
    const interval = body?.interval === 'yearly' ? 'year' : (body?.interval === 'monthly' ? 'month' : null);
    if (!interval) return json({ error: 'Missing interval (monthly|yearly)' }, 400);

    const cfg = await getPlanConfig();
    const usd = interval === 'month' ? cfg.monthly_price_usd : cfg.yearly_price_usd;
    const unitAmount = toCents(usd);
    if (!unitAmount) return json({ error: 'Invalid pricing configuration' }, 500);

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return json({ error: 'Missing STRIPE_SECRET_KEY env var' }, 500);

    const baseUrl = pickBaseUrl(event);
    const success = `${baseUrl}/?checkout=success`;
    const cancel = `${baseUrl}/?checkout=cancel`;

    // Avoid depending on the Stripe SDK during Netlify bundling. Use the Stripe
    // REST API directly (Node 18+ has global fetch).
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('customer_email', user.email);
    params.set('allow_promotion_codes', 'true');
    params.set('success_url', success);
    params.set('cancel_url', cancel);

    // metadata
    params.set('metadata[user_id]', String(user.id));
    params.set('metadata[plan_interval]', interval);

    // line_items[0]
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][product_data][name]', 'Aethon Pro');
    params.set(
      'line_items[0][price_data][product_data][description]',
      'Unlimited AI features + smarter adjustments'
    );
    params.set('line_items[0][price_data][recurring][interval]', interval);
    params.set('line_items[0][price_data][unit_amount]', String(unitAmount));

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Stripe error (${res.status})`;
      return json({ error: msg }, res.status);
    }

    return json({ url: data.url });
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || 'Unknown error';
    const status = e && e.statusCode ? e.statusCode : 500;
    return json({ error: msg }, status);
  }
};
