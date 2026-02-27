const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile, updateUserDeviceLink } = require('./_db');

function normalizeDeviceName(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const deviceId = String(body.device_id || '').trim();
  if (!/^[A-Za-z0-9._-]{12,200}$/.test(deviceId)) {
    return json(400, { error: 'device_id is required and must be valid' });
  }

  const hasName = Object.prototype.hasOwnProperty.call(body, 'device_name');
  const hasEnabled = Object.prototype.hasOwnProperty.call(body, 'is_enabled');

  if (!hasName && !hasEnabled) {
    return json(400, { error: 'At least one of device_name or is_enabled is required' });
  }

  if (hasEnabled && typeof body.is_enabled !== 'boolean') {
    return json(400, { error: 'is_enabled must be a boolean' });
  }

  const updated = await updateUserDeviceLink({
    userId,
    deviceId,
    deviceName: hasName ? normalizeDeviceName(body.device_name) : undefined,
    isEnabled: hasEnabled ? !!body.is_enabled : undefined
  });

  if (!updated) {
    return json(404, { error: 'Device link not found for this user' });
  }

  return json(200, { ok: true });
};
