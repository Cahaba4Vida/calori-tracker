const db = require('./_db');
const { requireAdmin } = require('./_adminAuth');

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

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (auth) return auth;

  try {
    await ensureTable();
    const body = event.body ? JSON.parse(event.body) : {};
    const link = typeof body.link === 'string' ? body.link.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';

    await db.query(
      `UPDATE client_update SET link = $1, description = $2, updated_at = NOW() WHERE id = 1;`,
      [link || null, description || null]
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server_error' }) };
  }
};
