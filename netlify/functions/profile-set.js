const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

function asIntOrNull(v, field) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(n);
}

function normalizeQuickFills(raw) {
  if (!Array.isArray(raw)) throw new Error("quick_fills must be an array");
  if (raw.length > 30) throw new Error("quick_fills supports up to 30 items");

  return raw.map((x, i) => {
    if (!x || typeof x !== "object") throw new Error(`quick_fills[${i}] must be an object`);
    const id = String(x.id || "").trim();
    const name = String(x.name || "").trim();
    const calories = Number(x.calories);
    if (!id) throw new Error(`quick_fills[${i}].id is required`);
    if (!name) throw new Error(`quick_fills[${i}].name is required`);
    if (!Number.isFinite(calories) || calories <= 0) throw new Error(`quick_fills[${i}].calories must be > 0`);

    const toMacro = (v, key) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`quick_fills[${i}].${key} must be >= 0`);
      return Math.round(n);
    };

    return {
      id: id.slice(0, 64),
      name: name.slice(0, 40),
      calories: Math.round(calories),
      protein_g: toMacro(x.protein_g, "protein_g"),
      carbs_g: toMacro(x.carbs_g, "carbs_g"),
      fat_g: toMacro(x.fat_g, "fat_g"),
      enabled: !!x.enabled
    };
  });
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

    if (Object.prototype.hasOwnProperty.call(body, "quick_fills")) {
      values.push(JSON.stringify(normalizeQuickFills(body.quick_fills)));
      updates.push(`quick_fills = $${values.length}::jsonb`);
    }

    if (updates.length === 0) return json(400, { error: "No valid fields to update" });

    values.push(userId);
    await query(`update user_profiles set ${updates.join(", ")} where user_id = $${values.length}`, values);
    return json(200, { ok: true });
  } catch (e) {
    if (e && e.code === "42703" && Object.prototype.hasOwnProperty.call(body, "quick_fills")) {
      return json(400, { error: "Quick fills are not enabled in your database yet. Run sql/004_quick_fills.sql and try again." });
    }
    return json(400, { error: e.message || "Invalid payload" });
  }
};
