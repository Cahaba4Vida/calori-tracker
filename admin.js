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
    el('grantTrialBtn').onclick = () => grantTrial();
    el('revokePassBtn').onclick = () => setPass('revoke');
    el('reconcileSubsBtn').onclick = () => reconcileSubscriptions();
    el('getInsightsBtn').onclick = () => getInsights();
    el('broadcastFeedbackBtn').onclick = () => sendCampaign();
    el('disableFeedbackBtn').onclick = () => disableCampaign();
    authorize();
