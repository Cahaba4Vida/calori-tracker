const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');

function linearProjectionNext30Sum(series) {
  // series: array of numbers length n (>=2)
  const n = series.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const avgX = (n - 1) / 2;
  const avgY = series.reduce((a, b) => a + b, 0) / Math.max(1, n);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - avgX;
    const dy = series[i] - avgY;
    num += dx * dy;
    den += dx * dx;
  }
  const slope = den > 0 ? (num / den) : 0; // units per day
  const last = series[n - 1] || 0;

  // Sum_{t=1..30} (last + slope*t)
  const days = 30;
  const sumT = (days * (days + 1)) / 2; // 465
  const next30Sum = (last * days) + (slope * sumT);

  return {
    slope_per_day: Math.round(slope * 1000) / 1000,
    next_30d_sum: Math.round(next30Sum),
    next_30d_avg_per_day: Math.round((next30Sum / days) * 10) / 10,
    projected_day_30: Math.round((last + slope * days) * 10) / 10
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  try {
    // Daily series for last 30 days (including today)
    const daily = await query(`
      with days as (
        select generate_series(current_date - 29, current_date, interval '1 day')::date as d
      )
      select
        d as day,
        (select count(*)::int from user_profiles u
          where u.email is not null and btrim(u.email) <> ''
            and u.created_at::date = d
        ) as signups,
        (select count(distinct user_id)::int from food_entries f
          where f.entry_date = d
        ) as dau,
        (select count(*)::int from food_entries f
          where f.entry_date = d
        ) as entries,
        (select count(*)::int from ai_usage_events a
          where a.entry_date = d
        ) as ai_actions
      from days
      order by d asc
    `);

    const rows = daily.rows || [];
    const series = rows.map(r => ({
      day: (r.day instanceof Date) ? r.day.toISOString().slice(0,10) : String(r.day),
      signups: Number(r.signups || 0),
      dau: Number(r.dau || 0),
      entries: Number(r.entries || 0),
      ai_actions: Number(r.ai_actions || 0),
    }));

    const signupsArr = series.map(x => x.signups);
    const dauArr = series.map(x => x.dau);
    const entriesArr = series.map(x => x.entries);
    const aiArr = series.map(x => x.ai_actions);

    const totals = await query(`
      select
        (select count(*)::int from user_profiles where email is not null and btrim(email) <> '') as total_users,
        (select count(*)::int from user_profiles where email is not null and btrim(email) <> '' and created_at >= now() - interval '7 days') as new_users_7d,
        (select count(distinct user_id)::int from food_entries where entry_date = current_date) as dau_today,
        (select count(distinct user_id)::int from food_entries where entry_date >= current_date - 6) as wau,
        (select count(*)::int from food_entries where entry_date = current_date) as entries_today,
        (select count(*)::int from ai_usage_events where entry_date = current_date) as ai_actions_today
    `);

    const t = totals.rows[0] || {};

    return json(200, {
      totals: {
        total_users: Number(t.total_users || 0),
        new_users_7d: Number(t.new_users_7d || 0),
        dau_today: Number(t.dau_today || 0),
        wau: Number(t.wau || 0),
        entries_today: Number(t.entries_today || 0),
        ai_actions_today: Number(t.ai_actions_today || 0),
      },
      series,
      projections: {
        signups: linearProjectionNext30Sum(signupsArr),
        dau: linearProjectionNext30Sum(dauArr),
        entries: linearProjectionNext30Sum(entriesArr),
        ai_actions: linearProjectionNext30Sum(aiArr),
      }
    });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
