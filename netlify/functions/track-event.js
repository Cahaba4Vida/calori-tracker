const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile, query } = require('./_db');

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const eventName = String(body.event_name || '').trim().slice(0, 80);
  if (!eventName) return json(400, { error: 'event_name is required' });

  const eventProps = body.event_props && typeof body.event_props === 'object' ? body.event_props : null;

  await query(
    `insert into app_events(user_id, event_name, event_props) values ($1, $2, $3::jsonb)`,
    [userId, eventName, eventProps ? JSON.stringify(eventProps) : null]
  );

  return json(200, { ok: true });
};
