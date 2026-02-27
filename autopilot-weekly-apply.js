const { json, getDenverDateISO } = require('./_util');
const { requireUser } = require('./_auth');
const { query, ensureUserProfile } = require('./_db');

function weekStartISO(denverISO /* YYYY-MM-DD */) {
  const [y, m, d] = denverISO.split('-').map(Number);
  // Anchor at midnight UTC for date math
  const dt = new Date(Date.UTC(y, m - 1, d));
  // JS: 0=Sun..6=Sat. We want Monday start.
  const dow = dt.getUTCDay();
  const offsetToMon = (dow + 6) % 7; // Mon->0 ... Sun->6
  dt.setUTCDate(dt.getUTCDate() - offsetToMon);
  return dt.toISOString().slice(0, 10);
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const todayISO = getDenverDateISO(new Date());
  const thisWeek = weekStartISO(todayISO);

  // Autopilot + goal fields live on user_profiles
  const r = await query(
    `select
       autopilot_enabled,
       autopilot_mode,
       autopilot_last_review_week,
       goal_weight_lbs,
       goal_date,
       goal_body_fat_percent,
       goal_body_fat_date,
       current_body_fat_percent,
       current_body_fat_weight_lbs
     from user_profiles
     where user_id=$1`,
    [userId]
  );

  const row = r.rows[0] || {};
  return json(200, {
    today: todayISO,
    week_start: thisWeek,
    autopilot_enabled: !!row.autopilot_enabled,
    autopilot_mode: row.autopilot_mode || 'weight',
    autopilot_last_review_week: row.autopilot_last_review_week ? String(row.autopilot_last_review_week) : null,
    goal_weight_lbs: row.goal_weight_lbs == null ? null : Number(row.goal_weight_lbs),
    goal_date: row.goal_date ?? null,
    goal_body_fat_percent: row.goal_body_fat_percent == null ? null : Number(row.goal_body_fat_percent),
    goal_body_fat_date: row.goal_body_fat_date ?? null,
    current_body_fat_percent: row.current_body_fat_percent == null ? null : Number(row.current_body_fat_percent),
    current_body_fat_weight_lbs: row.current_body_fat_weight_lbs == null ? null : Number(row.current_body_fat_weight_lbs)
  });
};
