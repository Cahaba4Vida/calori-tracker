const { json } = require('./_util');
const { getOrCreatePricingSettings } = require('./_plan');

function getHeader(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY) return json({ ok: false, error: 'Missing STRIPE_SECRET_KEY' }, 500);

    const body = JSON.parse(event.body || '{}');
    const interval = body.interval === 'year' ? 'year' : 'month';
    const deviceId = body.device_id || getHeader(event, 'x-device-id') || getHeader(event, 'X-Device-Id');
    if (!deviceId) return json({ ok: false, error: 'Missing device_id' }, 400);

    const pricing = await getOrCreatePricingSettings();
    const amount = interval === 'year' ? pricing.yearly_price_cents : pricing.monthly_price_cents;
    if (!amount || amount < 50) return json({ ok: false, error: 'Invalid pricing' }, 400);

    const base = process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '';
    const successUrl = process.env.CHECKOUT_SUCCESS_URL || (base ? `${base}/?checkout=success` : '/?checkout=success');
    const cancelUrl = process.env.CHECKOUT_CANCEL_URL || (base ? `${base}/?checkout=cancel` : '/?checkout=cancel');

    const sessionResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': interval === 'year' ? 'Aethon Fuel Pro (Yearly)' : 'Aethon Fuel Pro (Monthly)',
        'line_items[0][price_data][recurring][interval]': interval,
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][quantity]': '1',
        'metadata[device_id]': deviceId,
        'metadata[interval]': interval,
      })
    });

    const session = await sessionResp.json();
    if (!sessionResp.ok) {
      return json({ ok: false, error: session?.error?.message || 'Stripe error', raw: session }, 500);
    }

    return json({ ok: true, url: session.url, id: session.id });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
};
