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
    const { rows } = await db.query(`SELECT link, description, updated_at FROM client_update WHERE id = 1;`);
    const row = rows && rows[0] ? rows[0] : { link: null, description: null, updated_at: null };
    return { statusCode: 200, body: JSON.stringify({ ok: true, update: row }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server_error' }) };
  }
};
