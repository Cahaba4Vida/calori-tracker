// Backward-compatible admin auth helper.
// New admin endpoints expect `requireAdmin(event)` to return a Netlify response
// when unauthorized, and `null` when authorized.

const { requireAdminToken } = require('./_admin');

function requireAdmin(event) {
  const r = requireAdminToken(event);
  if (!r || r.ok === false) return r?.response || { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  return null;
}

module.exports = { requireAdmin };
