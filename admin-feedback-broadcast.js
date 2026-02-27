const { json } = require('./_util');
const { requireAdmin } = require('./_adminAuth');
const { query } = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const auth = await requireAdmin(event);
  if (auth) return auth;

  // Admin overview: per-ambassador totals and active MRR equivalent.
  try {
    const r = await query(
      `
      select
        a.id as ambassador_id,
        a.email,
        a.currency,
        a.monthly_price_cents,
        a.yearly_price_cents,
        count(ar.*) as referred_count,
        count(ar.*) filter (where ar.status='paid') as paid_count,
        coalesce(sum(ar.price_paid_cents) filter (where ar.status='paid'), 0) as total_first_payment_cents,
        coalesce(sum(
          case
            when ar.stripe_subscription_status in ('active','trialing') then
              case when ar.ambassador_interval='year' then (ar.price_paid_cents::numeric / 12.0) else ar.price_paid_cents::numeric end
            else 0
          end
        ), 0) as active_mrr_equiv_cents
      from admin_ambassadors a
      left join ambassador_referrals ar on ar.ambassador_id = a.id
      group by a.id, a.email, a.currency, a.monthly_price_cents, a.yearly_price_cents
      order by lower(a.email) asc
      `
    );

    const rows = (r.rows || []).map(x => ({
      ambassador_id: Number(x.ambassador_id),
      email: x.email,
      currency: (x.currency || 'usd'),
      referred_count: Number(x.referred_count || 0),
      paid_count: Number(x.paid_count || 0),
      total_first_payment_cents: Math.round(Number(x.total_first_payment_cents || 0)),
      active_mrr_equiv_cents: Math.round(Number(x.active_mrr_equiv_cents || 0)),
      monthly_price_cents: x.monthly_price_cents != null ? Number(x.monthly_price_cents) : null,
      yearly_price_cents: x.yearly_price_cents != null ? Number(x.yearly_price_cents) : null,
    }));

    return json(200, { ok: true, ambassadors: rows });
  } catch (e) {
    return json(500, { error: 'Could not load ambassador stats' });
  }
};
