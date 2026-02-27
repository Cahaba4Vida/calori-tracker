const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { getUserEntitlements, DEFAULTS } = require("./_plan");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const qs = event.queryStringParameters || {};
  const ent = await getUserEntitlements(userId);
  const maxDays = ent.is_premium ? 365 : (ent.limits.history_days || DEFAULTS.free_history_days);
  const days = Math.min(maxDays, Math.max(1, Number(qs.days || 30)));

  // Compute from-date in Denver time by taking today's date string and subtracting days in JS Date in UTC.
  const today = new Date();
  const todayISO = getDenverDateISO(today);
  const [y,m,d] = todayISO.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m-1, d));
  const from = new Date(anchor.getTime() - (days-1) * 86400000);
  const fromISO = from.toISOString().slice(0,10);

  const r = await query(
    `select entry_date::text as entry_date, weight_lbs::float8 as weight_lbs
     from daily_weights
     where user_id=$1 and entry_date between $2 and $3
     order by entry_date asc`,
    [userId, fromISO, todayISO]
  );

  return json(200, { weights: r.rows });
};
