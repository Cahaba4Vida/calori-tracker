const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const date = body.date || getDenverDateISO(new Date());
  const w = Number(body.weight_lbs);
  if (!Number.isFinite(w) || w <= 0) return json(400, { error: "weight_lbs must be a positive number" });

  await query(
    `insert into daily_weights(user_id, entry_date, weight_lbs, created_at, updated_at)
     values ($1, $2, $3, now(), now())
     on conflict (user_id, entry_date) do update set weight_lbs=excluded.weight_lbs, updated_at=now()`,
    [userId, date, w]
  );

  return json(200, { ok: true });
};
