const { requireAdmin } = require('./_adminAuth');
const { json, query, parseBody } = require('./_db');

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (auth) return auth;
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const body = parseBody(event);
    const user_id = body?.user_id;
    if (!user_id) return json({ ok: false, error: 'Missing user_id' }, 400);

    // Best-effort cascade delete across all known user-scoped tables.
    // Keep this list in sync with the app's storage tables.
    await query('begin');
    await query('delete from food_entries where user_id = $1', [user_id]);
    await query('delete from food_entries_archive where user_id = $1', [user_id]);
    await query('delete from daily_weights where user_id = $1', [user_id]);
    await query('delete from daily_weights_archive where user_id = $1', [user_id]);
    await query('delete from ai_actions where user_id = $1', [user_id]);
    await query('delete from ai_actions_archive where user_id = $1', [user_id]);
    const deleted = await query('delete from user_profiles where user_id = $1 returning user_id', [user_id]);
    await query('commit');

    if (!deleted.length) return json({ ok: false, error: 'User not found' }, 404);
    return json({ ok: true, deleted_user_id: user_id });
  } catch (e) {
    try {
      await query('rollback');
    } catch (_) {}
    return json({ ok: false, error: 'Failed to delete user', detail: String(e?.message || e) }, 500);
  }
};
