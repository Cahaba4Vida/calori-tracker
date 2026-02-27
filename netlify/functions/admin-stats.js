const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');
const { DEFAULTS } = require('./_plan');

const DEFAULT_WAU_GOAL = 500;
const DEFAULT_PAYING_GOAL = 30;

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  try {
    const [
      users,
      foodEntries,
      foodEntriesArchive,
      weights,
      summaries,
      summariesArchive,
      activeUsers7d,
      payingUsers,
      premiumPassUsers,
      atRiskPayingUsers,
      dbSize,
      feedbackCampaign,
      feedbackResponseCount,
      feedbackRequiredUsers,
      goals,
      webhookFailures24h,
      paymentFailed7d,
      webhookRecent,
      upgradeClicks7d,
      manageClicks7d,
      exports7d,
      reconcileErrors24h,
      latestReconcile,
      alertsSent24h
    ] = await Promise.all([
      // Only count signed-up users (email-based), not anonymous device IDs.
      query(`select count(*)::int as count from user_profiles where email is not null and btrim(email) <> ''`),
      query(`select count(*)::int as count from food_entries`),
      query(`select count(*)::int as count from food_entries_archive`),
      query(`select count(*)::int as count from daily_weights`),
      query(`select count(*)::int as count from daily_summaries`),
      query(`select count(*)::int as count from daily_summaries_archive`),
      query(`select count(distinct user_id)::int as count from food_entries where entry_date >= current_date - 6`),
      query(`select count(*)::int as count from user_profiles where plan_tier='premium' and subscription_status in ('active','trialing')`),
      query(`select count(*)::int as count from user_profiles where premium_pass=true and (premium_pass_expires_at is null or premium_pass_expires_at > now())`),
      query(`select count(*)::int as count from user_profiles where plan_tier='premium' and subscription_status in ('past_due','unpaid','incomplete')`),
      query(`select pg_database_size(current_database())::bigint as bytes`),
      query(`select id, title, question, is_active, activated_at, deactivated_at from feedback_campaigns order by id desc limit 1`),
      query(`select count(*)::int as count from feedback_responses`),
      query(`
        with active as (select id from feedback_campaigns where is_active = true order by id desc limit 1)
        select case when exists (select 1 from active) then (
          select count(*)::int from user_profiles u where not exists (
            select 1 from feedback_responses r where r.user_id = u.user_id and r.campaign_id = (select id from active)
          )
        ) else 0 end as count
      `),
      query(`
        select weekly_active_goal, paying_users_goal,
               free_food_entries_per_day, free_ai_actions_per_day, free_history_days,
               monthly_price_usd, yearly_price_usd,
               monthly_upgrade_url, yearly_upgrade_url, manage_subscription_url
        from app_admin_settings where singleton=true limit 1
      `),
      query(`select count(*)::int as count from stripe_webhook_events where processed=false and received_at >= now() - interval '24 hours'`),
      query(`select count(*)::int as count from stripe_webhook_events where event_type='invoice.payment_failed' and received_at >= now() - interval '7 days'`),
      query(`
        select stripe_event_id, event_type, received_at, processed, process_result, error_message, user_id, subscription_id, subscription_status
        from stripe_webhook_events
        order by received_at desc
        limit 15
      `),
      query(`select count(*)::int as count from app_events where event_name='upgrade_click' and created_at >= now() - interval '7 days'`),
      query(`select count(*)::int as count from app_events where event_name='manage_subscription_click' and created_at >= now() - interval '7 days'`),
      query(`select count(*)::int as count from app_events where event_name='export_data_click' and created_at >= now() - interval '7 days'`),
      query(`select coalesce(sum(errors),0)::int as count from subscription_reconcile_runs where created_at >= now() - interval '24 hours'`),
      query(`select created_at, checked, updated, errors from subscription_reconcile_runs order by created_at desc limit 1`),
      query(`select count(*)::int as count from alert_notifications where created_at >= now() - interval '24 hours' and delivered=true`)
    ]);

    const cfg = goals.rows[0] || {};
    const weeklyGoal = Number(cfg.weekly_active_goal || DEFAULT_WAU_GOAL);
    const payingGoal = Number(cfg.paying_users_goal || DEFAULT_PAYING_GOAL);
    const wau = Number(activeUsers7d.rows[0]?.count || 0);
    const paid = Number(payingUsers.rows[0]?.count || 0);

    return json(200, {
      users_total: users.rows[0]?.count || 0,
      active_users_7d: wau,
      paying_users_total: paid,
      premium_pass_users_total: premiumPassUsers.rows[0]?.count || 0,
      at_risk_paying_users_total: atRiskPayingUsers.rows[0]?.count || 0,
      weekly_active_goal: weeklyGoal,
      paying_users_goal: payingGoal,
      weekly_active_goal_progress_pct: Math.min(100, Math.round((wau / Math.max(1, weeklyGoal)) * 100)),
      paying_users_goal_progress_pct: Math.min(100, Math.round((paid / Math.max(1, payingGoal)) * 100)),
      free_food_entries_per_day: Number(cfg.free_food_entries_per_day || DEFAULTS.free_food_entries_per_day),
      free_ai_actions_per_day: Number(cfg.free_ai_actions_per_day || DEFAULTS.free_ai_actions_per_day),
      free_history_days: Number(cfg.free_history_days || DEFAULTS.free_history_days),
      monthly_price_usd: Number(cfg.monthly_price_usd || DEFAULTS.monthly_price_usd),
      yearly_price_usd: Number(cfg.yearly_price_usd || DEFAULTS.yearly_price_usd),
      monthly_upgrade_url: cfg.monthly_upgrade_url || DEFAULTS.monthly_upgrade_url,
      yearly_upgrade_url: cfg.yearly_upgrade_url || DEFAULTS.yearly_upgrade_url,
      manage_subscription_url: cfg.manage_subscription_url || null,
      webhook_failures_24h: webhookFailures24h.rows[0]?.count || 0,
      payment_failed_7d: paymentFailed7d.rows[0]?.count || 0,
      recent_webhook_events: webhookRecent.rows,
      upgrade_clicks_7d: upgradeClicks7d.rows[0]?.count || 0,
      manage_subscription_clicks_7d: manageClicks7d.rows[0]?.count || 0,
      export_clicks_7d: exports7d.rows[0]?.count || 0,
      reconcile_errors_24h: reconcileErrors24h.rows[0]?.count || 0,
      latest_reconcile_run: latestReconcile.rows[0] || null,
      alerts_sent_24h: alertsSent24h.rows[0]?.count || 0,
      food_entries_hot: foodEntries.rows[0]?.count || 0,
      food_entries_archive: foodEntriesArchive.rows[0]?.count || 0,
      daily_weights: weights.rows[0]?.count || 0,
      daily_summaries_hot: summaries.rows[0]?.count || 0,
      daily_summaries_archive: summariesArchive.rows[0]?.count || 0,
      feedback_responses_total: feedbackResponseCount.rows[0]?.count || 0,
      users_pending_feedback: feedbackRequiredUsers.rows[0]?.count || 0,
      db_size_bytes: Number(dbSize.rows[0]?.bytes || 0),
      latest_feedback_campaign: feedbackCampaign.rows[0] || null
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return json(400, { error: 'Admin/stat tables are missing. Run sql/005_admin_feedback.sql, sql/007_admin_goals_and_passes.sql, sql/008_growth_billing_upgrades.sql, and sql/009_reliability_growth.sql, and sql/010_scheduled_reconcile_alerts.sql.' });
    }
    if (e && e.code === '42703') {
      return json(400, { error: 'Billing/config columns are missing. Run sql/006_billing_limits.sql and sql/008_growth_billing_upgrades.sql.' });
    }
    return json(500, { error: 'Could not load admin stats' });
  }
};
