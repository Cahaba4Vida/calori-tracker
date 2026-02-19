const { query } = require('./_db');

async function logAdminAction({ action, actor = 'admin_token', target = null, details = null }) {
  try {
    await query(
      `insert into admin_audit_log(action, actor, target, details)
       values ($1,$2,$3,$4::jsonb)`,
      [String(action || '').slice(0, 80), String(actor || 'admin_token').slice(0, 80), target, details ? JSON.stringify(details) : null]
    );
  } catch {
    // Audit logging is optional (older DBs may not have the table yet).
  }
}

module.exports = { logAdminAction };
