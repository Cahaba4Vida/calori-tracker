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



async function mergeDeviceAnonymousData({ fromUserId, toUserId }) {
  if (!fromUserId || !toUserId) return { ok: false, reason: 'missing_user_id' };
  if (fromUserId === toUserId) return { ok: true, merged: false };

  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // 1) food entries (no uniqueness conflict expected)
    await client.query(
      `update food_entries set user_id = $2 where user_id = $1`,
      [fromUserId, toUserId]
    );

    // 2) weights: merge by most-recent updated_at
    await client.query(
      `insert into daily_weights(user_id, entry_date, weight_lbs, created_at, updated_at)
       select $2, entry_date, weight_lbs, created_at, updated_at
         from daily_weights
        where user_id = $1
       on conflict (user_id, entry_date) do update set
         weight_lbs = case when excluded.updated_at > daily_weights.updated_at then excluded.weight_lbs else daily_weights.weight_lbs end,
         updated_at = greatest(daily_weights.updated_at, excluded.updated_at)`,
      [fromUserId, toUserId]
    );
    await client.query(`delete from daily_weights where user_id = $1`, [fromUserId]);

    // 3) calorie goals: merge by most-recent updated_at
    await client.query(
      `insert into calorie_goals(user_id, daily_calories, created_at, updated_at)
       select $2, daily_calories, created_at, updated_at
         from calorie_goals
        where user_id = $1
       on conflict (user_id) do update set
         daily_calories = case when excluded.updated_at > calorie_goals.updated_at then excluded.daily_calories else calorie_goals.daily_calories end,
         updated_at = greatest(calorie_goals.updated_at, excluded.updated_at)`,
      [fromUserId, toUserId]
    );
    await client.query(`delete from calorie_goals where user_id = $1`, [fromUserId]);

    // 4) feedback responses (append; ids should be unique)
    await client.query(
      `update feedback_responses set user_id = $2 where user_id = $1`,
      [fromUserId, toUserId]
    );

    // 5) app events / usage telemetry (append)
    await client.query(`update app_events set user_id = $2 where user_id = $1`, [fromUserId, toUserId]);
    await client.query(`update ai_usage_events set user_id = $2 where user_id = $1`, [fromUserId, toUserId]);

    // 6) rollups/summaries (best-effort; ignore if table/schema differs)
    try { await client.query(`update day_totals set user_id = $2 where user_id = $1`, [fromUserId, toUserId]); } catch {}
    try { await client.query(`update daily_summaries set user_id = $2 where user_id = $1`, [fromUserId, toUserId]); } catch {}
    try { await client.query(`update daily_summaries_archive set user_id = $2 where user_id = $1`, [fromUserId, toUserId]); } catch {}
    try { await client.query(`update food_entries_archive set user_id = $2 where user_id = $1`, [fromUserId, toUserId]); } catch {}

    // 7) merge profile fields (keep anon profile for device remember-onboarding, but copy values into account if missing)
    await client.query(
      `update user_profiles up
          set onboarding_completed = coalesce(up.onboarding_completed,false) or coalesce(anon.onboarding_completed,false),
              macro_protein_g = coalesce(up.macro_protein_g, anon.macro_protein_g),
              macro_carbs_g   = coalesce(up.macro_carbs_g,   anon.macro_carbs_g),
              macro_fat_g     = coalesce(up.macro_fat_g,     anon.macro_fat_g),
              goal_weight_lbs = coalesce(up.goal_weight_lbs, anon.goal_weight_lbs),
              activity_level  = coalesce(up.activity_level,  anon.activity_level),
              goal_date       = coalesce(up.goal_date,       anon.goal_date),
              quick_fills     = coalesce(up.quick_fills,     anon.quick_fills)
         from user_profiles anon
        where up.user_id = $2
          and anon.user_id = $1`,
      [fromUserId, toUserId]
    );

    await client.query('COMMIT');
    return { ok: true, merged: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}


module.exports = {
  mergeDeviceAnonymousData,
  query,
  ensureUserProfile,
  ensureDeviceIdentity,
  linkDeviceToUser,
  resolveUserIdByDevice,
  listUserDevices,
  updateUserDeviceLink
};
