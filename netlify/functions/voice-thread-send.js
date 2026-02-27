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

async function createVoiceAudio(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text) return null;
  const r = await fetch(OPENAI_AUDIO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      format: "mp3",
      input: text.slice(0, 800)
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
     from voice_threads
     where id = $1 and user_id = $2
     limit 1`,
    [threadId, userId]
  );
  return r.rows[0] || null;
}

async function getLatestThread(userId) {
  const r = await query(
    `select id, last_active_at
     from voice_threads
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
    `insert into voice_threads(id, user_id, created_at, last_active_at)
     values ($1, $2, now(), now())`,
    [id, userId]
  );
  return id;
}

async function upsertActiveThread(userId, incomingThreadId) {
  const now = new Date();

  const incoming = await getThreadForUser(userId, incomingThreadId);
  if (incoming && incoming.last_active_at) {
    const last = new Date(incoming.last_active_at);
    if (hoursBetween(now, last) <= 4) return incoming.id;
  }

  // try latest thread if incoming is missing/invalid/expired
  const latest = await getLatestThread(userId);
  if (latest && latest.last_active_at) {
    const last = new Date(latest.last_active_at);
    if (hoursBetween(now, last) <= 4) return latest.id;
  }

  return await createThread(userId);
}

async function appendMessage(threadId, role, content) {
  const id = crypto.randomUUID();
  await query(
    `insert into voice_messages(id, thread_id, role, content, created_at)
     values ($1, $2, $3, $4, now())`,
    [id, threadId, role, content]
  );
}

async function loadRecentMessages(threadId, limit) {
  const r = await query(
    `select role, content
     from voice_messages
     where thread_id = $1
     order by created_at desc
     limit $2`,
    [threadId, limit]
  );
  // reverse to chronological
  return r.rows.reverse().map(x => ({ role: x.role, text: x.content }));
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const today = getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, today, "voice_thread_send");
  if (!aiLimit.ok) return aiLimit.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const message = String(body.message || "").trim();
  if (!message) return json(400, { error: "message is required" });

  const threadId = await upsertActiveThread(userId, String(body.thread_id || "").trim() || null);

  // persist user message
  await appendMessage(threadId, "user", message);

  const history = await loadRecentMessages(threadId, 20);

  const prompt = `You help users log food from voice descriptions.
Return ONLY JSON with this exact shape:
{
  "reply": "short conversational response",
  "needs_follow_up": boolean,
  "suggested_entry": {
    "calories": number|null,
    "protein_g": number|null,
    "carbs_g": number|null,
    "fat_g": number|null,
    "description": "short label"
  }|null
}

Rules:
- If user describes a meal, estimate calories/macros.
- If user is unclear, ask ONE follow-up question and set needs_follow_up=true.
- Keep reply <= 2 sentences.
- suggested_entry.description should be <= 60 chars.`;

  const input = [
    { role: "system", content: prompt },
    ...history.map(h => ({ role: h.role, content: h.text }))
  ];

  const resp = await responsesCreate({
    model: "gpt-4.1-mini",
    input
  });

  const raw = outputText(resp);
  let data;
  try { data = JSON.parse(raw); } catch { data = { reply: raw?.slice(0, 240) || "", needs_follow_up: false, suggested_entry: null }; }

  const reply = String(data.reply || "").trim();
  if (reply) await appendMessage(threadId, "assistant", reply);

  // keep thread active
  await query(`update voice_threads set last_active_at = now() where id = $1`, [threadId]);

  const audio_base64 = await createVoiceAudio(reply);

  return json(200, {
    thread_id: threadId,
    reply,
    needs_follow_up: !!data.needs_follow_up,
    suggested_entry: data.suggested_entry || null,
    audio_base64,
    audio_mime_type: audio_base64 ? "audio/mp3" : null
  });
};
