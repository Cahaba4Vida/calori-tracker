const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceHistoryAccess } = require("./_plan");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const qs = event.queryStringParameters || {};
  const date = qs.date || getDenverDateISO(new Date());
  const historyAccess = await enforceHistoryAccess(userId, date);
  if (!historyAccess.ok) return historyAccess.response;

  const r = await query(
    `select id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction
     from food_entries
     where user_id=$1 and entry_date=$2
     order by taken_at asc`,
    [userId, date]
  );

  const total = r.rows.reduce((s, x) => s + (x.calories || 0), 0);
  return json(200, { entry_date: date, total_calories: total, entries: r.rows });
};
