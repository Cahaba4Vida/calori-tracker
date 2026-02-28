const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

function isoToDate(iso) {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysISO(iso, days) {
  const dt = isoToDate(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function computeRollover(userId, todayISO, baseGoal) {
  // Returns {enabled, cap, delta, effective}
  let enabled = false;
  let cap = 500;
  try {
    const s = await query(
      `select coalesce(rollover_enabled,false) as rollover_enabled,
              coalesce(rollover_cap,500) as rollover_cap
         from user_profiles where user_id=$1`,
      [userId]
    );
    enabled = !!s.rows[0]?.rollover_enabled;
    cap = Number(s.rows[0]?.rollover_cap ?? 500);
  } catch (e) {
    if (!(e && e.code === "42703")) throw e;
    enabled = false;
    cap = 500;
  }

  if (!enabled || !baseGoal) {
    return { enabled, cap, delta: 0, effective: baseGoal };
  }

  const yday = addDaysISO(todayISO, -1);
  const r = await query(
    `select sum(calories)::int as total
       from food_entries
      where user_id=$1 and entry_date=$2`,
    [userId, yday]
  );
  const total = r.rows[0]?.total;
  if (total == null) {
    // No logged food yesterday => no rollover.
    return { enabled, cap, delta: 0, effective: baseGoal };
  }

  let delta = baseGoal - total; // under => positive
  const lim = Math.max(0, Math.min(2000, Number(cap) || 500));
  if (delta > lim) delta = lim;
  if (delta < -lim) delta = -lim;
  return { enabled, cap: lim, delta, effective: baseGoal + delta };
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const r = await query("select daily_calories from calorie_goals where user_id=$1", [userId]);
  const daily_calories = r.rows[0]?.daily_calories ?? null;

  const todayISO = getDenverDateISO(new Date());
  const roll = await computeRollover(userId, todayISO, daily_calories);

  return json(200, {
    daily_calories,
    rollover_enabled: roll.enabled,
    rollover_cap: roll.cap,
    rollover_delta: roll.delta,
    effective_daily_calories: roll.effective
  });
};
