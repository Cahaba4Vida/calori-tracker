const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');

function addDaysISO(days) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  return end.toISOString();
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const identifier = String(body.identifier || '').trim();
  const days = Math.max(1, Math.min(90, Math.round(Number(body.days || 7))));
  if (!identifier) return json(400, { error: 'identifier is required' });

  const found = await query(
    `select user_id, email from user_profiles where user_id=$1 or lower(email)=lower($1) order by created_at desc limit 1`,
    [identifier]
  );
  const user = found.rows[0];
  if (!user) return json(404, { error: 'User not found for identifier' });

  const expiresAt = addDaysISO(days);
  await query(
    `update user_profiles
     set premium_pass=true,
         premium_pass_expires_at=$2,
         premium_pass_note=$3
     where user_id=$1`,
    [user.user_id, expiresAt, `trial_${days}_days`]
  );

  try {
    await query(`insert into admin_audit_log(action, actor, target, details) values ($1,$2,$3,$4::jsonb)`, ['admin_pass_trial','admin_token', user.user_id, JSON.stringify({ days, expiresAt })]);
  } catch {}

  return json(200, {
    ok: true,
    user_id: user.user_id,
    email: user.email || null,
    premium_pass: true,
    premium_pass_expires_at: expiresAt,
    trial_days: days
  });
};
