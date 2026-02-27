const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceAiActionLimit } = require("./_plan");
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

function fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate, history }) {
  const days = daysUntil(goalDate);
  const lbsDelta = goalWeight - currentWeight;
  const dailyDelta = (lbsDelta * 3500) / days;

  const maintenanceBase = currentWeight * 14 * activityMultiplier(activityLevel) / 1.4;
  const historyAnchor = Number.isFinite(history.avg_logged_day_calories)
    ? Number(history.avg_logged_day_calories)
    : null;
  const maintenance = historyAnchor != null
    ? Math.round((maintenanceBase * 0.65) + (historyAnchor * 0.35))
    : Math.round(maintenanceBase);
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
      "Fallback plan used because AI output was unavailable.",
      `Calorie target is based on your timeline (${days} days) and activity level (${activityLevel}).`,
      historyAnchor != null
        ? `Recent food logs were considered (about ${historyAnchor} calories on logged days).`
        : "No recent intake history was available, so body-weight estimates were used.",
      "Protein is set to support lean mass while dieting or gaining."
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

async function loadHistorySummary(userId) {
  const empty = {
    days_with_entries_35d: 0,
    avg_logged_day_calories: null,
    avg_calendar_day_calories: null,
    tracked_days_all_time: 0,
    first_entry_date: null,
    last_entry_date: null,
    first_weight_35d_lbs: null,
    last_weight_35d_lbs: null,
    weight_change_35d_lbs: null
  };

  try {
    const allTimeStats = await query(
      `with all_entries as (
         select entry_date from food_entries where user_id = $1
         union all
         select entry_date from food_entries_archive where user_id = $1
       ), days as (
         select distinct entry_date from all_entries
       )
       select count(*)::int as tracked_days_all_time,
              min(entry_date) as first_entry_date,
              max(entry_date) as last_entry_date
       from days`,
      [userId]
    );

    const recentStats = await query(
      `with all_entries as (
         select entry_date, calories from food_entries
         where user_id = $1 and entry_date >= current_date - 35
         union all
         select entry_date, calories from food_entries_archive
         where user_id = $1 and entry_date >= current_date - 35
       ), day_totals as (
         select entry_date, sum(calories)::int as total_calories
         from all_entries
         group by entry_date
       )
       select count(*)::int as days_with_entries_35d,
              round(avg(total_calories))::int as avg_logged_day_calories,
              round(coalesce(sum(total_calories), 0) / 35.0)::int as avg_calendar_day_calories
       from day_totals`,
      [userId]
    );

    const weights = await query(
      `select entry_date, weight_lbs
       from daily_weights
       where user_id = $1 and entry_date >= current_date - 35
       order by entry_date asc`,
      [userId]
    );

    const out = { ...empty };
    const a = allTimeStats.rows[0] || {};
    const r = recentStats.rows[0] || {};

    out.tracked_days_all_time = Number(a.tracked_days_all_time || 0);
    out.first_entry_date = a.first_entry_date || null;
    out.last_entry_date = a.last_entry_date || null;
    out.days_with_entries_35d = Number(r.days_with_entries_35d || 0);
    out.avg_logged_day_calories = r.avg_logged_day_calories == null ? null : Number(r.avg_logged_day_calories);
    out.avg_calendar_day_calories = r.avg_calendar_day_calories == null ? null : Number(r.avg_calendar_day_calories);

    if (weights.rows.length > 0) {
      const first = Number(weights.rows[0].weight_lbs);
      const last = Number(weights.rows[weights.rows.length - 1].weight_lbs);
      out.first_weight_35d_lbs = Number.isFinite(first) ? first : null;
      out.last_weight_35d_lbs = Number.isFinite(last) ? last : null;
      if (Number.isFinite(first) && Number.isFinite(last)) {
        out.weight_change_35d_lbs = Math.round((last - first) * 10) / 10;
      }
    }

    return out;
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return empty;
    }
    throw e;
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);
  const aiLimit = await enforceAiActionLimit(userId, getDenverDateISO(new Date()), 'ai_goal_plan');
  if (!aiLimit.ok) return aiLimit.response;

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

  const history = await loadHistorySummary(userId);
  const editRequest = typeof body.edit_request === "string" ? body.edit_request.trim() : "";
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];

  const prompt = [
    "You generate a calorie and macro plan for a weight goal.",
    "Return ONLY valid JSON with no markdown and no extra keys.",
    "JSON schema: {\"daily_calories\":number,\"protein_g\":number,\"carbs_g\":number,\"fat_g\":number,\"rationale_bullets\":string[]}",
    "Use realistic sports nutrition guidance.",
    "daily_calories must be integer 1200-4000.",
    "protein_g, carbs_g, fat_g must be integers >= 0.",
    "Ensure macro calories roughly match daily calories (within ±15%).",
    "Use past logging history to calibrate the recommendation when useful, but do not overfit to incomplete logs.",
    `current_weight_lbs=${currentWeight}`,
    `goal_weight_lbs=${goalWeight}`,
    `activity_level=${activityLevel}`,
    `goal_date=${goalDate}`,
    `history_days_with_entries_35d=${history.days_with_entries_35d}`,
    `history_avg_logged_day_calories=${history.avg_logged_day_calories ?? "unknown"}`,
    `history_avg_calendar_day_calories_35d=${history.avg_calendar_day_calories ?? "unknown"}`,
    `history_weight_change_35d_lbs=${history.weight_change_35d_lbs ?? "unknown"}`,
    `history_tracked_days_all_time=${history.tracked_days_all_time}`,
    `history_first_entry_date=${history.first_entry_date ?? "unknown"}`,
    `history_last_entry_date=${history.last_entry_date ?? "unknown"}`,
    editRequest ? `edit_request=${editRequest}` : "",
    messages.length ? `conversation_messages=${JSON.stringify(messages)}` : ""
  ].filter(Boolean).join("\n");

  let out;
  try {
    const resp = await responsesCreate({
      model: "gpt-5.2",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
    });
    out = JSON.parse(outputText(resp));
  } catch {
    const fallback = fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate, history });
    if (!fallback) return json(422, { error: "Plan is unreasonable" });
    return json(200, fallback);
  }

  const keys = ["daily_calories", "protein_g", "carbs_g", "fat_g", "rationale_bullets"];
  for (const k of Object.keys(out || {})) {
    if (!keys.includes(k)) {
      const fallback = fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate, history });
      if (!fallback) return json(422, { error: "Plan is unreasonable" });
      return json(200, fallback);
    }
  }

  const daily = Number(out.daily_calories);
  const protein = Number(out.protein_g);
  const carbs = Number(out.carbs_g);
  const fat = Number(out.fat_g);
  const rationale = Array.isArray(out.rationale_bullets) ? out.rationale_bullets.filter((x) => typeof x === "string") : null;

  if (!Number.isFinite(daily) || !Number.isFinite(protein) || !Number.isFinite(carbs) || !Number.isFinite(fat) || !rationale) {
    const fallback = fallbackPlan({ currentWeight, goalWeight, activityLevel, goalDate, history });
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
