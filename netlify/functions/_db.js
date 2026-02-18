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



async function ensureDeviceIdentity(deviceId) {
  await query(
    `insert into device_identities(device_id, first_seen_at, last_seen_at)
     values ($1, now(), now())
     on conflict (device_id) do update set last_seen_at = now()`,
    [deviceId]
  );
}

async function linkDeviceToUser(deviceId, userId) {
  await query(
    `insert into user_device_links(user_id, device_id, created_at, last_seen_at)
     values ($1, $2, now(), now())
     on conflict (user_id, device_id) do update set last_seen_at = now()`,
    [userId, deviceId]
  );
}

async function resolveUserIdByDevice(deviceId) {
  const r = await query(
    `select user_id
       from user_device_links
      where device_id = $1
      order by last_seen_at desc
      limit 1`,
    [deviceId]
  );
  return r.rows[0]?.user_id || null;
}

module.exports = { query, ensureUserProfile, ensureDeviceIdentity, linkDeviceToUser, resolveUserIdByDevice };
