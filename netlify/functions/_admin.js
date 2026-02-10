const { json } = require("./_util");

function requireAdminToken(event) {
  const expected = process.env.ADMIN_DASH_TOKEN;
  const headers = event.headers || {};
  const sent = headers["x-admin-token"] || headers["X-Admin-Token"];

  if (!expected || sent !== expected) {
    return { ok: false, response: json(401, { error: "Unauthorized" }) };
  }
  return { ok: true };
}

module.exports = { requireAdminToken };
