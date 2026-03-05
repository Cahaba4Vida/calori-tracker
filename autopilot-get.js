const { json } = require('./_util');
const { requireAmbassador } = require('./_ambassadorAuth');

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const a = await requireAmbassador(event);
  if (!a.ok) return a.response;
  return json(200, { ok: true, ambassador: a.ambassador });
};
