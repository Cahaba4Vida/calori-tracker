const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const rollover_enabled = !!body.rollover_enabled;
  const rollover_cap = Math.max(0, Math.min(2000, Number(body.rollover_cap ?? 500) || 500));

  // Columns may not exist yet if migrations haven't run; return a clear error.
  try {
    await query(
      `update user_profiles
          set rollover_enabled = $2,
              rollover_cap = $3
        where user_id = $1`,
      [userId, rollover_enabled, rollover_cap]
    );
  } catch (e) {
    if (e && e.code === "42703") {
      return json(409, { error: "Database not migrated for rollover settings yet. Run sql/014_rollover_calories.sql." });
    }
    throw e;
  }

  return json(200, { ok: true, rollover_enabled, rollover_cap });
};
