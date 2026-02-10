const { query } = require('./_db');

function createStripeClient(secret = process.env.STRIPE_SECRET_KEY) {
  return async function stripeGet(pathname) {
    if (!secret) return null;
    const resp = await fetch(`https://api.stripe.com/v1/${pathname}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    if (!resp.ok) return null;
    return resp.json();
  };
}

async function sendAlert(summary) {
  const url = process.env.RECON_ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(summary)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function createReconciler(deps = {}) {
  const queryFn = deps.queryFn || query;
  const stripeGet = deps.stripeGet || createStripeClient();
  const alertFn = deps.alertFn || sendAlert;

  return async function reconcileSubscriptions({ actor = 'system/scheduled' } = {}) {
    const users = await queryFn(
      `select user_id, stripe_subscription_id, stripe_customer_id, subscription_status
       from user_profiles
       where stripe_subscription_id is not null or stripe_customer_id is not null`
    );

    let checked = 0;
    let updated = 0;
    let errors = 0;

    for (const u of users.rows) {
      checked += 1;
      let subscription = null;

      try {
        if (u.stripe_subscription_id) {
          subscription = await stripeGet(`subscriptions/${encodeURIComponent(String(u.stripe_subscription_id))}`);
        }

        if (!subscription && u.stripe_customer_id) {
          const list = await stripeGet(`subscriptions?customer=${encodeURIComponent(String(u.stripe_customer_id))}&status=all&limit=1`);
          subscription = list?.data?.[0] || null;
        }
      } catch {
        errors += 1;
        continue;
      }

      if (!subscription) continue;

      const status = String(subscription.status || 'inactive');
      const planTier = ['active', 'trialing'].includes(status) ? 'premium' : 'free';
      const periodEnd = subscription.current_period_end
        ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
        : null;

      if (status !== u.subscription_status || String(subscription.id || '') !== String(u.stripe_subscription_id || '')) {
        updated += 1;
      }

      await queryFn(
        `update user_profiles
         set plan_tier=$2,
             subscription_status=$3,
             stripe_customer_id=$4,
             stripe_subscription_id=$5,
             subscription_current_period_end=$6
         where user_id=$1`,
        [u.user_id, planTier, status, subscription.customer ? String(subscription.customer) : null, subscription.id ? String(subscription.id) : null, periodEnd]
      );
    }

    const result = { checked, updated, errors, actor };

    await queryFn(
      `insert into subscription_reconcile_runs(actor, checked, updated, errors)
       values ($1, $2, $3, $4)`,
      [actor, checked, updated, errors]
    );

    await queryFn(
      `insert into admin_audit_log(action, actor, target, details)
       values ($1, $2, $3, $4::jsonb)`,
      ['subscriptions_reconciled', actor, 'all_users', JSON.stringify(result)]
    );

    if (errors > 0) {
      const delivered = await alertFn({
        type: 'reconciliation_alert',
        severity: 'error',
        message: `Subscription reconciliation encountered ${errors} errors`,
        ...result
      });
      await queryFn(
        `insert into alert_notifications(alert_type, severity, payload, delivered)
         values ($1, $2, $3::jsonb, $4)`,
        ['reconciliation_error', 'error', JSON.stringify(result), delivered]
      );
    }

    return result;
  };
}

module.exports = { createReconciler, createStripeClient, sendAlert };
