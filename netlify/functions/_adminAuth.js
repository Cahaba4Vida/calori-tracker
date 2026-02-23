// Backward-compatible admin auth helper.
// New admin endpoints expect `requireAdmin(event)`.
// We delegate to the existing token-based gate in `_admin.js`.

const { requireAdminToken } = require('./_admin');

function requireAdmin(event) {
  return requireAdminToken(event);
}

module.exports = { requireAdmin };
