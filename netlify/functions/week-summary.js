const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { getUserEntitlements, DEFAULTS } = require("./_plan");

function toISODate(d) { return d.toISOString().slice(0,10); }

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const qs = event.queryStringParameters || {};
  const ent = await getUserEntitlements(userId);
  const maxDays = ent.is_premium ? 60 : (ent.limits.history_days || DEFAULTS.free_history_days);
  const days = Math.min(maxDays, Math.max(7, Number(qs.days || 7)));

  const todayISO = getDenverDateISO(new Date());
  const [y,m,d] = todayISO.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m-1, d));
  const from = new Date(anchor.getTime() - (days-1) * 86400000);
  const fromISO = toISODate(from);

  // Calories totals by day
  const cal = await query(
    `select entry_date::text as entry_date, sum(calories)::int as total_calories
     from food_entries
     where user_id=$1 and entry_date between $2 and $3
     group by entry_date
     order by entry_date asc`,
    [userId, fromISO, todayISO]
  );

  // Weight by day
  const wt = await query(
    `select entry_date::text as entry_date, weight_lbs::float8 as weight_lbs
     from daily_weights
     where user_id=$1 and entry_date between $2 and $3
     order by entry_date asc`,
    [userId, fromISO, todayISO]
  );

  // Build dense day series
  const calMap = new Map(cal.rows.map(r => [r.entry_date, r.total_calories]));
  const wtMap = new Map(wt.rows.map(r => [r.entry_date, r.weight_lbs]));

  const series = [];
  for (let i=0;i<days;i++) {
    const di = new Date(from.getTime() + i*86400000);
    const iso = toISODate(di);
    series.push({
      entry_date: iso,
      total_calories: calMap.get(iso) ?? 0,
      weight_lbs: wtMap.get(iso) ?? null
    });
  }

  return json(200, { from: fromISO, to: todayISO, days, series });
};
