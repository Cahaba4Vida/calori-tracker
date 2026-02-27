(function initAdminRender(global) {
  function renderGoalProgress(el, stats) {
    const wau = Number(stats.active_users_7d || 0);
    const paid = Number(stats.paying_users_total || 0);
    const wauGoal = Math.max(1, Number(stats.weekly_active_goal || 500));
    const paidGoal = Math.max(1, Number(stats.paying_users_goal || 30));
    const wauPct = Math.min(100, Math.round((wau / wauGoal) * 100));
    const paidPct = Math.min(100, Math.round((paid / paidGoal) * 100));

    el('wauGoalTarget').innerText = String(wauGoal);
    el('paidGoalTarget').innerText = String(paidGoal);
    el('wauGoalInput').value = String(wauGoal);
    el('paidGoalInput').value = String(paidGoal);
    el('freeFoodLimitInput').value = String(stats.free_food_entries_per_day || 5);
    el('freeAiLimitInput').value = String(stats.free_ai_actions_per_day || 3);
    el('freeHistoryDaysInput').value = String(stats.free_history_days || 20);
    el('monthlyPriceInput').value = String(stats.monthly_price_usd || 5);
    el('yearlyPriceInput').value = String(stats.yearly_price_usd || 50);
    el('monthlyUpgradeUrlInput').value = stats.monthly_upgrade_url || '';
    el('yearlyUpgradeUrlInput').value = stats.yearly_upgrade_url || '';
    el('manageSubUrlInput').value = stats.manage_subscription_url || '';
    el('wauGoalBar').style.width = `${wauPct}%`;
    el('paidGoalBar').style.width = `${paidPct}%`;
    el('wauGoalLabel').innerText = `${wau} / ${wauGoal} (${wauPct}%)`;
    el('paidGoalLabel').innerText = `${paid} / ${paidGoal} (${paidPct}%)`;
    el('billingHealthSummary').innerText = `At-risk paying users: ${stats.at_risk_paying_users_total || 0} • Payment failed (7d): ${stats.payment_failed_7d || 0} • Webhook failures (24h): ${stats.webhook_failures_24h || 0} • Reconcile errors (24h): ${stats.reconcile_errors_24h || 0} • Alerts sent (24h): ${stats.alerts_sent_24h || 0} • Upgrade clicks (7d): ${stats.upgrade_clicks_7d || 0} • Manage clicks (7d): ${stats.manage_subscription_clicks_7d || 0}`;
    el('webhookEventsOut').innerText = JSON.stringify(stats.recent_webhook_events || [], null, 2);

    // DB usage (DB1)
    try {
      const bytes = Number(stats.db_size_bytes || 0);
      const gb = (bytes / 1024 / 1024 / 1024);
      const gbRounded = Math.round(gb * 1000) / 1000;
      const maxGb = Number(stats.max_db_size_gb || 0.49);
      const pct = maxGb > 0 ? Math.min(100, (gb / maxGb) * 100) : 0;
      const pctRounded = Math.round(pct * 10) / 10;
      const urgentAt = Number(stats.urgent_db_threshold_gb || 0.4);
      const isUrgent = gb >= urgentAt;

      const bar = el('dbUsageBar');
      if (bar) {
        bar.style.width = `${pct}%`;
        bar.classList.toggle('urgent', isUrgent);
        bar.classList.toggle('warn', !isUrgent && pct >= 85);
      }

      const label = el('dbUsageLabel');
      if (label) {
        label.innerText = `${gbRounded} / ${maxGb} GB (${pctRounded}%)`;
      }

      const status = el('dbUsageStatus');
      if (status) {
        status.innerText = isUrgent ? `URGENT ≥ ${urgentAt} GB` : (pct >= 85 ? 'Warning' : 'OK');
      }

      const banner = el('dbUrgentBanner');
      if (banner) {
        banner.classList.toggle('hidden', !isUrgent);
        banner.classList.toggle('urgent', isUrgent);
        if (isUrgent) {
          banner.innerText = `🚨 URGENT: DB1 usage is ${gbRounded} GB (≥ ${urgentAt} GB). Consider splitting to DB2 soon.`;
        }
      }
    } catch (_) {}
  }

  global.AdminRender = { renderGoalProgress };
})(window);
