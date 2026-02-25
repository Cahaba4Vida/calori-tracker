const { json } = require('./_util');
const { query } = require('./_db');
const { requireAmbassador } = require('./_ambassadorAuth');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const a = await requireAmbassador(event);
  if (!a.ok) return a.response;

  try {
    const ambId = a.ambassador.id;

    // Pull referrals/conversions + stitch to user_profiles when possible.
    const r = await query(
      `select r.user_id,
              coalesce(r.email, p.email) as email,
              r.ref_code,
              r.first_seen_at,
              r.last_seen_at,
              r.status,
              r.price_paid_cents,
              r.currency,
              r.stripe_subscription_id,
              r.stripe_customer_id,
              r.stripe_subscription_status,
              r.stripe_current_period_end
         from ambassador_referrals r
         left join user_profiles p on p.user_id = r.user_id
        where r.ambassador_id = $1
        order by coalesce(r.price_paid_cents,0) desc, r.last_seen_at desc
        limit 500`,
      [ambId]
    );

    return json(200, { ok: true, users: r.rows });
  } catch (e) {
    return json(500, { error: 'Could not load ambassador users' });
  }
};
