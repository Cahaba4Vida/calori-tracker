const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile, deleteUserDeviceLink } = require('./_db');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email, device_id: currentDeviceId } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const deviceId = String(body.device_id || '').trim();
  if (!/^[A-Za-z0-9._-]{12,200}$/.test(deviceId)) {
    return json(400, { error: 'device_id is required and must be valid' });
  }

  if (currentDeviceId && deviceId === currentDeviceId) {
    return json(400, { error: 'You cannot delete the current device from itself.' });
  }

  const deleted = await deleteUserDeviceLink({ userId, deviceId });
  if (!deleted) {
    return json(404, { error: 'Device link not found for this user' });
  }

  return json(200, { ok: true });
};
