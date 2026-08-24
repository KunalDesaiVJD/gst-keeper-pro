// Background service worker — does ALL Supabase calls. Cross-origin fetches with
// host_permissions are reliable here (unlike from the popup/content directly).
// The popup + content script message it (see db.js).
importScripts('config.js');

const { SUPABASE_URL, SUPABASE_ANON_KEY } = globalThis.GSTK_CONFIG;
const base = SUPABASE_URL + '/rest/v1/';
const H = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};
const enc = encodeURIComponent;

const sel = async (path) => {
  const r = await fetch(base + path, { headers: H });
  if (!r.ok) throw new Error('GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
};
const patch = async (path, body) => {
  const r = await fetch(base + path, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('PATCH ' + path + ' -> ' + r.status);
  return true;
};
const post = async (table, rows, prefer = 'return=minimal') => {
  const r = await fetch(base + table, { method: 'POST', headers: { ...H, Prefer: prefer }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error('POST ' + table + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return true;
};
const del = async (table, query) => {
  const r = await fetch(base + table + '?' + query, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error('DELETE ' + table + ' -> ' + r.status);
  return true;
};

const API = {
  getClients: () => sel('clients?select=id,name,gstin,gst_user_id,gst_password,selected_returns&order=name'),
  getClient: (id) => sel(`clients?id=eq.${id}&select=id,name,gstin,gst_user_id,gst_password,selected_returns&limit=1`).then((a) => a[0] || null),
  upsertFilingStatus: (rows) => post('filing_status?on_conflict=client_id,return_type,period_month', rows, 'resolution=merge-duplicates,return=minimal'),
  upsertReco: async (table, clientId, period, patchObj) => {
    const ex = await sel(`${table}?client_id=eq.${clientId}&period_month=eq.${enc(period)}&select=id&limit=1`);
    if (ex[0]) return patch(`${table}?id=eq.${ex[0].id}`, patchObj);
    return post(table, [{ client_id: clientId, period_month: period, ...patchObj }]);
  },
  replaceTwob: async (clientId, period, rows) => {
    await del('twob_import_docs', `client_id=eq.${clientId}&period_month=eq.${enc(period)}`);
    return rows.length ? post('twob_import_docs', rows) : true;
  },

  // Persist the full credit-ledger transaction rows a 'ledger' pull already
  // scrapes (readLedgerRows() in content.js) but previously only used to
  // derive ITC-utilised/DRC-03 totals for GST Receivable Reco, discarding
  // the individual rows afterward. Feeds the "Credit Ledger" (full detail)
  // report. Delete-then-insert per client+period, same pattern as 2B.
  replaceCreditLedgerTxns: async (clientId, period, rows) => {
    await del('gst_credit_ledger_transactions', `client_id=eq.${clientId}&period_month=eq.${enc(period)}`);
    return rows.length ? post('gst_credit_ledger_transactions', rows) : true;
  },

  // Electronic Liability Register (Part-I, return-related) and Electronic Cash
  // Ledger — same delete-then-insert pattern as the credit ledger, fed by the
  // 'liabilityledger'/'cashledger' job steps in content.js (direct fetch of
  // the portal's own JSON APIs, not DOM scraping).
  replaceLiabilityLedgerEntries: async (clientId, period, rows) => {
    await del('gst_liability_ledger_entries', `client_id=eq.${clientId}&period_month=eq.${enc(period)}`);
    return rows.length ? post('gst_liability_ledger_entries', rows) : true;
  },
  replaceCashLedgerEntries: async (clientId, period, rows) => {
    await del('gst_cash_ledger_entries', `client_id=eq.${clientId}&period_month=eq.${enc(period)}`);
    return rows.length ? post('gst_cash_ledger_entries', rows) : true;
  },

  // View Notices and Orders. Not period-scoped (the report reads full
  // history), so this is a delete-all-then-insert per client, not per
  // period, fed by the 'notices' job step in content.js.
  replaceNotices: async (clientId, rows) => {
    await del('gst_notices', `client_id=eq.${clientId}`);
    return rows.length ? post('gst_notices', rows) : true;
  },

  // Refund applications (Track Application Status). Also not period-scoped —
  // delete-all-then-insert per client, fed by the 'refunds' job step.
  replaceRefundApplications: async (clientId, rows) => {
    await del('gst_refund_applications', `client_id=eq.${clientId}`);
    return rows.length ? post('gst_refund_applications', rows) : true;
  },

  // Best-effort document capture (application/query-memo/order PDFs) writes
  // here separately from the base scrape above, keyed by client+ARN rather
  // than needing the row's own id back from the insert (which the app skips
  // via Prefer: return=minimal). A missing target row or a not-yet-migrated
  // document column both fail this PATCH harmlessly — the caller in
  // content.js already treats it as non-fatal — without touching the
  // financial data replaceRefundApplications already saved.
  patchRefundDocument: async (clientId, arn, patchObj) =>
    patch(`gst_refund_applications?client_id=eq.${clientId}&arn=eq.${enc(arn)}`, patchObj),

  // DRC-03 voluntary payments. Also not period-scoped — delete-all-then-
  // insert per client, fed by the 'drc03' job step.
  replaceDrc03Filings: async (clientId, rows) => {
    await del('gst_drc03_filings', `client_id=eq.${clientId}`);
    return rows.length ? post('gst_drc03_filings', rows) : true;
  },

  // Taxpayer profile — one row per client (client_id UNIQUE), so this is a
  // true upsert rather than delete-then-insert: a failed re-pull leaves
  // whatever the last successful pull wrote untouched instead of blanking
  // it, unlike the list tables above.
  upsertTaxpayerProfile: async (clientId, patchObj) => {
    const ex = await sel(`gst_taxpayer_profile?client_id=eq.${clientId}&select=id&limit=1`);
    if (ex[0]) return patch(`gst_taxpayer_profile?id=eq.${ex[0].id}`, patchObj);
    return post('gst_taxpayer_profile', [{ client_id: clientId, ...patchObj }]);
  },

  // Quick DB-only check (no portal visit) for a client's known registration
  // date, so a Refund/DRC-03 pull can bound its portal date-window walks to
  // this client's real history instead of guessing or defaulting to GST's
  // 2017 inception for everyone. Returns null if Taxpayer Profile has never
  // been pulled for this client yet.
  getTaxpayerRegistrationDate: async (clientId) => {
    const rows = await sel(`gst_taxpayer_profile?client_id=eq.${clientId}&select=registration_date&limit=1`);
    return (rows[0] && rows[0].registration_date) || null;
  },

  // Challans. Also not period-scoped — delete-all-then-insert per client,
  // fed by the 'challans' job step.
  replaceChallans: async (clientId, rows) => {
    await del('gst_challans', `client_id=eq.${clientId}`);
    return rows.length ? post('gst_challans', rows) : true;
  },

  // Filed GSTR-3B / GSTR-1 / GSTR-2B — as-filed figures pulled directly from
  // the portal's own JSON APIs (see content.js handleGstr3bPull/handleGstr1Pull/
  // handleGstr2bPull), one row per client+period+return_type. A true upsert
  // (not delete-then-insert): a failed re-pull leaves the last good summary
  // untouched instead of blanking it, same reasoning as upsertTaxpayerProfile.
  upsertFiledReturn: async (clientId, period, returnType, patchObj) => {
    const ex = await sel(`gst_filed_returns?client_id=eq.${clientId}&period_month=eq.${enc(period)}&return_type=eq.${enc(returnType)}&select=id&limit=1`);
    if (ex[0]) return patch(`gst_filed_returns?id=eq.${ex[0].id}`, patchObj);
    return post('gst_filed_returns', [{ client_id: clientId, period_month: period, return_type: returnType, ...patchObj }]);
  },

  // Electronic Credit Reversal and Re-claimed Statement, and RCM Liability/ITC
  // Statement — both real Dashboard Quick Links, confirmed live 2026-08-22
  // against return.gst.gov.in's own internalapi (see the
  // rcm_credit_reversal_statements migration for the full endpoint shapes).
  // A pull fetches a client's WHOLE financial year in one call, so replace is
  // scoped to client+financial_year rather than client+period_month.
  replaceCreditReversalReclaimEntries: async (clientId, financialYear, rows) => {
    await del('gst_credit_reversal_reclaim_entries', `client_id=eq.${clientId}&financial_year=eq.${enc(financialYear)}`);
    return rows.length ? post('gst_credit_reversal_reclaim_entries', rows) : true;
  },
  replaceRcmLiabilityItcEntries: async (clientId, financialYear, rows) => {
    await del('gst_rcm_liability_itc_entries', `client_id=eq.${clientId}&financial_year=eq.${enc(financialYear)}`);
    return rows.length ? post('gst_rcm_liability_itc_entries', rows) : true;
  },

  // Cross-origin fetch relay. content.js's own fetch() is same-origin only
  // (it runs in the page's security context, subject to the page's CORS
  // policy — the SAME reason every Supabase call in this file already goes
  // through the background worker, see the file's own header comment). The
  // GSTR-1 offline-download ZIP is served from files.gst.gov.in, a
  // DIFFERENT origin from whatever *.gst.gov.in page triggered the
  // generation, so content.js can't fetch it directly — this relay can,
  // since host_permissions covers *.gst.gov.in for the background worker.
  fetchCrossOriginAsBase64: async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('fetchCrossOriginAsBase64 -> HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    return { base64: abToBase64(buf), contentType: r.headers.get('content-type') || 'application/octet-stream' };
  },

  // Upload a base64 data-URL PDF to the return-pdfs bucket, return its public URL.
  uploadPdf: async (path, dataUrl) => {
    const b64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const r = await fetch(SUPABASE_URL + '/storage/v1/object/return-pdfs/' + path, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/pdf', 'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!r.ok) throw new Error('PDF upload -> ' + r.status + ' ' + (await r.text()).slice(0, 100));
    return SUPABASE_URL + '/storage/v1/object/public/return-pdfs/' + path;
  },

  // Mark a return Filed (with ARN + filed_date + PDF url). Passes the app's
  // "PDF required before Filed" trigger because return_pdf_url is set.
  markFiled: (row) => post('filing_status?on_conflict=client_id,return_type,period_month', [row], 'resolution=merge-duplicates,return=minimal'),

  // From the app's Filing Status "Pull from portal" button: pull ONE filed
  // return's ARN + PDF and mark it Filed. Fetches creds, opens a portal tab.
  startReturnPull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const [mm, yyyy] = String(info.period_month).split('/').map((n) => parseInt(n, 10));
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const job = {
      mode: 'returnpdf', period: info.period_month, fyStart, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
      ret: { return_type: info.return_type, period_month: info.period_month },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name, return_type: info.return_type };
  },

  // From the app's Import 2B "Pull from portal" button: log in, download the
  // GSTR-2B for this client+period, and stash the file for the app to import
  // (the app parses it with its own GSTR-2B parser). Opens a portal tab.
  startTwobPull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'twob', period: info.period_month, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name };
  },

  // From the GSTR-2A Import card's "Pull from portal" button. Mirrors
  // startTwobPull exactly — same dashboard, same tile-and-download pattern,
  // different tile (GSTR-2A instead of GSTR-2B). See content.js handleTwoA /
  // handleTwoADownload — this is the one new-page automation in this batch
  // that has NOT been verified against a real GSTR-2A download; the tile
  // click and cascading-dropdown steps reuse code already proven against the
  // sibling GSTR-2B tile on the same dashboard, but the download page itself
  // (button label, whether it's a direct file or a blob) is inferred from
  // that same pattern, not confirmed against a real GSTR-2A download page.
  startTwoAPull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'twoa', period: info.period_month, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name };
  },

  // From the Filing Status login icon: log the client in and open the given
  // return's filing page (current tab's return + period). The human does the
  // CAPTCHA and the final OTP/DSC submission — we only log in + navigate.
  startFilingOpen: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'filing', period: info.period_month, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
      ret: { return_type: info.return_type, period_month: info.period_month },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name, return_type: info.return_type };
  },

  // From a reco page "Pull" button: log the client in and pull the ledger opening
  // balances (credit ledger -> GST Receivable Reco, reversal ledger -> Suspended
  // Reco). No mode -> the default ledger sync. Human does the CAPTCHA.
  startLedgerPull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      period: info.period_month, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name };
  },

  // From a Reports Hub "Pull" button on one specific report: log the client
  // in and jump straight to that one section (Notices / Refunds / DRC-03 /
  // Taxpayer Profile / Challans / Liability Ledger / Cash Ledger), then stop
  // — instead of running the whole ledger->reversal->...->challans chain that
  // GST Receivable Reco's "Pull" kicks off. `info.mode` is one of
  // 'notices' | 'refunds' | 'drc03' | 'taxpayerprofile' | 'challans' |
  // 'liabilityledger' | 'cashledger' (see reportsCatalog.ts `pull.mode` and
  // content.js's chainOrStop()). Human does the CAPTCHA.
  startSectionPull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    // Reports Hub can select several periods at once ("This FY" etc) — queue
    // all of them for this one client so a single Pull click covers every
    // selected period instead of just the first (content.js's advance()
    // walks the queue one period at a time, no re-login needed in between).
    const periods = Array.isArray(info.period_months) && info.period_months.length
      ? info.period_months
      : [info.period_month || ''];
    const job = {
      mode: info.mode, period: periods[0], periods, periodIdx: 0, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name, mode: info.mode, periods: periods.length };
  },

  // Same as startSectionPull but queues EVERY client with saved credentials
  // instead of one — the Notices Dashboard's "Sync All". content.js's queue
  // processor (job.idx/job.clients, see the top of the file) already handles
  // an arbitrary-length clients array generically — this is the only new
  // piece, reusing that machinery rather than adding a second one. Each
  // client still needs its own CAPTCHA typed in the portal tab before the
  // next one starts, same as the extension popup's own "All clients" option.
  startAllClientsSectionPull: async (info) => {
    const all = await API.getClients();
    const withCreds = all.filter((c) => c.gst_user_id);
    if (!withCreds.length) throw new Error('No clients have saved GST portal credentials.');
    const job = {
      mode: info.mode, period: info.period_month || '', idx: 0, step: 'login', startedAt: Date.now(),
      clients: withCreds.map((c) => ({
        clientId: c.id,
        creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      })),
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, count: withCreds.length, mode: info.mode };
  },

  // From the Clients → Credentials "Login" button: just log the client into the
  // GST portal and stop (mode 'login'). No return/ledger navigation. Human does
  // the CAPTCHA.
  startPortalLogin: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'login', idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name };
  },

  // From the GSTR-1 "Upload to GST Portal" button. Fetches the stored GSTR-1
  // JSON + client credentials, then opens a portal tab. The content script
  // logs in, navigates to the return dashboard, uploads the JSON, waits for
  // the portal to finish processing, and writes the outcome (accepted /
  // partial / failed + per-invoice errors) to chrome.storage — appbridge.js
  // relays it to the app. Filing / signing stays manual.
  startGstr1Upload: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    // gstr1_data.period_month is stored as the short label (e.g. "Jun-26")
    // — convert from the app's MM/YYYY.
    const [mm, yyyy] = String(info.period_month).split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) throw new Error('Bad period_month.');
    const short = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mm - 1] + '-' + String(yyyy).slice(-2);
    const rows = await sel(`gstr1_data?client_id=eq.${c.id}&period_month=eq.${enc(short)}&select=id,raw_json&limit=1`);
    const stored = rows && rows[0];
    if (!stored) throw new Error(`No stored GSTR-1 JSON for ${c.name} / ${short}. Import a JSON first.`);
    const job = {
      mode: 'gstr1_upload',
      idx: 0,
      step: 'login',
      startedAt: Date.now(),
      period: info.period_month,
      actorId: info.actorId || null,
      clients: [{
        clientId: c.id,
        creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
      gstr1: {
        rowId: stored.id,
        periodShort: short,
        // Serialize once here — content.js will reconstruct a File from this.
        json: stored.raw_json,
      },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name, period: short };
  },

  // From the GSTR-3B "Push to GST Portal" button. Unlike GSTR-1, there is no
  // gstr3b_data table — GSTR-3B is computed on the fly by the app's own
  // buildGstr3bJson() every time the page loads — so the app computes the
  // draft itself and passes the finished JSON straight through here rather
  // than this function re-deriving it from gstr1_data/itc_summaries/rcm_data
  // a second time (which would duplicate real tax-computation logic in two
  // languages and risk them drifting apart).
  startGstr3bPush: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    if (!info.gstr3bJson) throw new Error('No GSTR-3B draft data was passed in — recompute the page and try again.');
    const job = {
      mode: 'gstr3b_push',
      idx: 0,
      step: 'login',
      startedAt: Date.now(),
      period: info.period_month,
      actorId: info.actorId || null,
      clients: [{
        clientId: c.id,
        creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
      gstr3b: { json: info.gstr3bJson },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name };
  },

  // Content script calls this after the portal finishes processing an upload,
  // to persist the outcome so the "last uploaded" indicator survives a refresh.
  // Also records the attempt in gstr1_upload_versions for the Version History
  // dialog — one row per portal upload / refresh so the audit trail is
  // complete no matter which path triggered it.
  saveGstr1UploadResult: async ({ rowId, status, summary, errors, actorId, actionType }) => {
    // Pull client_id + period_month back from gstr1_data — we need them for
    // the versions insert but the content script only knows the row id.
    const rows = await sel(`gstr1_data?id=eq.${rowId}&select=client_id,period_month&limit=1`);
    const row = rows && rows[0];

    await patch(`gstr1_data?id=eq.${rowId}`, {
      last_uploaded_at: new Date().toISOString(),
      last_uploaded_by: actorId || null,
      last_upload_status: status,
      last_upload_summary: summary || null,
      last_upload_errors: errors || null,
    });

    if (row) {
      // action_type defaults to UPLOAD; content.js passes 'REFRESH_ERRORS'
      // when this write comes from the refresh flow.
      try {
        await post('gstr1_upload_versions', [{
          client_id: row.client_id,
          period_month: row.period_month,
          action_type: actionType || 'UPLOAD',
          actor_id: actorId || null,
          status: status || null,
          summary: summary || null,
          errors: errors || null,
        }]);
      } catch (e) {
        // Don't fail the whole write if the versions table isn't there yet
        // (migration not applied); the main row update still succeeds.
      }
    }
    return true;
  },

  // From the GSTR-1 "Refresh errors" button — same client + period as a
  // previous Upload, but without re-sending the JSON. The content script
  // logs in, navigates to Offline Upload → Download tab, and scrapes the
  // now-generated Error Report so per-invoice reasons can be surfaced in the
  // app.
  startGstr1RefreshErrors: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const [mm, yyyy] = String(info.period_month).split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) throw new Error('Bad period_month.');
    const short = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mm - 1] + '-' + String(yyyy).slice(-2);
    const rows = await sel(`gstr1_data?client_id=eq.${c.id}&period_month=eq.${enc(short)}&select=id&limit=1`);
    const stored = rows && rows[0];
    if (!stored) throw new Error(`No stored GSTR-1 row for ${c.name} / ${short}.`);
    const job = {
      mode: 'gstr1_refresh',
      idx: 0,
      step: 'login',
      startedAt: Date.now(),
      period: info.period_month,
      actorId: info.actorId || null,
      clients: [{
        clientId: c.id,
        creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
      gstr1: { rowId: stored.id, periodShort: short },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await chrome.storage.local.set({ gstk_active_job: job });
    return { started: true, client: c.name, period: short };
  },
};

// ---- GSTR-2B Excel capture (to-disk download) ------------------------------
// The GSTR-2B Excel downloads via a direct URL (not a JS blob), so the page hook
// can't see it. While a 'twob' pull is active, watch chrome.downloads, re-fetch
// the file with the user's logged-in session (cookies via host_permissions), and
// hand the bytes to the app. The downloaded file is left on disk untouched (the
// user keeps it for their client folder).
function abToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

if (chrome.downloads && chrome.downloads.onCreated) {
chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
    if (!job || !job.clients) return;
    if (job.mode !== 'twob' && job.mode !== 'twoa') return;
    const is2a = job.mode === 'twoa';
    const fileUrl = item.finalUrl || item.url || '';
    const hint = (item.filename || '') + ' ' + fileUrl;
    const looksLikeMatch = is2a
      ? ((/\.(xlsx|xls|zip)(\?|$)/i.test(hint) || /gstr-?2a|gstr2a/i.test(hint)))
      : ((/\.(xlsx|xls|zip)(\?|$)/i.test(hint) || /gstr-?2b|gstr2b/i.test(hint)));
    if (!looksLikeMatch || !/^https?:/i.test(fileUrl)) return; // blob:/data: handled in-page
    const resp = await fetch(fileUrl, { credentials: 'include' });
    if (!resp.ok) return;
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength < 100) return;
    const mime = resp.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const dataUrl = 'data:' + mime + ';base64,' + abToBase64(buf);
    const cur = job.clients[job.idx || 0];
    if (!cur) return;
    const resultKey = is2a ? 'gstk_twoa_result' : 'gstk_twob_result';
    const fileNamePrefix = is2a ? 'GSTR2A_' : 'GSTR2B_';
    await chrome.storage.local.set({ [resultKey]: {
      ok: true, clientId: cur.clientId, gstin: (cur.creds && cur.creds.gstin) || '', period: job.period,
      fileB64: dataUrl, fileName: item.filename || (fileNamePrefix + cur.clientId + '.xlsx'), at: Date.now(),
    } });
  } catch (e) { /* ignore — the in-page path or a timeout will report */ }
});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.gstk) return;
  if (msg.fn === 'whoami') {
    sendResponse({ ok: true, data: { tabId: sender && sender.tab ? sender.tab.id : null } });
    return true;
  }
  const fn = API[msg.fn];
  if (!fn) { sendResponse({ error: 'unknown fn: ' + msg.fn }); return; }
  Promise.resolve(fn(...(msg.args || [])))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
  return true; // keep the channel open for the async response
});
