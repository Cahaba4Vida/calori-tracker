const db = require('./_db');
const { requireUser } = require('./_auth');
const { json } = require('./_util');

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
  try {
    const auth = await requireUser(event, context);
    if (!auth.ok) return auth.response;

    await ensureTable();
    const r = await db.query(
      `select id, text, priority, done, source
       from admin_todos
       order by priority asc, id asc`
    );
    // Client view: show everything, but UI can treat done items as complete.
    return json(200, { todos: r.rows });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
