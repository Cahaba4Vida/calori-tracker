const crypto = require('crypto');
const { json } = require("./_util");
const { ensureUserProfile, ensureDeviceIdentity, linkDeviceToUser, resolveUserIdByDevice } = require('./_db');

function getNetlifyUser(context) {
  try {
    const raw = context?.clientContext?.custom?.netlify;
    if (!raw) return null;
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return parsed?.user || null;
  } catch {
    return null;
  }
}

function getHeader(event, name) {
  if (!event || !event.headers) return null;
  return event.headers[name] || event.headers[name.toLowerCase()] || event.headers[name.toUpperCase()] || null;
}

function normalizeDeviceId(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9._-]{12,200}$/.test(trimmed)) return null;
  return trimmed;
}

function stableDeviceUserId(deviceId) {
  const hash = crypto.createHash('sha256').update(String(deviceId)).digest('hex').slice(0, 40);
  return `device_${hash}`;
}

async function requireUser(event, context) {
  const user = getNetlifyUser(context);
  const deviceId = normalizeDeviceId(getHeader(event, 'x-device-id'));

  if (user) {
    const userId = user.sub || user.id || user.user_id;
    const email = user.email || null;
    if (!userId) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

    await ensureUserProfile(userId, email);
    if (deviceId) {
      await ensureDeviceIdentity(deviceId);
      await linkDeviceToUser(deviceId, userId);
    }

    return { ok: true, user: { userId, email, claims: user, identity_type: 'user', device_id: deviceId || null } };
  }

  if (!deviceId) {
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  await ensureDeviceIdentity(deviceId);
  const linkedUserId = await resolveUserIdByDevice(deviceId);
  if (linkedUserId) {
    return { ok: true, user: { userId: linkedUserId, email: null, claims: null, identity_type: 'device_linked', device_id: deviceId } };
  }

  const deviceScopedUserId = stableDeviceUserId(deviceId);
  await ensureUserProfile(deviceScopedUserId, null);
  return { ok: true, user: { userId: deviceScopedUserId, email: null, claims: null, identity_type: 'device_anonymous', device_id: deviceId } };
}

async function requireSignedUser(event, context) {
  const user = getNetlifyUser(context);
  if (!user) {
    return { ok: false, response: json(401, { error: 'Sign up or sign in is required for paid features.' }) };
  }

  const userId = user.sub || user.id || user.user_id;
  const email = user.email || null;
  if (!userId) {
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  const deviceId = normalizeDeviceId(getHeader(event, 'x-device-id'));
  await ensureUserProfile(userId, email);
  if (deviceId) {
    await ensureDeviceIdentity(deviceId);
    await linkDeviceToUser(deviceId, userId);
  }

  return { ok: true, user: { userId, email, claims: user, identity_type: 'user', device_id: deviceId || null } };
}

module.exports = { requireUser, requireSignedUser };
