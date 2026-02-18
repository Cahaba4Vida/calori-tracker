const { json } = require('./_util');
const { responsesCreate, outputText } = require('./_openai');

const OPENAI_AUDIO_URL = 'https://api.openai.com/v1/audio/speech';

async function createVoiceAudio(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text) return null;
  const r = await fetch(OPENAI_AUDIO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      format: 'mp3',
      input: String(text).slice(0, 800)
    })
  });
  if (!r.ok) return null;
  const arr = await r.arrayBuffer();
  return Buffer.from(arr).toString('base64');
}

async function runJsonTask(instructions, payload, model = 'gpt-5.2') {
  const resp = await responsesCreate({
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `${instructions}\n\nPayload:\n${JSON.stringify(payload)}` }] }]
  });
  const text = outputText(resp);
  return JSON.parse(text);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const task = String(body.task || '').trim();
  const payload = body.payload || {};

  try {
    if (task === 'ai-goals-suggest') {
      const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
      const editRequest = typeof payload.edit_request === 'string' ? payload.edit_request.trim() : '';
      const out = await runJsonTask(`You are an expert nutrition coach.
Return ONLY JSON with keys:
{
  "daily_calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "rationale_bullets": string[]
}
Rules: realistic, safe, concise rationale (3 bullets).
If edit_request is present, revise the previous plan using conversation context.` , {
        ...payload,
        edit_request: editRequest || null,
        messages
      });
      return json(200, out);
    }

    if (task === 'chat') {
      const out = await runJsonTask(`You are a supportive calorie/macro coach.
Return ONLY JSON: {"reply": string}.
Keep reply <= 3 short sentences and action-focused.
Use coach_context when provided to answer directly from the user's logged data without asking them to repeat those numbers.`, payload);
      return json(200, out);
    }

    if (task === 'entries-add-image') {
      const imageDataUrl = payload.imageDataUrl;
      if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) return json(400, { error: 'Invalid imageDataUrl' });
      const prompt = `You are reading a Nutrition Facts label image.
Return ONLY JSON with keys:
{
  "calories_per_serving": number | null,
  "protein_g_per_serving": number | null,
  "carbs_g_per_serving": number | null,
  "fat_g_per_serving": number | null,
  "serving_size": string | null,
  "servings_per_container": number | null,
  "confidence": "high"|"medium"|"low",
  "notes": string | null
}
If not a nutrition label, calories_per_serving must be null.`;
      const resp = await responsesCreate({
        model: 'gpt-5.2',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }]
      });
      const parsed = JSON.parse(outputText(resp));
      if (parsed.calories_per_serving == null) return json(422, { error: 'Could not read nutrition label calories clearly.', details: parsed });
      return json(200, { extracted: parsed });
    }

    if (task === 'entries-estimate-plate-image') {
      const imageDataUrl = payload.imageDataUrl;
      if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) return json(400, { error: 'Invalid imageDataUrl' });
      const prompt = `Estimate meal nutrition from this plate photo.
Return ONLY JSON:
{
  "calories": number,
  "protein_g": number | null,
  "carbs_g": number | null,
  "fat_g": number | null,
  "confidence": "high"|"medium"|"low",
  "assumptions": string[],
  "notes": string | null
}
Keep calories 50-2500.`;
      const resp = await responsesCreate({
        model: 'gpt-5.2',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }]
      });
      const parsed = JSON.parse(outputText(resp));
      return json(200, parsed);
    }

    if (task === 'voice-food-add') {
      const followupsUsed = Math.max(0, Number(payload.followups_used) || 0);
      const followupsLimit = Math.max(0, Number(payload.followups_limit) || 2);
      const out = await runJsonTask(`You help users log food from voice descriptions.
Return ONLY JSON:
{
  "reply": string,
  "needs_follow_up": boolean,
  "suggested_entry": {
    "calories": number,
    "protein_g": number | null,
    "carbs_g": number | null,
    "fat_g": number | null,
    "notes": string
  } | null
}
Ask follow-up if details are too vague.
Ask at most (followups_limit - followups_used) follow-up questions.
If followups_used >= followups_limit, you must set needs_follow_up=false and provide suggested_entry.`, {
        ...payload,
        followups_used: followupsUsed,
        followups_limit: followupsLimit
      });
      if (followupsUsed >= followupsLimit) out.needs_follow_up = false;
      const reply = String(out.reply || 'I can help with that.').slice(0, 280);
      const audio = await createVoiceAudio(reply);
      return json(200, {
        reply,
        needs_follow_up: !!out.needs_follow_up,
        suggested_entry: out.suggested_entry || null,
        audio_base64: audio,
        audio_mime_type: audio ? 'audio/mpeg' : null
      });
    }

    if (task === 'day-finish') {
      const out = await runJsonTask(`You score a user's day and provide concise nutrition coaching.
Return ONLY JSON: {"score": number, "tips": string}
score must be integer 1-10. tips should be short, practical.`, payload);
      return json(200, { score: Math.max(1, Math.min(10, Math.round(Number(out.score) || 6))), tips: String(out.tips || 'Nice consistency today.') });
    }

    return json(400, { error: 'Unknown task' });
  } catch (e) {
    return json(502, { error: e.message || 'OpenAI task failed' });
  }
};
