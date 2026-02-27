const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  const qs = event.queryStringParameters || {};
  const q = (qs.q || '').trim();
  const limit = Math.max(1, Math.min(200, Number(qs.limit || 50)));

  try {
    let where = '';
    let params = [limit];
    if (q) {
      where = `where target = $2 or lower(target) = lower($2)`;
      params = [limit, q];
    }

    const r = await query(
      `select id, action, actor, target, details, created_at
       from admin_audit_log
       ${where}
       order by created_at desc
       limit $1`,
      params
    );

    return json(200, { ok: true, items: r.rows || [] });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
