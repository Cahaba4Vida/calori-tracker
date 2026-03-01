const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

function addDaysISO(iso, days) {
  const [y,m,d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth()+1).padStart(2,"0");
  const dd = String(dt.getUTCDate()).padStart(2,"0");
  return `${yy}-${mm}-${dd}`;
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const goalR = await query("select daily_calories from calorie_goals where user_id=$1", [userId]);
  const daily_calories = goalR.rows[0]?.daily_calories ?? null;

  const profR = await query("select rollover_enabled, rollover_cap from user_profiles where user_id=$1", [userId]);
  const rollover_enabled = !!profR.rows[0]?.rollover_enabled;
  const rollover_cap = profR.rows[0]?.rollover_cap ?? 500;

  let rollover_delta = 0;
  let effective_daily_calories = daily_calories;

  if (rollover_enabled && daily_calories != null) {
    const today = getDenverDateISO(new Date());
    const yesterday = addDaysISO(today, -1);
    const sumR = await query(
      "select count(*)::int as n, coalesce(sum(calories),0)::int as total from food_entries where user_id=$1 and entry_date=$2",
      [userId, yesterday]
    );
    const n = sumR.rows[0]?.n ?? 0;
    const total = sumR.rows[0]?.total ?? 0;

    if (n > 0) {
      const deltaRaw = (daily_calories - total);
      const cap = Math.max(0, Math.min(2000, Number(rollover_cap) || 500));
      rollover_delta = Math.max(-cap, Math.min(cap, deltaRaw));
      effective_daily_calories = daily_calories + rollover_delta;
    }
  }

  return json(200, { daily_calories, rollover_enabled, rollover_cap, rollover_delta, effective_daily_calories });
};
