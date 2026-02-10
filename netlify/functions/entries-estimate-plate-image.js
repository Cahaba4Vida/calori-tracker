const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile } = require("./_db");
const { enforceAiActionLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");

function safeNum(x) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return n;
}
function safeStrArr(x) {
  if (!Array.isArray(x)) return [];
  return x.filter(v => typeof v === "string" && v.trim().length > 0).map(v => v.trim()).slice(0, 10);
}
function normConfidence(c) {
  return (c === "high" || c === "medium" || c === "low") ? c : "low";
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);
  const today = getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, today, 'plate_estimate');
  if (!aiLimit.ok) return aiLimit.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const imageDataUrl = body.imageDataUrl;
  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return json(400, { error: "imageDataUrl must be a base64 data URL starting with data:image/..." });
  }

  const portion_hint = (body.portion_hint === "small" || body.portion_hint === "medium" || body.portion_hint === "large")
    ? body.portion_hint
    : null;

  const servings_eaten = safeNum(body.servings_eaten);
  const servingsForPrompt = (servings_eaten != null && servings_eaten > 0) ? servings_eaten : 1.0;

  const prompt = [
    "You are estimating nutrition from a photo of a plate of food.",
    "Return ONLY valid JSON. No markdown. No commentary. No extra keys.",
    "",
    "Hard constraints:",
    "- If the photo is unclear or you cannot identify the food/portions with reasonable confidence, set calories=null and confidence=\"low\" and explain briefly in notes.",
    "- Do NOT overclaim precision. Prefer ranges mentally but output single numbers with uncertainty captured via confidence and assumptions.",
    "- calories must be plausible: 0 < calories < 3000 when present.",
    "- macros plausible: 0 <= protein_g,carbs_g,fat_g <= 250 when present.",
    "",
    "Inputs:",
    `- portion_hint: ${portion_hint || "null"} (small|medium|large or null)`,
    `- servings_eaten: ${servingsForPrompt} (decimal; default 1.0)`,
    "",
    "Output JSON schema (exact keys):",
    JSON.stringify({
      estimated: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      confidence: "low",
      assumptions: [],
      notes: null
    }),
    "",
    "Rules:",
    "- Set estimated=true always.",
    "- assumptions must be 2-6 short bullet-like strings describing what you assumed (e.g., \"assumed chicken thigh, grilled\", \"assumed 1 cup cooked rice\").",
    "- confidence meaning:",
    "  high: food items and portions clearly identifiable",
    "  medium: some ambiguity but reasonable",
    "  low: blurry/occluded/unknown portions or unclear foods",
  ].join("\n");

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
  let out;
  try { out = JSON.parse(text); } catch {
    return json(502, { error: "Model did not return valid JSON", raw: text });
  }

  // Validate schema keys strictly
  const allowedKeys = new Set(["estimated","calories","protein_g","carbs_g","fat_g","confidence","assumptions","notes"]);
  for (const k of Object.keys(out)) {
    if (!allowedKeys.has(k)) return json(502, { error: "Invalid schema (extra keys)", details: k });
  }

  const calories = safeNum(out.calories);
  let confidence = normConfidence(out.confidence);
  const protein_g = safeNum(out.protein_g);
  const carbs_g = safeNum(out.carbs_g);
  const fat_g = safeNum(out.fat_g);
  const assumptions = safeStrArr(out.assumptions);
  const notes = (out.notes == null) ? null : String(out.notes).slice(0, 300);

  // Hard constraints: if calories null -> 422
  if (calories == null) {
    return json(422, {
      error: "Could not estimate calories from the photo. Try a clearer photo with better lighting and the full plate visible.",
      details: { confidence, notes, assumptions }
    });
  }

  // Bounds checks
  if (!(calories > 0 && calories < 3000)) return json(422, { error: "Estimated calories out of plausible bounds", details: { calories } });

  function checkMacro(name, v) {
    if (v == null) return;
    if (!(v >= 0 && v <= 250)) throw new Error(`${name} out of plausible bounds`);
  }
  try {
    checkMacro("protein_g", protein_g);
    checkMacro("carbs_g", carbs_g);
    checkMacro("fat_g", fat_g);
  } catch (e) {
    return json(422, { error: e.message });
  }

  // Sanity check: protein calories shouldn't exceed ~130% of calories; if it does, downgrade confidence and note.
  let warn = null;
  if (protein_g != null) {
    const proteinCals = protein_g * 4;
    if (proteinCals > calories * 1.3) {
      confidence = "low";
      warn = "Protein estimate may be inconsistent with calories; consider adjusting macros.";
    }
  }

  const result = {
    estimated: true,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    confidence,
    assumptions,
    notes: warn ? (notes ? (notes + " | " + warn) : warn) : notes
  };

  return json(200, result);
};
