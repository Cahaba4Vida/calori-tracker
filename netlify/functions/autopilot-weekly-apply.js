const { json, getDenverDateISO } = require('./_util');
const { requireUser } = require('./_auth');
const { query, ensureUserProfile } = require('./_db');

function weekStartISO(denverISO) {
  const [y, m, d] = denverISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const offsetToMon = (dow + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - offsetToMon);
  return dt.toISOString().slice(0, 10);
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  if (typeof body.accept !== 'boolean') return json(400, { error: 'accept must be boolean' });

  const todayISO = getDenverDateISO(new Date());
  const thisWeek = weekStartISO(todayISO);

  // Mark reviewed regardless
  await query('update user_profiles set autopilot_last_review_week = $2 where user_id=$1', [userId, thisWeek]);

  if (!body.accept) {
    return json(200, { ok: true, applied: false, week_start: thisWeek });
  }

  // Recompute suggestion server-side by calling the logic in autopilot-weekly-suggest (inline minimal)
  // To avoid circular requires, we do a simple fetch from DB again: use the same computation in the suggest endpoint.
  // Easiest: call the suggest endpoint via internal logic is not available; so we require the client to pass suggested_daily_calories,
  // but clamp it to a safe range and max-step from current goal.
  const suggested = Number(body.suggested_daily_calories);
  if (!Number.isFinite(suggested) || suggested < 800 || suggested > 6000) {
    return json(400, { error: 'suggested_daily_calories must be a reasonable number' });
  }

  try {
  const gr = await query('select daily_calories from calorie_goals where user_id=$1', [userId]);
  const currentGoal = gr.rows[0]?.daily_calories == null ? null : Number(gr.rows[0].daily_calories);
  if (!Number.isFinite(currentGoal) || currentGoal <= 0) return json(400, { error: 'No current calorie goal to update' });

  const maxStep = 150;
  const delta = Math.max(-maxStep, Math.min(maxStep, suggested - currentGoal));
  const appliedGoal = Math.round((currentGoal + delta) / 10) * 10;

  await query(
    `insert into calorie_goals(user_id, daily_calories, created_at, updated_at)
     values ($1, $2, now(), now())
     on conflict (user_id) do update set daily_calories=excluded.daily_calories, updated_at=now()`,
    [userId, appliedGoal]
  );

  return json(200, { ok: true, applied: true, week_start: thisWeek, applied_daily_calories: appliedGoal });
  } catch (e) {
    return json(500, { error: 'Failed to apply autopilot update', detail: String(e && e.message || e) });
  }

};
