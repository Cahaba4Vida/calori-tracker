const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile, query } = require("./_db");
const { enforceAiActionLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");
const crypto = require("crypto");

const OPENAI_AUDIO_URL = "https://api.openai.com/v1/audio/speech";

function hoursBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

async function createCoachAudio(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text) return null;
  const r = await fetch(OPENAI_AUDIO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      format: "mp3",
      input: text.slice(0, 900)
    })
  });
  if (!r.ok) return null;
  const arr = await r.arrayBuffer();
  return Buffer.from(arr).toString("base64");
}

async function getThreadForUser(userId, threadId) {
  if (!threadId) return null;
  const r = await query(
    `select id, last_active_at
     from coach_threads
     where id=$1 and user_id=$2`,
    [threadId, userId]
  );
  return r.rows[0] || null;
}

async function getLatestThread(userId) {
  const r = await query(
    `select id, last_active_at
     from coach_threads
     where user_id = $1
     order by last_active_at desc
     limit 1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function createThread(userId) {
  const id = crypto.randomUUID();
  await query(
    `insert into coach_threads(id, user_id, created_at, last_active_at)
     values ($1, $2, now(), now())`,
    [id, userId]
  );
  return id;
}

async function touchThread(threadId) {
  await query(
    `update coach_threads set last_active_at=now() where id=$1`,
    [threadId]
  );
}

async function insertMessage(threadId, role, content) {
  await query(
    `insert into coach_messages(id, thread_id, role, content, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), threadId, role, content]
  );
}

async function loadHistory(threadId, limit = 16) {
  const r = await query(
    `select role, content
     from coach_messages
     where thread_id=$1
     order by created_at asc
     limit $2`,
    [threadId, limit]
  );
  return r.rows || [];
}

async function buildFoodContext(userId, date) {
  const entries = await query(
    `select calories, protein_g, carbs_g, fat_g, taken_at, raw_extraction
     from food_entries where user_id=$1 and entry_date=$2
     order by taken_at asc`,
    [userId, date]
  );

  const totalCalories = entries.rows.reduce((s, x) => s + (x.calories || 0), 0);
  const goalR = await query("select daily_calories from calorie_goals where user_id=$1", [userId]);
  const goal = goalR.rows[0]?.daily_calories ?? null;

  const lines = [];
  lines.push(`Date (America/Denver): ${date}`);
  lines.push(`Goal calories: ${goal ?? "not set"}`);
  lines.push(`Total calories logged: ${totalCalories}`);
  lines.push("Food entries (chronological):");
  for (const e of entries.rows) {
    const note = e.raw_extraction && e.raw_extraction.notes ? String(e.raw_extraction.notes) : "";
    lines.push(`- ${e.calories} cal` + (e.protein_g != null ? ` (P${e.protein_g} C${e.carbs_g} F${e.fat_g})` : "") + (note ? ` — ${note}` : ""));
  }
  return { totalCalories, goal, lines };
}

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
  const aiLimit = await enforceAiActionLimit(userId, getDenverDateISO(new Date()), "coach");
  if (!aiLimit.ok) return aiLimit.response;

  // Thread management (reuse if active in last 12 hours)
  let threadId = body.thread_id ? String(body.thread_id) : null;
  let thread = await getThreadForUser(userId, threadId);
  if (!thread) {
    const latest = await getLatestThread(userId);
    if (latest && latest.last_active_at) {
      const last = new Date(latest.last_active_at);
      const now = new Date();
      if (hoursBetween(now, last) <= 12) {
        threadId = latest.id;
        thread = latest;
      }
    }
  }
  if (!threadId) threadId = await createThread(userId);

  await touchThread(threadId);
  await insertMessage(threadId, "user", message);

  const foodCtx = await buildFoodContext(userId, date);
  const system = [
    "You are a friendly, motivating nutrition coach.",
    "Maintain conversational continuity across turns; refer back to what the user said previously when helpful.",
    "Ground advice in the provided food log; if data is missing, say so.",
    "Avoid medical claims; provide general wellness guidance.",
    "Keep replies concise and conversational: 2–4 short sentences.",
    "Prefer specific, actionable suggestions."
  ].join("\n");

  const history = await loadHistory(threadId, 18);

  // Build OpenAI input: system context + food log as a system message, then conversation history.
  const input = [];
  input.push({ role: "system", content: [{ type: "input_text", text: system }] });
  input.push({ role: "system", content: [{ type: "input_text", text: ["DATA:", ...foodCtx.lines].join("\n") }] });

  for (const m of history) {
    const role = (m.role === "assistant" || m.role === "user") ? m.role : "user";
    input.push({ role, content: [{ type: "input_text", text: String(m.content || "") }] });
  }

  const resp = await responsesCreate({
    model: "gpt-4o-mini",
    input
  });

  const reply = (outputText(resp) || "").trim() || "I couldn't generate a reply.";
  await insertMessage(threadId, "assistant", reply);

  const wantAudio = body.want_audio !== false; // default true (voice mode uses it; typed can ignore)
  const audio_base64 = wantAudio ? await createCoachAudio(reply) : null;

  return json(200, {
    thread_id: threadId,
    reply,
    audio_base64,
    audio_mime_type: audio_base64 ? "audio/mp3" : null
  });
};
