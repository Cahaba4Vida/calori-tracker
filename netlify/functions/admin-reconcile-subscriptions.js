const { json } = require('./_util');
const { requireAdminToken } = require('./_admin');
const { createReconciler } = require('./_reconcile');

const reconcileSubscriptions = createReconciler();

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: 'Missing STRIPE_SECRET_KEY' });

  try {
    const result = await reconcileSubscriptions({ actor: 'admin_token' });
    return json(200, { ok: true, ...result });
  } catch {
    return json(500, { error: 'Failed to reconcile subscriptions' });
  }
};
