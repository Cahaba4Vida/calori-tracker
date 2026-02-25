const { json } = require('./_util');
const { requireAmbassador } = require('./_ambassadorAuth');
const { query } = require('./_db');

function money(cents, currency) {
  const c = Number(cents || 0);
  const cur = (currency || 'usd').toUpperCase();
  return { cents: Math.round(c), currency: cur };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const a = await requireAmbassador(event);
  if (!a.ok) return a.response;

  const ambId = Number(a.ambassador.id);
  const currency = String(a.ambassador.currency || 'usd').toLowerCase();

  // "Made" is ambiguous for subscriptions. We expose two concrete metrics:
  // - total_first_payment_cents: sum of first paid amounts recorded on referral rows (lifetime)
  // - active_mrr_equiv_cents: monthly recurring revenue equivalent from currently active/trialing subs
  try {
    const r = await query(
      `
      select
        count(*) filter (where true) as total_referred,
        count(*) filter (where status='paid') as total_paid,
        coalesce(sum(price_paid_cents) filter (where status='paid'), 0) as total_first_payment_cents,
        coalesce(sum(
          case
            when stripe_subscription_status in ('active','trialing') then
              case when ambassador_interval='year' then (price_paid_cents::numeric / 12.0) else price_paid_cents::numeric end
            else 0
          end
        ), 0) as active_mrr_equiv_cents
      from ambassador_referrals
      where ambassador_id = $1
      `,
      [ambId]
    );

    const row = r.rows[0] || {};
    return json(200, {
      ok: true,
      ambassador_id: ambId,
      currency,
      totals: {
        referred: Number(row.total_referred || 0),
        paid: Number(row.total_paid || 0),
        total_first_payment: money(row.total_first_payment_cents, currency),
        active_mrr_equiv: money(row.active_mrr_equiv_cents, currency),
      }
    });
  } catch (e) {
    return json(500, { error: 'Could not load ambassador stats' });
  }
};
