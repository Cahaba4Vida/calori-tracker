const { json } = require('./_util');
const { getPlanConfig } = require('./_plan');

function getHeader(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

function pickBaseUrl(event) {
  const hdrs = event.headers || {};
  const proto = hdrs['x-forwarded-proto'] || hdrs['X-Forwarded-Proto'] || 'https';
  const host = hdrs['x-forwarded-host'] || hdrs['X-Forwarded-Host'] || hdrs.host || hdrs.Host || '';
  return process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.URL || (host ? `${proto}://${host}` : '');
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY) return json({ ok: false, error: 'Missing STRIPE_SECRET_KEY' }, 500);

    const body = JSON.parse(event.body || '{}');
    const interval = body.interval === 'year' || body.interval === 'yearly' ? 'year' : 'month';
    const deviceId = body.device_id || getHeader(event, 'x-device-id') || getHeader(event, 'X-Device-Id');
    const email = String(body.email || '').trim().toLowerCase();
    const onboardingCheckout = !!body.onboarding_checkout;
    if (!deviceId) return json({ ok: false, error: 'Missing device_id' }, 400);
    if (onboardingCheckout && !email) return json({ ok: false, error: 'Email is required to continue to checkout.' }, 400);

    const pricing = await getPlanConfig();
    const amount = interval === 'year'
      ? Number(pricing.yearly_price_cents || Math.round(Number(pricing.yearly_price_usd || 50) * 100))
      : Number(pricing.monthly_price_cents || Math.round(Number(pricing.monthly_price_usd || 5) * 100));

    if (!amount || amount < 50) return json({ ok: false, error: 'Invalid pricing' }, 400);

    const base = pickBaseUrl(event);
    const successUrl = body.success_url || process.env.CHECKOUT_SUCCESS_URL || (base ? `${base}/?checkout=success${onboardingCheckout ? '&setup_account=1' : ''}` : `/?checkout=success${onboardingCheckout ? '&setup_account=1' : ''}`);
    const cancelUrl = body.cancel_url || process.env.CHECKOUT_CANCEL_URL || (base ? `${base}/?checkout=cancel${onboardingCheckout ? '&setup_account=1' : ''}` : `/?checkout=cancel${onboardingCheckout ? '&setup_account=1' : ''}`);

    const params = new URLSearchParams({
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_creation: 'always',
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': interval === 'year' ? 'Aethon Fuel Premium (Yearly)' : 'Aethon Fuel Premium (Monthly)',
      'line_items[0][price_data][product_data][description]': 'Unlimited AI + smarter adjustments',
      'line_items[0][price_data][recurring][interval]': interval,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][quantity]': '1',
      client_reference_id: String(deviceId),
      ...(email ? { customer_email: email } : {}),
      'metadata[device_id]': String(deviceId),
      'metadata[interval]': interval,
      'metadata[source]': onboardingCheckout ? 'onboarding_checkout' : 'public_checkout',
      ...(email ? { 'metadata[email]': email } : {})
    });

    const sessionResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await sessionResp.json().catch(() => ({}));
    if (!sessionResp.ok) {
      return json({
        ok: false,
        error: session?.error?.message || 'Stripe error',
        details: session || null
      }, sessionResp.status || 500);
    }

    return json({ ok: true, url: session.url, id: session.id });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
};
