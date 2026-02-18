(function initAppBilling(global) {
  function createBillingController(deps) {
    const { api, authHeaders, el, setStatus, getCurrentUser } = deps;
    let billingState = null;
    let nearLimitEventSent = false;

    function trackEvent(eventName, eventProps = {}) {
      if (!getCurrentUser()) return;
      fetch('/api/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ event_name: eventName, event_props: eventProps })
      }).catch(() => {});
    }

    function renderBillingStatus() {
      const tier = billingState?.plan_tier === 'premium' ? 'Premium' : 'Free';
      const limits = billingState?.limits;
      const usage = billingState?.usage_today;

      const tierEl = el('planTierValue');
      const usageEl = el('planUsageValue');
      const limitsEl = el('planLimitsValue');
      const upgradeHint = el('upgradeHint');
      const monthlyBtn = el('upgradeMonthlyBtn');
      const yearlyBtn = el('upgradeYearlyBtn');
      const exportBtn = el('exportDataBtn');
      const manageBtn = el('manageSubscriptionBtn');

      if (tierEl) tierEl.innerText = tier;
      if (usageEl) usageEl.innerText = usage ? `Food entries today: ${usage.food_entries_today || 0} • AI actions today: ${usage.ai_actions_today || 0}` : '—';
      if (limitsEl) limitsEl.innerText = limits ? `Food/day: ${limits.food_entries_per_day ?? 'Unlimited'} • AI/day: ${limits.ai_actions_per_day ?? 'Unlimited'} • History: ${limits.history_days ?? 'Unlimited'} days` : '—';
      if (monthlyBtn && billingState?.monthly_price_usd) monthlyBtn.innerText = `Upgrade Monthly ($${billingState.monthly_price_usd})`;
      if (yearlyBtn && billingState?.yearly_price_usd) yearlyBtn.innerText = `Upgrade Yearly ($${billingState.yearly_price_usd})`;

      if (upgradeHint) {
        upgradeHint.classList.toggle('hidden', !!billingState?.is_premium);
        upgradeHint.innerText = billingState?.is_premium
          ? ''
          : 'Free plan includes 5 food entries/day, 5 AI actions/day, 20-day history, and no export. Upgrade for unlimited access.';
      }

      if (!billingState?.is_premium && usage) {
        const foodLeft = Math.max(0, Number(limits?.food_entries_per_day || 0) - Number(usage.food_entries_today || 0));
        const aiLeft = Math.max(0, Number(limits?.ai_actions_per_day || 0) - Number(usage.ai_actions_today || 0));
        const near = (foodLeft <= 2) || (aiLeft <= 1);
        if (near && upgradeHint) {
          upgradeHint.classList.remove('hidden');
          upgradeHint.innerText = `You're close to today's free limit (${foodLeft} food entries left, ${aiLeft} AI actions left). Upgrade for unlimited usage.`;
          if (!nearLimitEventSent) {
            nearLimitEventSent = true;
            trackEvent('near_limit_warning_shown', { food_left: foodLeft, ai_left: aiLeft });
          }
        }
      }

      if (exportBtn) exportBtn.disabled = !billingState?.is_premium;
      if (manageBtn) manageBtn.disabled = !billingState?.is_premium;
    }

    async function loadBillingStatus() {
      try {
        billingState = await api('billing-status');
      } catch {
        billingState = null;
      }
      renderBillingStatus();
    }

    async function startUpgradeCheckout(interval) {
      try {
        setStatus('Creating Stripe checkout link…');
        trackEvent('upgrade_click', { interval });
        const out = await api('create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval }) });
        if (out?.url) {
          window.location.href = out.url;
          return;
        }
        setStatus('Upgrade link unavailable. Please try again.');
      } catch (e) {
        setStatus(e.message || 'Could not start checkout');
      }
    }

    async function openManageSubscription() {
      try {
        trackEvent('manage_subscription_click');
        const out = await api('manage-subscription', { method: 'POST' });
        if (out?.url) {
          window.location.href = out.url;
          return;
        }
        setStatus('Manage subscription is not available right now.');
      } catch (e) {
        setStatus(e.message || 'Could not open subscription management');
      }
    }

    async function exportMyData() {
      try {
        setStatus('Preparing export…');
        trackEvent('export_data_click', { format: 'json' });
        const data = await api('export-data');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `calori-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus('Export downloaded.');
      } catch (e) {
        setStatus(e.message || 'Could not export data');
      }
    }

    return {
      loadBillingStatus,
      startUpgradeCheckout,
      openManageSubscription,
      exportMyData
    };
  }

  global.AppBilling = { createBillingController };
})(window);
