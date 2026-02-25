const { json } = require('./_util');
const { requireAmbassador } = require('./_ambassadorAuth');

function formEncode(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.join('&');
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const a = await requireAmbassador(event);
  if (!a.ok) return a.response;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(503, { error: 'Stripe is not configured (missing STRIPE_SECRET_KEY).' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const base = origin || (process.env.PUBLIC_BASE_URL || '');
  const successUrl = String(body.success_url || (base ? (base.replace(/\/$/, '') + '/?checkout=success') : 'https://example.com'));
  const cancelUrl = String(body.cancel_url || (base ? (base.replace(/\/$/, '') + '/?checkout=cancel') : 'https://example.com'));
  const customerEmail = body.customer_email ? String(body.customer_email).trim() : '';
  const interval = String(body.interval || 'month').toLowerCase(); // 'month' | 'year'

  // We strongly recommend collecting the user's email so we can link Stripe -> app user.
  if (!customerEmail) return json(400, { error: 'customer_email is required (used to grant access automatically).' });

  const unitAmount = interval === 'year'
    ? Number(a.ambassador.yearly_price_cents || 0)
    : Number(a.ambassador.monthly_price_cents || 0);
  const currency = String(a.ambassador.currency || 'usd').toLowerCase();
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) return json(400, { error: 'Ambassador pricing is not set.' });

  // Stripe Checkout Session (subscription) using price_data.
  const payload = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': Math.round(unitAmount),
    'line_items[0][price_data][product_data][name]': 'Aethon Premium',
    'line_items[0][price_data][recurring][interval]': (interval === 'year' ? 'year' : 'month'),
    'metadata[ambassador_email]': a.ambassador.email,
    'metadata[ambassador_id]': String(a.ambassador.id),
    'metadata[ambassador_price_cents]': String(Math.round(unitAmount)),
    'metadata[ambassador_currency]': currency,
    'metadata[ambassador_interval]': (interval === 'year' ? 'year' : 'month'),
    'metadata[customer_email]': customerEmail,
  };
  payload.customer_email = customerEmail;

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formEncode(payload),
    });
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch { j = { raw: txt }; }
    if (!r.ok) {
      return json(400, { error: (j && (j.error?.message || j.message)) || 'Stripe error', details: j });
    }
    return json(200, { ok: true, url: j.url, checkout_url: j.url, id: j.id });
  } catch (e) {
    return json(500, { error: 'Could not create checkout session' });
  }
};
