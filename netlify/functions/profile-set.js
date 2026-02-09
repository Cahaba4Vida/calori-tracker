const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

function asIntOrNull(v, field) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(n);
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  try {
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, "onboarding_completed")) {
      if (typeof body.onboarding_completed !== "boolean") return json(400, { error: "onboarding_completed must be boolean" });
      values.push(body.onboarding_completed);
      updates.push(`onboarding_completed = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, "macro_protein_g")) {
      values.push(asIntOrNull(body.macro_protein_g, "macro_protein_g"));
      updates.push(`macro_protein_g = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "macro_carbs_g")) {
      values.push(asIntOrNull(body.macro_carbs_g, "macro_carbs_g"));
      updates.push(`macro_carbs_g = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "macro_fat_g")) {
      values.push(asIntOrNull(body.macro_fat_g, "macro_fat_g"));
      updates.push(`macro_fat_g = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, "goal_weight_lbs")) {
      if (body.goal_weight_lbs == null) {
        values.push(null);
      } else {
        const n = Number(body.goal_weight_lbs);
        if (!Number.isFinite(n) || n <= 0) return json(400, { error: "goal_weight_lbs must be a positive number" });
        values.push(n);
      }
      updates.push(`goal_weight_lbs = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, "activity_level")) {
      const allowed = new Set(["sedentary", "light", "moderate", "very_active"]);
      if (body.activity_level != null && !allowed.has(body.activity_level)) {
        return json(400, { error: "activity_level must be one of sedentary|light|moderate|very_active" });
      }
      values.push(body.activity_level ?? null);
      updates.push(`activity_level = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, "goal_date")) {
      if (body.goal_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.goal_date))) {
        return json(400, { error: "goal_date must be YYYY-MM-DD or null" });
      }
      values.push(body.goal_date ?? null);
      updates.push(`goal_date = $${values.length}`);
    }

    if (updates.length === 0) return json(400, { error: "No valid fields to update" });

    values.push(userId);
    await query(`update user_profiles set ${updates.join(", ")} where user_id = $${values.length}`, values);
    return json(200, { ok: true });
  } catch (e) {
    return json(400, { error: e.message || "Invalid payload" });
  }
};
