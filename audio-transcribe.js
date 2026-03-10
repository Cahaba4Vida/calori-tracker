const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  // Columns may not exist yet if migrations haven't run; fall back safely.
  try {
    const r = await query(
      `select coalesce(rollover_enabled, false) as rollover_enabled,
              coalesce(rollover_cap, 500) as rollover_cap
         from user_profiles
        where user_id = $1`,
      [userId]
    );
    return json(200, {
      rollover_enabled: !!r.rows[0]?.rollover_enabled,
      rollover_cap: Number(r.rows[0]?.rollover_cap ?? 500)
    });
  } catch (e) {
    if (e && e.code === "42703") {
      return json(200, { rollover_enabled: false, rollover_cap: 500 });
    }
    throw e;
  }
};
