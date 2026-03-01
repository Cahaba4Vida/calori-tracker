const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const r = await query("select rollover_enabled, rollover_cap from user_profiles where user_id=$1", [userId]);
  const row = r.rows[0] || {};
  return json(200, {
    rollover_enabled: !!row.rollover_enabled,
    rollover_cap: row.rollover_cap ?? 500
  });
};
