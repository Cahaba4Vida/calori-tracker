const { json } = require("./_util");
const { requireUser } = require("./_auth");

function mustGetKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Missing OPENAI_API_KEY env var");
  return k;
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const audio_base64 = body.audio_base64;
  const mime = body.mime || "audio/webm";
  if (!audio_base64 || typeof audio_base64 !== "string") {
    return json(400, { error: "audio_base64 is required" });
  }

  const key = mustGetKey();
  const buf = Buffer.from(audio_base64, "base64");

  const form = new FormData();
  // filename is required by OpenAI
  const ext = mime.includes("wav") ? "wav" : (mime.includes("mp4") ? "mp4" : "webm");
  const file = new Blob([buf], { type: mime });
  form.append("file", file, `audio.${ext}`);
  form.append("model", "gpt-4o-mini-transcribe");

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: form
  });

  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!r.ok) {
    return json(502, { error: data?.error?.message || "Transcription failed", details: data });
  }

  // Expected response: { text: "..." }
  return json(200, { text: data.text || "" });
};
