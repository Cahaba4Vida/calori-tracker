(function () {
  function el(id) { return document.getElementById(id); }
  function setText(target, msg) {
    const n = typeof target === 'string' ? el(target) : target;
    if (n) n.innerText = msg || '';
  }

  function getEmail() { return (localStorage.getItem('amb_email') || el('ambEmailInput')?.value || '').trim(); }
  function getToken() { return (localStorage.getItem('amb_token') || el('ambTokenInput')?.value || '').trim(); }

  async function api(path, opts = {}) {
    const headers = {
      ...(opts.headers || {}),
      'x-ambassador-email': getEmail(),
      'x-ambassador-token': getToken(),
    };
    const r = await fetch('/api/' + path, { ...opts, headers });
    const txt = await r.text();
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch { body = { raw: txt }; }
    if (!r.ok) throw new Error((body && (body.error || body.message)) ? (body.error || body.message) : ('Request failed: ' + r.status));
    return body;
  }

  function money(cents) {
    const v = Number(cents || 0) / 100;
    return '$' + v.toFixed(2);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateTime(v) {
    try {
      if (!v) return '';
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString();
    } catch {
      return String(v || '');
    }
  }

  function parseQuery() {
    const q = new URLSearchParams(location.search || '');
    const email = q.get('email');
    const token = q.get('token');
    if (email && el('ambEmailInput')) el('ambEmailInput').value = email;
    if (token && el('ambTokenInput')) el('ambTokenInput').value = token;
  }

  async function refreshUsers() {
    const status = el('ambUsersStatus');
    const tbody = el('ambUsersTbody');
    if (tbody) tbody.innerHTML = '';
    setText(status, 'Loading…');
    try {
      const j = await api('ambassador-users-list', { method: 'GET' });
      await loadAmbassadorStats();
      const rows = j.users || [];
      if (!rows.length) { setText(status, 'No referred users yet.'); return; }
      setText(status, '');
      for (const u of rows) {
        const tr = document.createElement('tr');
        const price = (u.price_paid_cents != null && Number.isFinite(Number(u.price_paid_cents))) ? money(Number(u.price_paid_cents)) : '—';
        const currency = (u.currency || '').toUpperCase();
        const sub = u.stripe_subscription_status ? String(u.stripe_subscription_status) : '—';
        tr.innerHTML = `
          <td>${escapeHtml(u.email || '')}</td>
          <td class="mono">${escapeHtml(u.user_id || '')}</td>
          <td>${escapeHtml(u.status || 'referred')}</td>
          <td>${escapeHtml(sub)}</td>
          <td>${escapeHtml(price)} ${escapeHtml(currency)}</td>
          <td>${escapeHtml(formatDateTime(u.first_seen_at))}</td>
          <td>${escapeHtml(formatDateTime(u.last_seen_at))}</td>
        `;
        tbody.appendChild(tr);
      }
    } catch (e) {
      setText(status, e.message || String(e));
    }
  }

  async function authorize() {
    const email = (el('ambEmailInput')?.value || '').trim();
    const token = (el('ambTokenInput')?.value || '').trim();
    if (!email || !token) return setText('ambAuthStatus', 'Enter email + token.');
    localStorage.setItem('amb_email', email);
    localStorage.setItem('amb_token', token);

    try {
      const j = await api('ambassador-whoami', { method: 'GET' });
      el('ambProtected')?.classList.remove('hidden');
      setText('ambAuthStatus', 'Authorized as ' + (j.ambassador?.email || email));

      const monthly = j.ambassador?.monthly_price_cents;
      const yearly = j.ambassador?.yearly_price_cents;
      if (el('ambMonthlyLabel')) el('ambMonthlyLabel').innerText = monthly != null ? money(monthly) : '—';
      if (el('ambYearlyLabel')) el('ambYearlyLabel').innerText = yearly != null ? money(yearly) : '—';
      await loadAmbassadorStats();

      try {
        const code = (j.ambassador?.referral_code || '').trim();
        if (code) {
          const link = (window.location.origin || '') + '/?ref=' + encodeURIComponent(code);
          const a = el('ambReferralLink');
          const t = el('ambReferralLinkText');
          if (a) { a.href = link; a.innerText = 'Open referral link'; }
          if (t) t.innerText = link;
        }
      } catch (e) {}

      try { await refreshUsers(); } catch (e) {}
    } catch (e) {
      el('ambProtected')?.classList.add('hidden');
      setText('ambAuthStatus', e.message || String(e));
    }
  }

  function clearAuth() {
    localStorage.removeItem('amb_email');
    localStorage.removeItem('amb_token');
    if (el('ambEmailInput')) el('ambEmailInput').value = '';
    if (el('ambTokenInput')) el('ambTokenInput').value = '';
    el('ambProtected')?.classList.add('hidden');
    setText('ambAuthStatus', 'Cleared.');
  }

  async function createCheckout(interval) {
    setText('checkoutStatus', 'Creating…');
    el('checkoutLinkWrap')?.classList.add('hidden');

    const customer_email = (el('checkoutCustomerEmail')?.value || '').trim();
    if (!customer_email) {
      setText('checkoutStatus', 'Customer email is required.');
      return;
    }

    try {
      const j = await api('ambassador-create-checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_email, interval })
      });
      const url = j.checkout_url || j.url;
      if (url) {
        el('checkoutLink').href = url;
        el('checkoutUrlText').innerText = url;
        el('checkoutLinkWrap')?.classList.remove('hidden');
        setText('checkoutStatus', 'Ready.');
      } else {
        setText('checkoutStatus', 'No URL returned.');
      }
    } catch (e) {
      setText('checkoutStatus', e.message || String(e));
    }
  }

  async function copyCheckout() {
    const url = el('checkoutUrlText')?.innerText || '';
    if (!url) return setText('checkoutStatus', 'Create a link first.');
    try {
      await navigator.clipboard.writeText(url);
      setText('checkoutStatus', 'Copied.');
    } catch {
      setText('checkoutStatus', 'Copy failed — select and copy manually.');
    }
  }

  parseQuery();

  if (el('ambEmailInput')) el('ambEmailInput').value = localStorage.getItem('amb_email') || el('ambEmailInput').value || '';
  if (el('ambTokenInput')) el('ambTokenInput').value = localStorage.getItem('amb_token') || el('ambTokenInput').value || '';

  el('ambAuthBtn')?.addEventListener('click', authorize);
  el('ambClearBtn')?.addEventListener('click', clearAuth);
  el('createCheckoutMonthlyBtn')?.addEventListener('click', () => createCheckout('month'));
  el('createCheckoutYearlyBtn')?.addEventListener('click', () => createCheckout('year'));
  el('copyCheckoutBtn')?.addEventListener('click', copyCheckout);
  el('copyReferralBtn')?.addEventListener('click', async () => {
    try {
      const txt = el('ambReferralLinkText')?.innerText || '';
      if (txt) await navigator.clipboard.writeText(txt);
    } catch (e) {}
  });
  el('refreshUsersBtn')?.addEventListener('click', refreshUsers);

  if (getEmail() && getToken()) {
    window.setTimeout(() => authorize(), 20);
  }
})();
  async function loadAmbassadorStats() {
    try {
      const j = await api('ambassador-stats', { method: 'GET' });
      const t = j.totals || {};
      if (el('ambReferredCount')) el('ambReferredCount').innerText = String(t.referred ?? '0');
      if (el('ambPaidCount')) el('ambPaidCount').innerText = String(t.paid ?? '0');
      const cur = (j.currency || 'usd').toUpperCase();
      const total = t.total_first_payment?.cents != null ? money(t.total_first_payment.cents) : '—';
      const mrr = t.active_mrr_equiv?.cents != null ? money(t.active_mrr_equiv.cents) : '—';
      if (el('ambTotalFirstPaid')) el('ambTotalFirstPaid').innerText = total;
      if (el('ambActiveMrr')) el('ambActiveMrr').innerText = mrr;
    } catch (e) {
      // Non-fatal
    }
  }

