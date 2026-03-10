const db = require('./_db');

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS client_update (
      id INTEGER PRIMARY KEY,
      link TEXT,
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`INSERT INTO client_update (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);
}


function deriveVoiceFoodLabel(message, se) {
  const candidates = [
    se && se.description,
    se && se.name,
    se && se.food_name,
    se && se.product_name,
    se && se.item,
    se && se.notes
  ].map(v => String(v || "").trim()).filter(Boolean);

  for (const c of candidates) {
    const lc = c.toLowerCase();
    if (lc && !["plate estimate", "meal", "food entry", "estimate", "snack", "drink"].includes(lc)) {
      return c.slice(0, 60);
    }
  }

  const raw = String(message || "").trim()
    .replace(/^(log|add|track|record)\s+/i, "")
    .replace(/^(i\s+(had|ate|drank)\s+)/i, "")
    .replace(/^(for\s+(breakfast|lunch|dinner|snack)\s*[,:-]?\s*)/i, "")
    .replace(/^(it\s+was\s+)/i, "")
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "Food entry";

  const clipped = raw.length > 60 ? raw.slice(0, 60).trim() : raw;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}


exports.handler = async () => {
  try {
    await ensureTable();
    const { rows } = await db.query(`SELECT link, description, updated_at FROM client_update WHERE id = 1;`);
    const row = rows && rows[0] ? rows[0] : { link: null, description: null, updated_at: null };
    // Only expose if link exists
    if (!row.link) return { statusCode: 200, body: JSON.stringify({ ok: true, update: null }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true, update: row }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, update: null }) };
  }
};
