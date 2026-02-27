const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceFoodEntryLimit, enforceAiActionLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");

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

function clampStr(s, max=180) {
  if (s == null) return null;
  return String(s).slice(0, max);
}

function compactRawExtraction(meta = {}) {
  return {
    source: clampStr(meta.source ?? "nutrition_label", 32),
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
  const today = getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, today, 'label_scan');
  if (!aiLimit.ok) return aiLimit.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const imageDataUrl = body.imageDataUrl;
  const extractOnly = !!body.extract_only;

  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return json(400, { error: "imageDataUrl must be a base64 data URL starting with data:image/..." });
  }

  // Required extraction response shape
  const shape = {
    calories_per_serving: "number | null",
    protein_g_per_serving: "number | null",
    carbs_g_per_serving: "number | null",
    fat_g_per_serving: "number | null",
    serving_size: "string | null",
    servings_per_container: "number | null",
    notes: "string | null"
  };

  const prompt = `You are reading a photo. Extract nutrition data ONLY from a real Nutrition Facts / Nutrition Information panel.

Return ONLY valid JSON. No markdown. No commentary. No extra keys.

Hard constraints:
- If you cannot clearly see a Nutrition Facts panel, set calories_per_serving = null and confidence = "low".
- If calories cannot be confidently read as a number, set calories_per_serving = null (do NOT guess).
- Protein must be grams. If you only see %DV (or grams are unclear), set protein_g_per_serving = null.
- Prefer values labeled “per serving”. If there are multiple columns, identify them.
- If the panel is “per 100 g / 100ml”, set nutrition_basis = "per_100g".
- If the panel is “per container” only, set nutrition_basis = "per_container".
- If the label has “as prepared” vs “unprepared”, choose the column that matches what is MOST clearly labeled. If unclear, set nutrition_basis = "unknown" and include that ambiguity in notes.

Two-column / multi-column rule:
- If you see BOTH “per serving” and “per container” (or “as prepared” variants), set primary fields to the “per serving” column when present.
- Put any “per container” totals into alt_per_container when present.

Output JSON schema (exact keys, exact types):
{
  "nutrition_basis": "per_serving" | "per_container" | "per_100g" | "unknown",
  "confidence": "high" | "medium" | "low",

  "calories_per_serving": number | null,
  "protein_g_per_serving": number | null,
  "carbs_g_per_serving": number | null,
  "fat_g_per_serving": number | null,

  "serving_size": string | null,
  "servings_per_container": number | null,

  "is_prepared_variant": boolean,
  "prepared_label": string | null,

  "alt_per_container": {
    "calories": number | null,
    "protein_g": number | null,
    "carbs_g": number | null,
    "fat_g": number | null
  } | null,

  "notes": string | null
}

Guidance for confidence:
- "high": calories and at least one macro line are crisp/readable and clearly labeled.
- "medium": calories readable but macros partly unclear OR label slightly ambiguous.
- "low": glare/blur/cropping/angle OR unsure whether panel is per serving vs per 100g/per container.

Notes field:
- Keep it short and factual about what blocked certainty (e.g. "glare on calories row", "panel appears per 100g", "two columns: prepared vs unprepared").

IMPORTANT: If the image is NOT a Nutrition Facts panel (e.g., front-of-box marketing claims), return calories_per_serving = null, confidence="low", and notes="Nutrition Facts panel not visible".
`;

  const resp = await responsesCreate({
    model: "gpt-5.2",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl }
        ]
      }
    ]
  });

  const text = outputText(resp);
  let extracted;
  try { extracted = JSON.parse(text); } catch {
    return json(502, { error: "Model did not return valid JSON", raw: text });
  }

  const caloriesPerServing = safeNum(extracted.calories_per_serving);
  if (caloriesPerServing == null) {
    return json(422, {
      error: "Could not read calories per serving from image. Try a closer, clearer photo.",
      details: extracted
    });
  }

  // If the client only wants extraction, return it (no insert).
  if (extractOnly) {
    return json(200, { extracted });
  }

  // Backward compatible behavior: default to 1 serving eaten, compute totals and insert.
  const servingsEaten = 1.0;
  const proteinPerServing = safeNum(extracted.protein_g_per_serving);
  const carbsPerServing = safeNum(extracted.carbs_g_per_serving);
  const fatPerServing = safeNum(extracted.fat_g_per_serving);

  const totalCalories = roundInt(caloriesPerServing * servingsEaten);
  const totalProtein = proteinPerServing == null ? null : roundInt(proteinPerServing * servingsEaten);
  const totalCarbs = carbsPerServing == null ? null : roundInt(carbsPerServing * servingsEaten);
  const totalFat = fatPerServing == null ? null : roundInt(fatPerServing * servingsEaten);

  const entry_date = getDenverDateISO(new Date());
  const foodLimit = await enforceFoodEntryLimit(userId, entry_date);
  if (!foodLimit.ok) return foodLimit.response;
  const raw_extraction = compactRawExtraction({
    source: "nutrition_label",
    confidence: extracted?.confidence ?? "high",
    estimated: false,
    notes: extracted?.notes
  });

  const ins = await query(
    `insert into food_entries(user_id, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g`,
    [userId, entry_date, totalCalories, totalProtein, totalCarbs, totalFat, raw_extraction]
  );

  return json(200, { entry: ins.rows[0], extracted });
};
