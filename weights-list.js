const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const qs = event.queryStringParameters || {};
  const date = qs.date || getDenverDateISO(new Date());

  const r = await query(
    `select weight_lbs::float8 as weight_lbs
     from daily_weights
     where user_id=$1 and entry_date=$2`,
    [userId, date]
  );
  const weight_lbs = r.rows[0]?.weight_lbs ?? null;
  return json(200, { entry_date: date, weight_lbs });
};
