const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');
const { ensureAmbassadorsTables } = require('./_ambassadorAuth');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  try {
    await ensureAmbassadorsTables();
    const r = await query(
      `select id, email, referral_code, name, notes, monthly_price_cents, yearly_price_cents, currency, created_at
       from admin_ambassadors
       order by created_at desc
       limit 500`
    );
    return json(200, { ok: true, ambassadors: r.rows });
  } catch (e) {
    return json(500, { error: 'Could not list ambassadors' });
  }
};
