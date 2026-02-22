const { json } = require('./_util');
const { requireUser } = require('./_auth');
const { ensureUserProfile, query } = require('./_db');
const { getUserEntitlements } = require('./_plan');

function isDateOnly(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const ent = await getUserEntitlements(userId);
  if (!ent.is_premium) {
    return json(403, { error: 'Data export is available on Premium only.' });
  }

  const qs = event.queryStringParameters || {};
  const format = String(qs.format || 'json').toLowerCase();
  const from = qs.from;
  const to = qs.to;
  if (from && !isDateOnly(from)) return json(400, { error: 'from must be YYYY-MM-DD' });
  if (to && !isDateOnly(to)) return json(400, { error: 'to must be YYYY-MM-DD' });

  const dateFilter = [];
  const params = [userId];
  if (from) {
    params.push(from);
    dateFilter.push(`entry_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    dateFilter.push(`entry_date <= $${params.length}`);
  }
  const whereDate = dateFilter.length ? ` and ${dateFilter.join(' and ')}` : '';

  const [entries, weights, goals, profile] = await Promise.all([
    query(`select entry_date, taken_at, calories, protein_g, carbs_g, fat_g, raw_extraction from food_entries where user_id=$1${whereDate} order by taken_at asc`, params),
    query(`select entry_date, weight_lbs from daily_weights where user_id=$1${whereDate} order by entry_date asc`, params),
    query(`select daily_calories, updated_at from calorie_goals where user_id=$1`, [userId]),
    query(`select email, onboarding_completed, macro_protein_g, macro_carbs_g, macro_fat_g, goal_weight_lbs, activity_level, goal_date from user_profiles where user_id=$1`, [userId])
  ]);

  if (format === 'csv') {
    const profileRow = profile.rows[0] || {};
    const goalsRow = goals.rows[0] || {};

    // Provide CSVs that are easy to open in Google Sheets / Excel.
    // (We keep entries + weights as full tables, and profile + goals as one-row tables.)
    const payload = {
      format: 'csv',
      exported_at: new Date().toISOString(),
      filter: { from: from || null, to: to || null },
      entries_csv: toCsv(entries.rows),
      weights_csv: toCsv(weights.rows),
      profile_csv: toCsv([profileRow]),
      goals_csv: toCsv([goalsRow])
    };

    return json(200, payload);
  }

  return json(200, {
    exported_at: new Date().toISOString(),
    user_id: userId,
    filter: { from: from || null, to: to || null },
    profile: profile.rows[0] || null,
    goals: goals.rows[0] || null,
    entries: entries.rows,
    weights: weights.rows
  });
};
