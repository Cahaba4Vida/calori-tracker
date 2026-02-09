const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing DATABASE_URL env var");
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

async function ensureUserProfile(userId, email) {
  await query(
    `insert into user_profiles(user_id, email)
     values ($1, $2)
     on conflict (user_id) do update set email = coalesce(excluded.email, user_profiles.email)`,
    [userId, email]
  );
}

module.exports = { query, ensureUserProfile };
