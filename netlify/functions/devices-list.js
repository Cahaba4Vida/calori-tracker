const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile, listUserDevices } = require('./_db');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email, device_id: currentDeviceId } = auth.user;
  await ensureUserProfile(userId, email);

  const devices = await listUserDevices(userId);
  return json(200, {
    current_device_id: currentDeviceId || null,
    devices: devices.map((d) => ({
      device_id: d.device_id,
      device_name: d.device_name || null,
      is_enabled: !!d.is_enabled,
      created_at: d.created_at,
      first_seen_at: d.first_seen_at,
      last_seen_at: d.last_seen_at,
      is_current: currentDeviceId ? d.device_id === currentDeviceId : false
    }))
  });
};
