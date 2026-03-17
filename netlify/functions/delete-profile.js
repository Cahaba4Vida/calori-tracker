const { json, readJson } = require("./_util");
const { requireUser } = require("./_auth");
const { query } = require("./_db");

async function safeQuery(sql, params = []) {
  try {
    return await query(sql, params);
  } catch (e) {
    // ignore missing-table / missing-column errors across mixed schemas
    if (e && (e.code === "42P01" || e.code === "42703")) return null;
    throw e;
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user || {};
  const body = readJson(event);
  const confirmation = String(body.confirmation || "").trim();

  if (confirmation !== "Delete") {
    return json(400, { error: 'Type "Delete" to confirm profile deletion.' });
  }

  try {
    const linkedDeviceRows = await safeQuery(
      `select device_id from user_device_links where user_id = $1`,
      [String(userId)]
    );
    const linkedDeviceIds = (linkedDeviceRows?.rows || []).map(r => String(r.device_id || "")).filter(Boolean);

    // Delete explicit non-cascading relations first.
    await safeQuery(`delete from referrals where referrer_user_id = $1 or referred_user_id = $1`, [String(userId)]);
    await safeQuery(`delete from ambassador_referrals where user_id = $1`, [String(userId)]);
    if (email) {
      await safeQuery(`delete from ambassador_referrals where lower(email) = lower($1)`, [String(email)]);
    }

    await safeQuery(`delete from app_events where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from food_entries_archive where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from daily_summaries_archive where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from ai_actions where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from ai_actions_archive where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from day_totals where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from alert_notifications where user_id = $1`, [String(userId)]);

    // Thread parents first; messages cascade if FK exists.
    await safeQuery(`delete from voice_threads where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from coach_threads where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from voice_audio_clips where user_id = $1`, [String(userId)]);

    // Explicit user tables (some also cascade from user_profiles; safe either way).
    await safeQuery(`delete from ai_usage_events where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from food_entries where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from daily_weights where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from daily_summaries where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from calorie_goals where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from feedback_responses where user_id = $1`, [String(userId)]);
    await safeQuery(`delete from user_device_links where user_id = $1`, [String(userId)]);

    // Finally delete the profile row.
    await safeQuery(`delete from user_profiles where user_id = $1`, [String(userId)]);

    // Remove any now-orphaned device identities that were only linked to this user.
    for (const deviceId of linkedDeviceIds) {
      await safeQuery(
        `delete from device_identities d
          where d.device_id = $1
            and not exists (
              select 1 from user_device_links u where u.device_id = d.device_id
            )`,
        [deviceId]
      );
    }

    // Recalculate referral_count for remaining users.
    await safeQuery(`update user_profiles set referral_count = 0`);
    await safeQuery(`
      update user_profiles u
         set referral_count = r.cnt
        from (
          select referrer_user_id, count(*)::int as cnt
            from referrals
           group by referrer_user_id
        ) r
       where u.user_id = r.referrer_user_id
    `);

    return json(200, { ok: true, deleted: true });
  } catch (e) {
    return json(500, { error: e.message || "Could not delete profile" });
  }
};
