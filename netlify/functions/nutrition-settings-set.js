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

  const rollover_enabled = body.rollover_enabled === true;
  const rollover_cap_raw = Number(body.rollover_cap);
  const rollover_cap = Number.isFinite(rollover_cap_raw) ? Math.max(0, Math.min(2000, Math.round(rollover_cap_raw))) : 500;

  await query(
    "update user_profiles set rollover_enabled=$2, rollover_cap=$3 where user_id=$1",
    [userId, rollover_enabled, rollover_cap]
  );

  return json(200, { ok: true, rollover_enabled, rollover_cap });
};
