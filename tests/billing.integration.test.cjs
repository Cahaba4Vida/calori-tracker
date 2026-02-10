const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function signPayload(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('hex');
  return `t=${ts},v1=${sig}`;
}

function createDbMock() {
  const state = {
    events: [],
    profiles: [{ user_id: 'u1', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', plan_tier: 'premium', subscription_status: 'active', premium_pass: false, premium_pass_expires_at: null }]
  };

  async function query(text, params = []) {
    const q = text.toLowerCase();
    if (q.includes('insert into stripe_webhook_events')) {
      const eventId = params[0];
      if (eventId && state.events.some((e) => e.stripe_event_id === eventId)) return { rows: [] };
      const id = state.events.length + 1;
      state.events.push({ id, stripe_event_id: eventId, processed: false, process_result: null });
      return { rows: [{ id }] };
    }
    if (q.includes('select id from stripe_webhook_events where stripe_event_id')) {
      const row = state.events.find((e) => e.stripe_event_id === params[0]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (q.includes('update stripe_webhook_events')) {
      const row = state.events.find((e) => e.id === params[0]);
      if (row) {
        row.processed = params[1];
        row.process_result = params[2];
        row.subscription_status = params[6];
      }
      return { rows: [] };
    }
    if (q.includes('select user_id from user_profiles where stripe_subscription_id')) {
      const row = state.profiles.find((p) => p.stripe_subscription_id === params[0]);
      return { rows: row ? [{ user_id: row.user_id }] : [] };
    }
    if (q.includes('select user_id from user_profiles where stripe_customer_id')) {
      const row = state.profiles.find((p) => p.stripe_customer_id === params[0]);
      return { rows: row ? [{ user_id: row.user_id }] : [] };
    }
    if (q.includes('select user_id from user_profiles where lower(email)')) {
      return { rows: [] };
    }
    if (q.includes('update user_profiles')) {
      const user = state.profiles.find((p) => p.user_id === params[0]);
      user.plan_tier = params[1];
      user.subscription_status = params[2];
      user.stripe_customer_id = params[3];
      user.stripe_subscription_id = params[4];
      return { rows: [] };
    }
    if (q.includes('select free_food_entries_per_day')) {
      return { rows: [] };
    }
    if (q.includes('select coalesce(plan_tier')) {
      const user = state.profiles[0];
      return { rows: [user] };
    }
    throw new Error(`Unhandled query: ${text}`);
  }

  return { query, state };
}

function freshRequire(filePath, dbMock) {
  const dbPath = require.resolve('../netlify/functions/_db');
  delete require.cache[dbPath];
  require.cache[dbPath] = { exports: { query: dbMock.query } };
  const target = require.resolve(filePath);
  delete require.cache[target];
  return require(filePath);
}

test('stripe webhook deduplicates duplicate event IDs', async () => {
  const db = createDbMock();
  const secret = 'whsec_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1735689600, metadata: { user_id: 'u1' } }) });
  const webhook = freshRequire('../netlify/functions/stripe-webhook.js', db);

  const payload = JSON.stringify({ id: 'evt_dup', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'u1' } } } });
  const event = { httpMethod: 'POST', body: payload, headers: { 'stripe-signature': signPayload(payload, secret) } };

  const first = await webhook.handler(event);
  const second = await webhook.handler(event);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).duplicate, true);
});

test('stripe webhook marks user free on cancellation/payment failure', async () => {
  const db = createDbMock();
  const secret = 'whsec_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: 1735689600, metadata: { user_id: 'u1' } }) });
  const webhook = freshRequire('../netlify/functions/stripe-webhook.js', db);

  const payload = JSON.stringify({ id: 'evt_cancel', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } } });
  const res = await webhook.handler({ httpMethod: 'POST', body: payload, headers: { 'stripe-signature': signPayload(payload, secret) } });

  assert.equal(res.statusCode, 200);
  assert.equal(db.state.profiles[0].plan_tier, 'free');
  assert.equal(db.state.profiles[0].subscription_status, 'canceled');
});

test('admin pass override keeps user premium via entitlements', async () => {
  const db = createDbMock();
  db.state.profiles[0].plan_tier = 'free';
  db.state.profiles[0].subscription_status = 'inactive';
  db.state.profiles[0].premium_pass = true;
  const plan = freshRequire('../netlify/functions/_plan.js', db);

  const ent = await plan.getUserEntitlements('u1');
  assert.equal(ent.is_premium, true);
  assert.equal(ent.premium_source, 'admin_pass');
});
