const crypto = require("crypto");
const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

function mustGetKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Missing OPENAI_API_KEY env var");
  return k;
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

// Build a multipart/form-data request body WITHOUT using Blob/FormData.
// Netlify's Node runtime may not provide those globals.
function buildMultipart({ model, filename, mime, fileBuffer }) {
  const boundary = "----ctBoundary" + crypto.randomBytes(16).toString("hex");

  const pre = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${model}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
    "utf8"
  );

  const post = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return {
    boundary,
    body: Buffer.concat([pre, fileBuffer, post])
  };
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  // Two modes:
  // 1) clip_id: load audio bytes from DB (preferred when "must use DB")
  // 2) audio_base64: accept inline base64 and (optionally) store in DB
  const clipId = body.clip_id ? String(body.clip_id) : null;

  let mime = "audio/webm";
  let buf = null;

  if (clipId) {
    const r = await query(
      `select mime, bytes
         from voice_audio_clips
        where id = $1 and user_id = $2`,
      [clipId, userId]
    );
    if (!r.rows[0]) return json(404, { error: "clip_id not found" });
    mime = r.rows[0].mime || mime;
    buf = r.rows[0].bytes;
  } else {
    const audio_base64 = body.audio_base64;
    mime = body.mime || mime;
    if (!audio_base64 || typeof audio_base64 !== "string") {
      return json(400, { error: "audio_base64 is required (or provide clip_id)" });
    }
    buf = Buffer.from(audio_base64, "base64");

    // Store clip in DB so the system can be DB-first and we can inspect failures.
    // If the table hasn't been migrated yet, fail gracefully and continue.
    try {
      const id = newId();
      await query(
        `insert into voice_audio_clips (id, user_id, mime, bytes)
         values ($1, $2, $3, $4)`,
        [id, userId, mime, buf]
      );
      // Return clip_id to the client for subsequent requests if desired.
      // (We still proceed to transcribe right away.)
      body._stored_clip_id = id;
    } catch (e) {
      // 42P01 = undefined_table
      if (!(e && e.code === "42P01")) throw e;
    }
  }

  const key = mustGetKey();
  const ext = mime.includes("wav") ? "wav" : (mime.includes("mp4") ? "mp4" : "webm");
  const { boundary, body: mpBody } = buildMultipart({
    model: "gpt-4o-mini-transcribe",
    filename: `audio.${ext}`,
    mime,
    fileBuffer: buf
  });

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: mpBody
  });

  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!r.ok) {
    return json(502, { error: data?.error?.message || "Transcription failed", details: data });
  }

  const out = { text: data.text || "" };
  if (body._stored_clip_id) out.clip_id = body._stored_clip_id;
  return json(200, out);
};
