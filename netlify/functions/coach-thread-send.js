
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
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE || "alloy";
  if (!key || !text) return null;

  async function tryRequest(body) {
    try {
      const r = await fetch(OPENAI_AUDIO_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!r.ok) return null;
      const arr = await r.arrayBuffer();
      const b64 = Buffer.from(arr).toString("base64");
      return b64 || null;
    } catch (e) {
      return null;
    }
  }

  const clipped = String(text).slice(0, 900);

  // Preferred payload
  let audio = await tryRequest({
    model,
    voice,
    response_format: "mp3",
    input: clipped
  });
  if (audio) return audio;

  // Compatibility fallback for older builds/projects
  audio = await tryRequest({
    model,
    voice,
    format: "mp3",
    input: clipped
  });
  if (audio) return audio;

  // Final compatibility fallback to a broadly supported TTS model
  audio = await tryRequest({
    model: "tts-1",
    voice,
    response_format: "mp3",
    input: clipped
  });
  return audio;
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

async function loadHistory(threadId, limit = 20) {
  const r = await query(
    `select role, content
     from coach_messages
     where thread_id=$1
     order by created_at desc
     limit $2`,
    [threadId, limit]
  );
  return (r.rows || []).reverse();
}

async function buildFoodContext(userId, date) {
  const entries = await query(
    `select calories, protein_g, carbs_g, fat_g, taken_at, raw_extraction
     from food_entries where user_id=$1 and entry_date=$2
     order by taken_at asc`,
    [userId, date]
  );

  const totalCalories = entries.rows.reduce((s, x) => s + (Number(x.calories) || 0), 0);
  const totalProtein = entries.rows.reduce((s, x) => s + (Number(x.protein_g) || 0), 0);
  const totalCarbs = entries.rows.reduce((s, x) => s + (Number(x.carbs_g) || 0), 0);
  const totalFat = entries.rows.reduce((s, x) => s + (Number(x.fat_g) || 0), 0);

  const [goalR, profileR, latestWeightR, recentWeightsR] = await Promise.all([
    query("select daily_calories from calorie_goals where user_id=$1", [userId]),
    query(`select macro_protein_g, macro_carbs_g, macro_fat_g, current_weight_lbs, target_weight_lbs, goal_weight_lbs, activity_level, goal_mode
           from user_profiles where user_id=$1 limit 1`, [userId]),
    query(`select entry_date::text as entry_date, weight_lbs::float8 as weight_lbs
           from daily_weights where user_id=$1 order by entry_date desc limit 1`, [userId]),
    query(`select entry_date::text as entry_date, weight_lbs::float8 as weight_lbs
           from daily_weights where user_id=$1 order by entry_date desc limit 7`, [userId])
  ]);

  const goalCalories = goalR.rows[0]?.daily_calories ?? null;
  const p = profileR.rows[0] || {};
  const latestWeight = latestWeightR.rows[0] || null;
  const weightRows = (recentWeightsR.rows || []).slice().reverse();

  let weightTrend = "unknown";
  if (weightRows.length >= 2) {
    const first = Number(weightRows[0].weight_lbs);
    const last = Number(weightRows[weightRows.length - 1].weight_lbs);
    if (Number.isFinite(first) && Number.isFinite(last)) {
      const delta = Math.round((last - first) * 10) / 10;
      weightTrend = delta === 0 ? "flat" : `${delta > 0 ? '+' : ''}${delta} lbs over last ${weightRows.length} weigh-ins`;
    }
  }

  const lines = [];
  lines.push(`Date (America/Denver): ${date}`);
  lines.push(`Goal calories: ${goalCalories ?? "not set"}`);
  lines.push(`Today's totals so far: calories=${totalCalories}, protein_g=${Math.round(totalProtein)}, carbs_g=${Math.round(totalCarbs)}, fat_g=${Math.round(totalFat)}`);
  lines.push(`Macro goals: protein_g=${p.macro_protein_g ?? "not set"}, carbs_g=${p.macro_carbs_g ?? "not set"}, fat_g=${p.macro_fat_g ?? "not set"}`);
  lines.push(`Weight context: latest_weight_lbs=${latestWeight?.weight_lbs ?? p.current_weight_lbs ?? "unknown"}, target_weight_lbs=${p.target_weight_lbs ?? p.goal_weight_lbs ?? "unknown"}, goal_mode=${p.goal_mode ?? "unknown"}, activity_level=${p.activity_level ?? "unknown"}, trend=${weightTrend}`);
  lines.push("Recent food entries today (most recent last, for context only — do not recite unless asked):");
  const recent = entries.rows.slice(-6);
  if (!recent.length) {
    lines.push("- none logged today");
  } else {
    for (const e of recent) {
      const note = e.raw_extraction && e.raw_extraction.notes ? String(e.raw_extraction.notes) : "";
      lines.push(`- ${e.calories} cal${e.protein_g != null ? ` (P${e.protein_g} C${e.carbs_g} F${e.fat_g})` : ""}${note ? ` — ${note}` : ""}`);
    }
  }
  return { lines };
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
    "Keep a natural ongoing conversation across turns instead of restarting each reply.",
    "Answer the user's actual question first.",
    "Use the provided goals, weight data, and food logs when relevant, but do NOT recite the full log unless the user explicitly asks for a recap.",
    "Do not repeat previously listed foods back to the user unless needed for a specific explanation.",
    "Reference trends, calorie progress, macro progress, weight progress, or patterns only when they genuinely help the answer.",
    "If there is not enough data, say that briefly instead of inventing details.",
    "Avoid medical claims; provide general wellness guidance.",
    "Keep replies concise and conversational: usually 2-4 short sentences, occasionally 5 if needed.",
    "When useful, include one practical next step or insight."
  ].join("\n");

  const history = await loadHistory(threadId, 20);
  const input = [];
  input.push({ role: "system", content: system });
  input.push({ role: "system", content: ["USER DATA:", ...foodCtx.lines].join("\n") });
  for (const m of history) {
    const role = (m.role === "assistant" || m.role === "user") ? m.role : "user";
    input.push({ role, content: String(m.content || "") });
  }

  const resp = await responsesCreate({
    model: "gpt-4o-mini",
    input
  });

  const reply = (outputText(resp) || "").trim() || "I couldn't generate a reply.";
  await insertMessage(threadId, "assistant", reply);

  const wantAudio = body.want_audio !== false;
  const audio_base64 = wantAudio ? await createCoachAudio(reply) : null;

  return json(200, {
    thread_id: threadId,
    reply,
    audio_base64,
    audio_mime_type: audio_base64 ? "audio/mpeg" : null
  });
};
