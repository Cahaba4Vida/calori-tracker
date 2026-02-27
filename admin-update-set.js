const db = require('./_db');
const { requireAdmin } = require('./_adminAuth');

async function ensureTable() {
  await db.query("\nCREATE TABLE IF NOT EXISTS admin_todos (\n  id BIGSERIAL PRIMARY KEY,\n  text TEXT NOT NULL,\n  priority INTEGER NOT NULL DEFAULT 1,\n  done BOOLEAN NOT NULL DEFAULT FALSE,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n");
  await db.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';");
  await db.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS suggested_by_user_id TEXT;");
  await db.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS suggested_by_email TEXT;");
}

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (auth) return auth;
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    await ensureTable();
    const body = JSON.parse(event.body || '{}');
    const id = Number(body.id);
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
    const fields = [];
    const vals = [];
    let i = 1;
    if (body.text !== undefined) {
      fields.push(`text = $${i++}`);
      vals.push(String(body.text || '').trim());
    }
    if (body.priority !== undefined) {
      fields.push(`priority = $${i++}`);
      vals.push(Math.max(1, Number(body.priority || 1)));
    }
    if (body.done !== undefined) {
      fields.push(`done = $${i++}`);
      vals.push(!!body.done);
    }
    if (!fields.length) return { statusCode: 400, body: JSON.stringify({ error: 'No fields to update' }) };
    fields.push(`updated_at = NOW()`);
    vals.push(id);
    await db.query(`update admin_todos set ${fields.join(', ')} where id = $${i}`, vals);
    const r = await db.query(
      `select id, text, priority, done, created_at, updated_at
       from admin_todos
       order by priority asc, id asc`
    );
    return { statusCode: 200, body: JSON.stringify({ todos: r.rows }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
