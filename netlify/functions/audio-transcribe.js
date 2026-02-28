const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile } = require("./_db");

const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

async function transcribeWithModel(key, buf, mime, filename, model) {
  const form = new FormData();
  const blob = new Blob([buf], { type: mime || "audio/webm" });
  form.append("file", blob, filename || "audio.webm");
  form.append("model", model);
  // Many models accept json; keep default (json).

  const r = await fetch(TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`
    },
    body: form
  });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!r.ok) {
    const err = new Error(body?.error?.message || body?.message || `Transcribe error ${r.status}`);
    err.statusCode = 502;
    err.details = body;
    throw err;
  }
  return String(body.text || body.transcript || "").trim();
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, { error: "Missing OPENAI_API_KEY" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const audioBase64 = String(body.audio_base64 || "");
  const mime = String(body.mime_type || "audio/webm");
  const filename = String(body.filename || "audio.webm");
  if (!audioBase64) return json(400, { error: "audio_base64 is required" });

  let buf;
  try { buf = Buffer.from(audioBase64, "base64"); } catch {
    return json(400, { error: "Invalid base64" });
  }

  // Prefer newer lightweight transcribe model; fall back to whisper-1 if unavailable.
  let transcript = "";
  try {
    transcript = await transcribeWithModel(key, buf, mime, filename, "gpt-4o-mini-transcribe");
  } catch (e) {
    // Fallback for older accounts / regions.
    transcript = await transcribeWithModel(key, buf, mime, filename, "whisper-1");
  }

  return json(200, { transcript });
};
