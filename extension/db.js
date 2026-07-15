// Thin Supabase REST client (fetch-based) for the extension. Uses the anon key +
// RLS, same as the web app. Exposed as globalThis.GSTKdb for popup + content.
(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = globalThis.GSTK_CONFIG;
  const base = SUPABASE_URL + '/rest/v1/';
  const H = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };

  const sel = async (path) => {
    const r = await fetch(base + path, { headers: H });
    return r.ok ? r.json() : [];
  };
  const patch = async (path, body) => {
    const r = await fetch(base + path, {
      method: 'PATCH',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    return r.ok;
  };
  const post = async (table, rows, prefer = 'return=minimal') => {
    const r = await fetch(base + table, {
      method: 'POST',
      headers: { ...H, Prefer: prefer },
      body: JSON.stringify(rows),
    });
    return r.ok;
  };
  const del = async (table, query) => {
    const r = await fetch(base + table + '?' + query, { method: 'DELETE', headers: H });
    return r.ok;
  };
  const enc = encodeURIComponent;

  globalThis.GSTKdb = {
    // Clients (creds included — same access the app has via RLS).
    getClients: () => sel('clients?select=id,name,gstin,gst_user_id,gst_password&order=name'),
    getClient: (id) =>
      sel(`clients?id=eq.${id}&select=id,name,gstin,gst_user_id,gst_password,selected_returns&limit=1`).then((a) => a[0] || null),

    // Filing status: upsert ARN + filed date + status (on the unique key).
    upsertFilingStatus: (rows) =>
      post('filing_status?on_conflict=client_id,return_type,period_month', rows, 'resolution=merge-duplicates,return=minimal'),

    // Reco opening (suspended_reco / gst_receivable_reco) — manual upsert by (client, period).
    upsertReco: async (table, clientId, period, patchObj) => {
      const ex = await sel(`${table}?client_id=eq.${clientId}&period_month=eq.${enc(period)}&select=id&limit=1`);
      if (ex[0]) return patch(`${table}?id=eq.${ex[0].id}`, patchObj);
      return post(table, [{ client_id: clientId, period_month: period, ...patchObj }]);
    },

    // 2B docs: replace the batch for (client, period).
    replaceTwob: async (clientId, period, rows) => {
      await del('twob_import_docs', `client_id=eq.${clientId}&period_month=eq.${enc(period)}`);
      return rows.length ? post('twob_import_docs', rows) : true;
    },

    // Console log (portal_job_events requires a job_id, which the extension
    // doesn't use — it works directly, not via the job queue).
    logEvent: (clientId, level, message) => { console.log('[GSTKeeper]', level, clientId, message); },
  };
})();
