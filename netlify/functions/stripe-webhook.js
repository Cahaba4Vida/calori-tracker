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


async function ensureAmbassadorAttributionColumns() {
  // Ensure tables/columns exist for ambassador attribution, without requiring manual migrations.
  try {
    await query(`create table if not exists admin_ambassadors (
      id bigserial primary key,
      email text unique not null,
      referral_code text unique,
      name text,
      notes text,
      token_hash text not null,
      monthly_price_cents integer,
      yearly_price_cents integer,
      currency text default 'usd',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );`);
  } catch (e) {}

  try { await query(`alter table admin_ambassadors add column if not exists yearly_price_cents integer;`); } catch (e) {}

  try {
    await query(`create table if not exists ambassador_referrals (
      id bigserial primary key,
      ambassador_id bigint not null references admin_ambassadors(id) on delete cascade,
      user_id text,
      email text,
      ref_code text,
      first_seen_at timestamptz default now(),
      last_seen_at timestamptz default now(),
      price_paid_cents integer,
      currency text default 'usd',
      stripe_session_id text,
      stripe_customer_id text,
      stripe_subscription_id text,
      stripe_subscription_status text,
      stripe_current_period_end timestamptz,
      ambassador_interval text,
      status text default 'referred'
    );`);
  } catch (e) {}

  try { await query(`alter table ambassador_referrals add column if not exists stripe_subscription_status text;`); } catch (e) {}
  try { await query(`alter table ambassador_referrals add column if not exists stripe_current_period_end timestamptz;`); } catch (e) {}
  try { await query(`alter table ambassador_referrals add column if not exists ambassador_interval text;`); } catch (e) {}

  const alters = [
    `alter table user_profiles add column if not exists ambassador_id bigint;`,
    `alter table user_profiles add column if not exists ambassador_email text;`,
    `alter table user_profiles add column if not exists ambassador_ref_code text;`,
    `alter table user_profiles add column if not exists ambassador_referred_at timestamptz;`,
    `alter table user_profiles add column if not exists ambassador_last_seen_at timestamptz;`,
    `alter table user_profiles add column if not exists ambassador_price_paid_cents integer;`,
    `alter table user_profiles add column if not exists ambassador_last_paid_at timestamptz;`,
  ];
  for (const q of alters) { try { await query(q); } catch (e) {} }
}

