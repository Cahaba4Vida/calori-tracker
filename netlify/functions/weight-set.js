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
  const bf = (body.body_fat_percent==null || body.body_fat_percent==='') ? null : Number(body.body_fat_percent);
  if (!Number.isFinite(w) || w <= 0) return json(400, { error: "weight_lbs must be a positive number" });
  if (bf!=null && (!Number.isFinite(bf) || bf<=0 || bf>=100)) return json(400, { error: "body_fat_percent must be a number between 0 and 100" });

  await query(
    `insert into daily_weights(user_id, entry_date, weight_lbs, body_fat_percent, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())
     on conflict (user_id, entry_date) do update set weight_lbs=excluded.weight_lbs, body_fat_percent=excluded.body_fat_percent, updated_at=now()`,
    [userId, date, w, bf]
  );

  return json(200, { ok: true });
};
