const { json } = require('./_util');
const { createReconciler } = require('./_reconcile');

const reconcileSubscriptions = createReconciler();

exports.handler = async () => {
  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: 'Missing STRIPE_SECRET_KEY' });

  try {
    const result = await reconcileSubscriptions({ actor: 'netlify_schedule' });
    return json(200, { ok: true, ...result });
  } catch {
    return json(500, { error: 'Scheduled reconciliation failed' });
  }
};
