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
  try {
    await query(
      `insert into user_device_links(user_id, device_id, created_at, last_seen_at, is_enabled)
       values ($1, $2, now(), now(), true)
       on conflict (user_id, device_id) do update set last_seen_at = now()`,
      [userId, deviceId]
    );
  } catch (e) {
    if (e && e.code === '42703') {
      await query(
        `insert into user_device_links(user_id, device_id, created_at, last_seen_at)
         values ($1, $2, now(), now())
         on conflict (user_id, device_id) do update set last_seen_at = now()`,
        [userId, deviceId]
      );
      return;
    }
    throw e;
  }
}

async function resolveUserIdByDevice(deviceId) {
  try {
    const r = await query(
      `select user_id
         from user_device_links
        where device_id = $1
          and coalesce(is_enabled, true) = true
        order by last_seen_at desc
        limit 1`,
      [deviceId]
    );
    return r.rows[0]?.user_id || null;
  } catch (e) {
    if (e && e.code === '42703') {
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
    throw e;
  }
}

async function listUserDevices(userId) {
  try {
    const r = await query(
      `select u.device_id,
              coalesce(u.device_name, '') as device_name,
              coalesce(u.is_enabled, true) as is_enabled,
              u.created_at,
              u.last_seen_at,
              d.first_seen_at
         from user_device_links u
         join device_identities d on d.device_id = u.device_id
        where u.user_id = $1
        order by u.last_seen_at desc`,
      [userId]
    );
    return r.rows;
  } catch (e) {
    if (e && e.code === '42703') {
      const r = await query(
        `select u.device_id,
                '' as device_name,
                true as is_enabled,
                u.created_at,
                u.last_seen_at,
                d.first_seen_at
           from user_device_links u
           join device_identities d on d.device_id = u.device_id
          where u.user_id = $1
          order by u.last_seen_at desc`,
        [userId]
      );
      return r.rows;
    }
    throw e;
  }
}

async function updateUserDeviceLink({ userId, deviceId, deviceName, isEnabled }) {
  const updates = [];
  const values = [userId, deviceId];

  if (deviceName !== undefined) {
    values.push(deviceName);
    updates.push(`device_name = $${values.length}`);
  }
  if (isEnabled !== undefined) {
    values.push(!!isEnabled);
    updates.push(`is_enabled = $${values.length}`);
  }

  if (!updates.length) return false;

  try {
    const r = await query(
      `update user_device_links
          set ${updates.join(', ')}
        where user_id = $1
          and device_id = $2`,
      values
    );
    return r.rowCount > 0;
  } catch (e) {
    if (e && e.code === '42703') {
      throw new Error('Device settings are not enabled in your database yet. Run sql/012_device_link_settings.sql and try again.');
    }
    throw e;
  }
}


async function deleteUserDeviceLink({ userId, deviceId }) {
  const r = await query(
    `delete from user_device_links
      where user_id = $1
        and device_id = $2`,
    [userId, deviceId]
  );
  return r.rowCount > 0;
}

module.exports = {
  query,
  ensureUserProfile,
  ensureDeviceIdentity,
  linkDeviceToUser,
  resolveUserIdByDevice,
  listUserDevices,
  updateUserDeviceLink,
  deleteUserDeviceLink
};
