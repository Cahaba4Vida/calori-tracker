(function initAdminApi(global) {
  function createAdminApi({ getToken }) {
    async function adminApi(path, opts = {}) {
      const token = getToken();
      const headers = { ...(opts.headers || {}), 'x-admin-token': token };
      const r = await fetch('/api/' + path, { ...opts, headers });
      const txt = await r.text();
      let body = null;
      try { body = txt ? JSON.parse(txt) : null; } catch { body = { raw: txt }; }
      if (!r.ok) throw new Error((body && (body.error || body.message)) ? (body.error || body.message) : ('Request failed: ' + r.status));
      return body;
    }

    return { adminApi };
  }

  global.AdminApi = { createAdminApi };
})(window);

;
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
      if (label) label.innerText = `${gbRounded} / ${maxGb} GB (${pctRounded}%)`;
      const status = el('dbUsageStatus');
      if (status) status.innerText = isUrgent ? `URGENT ≥ ${urgentAt} GB` : (pct >= 85 ? 'Warning' : 'OK');

      // Estimate days until urgent threshold using last 7 days DB growth rate (stored locally in admin browser)
      try {
        const ETA_KEY = 'db_usage_samples_v1';
        const now = Date.now();
        let samples = [];
        try { samples = JSON.parse(localStorage.getItem(ETA_KEY) || '[]') || []; } catch { samples = []; }
        // prune > 8 days old (buffer) and invalid
        const cutoff = now - (8 * 24 * 60 * 60 * 1000);
        samples = samples.filter(s => s && typeof s.t === 'number' && typeof s.gb === 'number' && s.t >= cutoff);
        // de-duplicate: if last sample within 1h, replace it
        if (samples.length && (now - samples[samples.length - 1].t) < (60 * 60 * 1000)) {
          samples[samples.length - 1] = { t: now, gb };
        } else {
          samples.push({ t: now, gb });
        }
        // keep at most 200 samples
        if (samples.length > 200) samples = samples.slice(samples.length - 200);
        localStorage.setItem(ETA_KEY, JSON.stringify(samples));

        const etaEl = el('dbUsageEta');
        if (etaEl) {
          // use last 7 days window for slope
          const winCutoff = now - (7 * 24 * 60 * 60 * 1000);
          const win = samples.filter(s => s.t >= winCutoff);
          if (win.length >= 2) {
            const first = win[0];
            const last = win[win.length - 1];
            const spanDays = (last.t - first.t) / (24 * 60 * 60 * 1000);
            const deltaGb = last.gb - first.gb;
            const rate = spanDays > 0 ? (deltaGb / spanDays) : 0; // GB/day
            if (spanDays >= 0.25 && rate > 0.0001) {
              const daysTo = (urgentAt - gb) / rate;
              const rateStr = `${Math.round(rate * 1000) / 1000} GB/day`;
              if (daysTo <= 0) {
                etaEl.innerText = `At or above ${urgentAt} GB (7d rate: ${rateStr})`;
              } else if (daysTo < 1) {
                const hours = Math.max(1, Math.round(daysTo * 24));
                etaEl.innerText = `Est. ${hours}h to ${urgentAt} GB (7d rate: ${rateStr})`;
              } else {
                etaEl.innerText = `Est. ${Math.round(daysTo * 10) / 10} days to ${urgentAt} GB (7d rate: ${rateStr})`;
              }
            } else {
              etaEl.innerText = 'Est. time to 0.40 GB: need more history';
            }
          } else {
            etaEl.innerText = 'Est. time to 0.40 GB: collecting history…';
          }
        }
      } catch {}


      const banner = el('dbUrgentBanner');
      if (banner) {
        banner.classList.toggle('hidden', !isUrgent);
        banner.classList.toggle('urgent', isUrgent);
        if (isUrgent) banner.innerText = `🚨 URGENT: DB1 usage is ${gbRounded} GB (≥ ${urgentAt} GB). Consider splitting to DB2 soon.`;
      }
    } catch (_) {}
  }

  global.AdminRender = { renderGoalProgress };
})(window);

