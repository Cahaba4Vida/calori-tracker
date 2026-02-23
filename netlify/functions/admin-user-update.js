const { requireAdmin } = require('./_adminAuth');
const { json, query, parseBody } = require('./_db');

const ALLOWED_FIELDS = new Set([
  'email',
  'onboarding_completed',
  'goal_weight_lbs',
  'goal_date',
  'activity_level',
  'macro_protein_g',
  'macro_carbs_g',
  'macro_fat_g',
  'plan_tier',
  'subscription_status',
  'stripe_customer_id',
  'stripe_subscription_id',
  'premium_pass',
  'premium_pass_expires_at',
]);

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (auth) return auth;
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const body = parseBody(event);
    const user_id = body?.user_id;
    if (!user_id) return json({ ok: false, error: 'Missing user_id' }, 400);

    const updates = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (k === 'user_id') continue;
      if (!ALLOWED_FIELDS.has(k)) continue;
      updates[k] = v;
    }

    const keys = Object.keys(updates);
    if (!keys.length) return json({ ok: false, error: 'No valid fields to update' }, 400);

    // Build parameterized query.
    const setClauses = [];
    const params = [];
    let i = 1;
    for (const k of keys) {
      setClauses.push(`${k} = $${i++}`);
      params.push(updates[k]);
    }
    params.push(user_id);

    const rows = await query(
      `update user_profiles
          set ${setClauses.join(', ')}
        where user_id = $${i}
      returning user_id, email, onboarding_completed, goal_weight_lbs, goal_date, activity_level,
                macro_protein_g, macro_carbs_g, macro_fat_g, plan_tier, subscription_status,
                stripe_customer_id, stripe_subscription_id, premium_pass, premium_pass_expires_at`,
      params
    );

    if (!rows.length) return json({ ok: false, error: 'User not found' }, 404);
    return json({ ok: true, user: rows[0] });
  } catch (e) {
    return json({ ok: false, error: 'Failed to update user', detail: String(e?.message || e) }, 500);
  }
};
