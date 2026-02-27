const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  const qs = event.queryStringParameters || {};
  const days = Math.max(1, Math.min(365, Number(qs.days || 30)));

  try {
    const rows = await query(`
      select
        r.submitted_at,
        u.email,
        r.response_text,
        c.title as campaign_title,
        c.id as campaign_id
      from feedback_responses r
      join feedback_campaigns c on c.id = r.campaign_id
      left join user_profiles u on u.user_id = r.user_id
      where r.submitted_at >= now() - ($1::int || ' days')::interval
      order by r.submitted_at desc
      limit 300
    `, [days]);

    return json(200, { days, responses: rows.rows || [] });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
