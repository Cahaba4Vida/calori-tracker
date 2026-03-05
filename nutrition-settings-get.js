const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const daily = Number(body.daily_calories);
  if (!Number.isFinite(daily) || daily < 0) return json(400, { error: "daily_calories must be a non-negative number" });

  await query(
    `insert into calorie_goals(user_id, daily_calories, updated_at)
     values ($1, $2, now())
     on conflict (user_id) do update set daily_calories=excluded.daily_calories, updated_at=now()`,
    [userId, Math.round(daily)]
  );

  return json(200, { ok: true });
};
