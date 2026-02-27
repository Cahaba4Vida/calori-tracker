const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let r;
  try {
    r = await query(
      `select onboarding_completed, macro_protein_g, macro_carbs_g, macro_fat_g,
              goal_weight_lbs, activity_level, goal_date, quick_fills,
              goal_body_fat_percent, goal_body_fat_date,
              current_body_fat_percent, current_body_fat_weight_lbs,
              autopilot_enabled, autopilot_mode, autopilot_last_review_week
       from user_profiles
       where user_id = $1`,
      [userId]
    );
  } catch (e) {
    if (e && e.code === "42703") {
      r = await query(
        `select onboarding_completed, macro_protein_g, macro_carbs_g, macro_fat_g, goal_weight_lbs, activity_level, goal_date
         from user_profiles
         where user_id = $1`,
        [userId]
      );
    } else {
      return json(500, { error: "Could not load profile" });
    }
  }

  const row = r.rows[0] || {};
  return json(200, {
    onboarding_completed: !!row.onboarding_completed,
    macro_protein_g: row.macro_protein_g ?? null,
    macro_carbs_g: row.macro_carbs_g ?? null,
    macro_fat_g: row.macro_fat_g ?? null,
    goal_weight_lbs: row.goal_weight_lbs == null ? null : Number(row.goal_weight_lbs),
    activity_level: row.activity_level ?? null,
    goal_date: row.goal_date ?? null,
    goal_body_fat_percent: row.goal_body_fat_percent == null ? null : Number(row.goal_body_fat_percent),
    goal_body_fat_date: row.goal_body_fat_date ?? null,
    current_body_fat_percent: row.current_body_fat_percent == null ? null : Number(row.current_body_fat_percent),
    current_body_fat_weight_lbs: row.current_body_fat_weight_lbs == null ? null : Number(row.current_body_fat_weight_lbs),
    autopilot_enabled: row.autopilot_enabled == null ? false : !!row.autopilot_enabled,
    autopilot_mode: row.autopilot_mode ?? 'weight',
    autopilot_last_review_week: row.autopilot_last_review_week ? String(row.autopilot_last_review_week) : null,
    quick_fills: Array.isArray(row.quick_fills) ? row.quick_fills : []
  });
};
