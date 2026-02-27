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

  let bf = null;
  if (Object.prototype.hasOwnProperty.call(body, 'body_fat_percent')) {
    if (body.body_fat_percent == null || body.body_fat_percent === '') {
      bf = null;
    } else {
      bf = Number(body.body_fat_percent);
      if (!Number.isFinite(bf) || bf < 1 || bf > 80) return json(400, { error: 'body_fat_percent must be between 1 and 80' });
    }
  }

  try {
    await query(
      `insert into daily_weights(user_id, entry_date, weight_lbs, body_fat_percent, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())
       on conflict (user_id, entry_date) do update set weight_lbs=excluded.weight_lbs, body_fat_percent=excluded.body_fat_percent, updated_at=now()`,
      [userId, date, w, bf]
    );
  } catch (e) {
    // Backward compatibility if body_fat_percent column doesn't exist
    if (e && e.code === '42703') {
      await query(
        `insert into daily_weights(user_id, entry_date, weight_lbs, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         on conflict (user_id, entry_date) do update set weight_lbs=excluded.weight_lbs, updated_at=now()`,
        [userId, date, w]
      );
    } else {
      throw e;
    }
  }

  return json(200, { ok: true });
};
