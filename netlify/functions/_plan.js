const { query } = require('./_db');
const { getDenverDateISO, json } = require('./_util');

const DEFAULTS = {
  free_food_entries_per_day: 5,
  free_ai_actions_per_day: 5,
  free_history_days: 20,
  monthly_price_usd: 5,
  yearly_price_usd: 50,
  monthly_upgrade_url: 'https://buy.stripe.com/eVqbIUci9aZidBB9qg8bS0b',
  yearly_upgrade_url: 'https://buy.stripe.com/aFadR22Hz7N6app1XO8bS0c',
  manage_subscription_url: null
};

function toPosInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

async function getPlanConfig() {
  try {
    const r = await query(
      `select free_food_entries_per_day, free_ai_actions_per_day, free_history_days,
              monthly_price_usd, yearly_price_usd,
              monthly_upgrade_url, yearly_upgrade_url, manage_subscription_url
       from app_admin_settings where singleton=true limit 1`
    );
    const row = r.rows[0] || {};
    return {
      free_food_entries_per_day: toPosInt(row.free_food_entries_per_day, DEFAULTS.free_food_entries_per_day),
      free_ai_actions_per_day: toPosInt(row.free_ai_actions_per_day, DEFAULTS.free_ai_actions_per_day),
      free_history_days: toPosInt(row.free_history_days, DEFAULTS.free_history_days),
      monthly_price_usd: toPosInt(row.monthly_price_usd, DEFAULTS.monthly_price_usd),
      yearly_price_usd: toPosInt(row.yearly_price_usd, DEFAULTS.yearly_price_usd),
      monthly_upgrade_url: row.monthly_upgrade_url || DEFAULTS.monthly_upgrade_url,
      yearly_upgrade_url: row.yearly_upgrade_url || DEFAULTS.yearly_upgrade_url,
      manage_subscription_url: row.manage_subscription_url || null
    };
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return { ...DEFAULTS };
    throw e;
  }
}

function isSubscriptionPremium(row = {}) {
  return row.plan_tier === 'premium' && ['active', 'trialing'].includes(row.subscription_status);
}

function isPassPremium(row = {}) {
  if (!row.premium_pass) return false;
  if (!row.premium_pass_expires_at) return true;
  return new Date(row.premium_pass_expires_at).getTime() > Date.now();
}

async function getUserEntitlements(userId) {
  const cfg = await getPlanConfig();
  const r = await query(
    `select coalesce(plan_tier, 'free') as plan_tier,
            coalesce(subscription_status, 'inactive') as subscription_status,
            coalesce(premium_pass, false) as premium_pass,
            premium_pass_expires_at
     from user_profiles
     where user_id=$1`,
    [userId]
  );
  const row = r.rows[0] || {};
  const hasSubscription = isSubscriptionPremium(row);
  const hasPass = isPassPremium(row);
  const isPremium = hasSubscription || hasPass;

  return {
    plan_tier: isPremium ? 'premium' : 'free',
    is_premium: isPremium,
    premium_source: hasSubscription ? 'subscription' : (hasPass ? 'admin_pass' : 'none'),
    pricing: {
      monthly_price_usd: cfg.monthly_price_usd,
      yearly_price_usd: cfg.yearly_price_usd,
      monthly_upgrade_url: cfg.monthly_upgrade_url,
      yearly_upgrade_url: cfg.yearly_upgrade_url,
      manage_subscription_url: cfg.manage_subscription_url
    },
    limits: {
      food_entries_per_day: isPremium ? null : cfg.free_food_entries_per_day,
      ai_actions_per_day: isPremium ? null : cfg.free_ai_actions_per_day,
      history_days: isPremium ? null : cfg.free_history_days,
      can_export: isPremium
    }
  };
}

function parseISODateOnly(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return null;
  return String(v);
}

function minAllowedHistoryDate(todayISO, historyDays) {
  const [y, m, d] = todayISO.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const from = new Date(anchor.getTime() - (historyDays - 1) * 86400000);
  return from.toISOString().slice(0, 10);
}

async function enforceHistoryAccess(userId, dateISO) {
  const ent = await getUserEntitlements(userId);
  if (ent.is_premium) return { ok: true, entitlements: ent };

  const today = getDenverDateISO(new Date());
  const reqDate = parseISODateOnly(dateISO) || today;
  const limitDays = ent.limits.history_days || DEFAULTS.free_history_days;
  const minISO = minAllowedHistoryDate(today, limitDays);
  if (reqDate < minISO) {
    return {
      ok: false,
      response: json(403, {
        error: `Free tier includes last ${limitDays} days of history. Upgrade to Premium for unlimited history.`
      }),
      entitlements: ent
    };
  }
  return { ok: true, entitlements: ent };
}

async function enforceFoodEntryLimit(userId, entryDateISO) {
  const ent = await getUserEntitlements(userId);
  if (ent.is_premium) return { ok: true, entitlements: ent };

  const r = await query(
    `select count(*)::int as count from food_entries where user_id=$1 and entry_date=$2`,
    [userId, entryDateISO]
  );
  const used = Number(r.rows[0]?.count || 0);
  const limit = ent.limits.food_entries_per_day || DEFAULTS.free_food_entries_per_day;
  if (used >= limit) {
    return {
      ok: false,
      response: json(403, {
        error: `Free tier allows up to ${limit} food entries per day. Upgrade to Premium for unlimited entries.`
      }),
      entitlements: ent
    };
  }
  return { ok: true, entitlements: ent };
}

async function enforceAiActionLimit(userId, entryDateISO, actionType) {
  const ent = await getUserEntitlements(userId);
  if (ent.is_premium) {
    await query(
      `insert into ai_usage_events(user_id, entry_date, action_type) values ($1,$2,$3)`,
      [userId, entryDateISO, String(actionType || 'unknown').slice(0, 48)]
    );
    return { ok: true, entitlements: ent };
  }

  const usedR = await query(
    `select count(*)::int as count from ai_usage_events where user_id=$1 and entry_date=$2`,
    [userId, entryDateISO]
  );
  const used = Number(usedR.rows[0]?.count || 0);
  const limit = ent.limits.ai_actions_per_day || DEFAULTS.free_ai_actions_per_day;
  if (used >= limit) {
    return {
      ok: false,
      response: json(403, {
        error: `Free tier allows up to ${limit} AI actions per day. Upgrade to Premium for unlimited AI.`
      }),
      entitlements: ent
    };
  }

  await query(
    `insert into ai_usage_events(user_id, entry_date, action_type) values ($1,$2,$3)`,
    [userId, entryDateISO, String(actionType || 'unknown').slice(0, 48)]
  );

  return { ok: true, entitlements: ent };
}

module.exports = {
  DEFAULTS,
  getPlanConfig,
  getUserEntitlements,
  enforceHistoryAccess,
  enforceFoodEntryLimit,
  enforceAiActionLimit,
  minAllowedHistoryDate
};
