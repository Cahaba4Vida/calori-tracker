const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { query, ensureUserProfile } = require('./_db');

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

  const updates = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(body, 'autopilot_enabled')) {
    if (typeof body.autopilot_enabled !== 'boolean') return json(400, { error: 'autopilot_enabled must be boolean' });
    values.push(body.autopilot_enabled);
    updates.push(`autopilot_enabled = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'autopilot_mode')) {
    const mode = body.autopilot_mode;
    if (mode != null && mode !== 'weight' && mode !== 'bodyfat') {
      return json(400, { error: 'autopilot_mode must be weight|bodyfat' });
    }
    values.push(mode ?? 'weight');
    updates.push(`autopilot_mode = $${values.length}`);
  }

  if (updates.length === 0) return json(400, { error: 'No valid fields to update' });

  values.push(userId);
  await query(`update user_profiles set ${updates.join(', ')} where user_id = $${values.length}`, values);
  return json(200, { ok: true });
};
