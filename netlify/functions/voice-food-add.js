const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile } = require("./_db");
const { enforceAiActionLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");

const OPENAI_AUDIO_URL = "https://api.openai.com/v1/audio/speech";

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

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);
  const today = getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, today, "voice_food_add");
  if (!aiLimit.ok) return aiLimit.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const message = String(body.message || "").trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const followupsUsed = Math.max(0, Number(body.followups_used) || 0);
  const followupsLimit = Math.max(0, Number(body.followups_limit) || 2);
  if (!message) return json(400, { error: "message is required" });

  const prompt = `You help users log food from voice descriptions.
Return ONLY JSON with this exact shape:
{
  "reply": "short conversational response",
  "needs_follow_up": boolean,
  "suggested_entry": {
    "calories": number,
    "protein_g": number | null,
    "carbs_g": number | null,
    "fat_g": number | null,
    "notes": string
  } | null
}
Rules:
- Ask follow-up when meal details are too vague to estimate calories confidently.
- You may ask AT MOST (followups_limit - followups_used) follow-up questions this turn.
- If enough detail exists, provide a best-effort estimate.
- Keep calories between 50 and 2500.
- Keep macro grams between 0 and 300.
- Keep reply under 2 short sentences.
- notes should summarize what was estimated and why.
- If followups_used >= followups_limit, you MUST set needs_follow_up=false and provide suggested_entry.`;

  const resp = await responsesCreate({
    model: "gpt-5.2",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${prompt}\n\nfollowups_used=${followupsUsed}\nfollowups_limit=${followupsLimit}\nHistory: ${JSON.stringify(history)}\nUser: ${message}`
          }
        ]
      }
    ]
  });

  const text = outputText(resp);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(502, { error: "Model did not return valid JSON", raw: text });
  }

  if (followupsUsed >= followupsLimit) parsed.needs_follow_up = false;
  const reply = String(parsed.reply || "I can help with that.").slice(0, 280);
  const audio = await createVoiceAudio(reply);

  return json(200, {
    reply,
    needs_follow_up: !!parsed.needs_follow_up,
    suggested_entry: parsed.suggested_entry || null,
    audio_base64: audio,
    audio_mime_type: audio ? "audio/mpeg" : null
  });
};
