const { requireAdmin } = require('./_adminAuth');
const { json, query } = require('./_db');

// Lists signed-up users (email-based accounts).
// This intentionally excludes anonymous device-only profiles.
exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (auth) return auth;

  try {
    const limit = Math.min(Math.max(parseInt(event.queryStringParameters?.limit || '200', 10) || 200, 1), 1000);
    const rows = await query(
      `select
          user_id,
          email,
          created_at,
          onboarding_completed,
          goal_weight_lbs,
          goal_date,
          activity_level,
          macro_protein_g,
          macro_carbs_g,
          macro_fat_g,
          plan_tier,
          subscription_status,
          stripe_customer_id,
          stripe_subscription_id,
          premium_pass,
          premium_pass_expires_at
        from user_profiles
       where email is not null and btrim(email) <> ''
       order by created_at desc
       limit $1`,
      [limit]
    );

    return json({ ok: true, users: rows });
  } catch (e) {
    return json({ ok: false, error: 'Failed to list users', detail: String(e?.message || e) }, 500);
  }
};
