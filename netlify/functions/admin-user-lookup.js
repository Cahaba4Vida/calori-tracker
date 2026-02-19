const { json, getDenverDateISO } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');
const { getUserEntitlements } = require('./_plan');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  const qs = event.queryStringParameters || {};
  const identifier = (qs.identifier || '').trim();
  if (!identifier) return json(400, { error: 'Missing identifier' });

  try {
    // Prefer direct user_id match; else email match. For email duplicates, pick newest identity.
    const r = await query(
      `select user_id, email, created_at,
              coalesce(plan_tier,'free') as plan_tier,
              coalesce(subscription_status,'inactive') as subscription_status,
              coalesce(premium_pass,false) as premium_pass,
              premium_pass_expires_at
       from user_profiles
       where user_id=$1 or lower(email)=lower($1)
       order by created_at desc
       limit 1`,
      [identifier]
    );

    const row = r.rows[0];
    if (!row) return json(404, { error: 'User not found' });

    const userId = row.user_id;
    const dateISO = getDenverDateISO(new Date());
    const [ent, aiUsedR, foodUsedR, deviceCountR] = await Promise.all([
      getUserEntitlements(userId),
      query(`select count(*)::int as count from ai_usage_events where user_id=$1 and entry_date=$2`, [userId, dateISO]),
      query(`select count(*)::int as count from food_entries where user_id=$1 and entry_date=$2`, [userId, dateISO]),
      query(`select count(*)::int as count from user_device_links where user_id=$1`, [userId])
    ]);

    return json(200, {
      ok: true,
      user: {
        user_id: userId,
        email: row.email || null,
        created_at: row.created_at,
        plan_tier: row.plan_tier,
        subscription_status: row.subscription_status,
        premium_pass: !!row.premium_pass,
        premium_pass_expires_at: row.premium_pass_expires_at || null
      },
      entitlements: ent,
      usage_today: {
        entry_date: dateISO,
        ai_actions: Number(aiUsedR.rows[0]?.count || 0),
        food_entries: Number(foodUsedR.rows[0]?.count || 0)
      },
      devices: {
        count: Number(deviceCountR.rows[0]?.count || 0)
      }
    });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
