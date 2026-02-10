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
