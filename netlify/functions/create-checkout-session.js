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

    const stripe = require('stripe')(stripeKey);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Aethon Pro',
              description: 'Unlimited AI features + smarter adjustments'
            },
            recurring: { interval },
            unit_amount: unitAmount
          },
          quantity: 1
        }
      ],
      metadata: {
        user_id: user.id,
        plan_interval: interval
      },
      success_url: success,
      cancel_url: cancel
    });

    return json({ url: session.url });
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || 'Unknown error';
    const status = e && e.statusCode ? e.statusCode : 500;
    return json({ error: msg }, status);
  }
};
