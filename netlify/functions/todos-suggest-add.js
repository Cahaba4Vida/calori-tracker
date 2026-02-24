const db = require('./_db');
const { requireUser } = require('./_auth');
const { json, readJson } = require('./_util');

async function ensureTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS admin_todos (
    id BIGSERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  await db.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';");
  await db.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS suggested_by_user_id TEXT;");
  await db.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS suggested_by_email TEXT;");
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  try {
    const auth = await requireUser(event, context);
    if (!auth.ok) return auth.response;

    const body = readJson(event);
    const rawText = (body?.text || '').toString().trim();
    if (!rawText) return json(400, { error: 'Missing text' });
    if (rawText.length > 240) return json(400, { error: 'Text too long (max 240 chars)' });

    await ensureTable();

    const maxP = await db.query('select coalesce(max(priority), 0) as p from admin_todos');
    const nextPriority = Number(maxP.rows?.[0]?.p || 0) + 1;

    const userId = auth.user?.userId || null;
    const email = auth.user?.email || null;

    const ins = await db.query(
      `insert into admin_todos (text, priority, done, source, suggested_by_user_id, suggested_by_email)
       values ($1, $2, false, 'client', $3, $4)
       returning id, text, priority, done, source`,
      [rawText, nextPriority, userId, email]
    );

    return json(200, { ok: true, todo: ins.rows[0] });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
