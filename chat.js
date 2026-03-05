const { json, getDenverDateISO } = require('./_util');
const { requireUser } = require('./_auth');
const { query, ensureUserProfile } = require('./_db');

function weekStartISO(denverISO) {
  const [y, m, d] = denverISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const offsetToMon = (dow + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - offsetToMon);
  return dt.toISOString().slice(0, 10);
}

function daysBetweenISO(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const todayISO = getDenverDateISO(new Date());
  const thisWeek = weekStartISO(todayISO);

  // Load profile + autopilot config
  const pr = await query(
    `select
       autopilot_enabled,
       autopilot_mode,
       autopilot_last_review_week,
       goal_weight_lbs,
       goal_date,
       goal_body_fat_percent,
       goal_body_fat_date,
       current_body_fat_percent,
       current_body_fat_weight_lbs
     from user_profiles where user_id=$1`,
    [userId]
  );
  const p = pr.rows[0] || {};

  const enabled = !!p.autopilot_enabled;
  const mode = (p.autopilot_mode || 'weight');
  const lastReviewed = p.autopilot_last_review_week ? String(p.autopilot_last_review_week) : null;
  const dueThisWeek = enabled && lastReviewed !== thisWeek;

  if (!enabled) {
    return json(200, { ok: false, reason: 'autopilot_disabled', due_this_week: false, week_start: thisWeek, today: todayISO });
  }

  // Get current calorie goal
  const gr = await query('select daily_calories from calorie_goals where user_id=$1', [userId]);
  const currentGoal = gr.rows[0]?.daily_calories == null ? null : Number(gr.rows[0].daily_calories);
  if (!currentGoal) {
    return json(200, { ok: false, reason: 'no_calorie_goal', due_this_week: dueThisWeek, week_start: thisWeek, today: todayISO });
  }

  // Last 7 days calorie totals
  const from7 = (() => {
    const [y, m, d] = todayISO.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 6);
    return dt.toISOString().slice(0, 10);
  })();

  const cal = await query(
    `select entry_date::text as entry_date, sum(calories)::float8 as total_calories
     from food_entries
     where user_id=$1 and entry_date between $2 and $3
     group by entry_date`,
    [userId, from7, todayISO]
  );

  const caloriesByDay = new Map(cal.rows.map(r => [r.entry_date, Number(r.total_calories || 0)]));
  let foodDays = 0;
  let calSum = 0;
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = from7.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    const v = caloriesByDay.get(iso) || 0;
    if (v > 0) {
      foodDays++;
      calSum += v;
    }
  }

  if (foodDays < 4) {
    return json(200, {
      ok: false,
      reason: 'not_enough_food_days',
      due_this_week: dueThisWeek,
      week_start: thisWeek,
      today: todayISO,
      need_food_days: 4,
      have_food_days: foodDays
    });
  }
  const avgCalories = calSum / foodDays;

  // Last 14 days weights
  const from14 = (() => {
    const [y, m, d] = todayISO.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 13);
    return dt.toISOString().slice(0, 10);
  })();

  const wt = await query(
    `select entry_date::text as entry_date, weight_lbs::float8 as weight_lbs, body_fat_percent::float8 as body_fat_percent
     from daily_weights
     where user_id=$1 and entry_date between $2 and $3
     order by entry_date asc`,
    [userId, from14, todayISO]
  );

  const weights = wt.rows.filter(r => r.weight_lbs != null).map(r => ({
    entry_date: r.entry_date,
    weight_lbs: Number(r.weight_lbs),
    body_fat_percent: r.body_fat_percent == null ? null : Number(r.body_fat_percent)
  }));

  if (weights.length < 2) {
    return json(200, { ok: false, reason: 'not_enough_weighins', due_this_week: dueThisWeek, week_start: thisWeek, today: todayISO, need_weighins: 2, have_weighins: weights.length });
  }

  const first = weights[0];
  const last = weights[weights.length - 1];
  const spanDays = Math.max(1, daysBetweenISO(first.entry_date, last.entry_date));
  if (spanDays < 6) {
    return json(200, { ok: false, reason: 'weighins_too_close', due_this_week: dueThisWeek, week_start: thisWeek, today: todayISO, min_span_days: 6, span_days: spanDays });
  }
  const observedLbsPerWeek = ((last.weight_lbs - first.weight_lbs) / spanDays) * 7;

  // Determine target weight + goal date
  let targetWeight = null;
  let goalDate = null;
  let meta = {};

  if (mode === 'weight') {
    targetWeight = p.goal_weight_lbs == null ? null : Number(p.goal_weight_lbs);
    goalDate = p.goal_date ?? null;
    if (!targetWeight) {
      return json(200, { ok: false, reason: 'no_target_weight', due_this_week: dueThisWeek, week_start: thisWeek, today: todayISO });
    }
  } else {
    const targetBF = p.goal_body_fat_percent == null ? null : Number(p.goal_body_fat_percent);
    goalDate = p.goal_body_fat_date ?? null;
    if (!targetBF) {
      return json(200, { ok: false, reason: 'no_target_bodyfat', due_this_week: dueThisWeek, week_start: thisWeek, today: todayISO });
    }

    // Current snapshot BF% must exist (manual entry allowed)
    const currentBF = p.current_body_fat_percent == null ? null : Number(p.current_body_fat_percent);
    if (!currentBF) {
      return json(200, { ok: false, reason: 'no_current_bodyfat', due_this_week: dueThisWeek, week_start: thisWeek, today: todayISO });
    }

    // Current weight: prefer override snapshot weight, else latest weigh-in
    const currentWeight = p.current_body_fat_weight_lbs == null ? last.weight_lbs : Number(p.current_body_fat_weight_lbs);
    const leanMass = currentWeight * (1 - clamp(currentBF, 1, 80) / 100);
    targetWeight = leanMass / (1 - clamp(targetBF, 1, 80) / 100);
    meta = {
      target_body_fat_percent: targetBF,
      current_body_fat_percent: currentBF,
      implied_target_weight_lbs: Number(targetWeight.toFixed(1))
    };
  }

  // Desired rate
  let desiredLbsPerWeek = -1; // default: lose 1 lb/wk
  if (goalDate) {
    const daysToGoal = daysBetweenISO(todayISO, String(goalDate));
    const weeks = daysToGoal / 7;
    if (weeks > 0.25) {
      const currentWeightForTarget = last.weight_lbs;
      desiredLbsPerWeek = (targetWeight - currentWeightForTarget) / weeks;
    }
  }
  desiredLbsPerWeek = clamp(desiredLbsPerWeek, -2.0, 1.0);

  // Infer TDEE from observed change
  const deficitPerDayObserved = -observedLbsPerWeek * 500;
  const inferredTDEE = avgCalories + deficitPerDayObserved;

  // Raw target calories
  const targetCaloriesRaw = inferredTDEE - (desiredLbsPerWeek * 500);

  // Smooth with max weekly step
  const maxStep = 150;
  const targetCaloriesClamped = clamp(targetCaloriesRaw, 1200, 4500);
  const deltaRaw = targetCaloriesClamped - currentGoal;
  const delta = clamp(deltaRaw, -maxStep, maxStep);
  const suggested = Math.round((currentGoal + delta) / 10) * 10;

  return json(200, {
    ok: true,
    due_this_week: dueThisWeek,
    week_start: thisWeek,
    today: todayISO,
    autopilot_mode: mode,
    current_daily_calories: currentGoal,
    suggested_daily_calories: suggested,
    delta_daily_calories: suggested - currentGoal,
    avg_calories_7d: Math.round(avgCalories),
    observed_lbs_per_week: Number(observedLbsPerWeek.toFixed(2)),
    inferred_tdee: Math.round(inferredTDEE),
    desired_lbs_per_week: Number(desiredLbsPerWeek.toFixed(2)),
    target_weight_lbs: Number(targetWeight.toFixed(1)),
    goal_date: goalDate,
    ...meta
  });
};
