const { json } = require("./_util");

const OPENAI_URL = "https://api.openai.com/v1/responses";

function mustGetKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Missing OPENAI_API_KEY env var");
  return k;
}

// Minimal Responses API call for text+image inputs. Images as base64 data URLs are supported. citeturn0search3turn0search0
async function responsesCreate(payload) {
  const key = mustGetKey();
  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

  if (!r.ok) {
    const msg = body?.error?.message || body?.message || `OpenAI error: ${r.status}`;
    const err = new Error(msg);
    err.statusCode = 502;
    err.details = body;
    throw err;
  }
  return body;
}

function outputText(resp) {
  // Docs show response.output_text in SDK; REST returns output array; safest: prefer resp.output_text if present.
  if (resp && typeof resp.output_text === "string") return resp.output_text;
  // fallback: try to extract from output[].content[].text
  try {
    const parts = [];
    for (const item of resp.output || []) {
      for (const c of item.content || []) {
        if (c.type === "output_text" && c.text) parts.push(c.text);
        if (c.type === "text" && c.text) parts.push(c.text);
      }
    }
    return parts.join("\n").trim();
  } catch {
    return "";
  }
}

module.exports = { responsesCreate, outputText };
