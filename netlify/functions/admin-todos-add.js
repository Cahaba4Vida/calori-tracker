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
    const text = String(body.text || '').trim();
    const priority = Math.max(1, Number(body.priority || 1));
    if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'Missing text' }) };
    await db.query(
      `insert into admin_todos(text, priority) values ($1, $2)`,
      [text, priority]
    );
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
