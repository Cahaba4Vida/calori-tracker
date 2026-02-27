const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');

function isDateTime(v) {
  if (!v) return false;
  return Number.isFinite(Date.parse(v));
}

async function writeAudit(targetUserId, details) {
  try {
    await query(
      `insert into admin_audit_log(action, actor, target, details)
       values ($1,$2,$3,$4::jsonb)`,
      ['admin_pass_grant', 'admin_token', targetUserId, JSON.stringify(details || {})]
    );
  } catch {
    // audit is optional
  }
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const identifier = String(body.identifier || '').trim();
  const mode = String(body.mode || 'grant').trim();
  const note = body.note == null ? null : String(body.note).slice(0, 300);
  const expiresAt = body.expires_at == null || body.expires_at === '' ? null : String(body.expires_at);

  if (!identifier) return json(400, { error: 'identifier is required (email or user_id)' });
  if (!['grant', 'revoke'].includes(mode)) return json(400, { error: 'mode must be grant or revoke' });
  if (expiresAt && !isDateTime(expiresAt)) return json(400, { error: 'expires_at must be a valid datetime (ISO string) or blank' });

  try {
    const found = await query(
      `select user_id, email
       from user_profiles
       where user_id=$1 or lower(email)=lower($1)
       order by created_at desc
       limit 1`,
      [identifier]
    );
    const user = found.rows[0];
    if (!user) return json(404, { error: 'User not found for identifier' });

    if (mode === 'revoke') {
      await query(
        `update user_profiles
         set premium_pass=false,
             premium_pass_expires_at=null,
             premium_pass_note=null
         where user_id=$1`,
        [user.user_id]
      );
      await writeAudit(user.user_id, { mode });
      return json(200, { ok: true, user_id: user.user_id, email: user.email || null, premium_pass: false });
    }

    await query(
      `update user_profiles
       set premium_pass=true,
           premium_pass_expires_at=$2,
           premium_pass_note=$3
       where user_id=$1`,
      [user.user_id, expiresAt, note]
    );

    await writeAudit(user.user_id, { mode, expiresAt, note });

    return json(200, {
      ok: true,
      user_id: user.user_id,
      email: user.email || null,
      premium_pass: true,
      premium_pass_expires_at: expiresAt,
      premium_pass_note: note
    });
  } catch (e) {
    if (e && e.code === '42703') {
      return json(400, { error: 'Premium pass columns are missing. Run sql/007_admin_goals_and_passes.sql.' });
    }
    return json(500, { error: 'Could not update premium pass' });
  }
};
