const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceFoodEntryLimit } = require("./_plan");

function safeNum(x) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return n;
}
function roundInt(n) {
  if (n == null) return null;
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x);
}
function clampStr(s, max=300) {
  if (s == null) return null;
  return String(s).slice(0, max);
}

function compactRawExtraction(meta = {}) {
  return {
    source: clampStr(meta.source ?? "manual", 32),
    confidence: clampStr(meta.confidence ?? "medium", 16),
    estimated: !!meta.estimated,
    notes: clampStr(meta.notes, 180)
  };
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const bodyDate = String(body.date || '').trim();
  const entry_date = /^\d{4}-\d{2}-\d{2}$/.test(bodyDate) ? bodyDate : getDenverDateISO(new Date());
  const limit = await enforceFoodEntryLimit(userId, entry_date);
  if (!limit.ok) return limit.response;

  // Mode 1 (existing): per-serving + servings_eaten
  const caloriesPerServing = safeNum(body.calories_per_serving);
  const servingsEaten = safeNum(body.servings_eaten);

  // Mode 2 (new): totals (plate estimates)
  const caloriesTotal = safeNum(body.calories);

  let totalCalories, totalProtein, totalCarbs, totalFat;
  let raw_extraction = {};

  if (caloriesPerServing != null) {
    // Per-serving path (label flow)
    if (servingsEaten == null || servingsEaten <= 0) return json(400, { error: "servings_eaten must be a positive number" });
    if (caloriesPerServing < 0) return json(400, { error: "calories_per_serving must be a non-negative number" });

    const proteinPerServing = safeNum(body.protein_g_per_serving);
    const carbsPerServing = safeNum(body.carbs_g_per_serving);
    const fatPerServing = safeNum(body.fat_g_per_serving);

    totalCalories = roundInt(caloriesPerServing * servingsEaten);
    totalProtein = proteinPerServing == null ? null : roundInt(proteinPerServing * servingsEaten);
    totalCarbs = carbsPerServing == null ? null : roundInt(carbsPerServing * servingsEaten);
    totalFat = fatPerServing == null ? null : roundInt(fatPerServing * servingsEaten);

    const extracted = body.extracted || {
      calories_per_serving: caloriesPerServing,
      protein_g_per_serving: proteinPerServing,
      carbs_g_per_serving: carbsPerServing,
      fat_g_per_serving: fatPerServing,
      serving_size: body.serving_size ?? null,
      servings_per_container: body.servings_per_container ?? null,
      notes: body.notes ?? null
    };

    raw_extraction = compactRawExtraction({
      source: "nutrition_label",
      confidence: extracted?.confidence ?? "high",
      estimated: false,
      notes: extracted?.notes ?? body.notes
    });
  } else if (caloriesTotal != null) {
    // Totals path (plate photo estimate)
    if (!(caloriesTotal > 0 && caloriesTotal < 3000)) return json(400, { error: "calories must be between 0 and 3000" });

    const protein_g = safeNum(body.protein_g);
    const carbs_g = safeNum(body.carbs_g);
    const fat_g = safeNum(body.fat_g);

    const chk = (name, v) => {
      if (v == null) return;
      if (!(v >= 0 && v <= 250)) throw new Error(`${name} must be between 0 and 250`);
    };
    try {
      chk("protein_g", protein_g); chk("carbs_g", carbs_g); chk("fat_g", fat_g);
    } catch (e) {
      return json(400, { error: e.message });
    }

    totalCalories = roundInt(caloriesTotal);
    totalProtein = protein_g == null ? null : roundInt(protein_g);
    totalCarbs = carbs_g == null ? null : roundInt(carbs_g);
    totalFat = fat_g == null ? null : roundInt(fat_g);

    const meta = body.raw_extraction_meta || {};
    raw_extraction = compactRawExtraction({
      source: meta.source ?? "plate_photo",
      estimated: meta.estimated ?? ((meta.source ?? "plate_photo") === "plate_photo"),
      confidence: meta.confidence ?? "low",
      notes: meta.notes
    });
  } else {
    return json(400, { error: "Invalid payload. Provide calories_per_serving+servings_eaten (label) OR calories totals (estimate)." });
  }

  const ins = await query(
    `insert into food_entries(user_id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction)
     values ($1, now(), $2, $3, $4, $5, $6, $7)
     returning id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction`,
    [userId, entry_date, totalCalories, totalProtein, totalCarbs, totalFat, raw_extraction]
  );

  return json(200, { entry: ins.rows[0] });
};
