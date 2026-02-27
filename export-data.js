const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const qs = event.queryStringParameters || {};
  const id = Number(qs.id);
  if (!Number.isFinite(id) || id <= 0) return json(400, { error: "id is required" });

  const del = await query(
    `delete from food_entries where id=$1 and user_id=$2 returning id`,
    [id, userId]
  );

  if (del.rowCount === 0) return json(404, { error: "Entry not found" });
  return json(200, { ok: true, id });
};
