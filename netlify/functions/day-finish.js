const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceAiActionLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");

const shouldPersistDailySummaries = process.env.PERSIST_DAILY_SUMMARIES === "true";

function clampScore(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const date = body.date || getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, getDenverDateISO(new Date()), 'day_finish');
  if (!aiLimit.ok) return aiLimit.response;

  const entries = await query(
    `select calories, protein_g, carbs_g, fat_g, taken_at
     from food_entries where user_id=$1 and entry_date=$2
     order by taken_at asc`,
    [userId, date]
  );

  const totalCalories = entries.rows.reduce((s, x) => s + (x.calories || 0), 0);

  const goalR = await query("select daily_calories from calorie_goals where user_id=$1", [userId]);
  const goal = goalR.rows[0]?.daily_calories ?? null;

  const weightR = await query(
    `select weight_lbs::float8 as weight_lbs from daily_weights where user_id=$1 and entry_date=$2`,
    [userId, date]
  );
  const weight = weightR.rows[0]?.weight_lbs ?? null;

  const scoringSpec = {
    score: "integer 0-100",
    tips: "string with exactly 2-4 short bullet points: first 1-2 wins, then 1-2 improvement tips"
  };

  const contextLines = [];
  contextLines.push(`Date (America/Denver): ${date}`);
  contextLines.push(`Goal calories: ${goal ?? "not set"}`);
  contextLines.push(`Total calories logged: ${totalCalories}`);
  contextLines.push(`Weight today: ${weight ?? "not logged"}`);
  contextLines.push("Food entries (chronological):");
  for (const e of entries.rows) {
    contextLines.push(`- ${e.calories} cal` + (e.protein_g != null ? ` (P${e.protein_g} C${e.carbs_g} F${e.fat_g})` : ""));
  }

  const prompt = [
    "You are a nutrition coach for calorie tracking.",
    "Given today's food log, calorie goal, and optional weight, produce a daily adherence score and a short friendly recap.",
    "Scoring rubric:",
    "- If goal is set: reward being close to goal (within ~5-10%). Penalize large deviation.",
    "- If goal is not set: score based on completeness and consistency; encourage setting a goal.",
    "- Reward logging consistency (more complete log = higher score).",
    "- Keep response brief and friendly.",
    "- Format tips as bullet points using '-' only.",
    "- Include 1-2 good things first, then 1-2 concrete improvement tips.",
    "Return ONLY valid JSON (no markdown).",
    "JSON shape: " + JSON.stringify(scoringSpec),
    "",
    "DATA:",
    contextLines.join("\\n")
  ].join("\\n");

  const resp = await responsesCreate({
    model: "gpt-5.2",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  });

  const text = outputText(resp);
  let out;
  try { out = JSON.parse(text); } catch {
    return json(502, { error: "Model did not return valid JSON", raw: text });
  }

  const score = clampScore(out.score);
  const tips = String(out.tips || "").trim().slice(0, 400) || "- Log consistently\\n- Set a goal\\n- Review portion sizes";

  if (shouldPersistDailySummaries) {
    await query(
      `insert into daily_summaries(user_id, entry_date, total_calories, goal_calories, score, tips)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, entry_date)
       do update set total_calories=excluded.total_calories, goal_calories=excluded.goal_calories,
                     score=excluded.score, tips=excluded.tips, created_at=now()`,
      [userId, date, totalCalories, goal, score, tips]
    );
  }

  return json(200, {
    entry_date: date,
    total_calories: totalCalories,
    goal_calories: goal,
    score,
    tips,
    persisted: shouldPersistDailySummaries
  });
};
