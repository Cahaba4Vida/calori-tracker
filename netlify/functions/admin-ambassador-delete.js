const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');
const { ensureAmbassadorsTables } = require('./_ambassadorAuth');

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
    await query(`delete from admin_ambassadors where lower(email)=lower($1)`, [email]);
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: 'Could not delete ambassador' });
  }
};