;
const el = (id) => document.getElementById(id);
    const ADMIN_TOKEN_KEY = 'adminDashToken';
    let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
    if (adminToken) el('adminTokenInput').value = adminToken;
    const adminClient = window.AdminApi.createAdminApi({ getToken: () => adminToken });

    function setStatus(node, message) { node.innerText = message || ''; }
    function setAuthorized(isAuthorized) { el('adminProtected').classList.toggle('hidden', !isAuthorized); }
    function saveToken(value) {
      adminToken = value.trim();
      if (adminToken) localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
      else localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
    async function loadStats(options = {}) {
      const { throwOnError = false } = options;
      try {
        setStatus(el('adminStatus'), 'Loading…');
        const stats = await adminClient.adminApi('admin-stats');
        window.AdminRender.renderGoalProgress(el, stats);
        el('statsOut').innerText = JSON.stringify(stats, null, 2);
        setStatus(el('adminStatus'), 'Stats loaded.');
      } catch (e) {
        setStatus(el('adminStatus'), e.message || String(e));
        if (throwOnError) throw e;
      }
    }

    async function saveGoals() {
      try {
        setStatus(el('goalsStatus'), 'Saving goals…');
        const weekly_active_goal = Number(el('wauGoalInput').value);
        const paying_users_goal = Number(el('paidGoalInput').value);
        const free_food_entries_per_day = Number(el('freeFoodLimitInput').value);
        const free_ai_actions_per_day = Number(el('freeAiLimitInput').value);
        const free_history_days = Number(el('freeHistoryDaysInput').value);
        const monthly_price_usd = Number(el('monthlyPriceInput').value);
        const yearly_price_usd = Number(el('yearlyPriceInput').value);
        const monthly_upgrade_url = el('monthlyUpgradeUrlInput').value.trim() || null;
        const yearly_upgrade_url = el('yearlyUpgradeUrlInput').value.trim() || null;
        const manage_subscription_url = el('manageSubUrlInput').value.trim() || null;
        await adminClient.adminApi('admin-goals-set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weekly_active_goal,
            paying_users_goal,
            free_food_entries_per_day,
            free_ai_actions_per_day,
            free_history_days,
            monthly_price_usd,
            yearly_price_usd,
            monthly_upgrade_url,
            yearly_upgrade_url,
            manage_subscription_url
          })
        });
        setStatus(el('goalsStatus'), 'Goals saved.');
        await loadStats();
      } catch (e) {
        setStatus(el('goalsStatus'), e.message || String(e));
      }
    }

    async function setPass(mode) {
      try {
        setStatus(el('passStatus'), mode === 'grant' ? 'Granting pass…' : 'Revoking pass…');
        const out = await adminClient.adminApi('admin-pass-grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            identifier: el('passIdentifierInput').value.trim(),
            expires_at: el('passExpiresInput').value.trim() || null,
            note: el('passNoteInput').value.trim() || null
          })
        });
        setStatus(el('passStatus'), `${mode === 'grant' ? 'Pass granted' : 'Pass revoked'} for ${out.email || out.user_id}.`);
        await loadStats();
      } catch (e) {
        setStatus(el('passStatus'), e.message || String(e));
      }
    }



    async function grantTrial() {
      try {
        setStatus(el('passStatus'), 'Granting trial pass…');
        const days = Number(el('trialDaysInput').value || '7');
        const out = await adminClient.adminApi('admin-pass-trial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: el('passIdentifierInput').value.trim(), days })
        });
        setStatus(el('passStatus'), `Trial granted for ${out.email || out.user_id} (${out.trial_days} days).`);
        await loadStats();
      } catch (e) {
        setStatus(el('passStatus'), e.message || String(e));
      }
    }

    async function grantUnlimited() {
      try {
        setStatus(el('passStatus'), 'Granting unlimited premium…');
        const out = await adminClient.adminApi('admin-pass-grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'grant',
            identifier: el('passIdentifierInput').value.trim(),
            expires_at: null,
            note: (el('passNoteInput').value.trim() || null) || 'unlimited_override'
          })
        });
        setStatus(el('passStatus'), `Unlimited premium granted for ${out.email || out.user_id}.`);
        await loadStats();
      } catch (e) {
        setStatus(el('passStatus'), e.message || String(e));
      }
    }




    async function reconcileSubscriptions() {
      try {
        setStatus(el('reconcileStatus'), 'Reconciling subscriptions…');
        const out = await adminClient.adminApi('admin-reconcile-subscriptions', { method: 'POST' });
        setStatus(el('reconcileStatus'), `Done. Checked ${out.checked || 0}, updated ${out.updated || 0}.`);
        await loadStats();
      } catch (e) {
        setStatus(el('reconcileStatus'), e.message || String(e));
      }
    }
    async function authorize() {
      const candidate = el('adminTokenInput').value.trim();
      if (!candidate) {
        setAuthorized(false);
        setStatus(el('adminStatus'), 'Paste a valid admin token first.');
        return;
      }
      try {
        setStatus(el('adminStatus'), 'Authorizing…');
        saveToken(candidate);
        await loadStats({ throwOnError: true });
        setAuthorized(true);
        setStatus(el('adminStatus'), 'Authorized. You can now edit the admin page.');
      } catch (e) {
        saveToken('');
        setAuthorized(false);
        setStatus(el('adminStatus'), e.message || String(e));
      }
    }

    function clearToken() {
      saveToken('');
      el('adminTokenInput').value = '';
      setAuthorized(false);
      setStatus(el('adminStatus'), 'Admin token cleared.');
    }

    async function getInsights() {
      try {
        setStatus(el('insightsStatus'), 'Generating insights…');
        const out = await adminApi('admin-ai-insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: el('insightsQuestionInput').value.trim() }) });
        el('insightsOut').innerText = out.insights || 'No insights generated.';
        setStatus(el('insightsStatus'), 'Insights ready.');
      } catch (e) { setStatus(el('insightsStatus'), e.message || String(e)); }
    }

    async function sendCampaign() {
      try {
        setStatus(el('campaignStatus'), 'Sending…');
        const body = {
          mode: 'activate',
          title: el('campaignTitleInput').value.trim(),
          question: el('campaignQuestionInput').value.trim(),
          placeholder: el('campaignPlaceholderInput').value.trim(),
          submit_label: el('campaignSubmitLabelInput').value.trim()
        };
        const out = await adminApi('admin-feedback-broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        setStatus(el('campaignStatus'), `Mandatory feedback form sent (campaign #${out?.campaign?.id || 'new'}).`);
        await loadStats();
      } catch (e) { setStatus(el('campaignStatus'), e.message || String(e)); }
    }

    async function disableCampaign() {
      try {
        setStatus(el('campaignStatus'), 'Turning off…');
        await adminApi('admin-feedback-broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'deactivate' }) });
        setStatus(el('campaignStatus'), 'Feedback lock disabled.');
        await loadStats();
      } catch (e) { setStatus(el('campaignStatus'), e.message || String(e)); }
    }

    el('authorizeBtn').onclick = () => authorize();
    el('clearTokenBtn').onclick = () => clearToken();
    el('saveGoalsBtn').onclick = () => saveGoals();
    el('grantPassBtn').onclick = () => setPass('grant');
    el('grantUnlimitedBtn').onclick = () => grantUnlimited();
    el('grantTrialBtn').onclick = () => grantTrial();
    el('revokePassBtn').onclick = () => setPass('revoke');
    el('reconcileSubsBtn').onclick = () => reconcileSubscriptions();
    el('getInsightsBtn').onclick = () => getInsights();
    el('broadcastFeedbackBtn').onclick = () => sendCampaign();
    el('disableFeedbackBtn').onclick = () => disableCampaign();
    authorize();


// --- Admin UX upgrades (tabs, user lookup, overrides, audit, safer actions) ---
(function initAdminUxUpgrades() {
  let selectedUser = null;

  function showToast(message, type = 'success', timeoutMs = 3500) {
    const t = el('adminToast');
    if (!t) return;
    t.className = 'toast ' + (type || '');
    t.innerText = message || '';
    t.classList.remove('hidden');
    if (timeoutMs) {
      window.clearTimeout(t._hideTimer);
      t._hideTimer = window.setTimeout(() => t.classList.add('hidden'), timeoutMs);
    }
  }

  function setActiveTab(tab) {
    document.querySelectorAll('.tabBtn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    ['users','dashboard','feedback'].forEach((k) => {
      const p = el('tab_' + k);
      if (p) p.classList.toggle('hidden', k !== tab);
    });
    if (tab === 'dashboard') { loadDashboardMetrics(); }
    if (tab === 'feedback') { ensureTodosLoaded(); ensureFeedbackLoaded(); }    try { location.hash = tab; } catch {}
  }

  function moveLegacyCards() {
    const legacy = el('legacyAdminCards');
    if (!legacy) return;
    const cards = Array.from(legacy.querySelectorAll(':scope > section.card'));
    const mapTab = (title) => {
      const t = (title || '').toLowerCase();
      if (t.includes('reconcile') || t.includes('billing') || t.includes('subscription')) return 'billing';
      if (t.includes('ai insights') || t.includes('growth goals') || t.includes('stats') || t.includes('goal')) return 'insights';
      if (t.includes('feedback') || t.includes('retention') || t.includes('broadcast') || t.includes('export')) return 'ops';
      if (t.includes('premium pass') || t.includes('access')) return 'users';
      return 'insights';
    };
    cards.forEach((card) => {
      const title = card.querySelector('h2')?.innerText || '';
      const tab = mapTab(title);
      const panel = el('tab_' + tab);
      if (panel) panel.appendChild(card);
    });

    // Put advanced tools behind a native accordion in Ops
    const ops = el('tab_ops');
    if (ops) {
      const advanced = document.createElement('details');
      advanced.className = 'card';
      advanced.open = false;
      const sum = document.createElement('summary');
      sum.innerText = 'Advanced tools';
      sum.style.fontWeight = '700';
      advanced.appendChild(sum);

      // Move remaining ops cards (except any that are already user-facing) into advanced.
      const opsCards = Array.from(ops.querySelectorAll(':scope > section.card'));
      opsCards.forEach((c) => advanced.appendChild(c));
      ops.appendChild(advanced);
    }
  }

  // Dashboard metrics (30d trends + linear projection)
  function fmtInt(n) { return (n == null) ? '—' : String(Math.round(Number(n))); }

  function drawLineChart(canvas, points, opts = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padL = 40, padR = 10, padT = 10, padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, w, h);

    const vals = (points || []).map(p => Number(p || 0));
    const maxV = Math.max(1, ...vals);
    const minV = Math.min(0, ...vals);

    function x(i) { return padL + (i / Math.max(1, vals.length - 1)) * plotW; }
    function y(v) { return padT + (1 - ((v - minV) / (maxV - minV))) * plotH; }

    // axes
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // y labels
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(String(Math.round(maxV)), 6, padT + 12);
    ctx.fillText(String(Math.round(minV)), 6, padT + plotH);

    // line
    ctx.strokeStyle = '#d6b15f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const xx = x(i);
      const yy = y(v);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();

    // points
    ctx.fillStyle = '#d6b15f';
    vals.forEach((v, i) => {
      const xx = x(i);
      const yy = y(v);
      ctx.beginPath();
      ctx.arc(xx, yy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // x labels
    if (opts.firstLabel && opts.lastLabel) {
      ctx.fillStyle = '#9a9a9a';
      ctx.fillText(opts.firstLabel, padL, h - 10);
      const lastW = ctx.measureText(opts.lastLabel).width;
      ctx.fillText(opts.lastLabel, w - padR - lastW, h - 10);
    }
  }

  async function loadDashboardMetrics(options = {}) {
    const { throwOnError = false } = options;
    try {
      setStatus(el('dashStatus'), 'Loading…');
      const data = await adminClient.adminApi('admin-dashboard-metrics');

      el('kpiTotalUsers').innerText = fmtInt(data?.totals?.total_users);
      el('kpiNewUsers7d').innerText = fmtInt(data?.totals?.new_users_7d);
      el('kpiDauToday').innerText = fmtInt(data?.totals?.dau_today);
      el('kpiWau').innerText = fmtInt(data?.totals?.wau);
      el('kpiEntriesToday').innerText = fmtInt(data?.totals?.entries_today);
      el('kpiAiToday').innerText = fmtInt(data?.totals?.ai_actions_today);

      const series = data?.series || [];
      const firstDay = series[0]?.day || '';
      const lastDay = series[series.length - 1]?.day || '';

      drawLineChart(el('chartSignups'), series.map(x => Number(x.signups || 0)), { firstLabel: firstDay, lastLabel: lastDay });
      drawLineChart(el('chartDau'), series.map(x => Number(x.dau || 0)), { firstLabel: firstDay, lastLabel: lastDay });
      drawLineChart(el('chartEntries'), series.map(x => Number(x.entries || 0)), { firstLabel: firstDay, lastLabel: lastDay });

      const pS = data?.projections?.signups;
      const pD = data?.projections?.dau;
      const pE = data?.projections?.entries;
      el('projSignupsText').innerText = pS ? `Next 30d: ~${fmtInt(pS.next_30d_sum)} (slope ${pS.slope_per_day}/day)` : '—';
      el('projDauText').innerText = pD ? `Next 30d avg/day: ~${pD.next_30d_avg_per_day} (slope ${pD.slope_per_day}/day)` : '—';
      el('projEntriesText').innerText = pE ? `Next 30d: ~${fmtInt(pE.next_30d_sum)} (slope ${pE.slope_per_day}/day)` : '—';

      setStatus(el('dashStatus'), 'Loaded.');
    } catch (e) {
      setStatus(el('dashStatus'), e.message || String(e));
      if (throwOnError) throw e;
    }
  }

  // Feedback inbox
  let _feedbackLoaded = false;
  async function ensureFeedbackLoaded() {
    if (_feedbackLoaded) return;
    _feedbackLoaded = true;
    await loadFeedbackList();
  }

  async function loadFeedbackList(options = {}) {
    const { throwOnError = false } = options;
    try {
      const days = Number(el('feedbackRangeSelect')?.value || 30);
      setStatus(el('feedbackListStatus'), 'Loading…');
      const data = await adminClient.adminApi(`admin-feedback-list?days=${encodeURIComponent(days)}`);
      const rows = data?.responses || [];
      const body = el('feedbackTableBody');
      if (!body) return;

      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="3" class="muted">No feedback in this range.</td></tr>`;
      } else {
        body.innerHTML = rows.map((r) => {
          const ts = (r.submitted_at || '').slice(0, 19).replace('T', ' ');
          const email = r.email || '(unknown)';
          const txt = String(r.response_text || '').replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
          return `<tr><td>${ts}</td><td>${email}</td><td>${txt}</td></tr>`;
        }).join('');
      }

      setStatus(el('feedbackListStatus'), `Loaded ${rows.length} responses (last ${days} days).`);
    } catch (e) {
      setStatus(el('feedbackListStatus'), e.message || String(e));
      if (throwOnError) throw e;
    }
  }

  function renderSelectedUser() {
    const box = el('userCard');
    if (!box) return;
    if (!selectedUser) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const u = selectedUser.user || {};
    const ent = selectedUser.entitlements || {};
    const usage = selectedUser.usage_today || {};
    const devices = selectedUser.devices || {};
    const premium = ent.is_premium ? 'Premium' : 'Free';
    const src = ent.premium_source || 'none';

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="grid2">
        <div><div class="k">Email</div><div class="v">${u.email || '<span class="muted">—</span>'}</div></div>
        <div><div class="k">User ID</div><div class="v">${u.user_id}</div></div>
        <div><div class="k">Entitlement</div><div class="v">${premium} <span class="muted">(${src})</span></div></div>
        <div><div class="k">Pass expires</div><div class="v">${u.premium_pass_expires_at || (u.premium_pass ? 'Unlimited' : '—')}</div></div>
        <div><div class="k">AI actions today</div><div class="v">${usage.ai_actions ?? 0}</div></div>
        <div><div class="k">Food entries today</div><div class="v">${usage.food_entries ?? 0}</div></div>
        <div><div class="k">Linked devices</div><div class="v">${devices.count ?? 0}</div></div>
        <div><div class="k">Subscription</div><div class="v">${u.subscription_status || 'inactive'}</div></div>
      </div>
      <div class="row" style="margin-top:10px;">
        <button id="copyUserIdBtn" class="secondaryBtn">Copy user_id</button>
        <button id="copyEmailBtn" class="secondaryBtn">Copy email</button>
      </div>
    `;
    const copy = async (v) => {
      try { await navigator.clipboard.writeText(v || ''); showToast('Copied.', 'success', 1200); } catch { showToast('Copy failed.', 'error'); }
    };
    el('copyUserIdBtn')?.addEventListener('click', () => copy(u.user_id));
    el('copyEmailBtn')?.addEventListener('click', () => copy(u.email || ''));
  }

  async function lookupUser() {
    const q = el('userLookupInput')?.value?.trim();
    if (!q) return showToast('Enter an email, user_id, or device_id.', 'warn');
    try {
      setStatus(el('userLookupStatus'), 'Looking up…');
      const out = await adminClient.adminApi('admin-user-lookup', { method: 'GET' , headers: { }, });
      // adminApi doesn't support query params directly; fallback:
      // We'll call fetch manually so we can pass querystring.
    } catch (e) {
      // no-op
    }
  }

  async function lookupUser2() {
    const q = el('userLookupInput')?.value?.trim();
    if (!q) return showToast('Enter an email, user_id, or device_id.', 'warn');
    try {
      setStatus(el('userLookupStatus'), 'Looking up…');
      const token = adminToken;
      const r = await fetch(`/api/admin-user-lookup?identifier=${encodeURIComponent(q)}`, {
        method: 'GET',
        headers: { 'x-admin-token': token }
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Lookup failed');
      selectedUser = data;
      setStatus(el('userLookupStatus'), `Selected: ${data.user?.email || data.user?.user_id}`);
      renderSelectedUser();
      await refreshAudit(false);
      showToast('User loaded.', 'success', 1500);
    } catch (e) {
      selectedUser = null;
      renderSelectedUser();
      setStatus(el('userLookupStatus'), e.message || String(e));
      showToast(e.message || String(e), 'error');
    }
  }

  function requireSelectedUser() {
    if (!selectedUser?.user?.user_id) {
      showToast('Lookup and select a user first.', 'warn');
      throw new Error('No selected user');
    }
    return selectedUser.user;
  }

  async function grantOverride() {
    const u = requireSelectedUser();
    const dur = el('overrideDuration')?.value || '7';
    const note = (el('overrideNote')?.value || '').trim();
    if (dur === 'unlimited') {
      if (!note) {
        showToast('Note is required for Unlimited.', 'warn');
        return;
      }
      const confirmTxt = prompt('Type UNLIMITED to confirm granting unlimited premium:');
      if (confirmTxt !== 'UNLIMITED') return;
    }
    let expiresAt = null;
    if (dur !== 'unlimited') {
      const days = Number(dur || '7');
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString();
    }

    try {
      setStatus(el('overrideStatus'), 'Granting premium…');
      const out = await adminClient.adminApi('admin-pass-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'grant',
          identifier: u.user_id,
          expires_at: expiresAt,
          note: note || (dur === 'unlimited' ? 'unlimited_override' : null)
        })
      });
      setStatus(el('overrideStatus'), `Granted premium to ${out.email || out.user_id}.`);
      showToast('Premium granted.', 'success');
      await lookupUser2();
    } catch (e) {
      setStatus(el('overrideStatus'), e.message || String(e));
      showToast(e.message || String(e), 'error');
    }
  }

  async function grantTrialFromCard() {
    const u = requireSelectedUser();
    const days = Number(prompt('Trial length in days:', '7') || '7');
    if (!Number.isFinite(days) || days <= 0) return;
    try {
      setStatus(el('overrideStatus'), 'Granting trial…');
      const out = await adminClient.adminApi('admin-pass-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: u.user_id, days })
      });
      setStatus(el('overrideStatus'), `Trial granted for ${out.email || out.user_id} (${out.trial_days} days).`);
      showToast('Trial granted.', 'success');
      await lookupUser2();
    } catch (e) {
      setStatus(el('overrideStatus'), e.message || String(e));
      showToast(e.message || String(e), 'error');
    }
  }

  async function revokeOverride() {
    const u = requireSelectedUser();
    const confirmTxt = prompt(`Type REVOKE to confirm removing admin override for ${u.email || u.user_id}:`);
    if (confirmTxt !== 'REVOKE') return;
    try {
      setStatus(el('overrideStatus'), 'Revoking override…');
      const out = await adminClient.adminApi('admin-pass-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'revoke', identifier: u.user_id })
      });
      setStatus(el('overrideStatus'), `Override revoked for ${out.email || out.user_id}.`);
      showToast('Override revoked.', 'success');
      await lookupUser2();
    } catch (e) {
      setStatus(el('overrideStatus'), e.message || String(e));
      showToast(e.message || String(e), 'error');
    }
  }

  async function refreshAudit(filterToUser = null) {
    try {
      setStatus(el('auditStatus'), 'Loading…');
      const token = adminToken;
      let q = '';
      if (filterToUser === true) {
        if (selectedUser?.user?.user_id) q = `&q=${encodeURIComponent(selectedUser.user.user_id)}`;
      } else if (filterToUser === false) {
        // no filter
      } else {
        // default: if selected user exists, show filtered, else global
        if (selectedUser?.user?.user_id) q = `&q=${encodeURIComponent(selectedUser.user.user_id)}`;
      }

      const r = await fetch(`/api/admin-audit-list?limit=50${q}`, { headers: { 'x-admin-token': token } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to load audit');
      const items = data.items || [];
      const list = el('auditList');
      if (list) {
        list.innerHTML = items.map((it) => {
          const details = it.details ? JSON.stringify(it.details, null, 2) : '';
          return `
            <div class="auditItem">
              <div class="meta">
                <span><strong>${it.action}</strong></span>
                <span>${new Date(it.created_at).toLocaleString()}</span>
                <span class="muted">${it.target || ''}</span>
              </div>
              ${details ? `<pre>${details}</pre>` : ''}
            </div>
          `;
        }).join('');
      }
      setStatus(el('auditStatus'), `${items.length} actions`);
    } catch (e) {
      setStatus(el('auditStatus'), e.message || String(e));
    }
  }

  // =========================
  // Signed-up users list
  // =========================
  let usersCache = [];

  function fmtDate(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString(); } catch { return String(v); }
  }

  function renderUsersTable() {
    const tbody = el('usersTable')?.querySelector('tbody');
    if (!tbody) return;
    const filter = (el('usersFilter')?.value || '').trim().toLowerCase();
    const rows = (usersCache || []).filter(u => !filter || (u.email || '').toLowerCase().includes(filter));
    tbody.innerHTML = rows.map(u => {
      const goal = u.goal_weight_lbs ? `${u.goal_weight_lbs} lbs${u.goal_date ? ` by ${fmtDate(u.goal_date)}` : ''}` : '—';
      const pass = u.premium_pass ? (u.premium_pass_expires_at ? `Yes (to ${fmtDate(u.premium_pass_expires_at)})` : 'Yes (unlimited)') : 'No';
      return `
        <tr data-user-id="${u.user_id}" data-email="${(u.email || '').replace(/\"/g,'&quot;')}">
          <td>${u.email || '—'}</td>
          <td><code>${u.user_id}</code></td>
          <td>${fmtDate(u.created_at)}</td>
          <td>${u.plan_tier || u.subscription_status || 'free'}</td>
          <td>${pass}</td>
          <td>${goal}</td>
          <td>
            <button class="btnMini" data-act="edit">Edit</button>
            <button class="btnMini danger" data-act="delete">Delete</button>
          </td>
        </tr>
        <tr class="hidden" data-edit-row="${u.user_id}">
          <td colspan="7">
            <div class="inlineEdit">
              <div class="row">
                <div>
                  <label>Email</label>
                  <input data-f="email" value="${(u.email || '').replace(/\"/g,'&quot;')}" />
                </div>
                <div>
                  <label>Subscription status</label>
                  <input data-f="subscription_status" value="${(u.subscription_status || '').replace(/\"/g,'&quot;')}" placeholder="active / inactive" />
                </div>
                <div>
                  <label>Plan tier</label>
                  <input data-f="plan_tier" value="${(u.plan_tier || '').replace(/\"/g,'&quot;')}" placeholder="free / pro" />
                </div>
                <div>
                  <label>Premium pass</label>
                  <select data-f="premium_pass">
                    <option value="false" ${u.premium_pass ? '' : 'selected'}>No</option>
                    <option value="true" ${u.premium_pass ? 'selected' : ''}>Yes</option>
                  </select>
                </div>
                <div>
                  <label>Pass expires (optional)</label>
                  <input data-f="premium_pass_expires_at" value="${u.premium_pass_expires_at || ''}" placeholder="YYYY-MM-DD or ISO" />
                </div>
                <div>
                  <label>Goal weight (lbs)</label>
                  <input data-f="goal_weight_lbs" value="${u.goal_weight_lbs ?? ''}" />
                </div>
                <div>
                  <label>Goal date</label>
                  <input data-f="goal_date" value="${u.goal_date || ''}" placeholder="YYYY-MM-DD" />
                </div>
              </div>
              <div class="row" style="margin-top:10px;">
                <button class="secondaryBtn" data-act="save">Save</button>
                <button class="secondaryBtn" data-act="cancel">Cancel</button>
              </div>
              <div class="muted" data-edit-status style="margin-top:8px;"></div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Allow quick “click into” a user from the list (loads full profile into the User Lookup panel)
    tbody.querySelectorAll('tr[data-user-id]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', (e) => {
        // Don't steal clicks from action buttons or inline-edit controls
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea')) return;
        const email = tr.getAttribute('data-email') || '';
        const uid = tr.getAttribute('data-user-id') || '';
        const q = (email && email !== '—') ? email : uid;
        if (!q) return;
        const inp = el('userLookupInput');
        if (inp) inp.value = q;
        lookupUser2();
      });
    });

    tbody.querySelectorAll('button[data-act="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const uid = tr?.getAttribute('data-user-id');
        const editRow = tbody.querySelector(`tr[data-edit-row="${uid}"]`);
        editRow?.classList.toggle('hidden');
      });
    });

    tbody.querySelectorAll('button[data-act="cancel"]').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('tr')?.classList.add('hidden'));
    });

    tbody.querySelectorAll('button[data-act="save"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const editTr = btn.closest('tr');
        const uid = editTr?.getAttribute('data-edit-row');
        const box = editTr?.querySelector('.inlineEdit');
        const status = editTr?.querySelector('[data-edit-status]');
        if (!uid || !box) return;
        const payload = { user_id: uid };
        box.querySelectorAll('[data-f]').forEach(inp => {
          const k = inp.getAttribute('data-f');
          let v = inp.value;
          if (k === 'premium_pass') v = inp.value === 'true';
          if (k === 'goal_weight_lbs') v = v === '' ? null : Number(v);
          payload[k] = v === '' ? null : v;
        });
        try {
          setStatus(status, 'Saving…');
          const out = await adminClient.adminApi('admin-user-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          // Update cache
          usersCache = usersCache.map(u => u.user_id === uid ? ({ ...u, ...out.user }) : u);
          renderUsersTable();
          showToast('User updated.', 'success', 1500);
        } catch (e) {
          setStatus(status, e.message || String(e));
          showToast(e.message || String(e), 'error');
        }
      });
    });

    tbody.querySelectorAll('button[data-act="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const uid = tr?.getAttribute('data-user-id');
        const email = tr?.children?.[0]?.innerText || '';
        const confirmTxt = prompt(`Type DELETE to permanently delete ${email || uid} (including entries/weights):`);
        if (confirmTxt !== 'DELETE') return;
        try {
          await adminClient.adminApi('admin-user-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: uid })
          });
          usersCache = usersCache.filter(u => u.user_id !== uid);
          renderUsersTable();
          showToast('User deleted.', 'success', 1500);
        } catch (e) {
          showToast(e.message || String(e), 'error');
        }
      });
    });
  }

  async function loadUsers() {
    if (!adminToken) return showToast('Authorize first.', 'warn');
    try {
      setStatus(el('usersStatus'), 'Loading users…');
      const token = adminToken;
      const r = await fetch(`/api/admin-users-list?limit=500`, { headers: { 'x-admin-token': token } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to load users');
      usersCache = data.users || [];
      setStatus(el('usersStatus'), `${usersCache.length} users loaded`);
      renderUsersTable();
    } catch (e) {
      setStatus(el('usersStatus'), e.message || String(e));
      showToast(e.message || String(e), 'error');
    }
  }

  // Hook up controls
  document.querySelectorAll('.tabBtn').forEach((b) => b.addEventListener('click', () => setActiveTab(b.getAttribute('data-tab'))));
  el('userLookupBtn')?.addEventListener('click', lookupUser2);
  el('userLookupInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupUser2(); });

  el('grantOverrideBtn')?.addEventListener('click', grantOverride);
  el('grantTrialBtn')?.addEventListener('click', grantTrialFromCard);
  el('revokeOverrideBtn')?.addEventListener('click', revokeOverride);

  el('refreshAuditBtn')?.addEventListener('click', () => refreshAudit(false));
  el('filterAuditBtn')?.addEventListener('click', () => refreshAudit(true));

  el('loadUsersBtn')?.addEventListener('click', loadUsers);
  el('usersFilter')?.addEventListener('input', renderUsersTable);


  // ---- Admin Todo ----
  let todoItems = [];

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function ensureTodosLoaded() {
    try {
      const res = await adminClient.adminApi('admin-todos-list', { method: 'GET' });
      todoItems = Array.isArray(res.todos) ? res.todos : [];
      renderTodoList();
    } catch (e) {
      showToast(e.message || String(e), 'error', 2500);
    }
  }

  function renderTodoList() {
    const host = el('todoList');
    if (!host) return;
    const items = [...todoItems].sort((a,b) => {
      const pa = Number(a.priority ?? 9999);
      const pb = Number(b.priority ?? 9999);
      if (pa !== pb) return pa - pb;
      return Number(a.id) - Number(b.id);
    });
    el('todoCount').innerText = `${items.length} item${items.length===1?'':'s'}`;

    if (!items.length) {
      host.innerHTML = '<div class="muted">No items yet.</div>';
      return;
    }

    host.innerHTML = items.map((t, i) => {
      const done = !!t.done;
      const pr = Number(t.priority ?? 9999);
      return `
        <div class="row" style="align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid rgba(0,0,0,0.08);">
          <input type="checkbox" data-todo-action="toggle" data-id="${t.id}" ${done ? 'checked' : ''} />
          <input type="text" data-todo-action="editText" data-id="${t.id}" value="${escapeHtml(t.text)}" style="flex:1; ${done ? 'text-decoration:line-through; opacity:0.7;' : ''}" />
          <input type="number" min="1" step="1" data-todo-action="editPriority" data-id="${t.id}" value="${pr}" style="width:80px;" />
          <button class="btnMini" data-todo-action="up" data-id="${t.id}" title="Higher priority">↑</button>
          <button class="btnMini" data-todo-action="down" data-id="${t.id}" title="Lower priority">↓</button>
          <button class="btnMini" data-todo-action="del" data-id="${t.id}" title="Delete">✕</button>
        </div>
      `;
    }).join('');

    // Delegate actions
    host.querySelectorAll('[data-todo-action]').forEach((node) => {
      const action = node.getAttribute('data-todo-action');
      const id = Number(node.getAttribute('data-id'));
      if (action === 'toggle') {
        node.onchange = () => updateTodo(id, { done: node.checked });
      } else if (action === 'editText') {
        node.onchange = () => updateTodo(id, { text: node.value });
      } else if (action === 'editPriority') {
        node.onchange = () => updateTodo(id, { priority: Number(node.value || 1) });
      } else if (action === 'del') {
        node.onclick = () => deleteTodo(id);
      } else if (action === 'up') {
        node.onclick = () => bumpTodoPriority(id, -1);
      } else if (action === 'down') {
        node.onclick = () => bumpTodoPriority(id, +1);
      }
    });
  }

  function getTodoById(id) { return todoItems.find((t) => Number(t.id) === Number(id)); }

  async function addTodo() {
    const text = (el('todoTextInput')?.value || '').trim();
    const priority = Number(el('todoPriorityInput')?.value || 1);
    if (!text) return showToast('Enter a todo item.', 'error', 2000);
    try {
      const res = await adminClient.adminApi('admin-todos-add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, priority })
      });
      el('todoTextInput').value = '';
      todoItems = Array.isArray(res.todos) ? res.todos : todoItems;
      showToast('Added.', 'success', 1200);
      renderTodoList();
    } catch (e) { showToast(e.message || String(e), 'error', 2500); }
  }

  async function updateTodo(id, patch) {
    try {
      const res = await adminClient.adminApi('admin-todos-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch })
      });
      todoItems = Array.isArray(res.todos) ? res.todos : todoItems;
      renderTodoList();
    } catch (e) { showToast(e.message || String(e), 'error', 2500); }
  }

  async function deleteTodo(id) {
    try {
      const res = await adminClient.adminApi('admin-todos-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      todoItems = Array.isArray(res.todos) ? res.todos : todoItems;
      showToast('Deleted.', 'success', 1200);
      renderTodoList();
    } catch (e) { showToast(e.message || String(e), 'error', 2500); }
  }

  async function bumpTodoPriority(id, delta) {
    const t = getTodoById(id);
    if (!t) return;
    const current = Number(t.priority || 1);
    const next = Math.max(1, current + delta);
    if (next === current) return;
    await updateTodo(id, { priority: next });
  }

  el('todoAddBtn')?.addEventListener('click', addTodo);
  el('todoRefreshBtn')?.addEventListener('click', ensureTodosLoaded);
  el('todoTextInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTodo();
  });

  // Client update link (shown on client dashboard)
  async function loadClientUpdate() {
    try {
      const j = await adminClient.adminApi('admin-update-get');
      const u = j && j.update ? j.update : null;
      if (u) {
        if (el('updateLinkInput')) el('updateLinkInput').value = u.link || '';
        if (el('updateDescInput')) el('updateDescInput').value = u.description || '';
      }
      setStatus(el('updateSavedHint'), '');
    } catch (e) {
      setStatus(el('updateSavedHint'), 'Could not load');
    }
  }

  async function saveClientUpdate() {
    const link = (el('updateLinkInput')?.value || '').trim();
    const description = (el('updateDescInput')?.value || '').trim();
    try {
      await adminClient.adminApi('admin-update-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link, description }) });
      setStatus(el('updateSavedHint'), 'Saved');
    } catch (e) {
      setStatus(el('updateSavedHint'), 'Save failed');
    }
  }

  el('updateLoadBtn')?.addEventListener('click', loadClientUpdate);
  el('updateSaveBtn')?.addEventListener('click', saveClientUpdate);


  // ---- Ambassadors ----
  let ambassadors = [];
  let selectedAmbassadorEmail = null;

  function moneyUsd(cents) {
    const v = Number(cents || 0) / 100;
    return '$' + v.toFixed(2);
  }

  function setAmbStatus(msg) {
    const s = el('ambStatus');
    if (s) s.innerText = msg || '';
  }

  function setPortalLink(email, token) {
    const host = el('ambPortalLink');
    if (!host) return;
    if (!email) {
      host.innerText = '(select an ambassador)';
      return;
    }
    const base = (location.origin || '').replace(/\/$/, '');
    const url = base + '/ambassador.html?email=' + encodeURIComponent(email) + (token ? ('&token=' + encodeURIComponent(token)) : '');
    host.innerText = url;
  }

  async function ensureAmbassadorsLoaded() {
    try {
      const j = await adminClient.adminApi('admin-ambassadors-list', { method: 'GET' });
      ambassadors = Array.isArray(j.ambassadors) ? j.ambassadors : [];
      renderAmbassadors();
    } catch (e) {
      setAmbStatus(e.message || String(e));
    }
  }

  function renderAmbassadors() {
    const tb = el('ambTable')?.querySelector('tbody');
    if (!tb) return;
    if (!ambassadors.length) {
      tb.innerHTML = '<tr><td colspan="8" class="muted">No ambassadors yet.</td></tr>';
      return;
    }
    tb.innerHTML = ambassadors.map((a) => {
      const email = a.email || '';
      const name = a.name || '';
      const monthly = a.monthly_price_cents == null ? '' : moneyUsd(a.monthly_price_cents);
      const yearly = a.yearly_price_cents == null ? '' : moneyUsd(a.yearly_price_cents);
      const created = a.created_at ? String(a.created_at).slice(0, 10) : '';
      const st = ambassadorStatsMap.get(String(a.id)) || null;
      const totalFirst = st ? moneyUsd(st.total_first_payment_cents || 0) : '';
      const activeMrr = st ? moneyUsd(st.active_mrr_equiv_cents || 0) : '';
      return `<tr data-amb-row="1" data-email="${escapeHtml(email)}" style="cursor:pointer;">
        <td>${escapeHtml(email)}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(monthly)}</td>
        <td>${escapeHtml(yearly)}</td>
        <td>${escapeHtml(totalFirst)}</td>
        <td>${escapeHtml(activeMrr)}</td>
        <td>${escapeHtml(created)}</td>
        <td>
          <button class="btnMini" data-amb-action="select" data-email="${escapeHtml(email)}">Select</button>
          <button class="btnMini" data-amb-action="del" data-email="${escapeHtml(email)}">✕</button>
        </td>
      </tr>`;
    }).join('');

    tb.querySelectorAll('[data-amb-action="select"]').forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        pickAmbassador(b.getAttribute('data-email'));
      };
    });
    tb.querySelectorAll('[data-amb-action="del"]').forEach((b) => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const email = b.getAttribute('data-email');
        if (!email) return;
        if (!confirm('Delete ambassador ' + email + '?')) return;
        try {
          await adminClient.adminApi('admin-ambassador-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
          setAmbStatus('Deleted.');
          await ensureAmbassadorsLoaded();
        } catch (e) { setAmbStatus(e.message || String(e)); }
      };
    });
    tb.querySelectorAll('tr[data-amb-row="1"]').forEach((r) => {
      r.onclick = () => pickAmbassador(r.getAttribute('data-email'));
    });
  }

  function pickAmbassador(email) {
    const a = ambassadors.find((x) => String(x.email || '').toLowerCase() === String(email || '').toLowerCase());
    if (!a) return;
    selectedAmbassadorEmail = a.email;
    if (el('ambEmail')) el('ambEmail').value = a.email || '';
    if (el('ambName')) el('ambName').value = a.name || '';
    if (el('ambMonthlyUsd')) el('ambMonthlyUsd').value = a.monthly_price_cents != null ? String(Math.round(Number(a.monthly_price_cents) / 100)) : '';
    if (el('ambYearlyUsd')) el('ambYearlyUsd').value = a.yearly_price_cents != null ? String(Math.round(Number(a.yearly_price_cents) / 100)) : '';
    if (el('ambNotes')) el('ambNotes').value = a.notes || '';
    setPortalLink(a.email, null);
    setAmbStatus('Selected: ' + a.email);
  }

  async function upsertAmbassador() {
    const email = (el('ambEmail')?.value || '').trim();
    const name = (el('ambName')?.value || '').trim();
    const monthlyUsd = Number(el('ambMonthlyUsd')?.value || 0);
    const yearlyUsd = Number(el('ambYearlyUsd')?.value || 0);
    const notes = (el('ambNotes')?.value || '').trim();
    if (!email) return setAmbStatus('Email is required.');
    if (!Number.isFinite(monthlyUsd) || monthlyUsd <= 0) return setAmbStatus('Monthly price must be >= 1.');
    if (!Number.isFinite(yearlyUsd) || yearlyUsd <= 0) return setAmbStatus('Yearly price must be >= 1.');
    try {
      const j = await adminClient.adminApi('admin-ambassador-upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, monthly_price_cents: Math.round(monthlyUsd * 100), yearly_price_cents: Math.round(yearlyUsd * 100), notes })
      });
      const token = j.token || null;
      setAmbStatus(token ? 'Saved. TOKEN: ' + token : 'Saved.');
      setPortalLink(email, token);
      await ensureAmbassadorsLoaded();
      pickAmbassador(email);
    } catch (e) { setAmbStatus(e.message || String(e)); }
  }

  async function rotateAmbassadorToken() {
    const email = (el('ambEmail')?.value || '').trim() || selectedAmbassadorEmail;
    if (!email) return setAmbStatus('Select an ambassador first.');
    try {
      const j = await adminClient.adminApi('admin-ambassador-rotate-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const token = j.token || null;
      setAmbStatus(token ? 'Rotated. TOKEN: ' + token : 'Rotated.');
      setPortalLink(email, token);
      await ensureAmbassadorsLoaded();
      pickAmbassador(email);
    } catch (e) { setAmbStatus(e.message || String(e)); }
  }

  el('ambRefreshBtn')?.addEventListener('click', ensureAmbassadorsLoaded);
  el('ambLoadBtn')?.addEventListener('click', ensureAmbassadorsLoaded);
  el('ambCreateBtn')?.addEventListener('click', upsertAmbassador);
  el('ambRotateBtn')?.addEventListener('click', rotateAmbassadorToken);


  // Initialize layout once authorized
  const oldAuthorize = el('authorizeBtn')?.onclick;
  el('authorizeBtn')?.addEventListener('click', () => {
    // After existing authorize handler runs, redistribute.
    window.setTimeout(() => {
      moveLegacyCards();
      const tabFromHash = (location.hash || '').replace('#','') || 'users';
      setActiveTab(['users','dashboard','feedback'].includes(tabFromHash) ? tabFromHash : 'users');
      showToast('Admin authorized.', 'success', 1500);
    }, 50);
  });

  // Dashboard + Feedback UI handlers
  el('dashRefreshBtn')?.addEventListener('click', () => loadDashboardMetrics());
  el('feedbackRefreshBtn')?.addEventListener('click', () => loadFeedbackList());
  el('feedbackRangeSelect')?.addEventListener('change', () => loadFeedbackList());

})();
