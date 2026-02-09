const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile } = require("./_db");
const { responsesCreate, outputText } = require("./_openai");


function daysUntil(goalDate) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const goal = new Date(`${goalDate}T00:00:00Z`);
  return Math.max(1, Math.round((goal.getTime() - now.getTime()) / 86400000));
}

function activityMultiplier(level) {
  if (level === "sedentary") return 1.2;
  if (level === "light") return 1.35;
  if (level === "moderate") return 1.5;
  return 1.7;
}

function fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate }) {
  const days = daysUntil(goalDate);
  const lbsDelta = goalWeight - currentWeight;
  const dailyDelta = (lbsDelta * 3500) / days;

  const maintenance = currentWeight * 14 * activityMultiplier(activityLevel) / 1.4;
  const daily = Math.round(maintenance + dailyDelta);

  if (daily < 1200 || daily > 4000) return null;

  const protein = Math.round(Math.max(80, currentWeight * 0.8));
  const fat = Math.round(Math.max(40, daily * 0.27 / 9));
  const carbs = Math.max(0, Math.round((daily - (protein * 4 + fat * 9)) / 4));

  return {
    daily_calories: daily,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    rationale_bullets: [
      `Fallback plan used because AI output was unavailable.`,
      `Calorie target is based on your timeline (${days} days) and activity level (${activityLevel}).`,
      `Protein is set to support lean mass while dieting or gaining.`
    ]
  };
}

function isFutureDate(dateText) {
  const ms = Date.parse(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return ms > today.getTime();
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

  const currentWeight = Number(body.current_weight_lbs);
  const goalWeight = Number(body.goal_weight_lbs);
  const activityLevel = body.activity_level;
  const goalDate = String(body.goal_date || "");
  const allowed = new Set(["sedentary", "light", "moderate", "very_active"]);

  if (!Number.isFinite(currentWeight) || currentWeight <= 0 ||
      !Number.isFinite(goalWeight) || goalWeight <= 0 ||
      !allowed.has(activityLevel) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(goalDate) ||
      !isFutureDate(goalDate)) {
    return json(400, { error: "Invalid payload" });
  }

  const prompt = [
    "You generate a calorie and macro plan for a weight goal.",
    "Return ONLY valid JSON with no markdown and no extra keys.",
    "JSON schema: {\"daily_calories\":number,\"protein_g\":number,\"carbs_g\":number,\"fat_g\":number,\"rationale_bullets\":string[]}",
    "Use realistic sports nutrition guidance.",
    "daily_calories must be integer 1200-4000.",
    "protein_g, carbs_g, fat_g must be integers >= 0.",
    "Ensure macro calories roughly match daily calories (within ±15%).",
    `current_weight_lbs=${currentWeight}`,
    `goal_weight_lbs=${goalWeight}`,
    `activity_level=${activityLevel}`,
    `goal_date=${goalDate}`
  ].join("\n");

  let out;
  try {
    const resp = await responsesCreate({
      model: "gpt-5.2",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
    });
    out = JSON.parse(outputText(resp));
  } catch {
    const fallback = fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate });
    if (!fallback) return json(422, { error: "Plan is unreasonable" });
    return json(200, fallback);
  }

  const keys = ["daily_calories", "protein_g", "carbs_g", "fat_g", "rationale_bullets"];
  for (const k of Object.keys(out || {})) {
    if (!keys.includes(k)) {
      const fallback = fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate });
      if (!fallback) return json(422, { error: "Plan is unreasonable" });
      return json(200, fallback);
    }
  }

  const daily = Number(out.daily_calories);
  const protein = Number(out.protein_g);
  const carbs = Number(out.carbs_g);
  const fat = Number(out.fat_g);
  const rationale = Array.isArray(out.rationale_bullets) ? out.rationale_bullets.filter(x => typeof x === "string") : null;

  if (!Number.isFinite(daily) || !Number.isFinite(protein) || !Number.isFinite(carbs) || !Number.isFinite(fat) || !rationale) {
    const fallback = fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate });
    if (!fallback) return json(422, { error: "Plan is unreasonable" });
    return json(200, fallback);
  }

  const rounded = {
    daily_calories: Math.round(daily),
    protein_g: Math.round(protein),
    carbs_g: Math.round(carbs),
    fat_g: Math.round(fat),
    rationale_bullets: rationale.slice(0, 8)
  };

  if (rounded.daily_calories < 1200 || rounded.daily_calories > 4000) {
    return json(422, { error: "Plan is unreasonable" });
  }

  return json(200, rounded);
};
