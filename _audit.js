const { requireAdminToken } = require("./_admin");

// Compatibility shim:
// - Return null when authorized
// - Return a Netlify response object when unauthorized
function requireAdmin(event) {
  const r = requireAdminToken(event);
  if (!r || !r.ok) return r?.response || { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  return null;
}

module.exports = { requireAdmin };
