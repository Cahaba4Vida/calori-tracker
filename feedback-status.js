const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");

function safeInt(x) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) return json(400, { error: "id is required" });

  const calories = safeInt(body.calories);
  const protein_g = safeInt(body.protein_g);
  const carbs_g = safeInt(body.carbs_g);
  const fat_g = safeInt(body.fat_g);

  if (calories == null || calories < 0) return json(400, { error: "calories must be a non-negative integer" });

  const upd = await query(
    `update food_entries
     set calories=$1, protein_g=$2, carbs_g=$3, fat_g=$4
     where id=$5 and user_id=$6
     returning id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g`,
    [calories, protein_g, carbs_g, fat_g, id, userId]
  );

  if (upd.rowCount === 0) return json(404, { error: "Entry not found" });
  return json(200, { entry: upd.rows[0] });
};
