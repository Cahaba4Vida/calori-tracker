const crypto = require('crypto');
const { json } = require("./_util");
const { ensureUserProfile, ensureDeviceIdentity, linkDeviceToUser, resolveUserIdByDevice, query } = require('./_db');

async function stripeGet(pathname) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  const resp = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function tryAttachPaidSubscriptionFromEmail(userId, email) {
  if (!userId || !email) return;

  // If the user already has a subscription linked, do nothing.
  try {
    const existing = await query(
      `select stripe_subscription_id, stripe_customer_id, subscription_status
         from user_profiles where user_id=$1 limit 1`,
      [String(userId)]
    );
    const row = existing.rows[0] || {};
    if (row.stripe_subscription_id || row.stripe_customer_id) return;
  } catch (e) {
    // ignore
  }

  // Look for a paid ambassador referral record by email (covers: paid before signup).
  let ref = null;
  try {
    const r = await query(
      `select ambassador_id, ref_code, stripe_customer_id, stripe_subscription_id
         from ambassador_referrals
        where lower(email)=lower($1)
          and stripe_subscription_id is not null
        order by last_seen_at desc
        limit 1`,
      [String(email)]
    );
    ref = r.rows[0] || null;
  } catch (e) {
    return;
  }

  if (!ref || !ref.stripe_subscription_id) return;

  // Fetch Stripe subscription and sync plan fields.
  const sub = await stripeGet(`subscriptions/${encodeURIComponent(String(ref.stripe_subscription_id))}`);
  if (!sub) return;

  const status = String(sub?.status || 'inactive');
  const isActive = ['active', 'trialing'].includes(status);
  const periodEnd = sub?.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toISOString() : null;

  try {
    await query(
      `update user_profiles
          set ambassador_id=coalesce(ambassador_id,$2),
              ambassador_ref_code=coalesce(ambassador_ref_code,$3),
              stripe_customer_id=$4,
              stripe_subscription_id=$5,
              plan_tier=$6,
              subscription_status=$7,
              subscription_current_period_end=$8
        where user_id=$1`,
      [
        String(userId),
        ref.ambassador_id || null,
        ref.ref_code || null,
        sub?.customer ? String(sub.customer) : (ref.stripe_customer_id ? String(ref.stripe_customer_id) : null),
        sub?.id ? String(sub.id) : String(ref.stripe_subscription_id),
        isActive ? 'premium' : 'free',
        status,
        periodEnd
      ]
    );
  } catch (e) {
    // ignore
  }
}

function getNetlifyUser(context) {
  try {
    const raw = context?.clientContext?.custom?.netlify;
    if (!raw) return null;
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return parsed?.user || null;
  } catch {
    return null;
  }
}

function getHeader(event, name) {
  if (!event || !event.headers) return null;
  return event.headers[name] || event.headers[name.toLowerCase()] || event.headers[name.toUpperCase()] || null;
}

function normalizeDeviceId(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9._-]{12,200}$/.test(trimmed)) return null;
  return trimmed;
}

function stableDeviceUserId(deviceId) {
  const hash = crypto.createHash('sha256').update(String(deviceId)).digest('hex').slice(0, 40);
  return `device_${hash}`;
}

async function requireUser(event, context) {
  const user = getNetlifyUser(context);
  const deviceId = normalizeDeviceId(getHeader(event, 'x-device-id'));

  if (user) {
    const userId = user.sub || user.id || user.user_id;
    const email = user.email || null;
    if (!userId) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

    await ensureUserProfile(userId, email);

    // If the user paid via an ambassador link before signing up, attach their subscription by email.
    if (email) {
      try { await tryAttachPaidSubscriptionFromEmail(userId, email); } catch (e) {}
    }
    if (deviceId) {
      await ensureDeviceIdentity(deviceId);
      await linkDeviceToUser(deviceId, userId);
    }

    return { ok: true, user: { userId, email, claims: user, identity_type: 'user', device_id: deviceId || null } };
  }

  if (!deviceId) {
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  await ensureDeviceIdentity(deviceId);
  const linkedUserId = await resolveUserIdByDevice(deviceId);
  if (linkedUserId) {
    return { ok: true, user: { userId: linkedUserId, email: null, claims: null, identity_type: 'device_linked', device_id: deviceId } };
  }

  const deviceScopedUserId = stableDeviceUserId(deviceId);
  await ensureUserProfile(deviceScopedUserId, null);
  return { ok: true, user: { userId: deviceScopedUserId, email: null, claims: null, identity_type: 'device_anonymous', device_id: deviceId } };
}

async function requireSignedUser(event, context) {
  const user = getNetlifyUser(context);
  if (!user) {
    return { ok: false, response: json(401, { error: 'Sign up or sign in is required for paid features.' }) };
  }

  const userId = user.sub || user.id || user.user_id;
  const email = user.email || null;
  if (!userId) {
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  const deviceId = normalizeDeviceId(getHeader(event, 'x-device-id'));
  await ensureUserProfile(userId, email);
  if (deviceId) {
    await ensureDeviceIdentity(deviceId);
    await linkDeviceToUser(deviceId, userId);
  }

  return { ok: true, user: { userId, email, claims: user, identity_type: 'user', device_id: deviceId || null } };
}

module.exports = { requireUser, requireSignedUser };