async function recordAmbassadorPaymentFromCheckoutSession(session) {
  const md = session?.metadata || {};
  const ambIdRaw = md.ambassador_id || md.ambassadorId || null;
  const ambEmail = md.ambassador_email || md.ambassadorEmail || null;
  const priceCentsRaw = md.ambassador_price_cents || md.ambassadorPriceCents || null;
  const interval = (md.ambassador_interval || md.ambassadorInterval || 'month') + '';

  const ambId = ambIdRaw != null ? Number(ambIdRaw) : null;
  const priceCents = priceCentsRaw != null ? Number(priceCentsRaw) : (session?.amount_total != null ? Number(session.amount_total) : null);
  const currency = (md.ambassador_currency || session?.currency || 'usd') + '';

  if (!ambId && !ambEmail) return;

  await ensureAmbassadorAttributionColumns();

  // Resolve ambassador_id if only email present.
  let ambassadorId = ambId;
  if (!ambassadorId && ambEmail) {
    const a = await query(`select id from admin_ambassadors where lower(email)=lower($1) limit 1`, [String(ambEmail).toLowerCase()]);
    ambassadorId = a.rows[0]?.id || null;
  }
  if (!ambassadorId) return;

  const customerEmail = (session?.customer_details?.email || session?.customer_email || md.customer_email || null);
  const userId = md.user_id || md.userId || null;
  const subId = session?.subscription ? String(session.subscription) : null;
  const custId = session?.customer ? String(session.customer) : null;
  const sessId = session?.id ? String(session.id) : null;

  // Upsert referral/conversion record.
  if (userId) {
    await query(
      `insert into ambassador_referrals(ambassador_id, user_id, email, last_seen_at, price_paid_cents, currency, stripe_session_id, stripe_customer_id, stripe_subscription_id, ambassador_interval, status)
       values ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,'paid')
       on conflict do nothing`,
      [ambassadorId, String(userId), customerEmail, (Number.isFinite(priceCents) ? Math.round(priceCents) : null), currency, sessId, custId, subId, (interval === 'year' ? 'year' : 'month')]
    ).catch(()=>{});
    // Update existing row for that user/ambassador
    await query(
      `update ambassador_referrals
          set last_seen_at=now(),
              email=coalesce($3,email),
              price_paid_cents=coalesce(price_paid_cents,$4),
              currency=coalesce(currency,$5),
              stripe_session_id=coalesce(stripe_session_id,$6),
              stripe_customer_id=coalesce(stripe_customer_id,$7),
              stripe_subscription_id=coalesce(stripe_subscription_id,$8),
              status='paid'
        where ambassador_id=$1 and user_id=$2`,
      [ambassadorId, String(userId), customerEmail, (Number.isFinite(priceCents) ? Math.round(priceCents) : null), currency, sessId, custId, subId, (interval === 'year' ? 'year' : 'month')]
    ).catch(()=>{});
  } else if (customerEmail) {
    await query(
      `insert into ambassador_referrals(ambassador_id, user_id, email, ref_code, first_seen_at, last_seen_at, price_paid_cents, currency, stripe_session_id, stripe_customer_id, stripe_subscription_id, ambassador_interval, status)
       values ($1,null,$2,null,now(),now(),$3,$4,$5,$6,$7,$8,'paid')`,
      [ambassadorId, customerEmail, (Number.isFinite(priceCents) ? Math.round(priceCents) : null), currency, sessId, custId, subId, (interval === 'year' ? 'year' : 'month')]
    ).catch(()=>{});
    await query(
      `update ambassador_referrals
          set last_seen_at=now(),
              price_paid_cents=coalesce(price_paid_cents,$3),
              currency=coalesce(currency,$4),
              stripe_session_id=coalesce(stripe_session_id,$5),
              stripe_customer_id=coalesce(stripe_customer_id,$6),
              stripe_subscription_id=coalesce(stripe_subscription_id,$7),
              ambassador_interval=coalesce(ambassador_interval,$8),
              status='paid'
        where ambassador_id=$1 and lower(email)=lower($2)`,
      [ambassadorId, customerEmail, (Number.isFinite(priceCents) ? Math.round(priceCents) : null), currency, sessId, custId, subId, (interval === 'year' ? 'year' : 'month')]
    ).catch(()=>{});
  }

  // Also stamp on user_profiles if we can resolve a user row.
  try {
    if (userId) {
      await query(
        `update user_profiles
            set ambassador_id=coalesce(ambassador_id,$2),
                ambassador_email=coalesce(ambassador_email,$3),
                ambassador_price_paid_cents=coalesce(ambassador_price_paid_cents,$4),
                ambassador_last_paid_at=now()
          where user_id=$1`,
        [String(userId), ambassadorId, ambEmail, (Number.isFinite(priceCents) ? Math.round(priceCents) : null)]
      );
    } else if (customerEmail) {
      await query(
        `update user_profiles
            set ambassador_id=coalesce(ambassador_id,$2),
                ambassador_email=coalesce(ambassador_email,$3),
                ambassador_price_paid_cents=coalesce(ambassador_price_paid_cents,$4),
                ambassador_last_paid_at=now()
          where lower(email)=lower($1)`,
        [customerEmail, ambassadorId, ambEmail, (Number.isFinite(priceCents) ? Math.round(priceCents) : null)]
      );
    }
  } catch (e) {}
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

  // Keep ambassador referral rows in sync (if any).
  try {
    await ensureAmbassadorAttributionColumns();
    const pe = subscription?.current_period_end
      ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
      : null;
    await query(
      `update ambassador_referrals
          set stripe_subscription_status=$2,
              stripe_current_period_end=($3::timestamptz),
              status=case when $2 in ('active','trialing') then 'paid' else status end,
              last_seen_at=now()
        where stripe_subscription_id=$1`,
      [subscription?.id ? String(subscription.id) : null, status, pe]
    );
  } catch (e) {}

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
      try { await recordAmbassadorPaymentFromCheckoutSession(session); } catch (e) {}

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
