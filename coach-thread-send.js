const { json, getDenverDateISO } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile, query } = require('./_db');
const { getUserEntitlements, DEFAULTS } = require('./_plan');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const ent = await getUserEntitlements(userId);
  const today = getDenverDateISO(new Date());

  const [food, ai] = await Promise.all([
    query(`select count(*)::int as count from food_entries where user_id=$1 and entry_date=$2`, [userId, today]),
    query(`select count(*)::int as count from ai_usage_events where user_id=$1 and entry_date=$2`, [userId, today])
  ]);

  const usedFood = Number(food.rows[0]?.count || 0);
  const usedAi = Number(ai.rows[0]?.count || 0);

  return json(200, {
    plan_tier: ent.plan_tier,
    is_premium: ent.is_premium,
    premium_source: ent.premium_source,
    monthly_price_usd: ent.pricing?.monthly_price_usd || DEFAULTS.monthly_price_usd,
    yearly_price_usd: ent.pricing?.yearly_price_usd || DEFAULTS.yearly_price_usd,
    upgrade_links: {
      monthly: ent.pricing?.monthly_upgrade_url || DEFAULTS.monthly_upgrade_url,
      yearly: ent.pricing?.yearly_upgrade_url || DEFAULTS.yearly_upgrade_url,
      manage: ent.pricing?.manage_subscription_url || null
    },
    limits: {
      food_entries_per_day: ent.limits.food_entries_per_day,
      ai_actions_per_day: ent.limits.ai_actions_per_day,
      history_days: ent.limits.history_days,
      can_export: !!ent.is_premium
    },
    usage_today: {
      food_entries: usedFood,
      ai_actions: usedAi,
      food_entries_remaining: ent.is_premium ? null : Math.max(0, (ent.limits.food_entries_per_day || 0) - usedFood),
      ai_actions_remaining: ent.is_premium ? null : Math.max(0, (ent.limits.ai_actions_per_day || 0) - usedAi)
    }
  });
};
