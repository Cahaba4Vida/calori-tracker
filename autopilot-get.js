const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile, query } = require("./_db");
const crypto = require("crypto");

function hoursBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

async function getLatestThread(userId) {
  const r = await query(
    `select id, last_active_at
     from voice_threads
     where user_id = $1
     order by last_active_at desc
     limit 1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function createThread(userId) {
  const id = crypto.randomUUID();
  await query(
    `insert into voice_threads(id, user_id, created_at, last_active_at)
     values ($1, $2, now(), now())`,
    [id, userId]
  );
  return id;
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const latest = await getLatestThread(userId);
  if (latest && latest.last_active_at) {
    const last = new Date(latest.last_active_at);
    const now = new Date();
    if (hoursBetween(now, last) <= 4) {
      return json(200, { thread_id: latest.id, rotated: false });
    }
  }

  const id = await createThread(userId);
  return json(200, { thread_id: id, rotated: true });
};
