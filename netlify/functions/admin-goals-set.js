const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');

function asPositiveInt(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be a positive number`);
  return Math.round(n);
}

function asUrlOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^https?:\/\//.test(s)) throw new Error('URLs must start with http:// or https://');
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  try {
    const weekly = asPositiveInt(body.weekly_active_goal, 'weekly_active_goal');
    const paying = asPositiveInt(body.paying_users_goal, 'paying_users_goal');
    const freeFood = asPositiveInt(body.free_food_entries_per_day, 'free_food_entries_per_day');
    const freeAi = asPositiveInt(body.free_ai_actions_per_day, 'free_ai_actions_per_day');
    const freeHistory = asPositiveInt(body.free_history_days, 'free_history_days');
    const monthlyPrice = asPositiveInt(body.monthly_price_usd, 'monthly_price_usd');
    const yearlyPrice = asPositiveInt(body.yearly_price_usd, 'yearly_price_usd');
    const monthlyUrl = asUrlOrNull(body.monthly_upgrade_url);
    const yearlyUrl = asUrlOrNull(body.yearly_upgrade_url);
    const manageUrl = asUrlOrNull(body.manage_subscription_url);

    await query(
      `insert into app_admin_settings(
         singleton,
         weekly_active_goal,
         paying_users_goal,
         free_food_entries_per_day,
         free_ai_actions_per_day,
         free_history_days,
         monthly_price_usd,
         yearly_price_usd,
         monthly_upgrade_url,
         yearly_upgrade_url,
         manage_subscription_url,
         updated_at
       )
       values (true, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       on conflict (singleton)
       do update set weekly_active_goal=excluded.weekly_active_goal,
                     paying_users_goal=excluded.paying_users_goal,
                     free_food_entries_per_day=excluded.free_food_entries_per_day,
                     free_ai_actions_per_day=excluded.free_ai_actions_per_day,
                     free_history_days=excluded.free_history_days,
                     monthly_price_usd=excluded.monthly_price_usd,
                     yearly_price_usd=excluded.yearly_price_usd,
                     monthly_upgrade_url=excluded.monthly_upgrade_url,
                     yearly_upgrade_url=excluded.yearly_upgrade_url,
                     manage_subscription_url=excluded.manage_subscription_url,
                     updated_at=now()`,
      [weekly, paying, freeFood, freeAi, freeHistory, monthlyPrice, yearlyPrice, monthlyUrl, yearlyUrl, manageUrl]
    );


    try {
      await query(
        `insert into admin_audit_log(action, actor, target, details)
         values ($1,$2,$3,$4::jsonb)`,
        ['admin_goals_set', 'admin_token', 'app_settings', JSON.stringify({ weekly, paying, freeFood, freeAi, freeHistory, monthlyPrice, yearlyPrice })]
      );
    } catch {
      // audit log optional
    }

    return json(200, {
      ok: true,
      weekly_active_goal: weekly,
      paying_users_goal: paying,
      free_food_entries_per_day: freeFood,
      free_ai_actions_per_day: freeAi,
      free_history_days: freeHistory,
      monthly_price_usd: monthlyPrice,
      yearly_price_usd: yearlyPrice,
      monthly_upgrade_url: monthlyUrl,
      yearly_upgrade_url: yearlyUrl,
      manage_subscription_url: manageUrl
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return json(400, { error: 'Admin goals table is missing. Run sql/007_admin_goals_and_passes.sql and sql/008_growth_billing_upgrades.sql.' });
    }
    return json(400, { error: e.message || 'Invalid payload' });
  }
};
