const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const r = await query("select daily_calories from calorie_goals where user_id=$1", [userId]);
  const daily_calories = r.rows[0]?.daily_calories ?? null;
  return json(200, { daily_calories });
};
