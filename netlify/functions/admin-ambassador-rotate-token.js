const crypto = require('crypto');
const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');
const { sha256Hex, ensureAmbassadorsTables } = require('./_ambassadorAuth');

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return json(400, { error: 'email is required' });

  try {
    await ensureAmbassadorsTables();
    const token = newToken();
    const r = await query(`update admin_ambassadors set token_hash=$2, updated_at=now() where lower(email)=lower($1)`, [email, sha256Hex(token)]);
    if (!r.rowCount) return json(404, { error: 'Ambassador not found' });
    return json(200, { ok: true, email, token });
  } catch (e) {
    return json(500, { error: 'Could not rotate token' });
  }
};
