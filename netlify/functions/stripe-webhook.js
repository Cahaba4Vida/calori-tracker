const crypto = require('crypto');
const { json } = require('./_util');
const { query } = require('./_db');

function rawBody(event) {
  if (event.isBase64Encoded) return Buffer.from(event.body || '', 'base64').toString('utf8');
  return event.body || '';
}

function parseSignature(headerValue = '') {
  const out = { t: null, v1: [] };
  for (const part of String(headerValue).split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') out.t = v;
    if (k === 'v1') out.v1.push(v);
  }
  return out;
}

function verifySignature(payload, sigHeader, secret) {
  if (!secret) return false;
  const parts = parseSignature(sigHeader);
  if (!parts.t || !parts.v1.length) return false;

  const signedPayload = `${parts.t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return parts.v1.some((candidate) => {
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function stripeGet(pathname) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  const resp = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function findUserId(subscription) {
  if (subscription?.metadata?.user_id) return subscription.metadata.user_id;

  if (subscription?.id) {
    const bySub = await query(`select user_id from user_profiles where stripe_subscription_id=$1 limit 1`, [subscription.id]);
    if (bySub.rows[0]?.user_id) return bySub.rows[0].user_id;
  }

  if (subscription?.customer) {
    const byCustomer = await query(`select user_id from user_profiles where stripe_customer_id=$1 limit 1`, [String(subscription.customer)]);
    if (byCustomer.rows[0]?.user_id) return byCustomer.rows[0].user_id;

    const customer = await stripeGet(`customers/${encodeURIComponent(String(subscription.customer))}`);
    const email = customer?.email;
    if (email) {
      const byEmail = await query(`select user_id from user_profiles where lower(email)=lower($1) order by created_at desc limit 1`, [email]);
      if (byEmail.rows[0]?.user_id) return byEmail.rows[0].user_id;
    }
  }

  return null;
}

async function syncSubscription(subscription) {
  const userId = await findUserId(subscription);
  if (!userId) return { ok: false, userId: null };

  const status = String(subscription?.status || 'inactive');
  const isActive = ['active', 'trialing'].includes(status);
  const periodEnd = subscription?.current_period_end
    ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
    : null;

  await query(
    `update user_profiles
     set plan_tier=$2,
         subscription_status=$3,
         stripe_customer_id=$4,
         stripe_subscription_id=$5,
         subscription_current_period_end=$6
     where user_id=$1`,
    [
      userId,
      isActive ? 'premium' : 'free',
      status,
      subscription?.customer ? String(subscription.customer) : null,
      subscription?.id ? String(subscription.id) : null,
      periodEnd
    ]
  );

  return { ok: true, userId, status };
}

async function logEventInsert(stripeEvent, payload) {
  try {
    const eventId = stripeEvent?.id || null;
    const r = await query(
      `insert into stripe_webhook_events(stripe_event_id, event_type, payload)
       values ($1,$2,$3::jsonb)
       on conflict (stripe_event_id) where stripe_event_id is not null do nothing
       returning id`,
      [eventId, stripeEvent?.type || 'unknown', payload || '{}']
    );
    if (r.rows[0]?.id) return { id: r.rows[0].id, duplicate: false };

    if (eventId) {
      const existing = await query(`select id from stripe_webhook_events where stripe_event_id=$1 limit 1`, [eventId]);
      if (existing.rows[0]?.id) return { id: existing.rows[0].id, duplicate: true };
    }
    return { id: null, duplicate: false };
  } catch {
    return { id: null, duplicate: false };
  }
}

async function logEventUpdate(id, patch = {}) {
  if (!id) return;
  try {
    await query(
      `update stripe_webhook_events
       set processed=$2,
           process_result=$3,
           error_message=$4,
           user_id=$5,
           subscription_id=$6,
           subscription_status=$7
       where id=$1`,
      [
        id,
        !!patch.processed,
        patch.process_result || null,
        patch.error_message || null,
        patch.user_id || null,
        patch.subscription_id || null,
        patch.subscription_status || null
      ]
    );
  } catch {
    // ignore logging errors
  }
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const payload = rawBody(event);

  if (!webhookSecret) return json(503, { error: 'Missing STRIPE_WEBHOOK_SECRET' });
  if (!verifySignature(payload, sig, webhookSecret)) return json(400, { error: 'Invalid stripe-signature' });

  let stripeEvent;
  try { stripeEvent = JSON.parse(payload || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const logged = await logEventInsert(stripeEvent, payload);
  if (logged.duplicate) {
    return json(200, { received: true, duplicate: true });
  }
  const logId = logged.id;

  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data?.object || {};
      if (session.subscription) {
        const sub = await stripeGet(`subscriptions/${encodeURIComponent(String(session.subscription))}`);
        if (sub) {
          const synced = await syncSubscription(sub);
          await logEventUpdate(logId, {
            processed: true,
            process_result: synced.ok ? 'subscription_synced' : 'user_not_found',
            user_id: synced.userId,
            subscription_id: sub?.id || null,
            subscription_status: sub?.status || null
          });
        }
      }
    } else if (stripeEvent.type === 'customer.subscription.created' || stripeEvent.type === 'customer.subscription.updated' || stripeEvent.type === 'customer.subscription.deleted') {
      const sub = stripeEvent.data?.object || {};
      const synced = await syncSubscription(sub);
      await logEventUpdate(logId, {
        processed: true,
        process_result: synced.ok ? 'subscription_synced' : 'user_not_found',
        user_id: synced.userId,
        subscription_id: sub?.id || null,
        subscription_status: sub?.status || null
      });
    } else if (stripeEvent.type === 'invoice.payment_failed') {
      const subId = stripeEvent.data?.object?.subscription;
      if (subId) {
        const sub = await stripeGet(`subscriptions/${encodeURIComponent(String(subId))}`);
        if (sub) {
          const synced = await syncSubscription(sub);
          await logEventUpdate(logId, {
            processed: true,
            process_result: synced.ok ? 'payment_failed_synced' : 'user_not_found',
            user_id: synced.userId,
            subscription_id: sub?.id || null,
            subscription_status: sub?.status || null
          });
        }
      }
    } else {
      await logEventUpdate(logId, { processed: true, process_result: 'ignored_event_type' });
    }
  } catch (e) {
    await logEventUpdate(logId, {
      processed: false,
      process_result: 'processing_failed',
      error_message: e?.message || 'Unknown processing error'
    });
    return json(500, { error: 'Failed processing Stripe webhook event' });
  }

  return json(200, { received: true });
};
