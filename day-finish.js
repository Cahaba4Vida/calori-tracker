const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceAiActionLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const message = String(body.message || "").trim();
  if (!message) return json(400, { error: "message is required" });

  const date = body.date || getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, getDenverDateISO(new Date()), 'chat');
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

  const contextLines = [];
  contextLines.push(`Date (America/Denver): ${date}`);
  contextLines.push(`Goal calories: ${goal ?? "not set"}`);
  contextLines.push(`Total calories logged: ${totalCalories}`);
  contextLines.push("Food entries (chronological):");
  for (const e of entries.rows) {
    contextLines.push(`- ${e.calories} cal` + (e.protein_g != null ? ` (P${e.protein_g} C${e.carbs_g} F${e.fat_g})` : ""));
  }

  const system = [
    "You are a helpful nutrition coach chatbot.",
    "You must ground your answers in the provided food log; if data is missing, say so.",
    "Avoid medical claims; provide general wellness guidance.",
    "Keep replies concise: max 2 short bullet points or 2 short sentences.",
    "Aim for under 45 words unless the user explicitly asks for detail.",
    "Prefer short, actionable suggestions.",
  ].join("\\n");

  const prompt = [
    system,
    "",
    "DATA:",
    contextLines.join("\\n"),
    "",
    "USER QUESTION:",
    message
  ].join("\\n");

  const resp = await responsesCreate({
    model: "gpt-5.2",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  });

  const reply = outputText(resp) || "I couldn't generate a reply.";
  return json(200, { reply });
};
