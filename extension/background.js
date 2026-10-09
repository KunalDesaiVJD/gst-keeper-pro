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

// The GSTR-3A summary API (return.gst.gov.in/returns/auth/api/gstr3a/summary)
// WAF-rejects any request whose Referer isn't the portal's own "View Notices
// and Orders" page — confirmed live 2026-09-03: a plain fetch() from this
// worker got a 200 "Access Denied" HTML page instead of JSON (every row,
// every client), while clicking the notice's own "View" link on the portal
// (which sends that Referer naturally) succeeded. `fetch()` cannot set
// Referer itself — it's a forbidden header per the Fetch spec, extension or
// not — so this rewrites it at the network layer instead via
// declarativeNetRequest, which is allowed to. Registered once per worker
// startup; scoped narrowly to this one endpoint so it can't affect any other
// cross-origin fetch this file makes.
// 0.8.0: the registration is awaited before the first cross-origin fetch
// (dnrReady, used by fetchCrossOriginAsBase64 below). Registering is async,
// and this worker starts on the very message that wants the rule — so a
// GSTR-3A summary fetched in the first moments of a worker's life went out
// with the page's own Referer, came back as the 200 "Access Denied" HTML page
// described above, and failed as "not JSON". That is the GSTR-3A "no PDF
// captured" row: not a notice the portal has no PDF for, just one whose
// request raced the rule. Dynamic rules persist across worker restarts, so
// after the first registration this resolves immediately.
const dnrReady = (async () => {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        condition: { urlFilter: '||return.gst.gov.in/returns/auth/api/gstr3a/summary', resourceTypes: ['xmlhttprequest'] },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://services.gst.gov.in/services/auth/notices' }],
        },
      }],
    });
    return true;
  } catch (e) { return false; } // best-effort — a failed registration just leaves the old fetch behavior
})();

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
const upsert = async (table, conflictCols, rows) => {
  const r = await fetch(base + table + '?on_conflict=' + conflictCols, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error('UPSERT ' + table + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return true;
};

// ── Sync write guards (Phase 0, notices roadmap) ───────────────────────────
// A pull that returned nothing, or only part of what it should have, must
// never mark the client's existing rows as gone. Callers pass
// { complete: false } when any sub-fetch failed; an empty batch is treated the
// same way; and a pass that would remove more than half of a client's live
// rows (and more than 5) is held back and reported instead of applied.
const dedupeRows = (rows, keys) => {
  const m = new Map();
  for (const r of rows) m.set(keys.map((k) => String(r[k] ?? '')).join('\u0001'), r);
  return [...m.values()];
};
const guardedSoftDelete = async (table, scopeQuery, rows, pullTs, opts) => {
  const complete = !opts || opts.complete !== false;
  if (!rows.length) return { softDeleted: 0, held: 'empty pull — nothing marked missing' };
  if (!complete) return { softDeleted: 0, held: 'partial pull — nothing marked missing' };
  const live = await sel(`${table}?${scopeQuery}&deleted_at=is.null&select=id`);
  const stale = await sel(`${table}?${scopeQuery}&deleted_at=is.null&last_seen_at=lt.${enc(pullTs)}&select=id`);
  if (stale.length > 5 && stale.length > live.length / 2) {
    return { softDeleted: 0, held: `would mark ${stale.length} of ${live.length} rows missing — held back for review` };
  }
  if (stale.length) await patch(`${table}?${scopeQuery}&deleted_at=is.null&last_seen_at=lt.${enc(pullTs)}`, { deleted_at: pullTs });
  return { softDeleted: stale.length, held: null };
};

// ── One ingest door and the run ledger (0.5.0; notices roadmap Phase 1) ─────
// Portal rows go through public.sync_ingest(): one advisory lock per client
// and step, server timestamps, a content hash for new/changed/removed counts,
// the same guarded soft-delete as above, a sync_run_items ledger row, and the
// closing sweep after notices / DRC-03. A database without the RPC (404) falls
// back to the REST path above.
const EXT_VERSION = chrome.runtime.getManifest().version;
const rpc = async (fn, body) => {
  const r = await fetch(base + 'rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error('RPC ' + fn + ' -> ' + r.status + ' ' + text.slice(0, 160));
    err.status = r.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
};
const isMissingRpc = (e) => e && (e.status === 404 || /PGRST202|Could not find the function/.test(String(e.message)));

// ── The job slot (0.7.0) ────────────────────────────────────────────────────
// One job runs in this browser at a time (gstk_active_job). Every start goes
// through jobSlot, and so does the scheduled-sync runner (runner.js), so a check
// and a write never interleave: a person's sync always gets the slot (the runner
// gives its client back to the queue and closes its window), and the runner only
// takes an empty slot.
let jobSlotChain = Promise.resolve();
function jobSlot(fn) {
  const run = jobSlotChain.then(() => fn());
  jobSlotChain = run.catch(() => {});
  return run;
}
const setActiveJob = (job) => jobSlot(() => chrome.storage.local.set({ gstk_active_job: job }));

// The REST path needs the bookkeeping columns the RPC sets on the server.
const legacyRows = (rows, extra) => rows.map((r) => ({ ...r, ...extra }));
const LEGACY_REPLACE = {
  notices: (clientId, rows, pullTs, opts) => API.replaceNotices(clientId,
    legacyRows(rows, { client_id: clientId, source: 'notices', pulled_at: pullTs, last_seen_at: pullTs, deleted_at: null }), pullTs, opts),
  refunds: (clientId, rows, pullTs, opts) => API.replaceRefundApplications(clientId,
    legacyRows(rows, { client_id: clientId, pulled_at: pullTs, last_seen_at: pullTs, deleted_at: null }), pullTs, opts),
  drc03: (clientId, rows, pullTs, opts) => API.replaceDrc03Filings(clientId,
    legacyRows(rows, { client_id: clientId, pulled_at: pullTs, last_seen_at: pullTs, deleted_at: null }), pullTs, opts),
  case_folder: (clientId, rows, pullTs, opts, scope) => API.replaceCaseFolderItems(clientId, scope,
    legacyRows(rows, { client_id: clientId, case_id: scope, pulled_at: pullTs, last_seen_at: pullTs, deleted_at: null }), pullTs, opts),
};

// 0.8.1: refused portal passwords (API.pwRefusal*). Keyed by client id; each
// entry holds a fingerprint of the refused user ID + password, never either.
const PW_REFUSED_KEY = 'gstk_pw_refused';
const PW_SALT_KEY = 'gstk_pw_salt';
async function pwRefusals() {
  try { return (await chrome.storage.local.get(PW_REFUSED_KEY))[PW_REFUSED_KEY] || {}; } catch (e) { return {}; }
}
async function pwSalt() {
  const got = (await chrome.storage.local.get(PW_SALT_KEY))[PW_SALT_KEY];
  if (got) return got;
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await chrome.storage.local.set({ [PW_SALT_KEY]: salt });
  return salt;
}
async function pwFingerprint(user, pass) {
  const data = new TextEncoder().encode(await pwSalt() + '\n' + String(user || '').trim().toLowerCase() + '\n' + String(pass == null ? '' : pass));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const API = {
  // 0.8.2: portal_login_issue too (a client the portal refused is skipped); a
  // database without that column is read as before.
  getClients: () => sel('clients?select=id,name,gstin,gst_user_id,selected_returns,notices_sync_excluded,inactive_at_hand,portal_login_issue&order=name')
    .catch(() => sel('clients?select=id,name,gstin,gst_user_id,selected_returns,notices_sync_excluded,inactive_at_hand&order=name')),
  getClient: (id) => sel(`clients?id=eq.${id}&select=id,name,gstin,gst_user_id,selected_returns,portal_login_issue,portal_login_issue_message,portal_login_issue_at&limit=1`)
    .catch(() => sel(`clients?id=eq.${id}&select=id,name,gstin,gst_user_id,selected_returns&limit=1`)).then((a) => a[0] || null),
  loginIssueSet: async (clientId, reason, message) => {
    try { return await rpc('client_login_issue_set', { p_client_id: clientId, p_reason: reason || null, p_message: message ? String(message).slice(0, 500) : null }); }
    catch (e) { return null; } // a database without migration 20261010100000
  },
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

  // View Notices and Orders — upsert on (client_id, source, portal_key).
  // Staff workflow columns (staff_status, priority, reply_*, etc.) are NOT
  // in the request body so PostgREST's merge-duplicates preserves them.
  // Rows the portal no longer returns are soft-deleted (deleted_at set)
  // rather than hard-deleted, so staff notes survive even if the portal
  // drops a notice temporarily.
  replaceNotices: async (clientId, rows, pullTs, opts) => {
    const batch = dedupeRows(rows, ['client_id', 'source', 'portal_key']);
    if (batch.length > 0) {
      await upsert('gst_notices', 'client_id,source,portal_key', batch);
    }
    // Manual notices (portal_key 'manual:…') are never marked missing: the
    // portal never returns them. A DB trigger enforces the same rule for
    // older extension copies.
    return guardedSoftDelete('gst_notices', `client_id=eq.${clientId}&source=eq.notices&portal_key=not.like.manual:*`, batch, pullTs, opts);
  },

  // Refund applications — upsert on (client_id, portal_key).
  replaceRefundApplications: async (clientId, rows, pullTs, opts) => {
    const batch = dedupeRows(rows, ['client_id', 'portal_key']);
    if (batch.length > 0) {
      await upsert('gst_refund_applications', 'client_id,portal_key', batch);
    }
    return guardedSoftDelete('gst_refund_applications', `client_id=eq.${clientId}`, batch, pullTs, opts);
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

  // 0.8.0 — one notice's own columns, separately from the notices upsert.
  // Two things need this. The DIN: this extension cannot migrate the
  // database, and an unknown column anywhere in the upsert body would fail
  // the whole client's notices save, so the DIN goes in a PATCH of its own
  // that fails harmlessly on a database without the column — the same
  // reasoning patchRefundDocument above is built on. And a refund notice's
  // PDF and reply date: those live in the refund case's folder, which the
  // refunds step reads after the notices are already saved, so patching is
  // the only way to get them onto the notice in the same run.
  // Manual rows (portal_key 'manual:…') are never touched: they are the
  // firm's own, and the portal has nothing to say about them.
  // 0.8.0: this client's portal notices that are still missing a PDF, a reply
  // date or an officer. Read once by the refunds step so its link pass patches
  // only what is actually missing, and never a notice the firm entered itself.
  noticesNeedingDetail: async (clientId) => {
    try {
      const rows = await sel(`gst_notices?client_id=eq.${clientId}&source=eq.notices&deleted_at=is.null`
        + '&or=(pdf_url.is.null,due_date.is.null,issued_by.is.null)'
        + '&reference_number=not.is.null'
        + '&select=portal_key,reference_number,pdf_url,due_date,issued_by&limit=2000');
      // The firm's own rows are filtered here rather than in the query: a
      // `not.like.manual:*` filter whose value carries a colon is the kind of
      // thing PostgREST answers with a 400, and this reader swallows its own
      // errors, so a filter that failed would silently return nothing at all.
      return (rows || []).filter((r) => String(r.portal_key || '').indexOf('manual:') !== 0);
    } catch (e) { return []; }
  },

  patchNoticeFields: async (clientId, portalKey, patchObj) => {
    const key = String(portalKey || '');
    if (!key || key.indexOf('manual:') === 0) return false;
    if (!patchObj || !Object.keys(patchObj).length) return false;
    await patch(`gst_notices?client_id=eq.${clientId}&source=eq.notices&portal_key=eq.${enc(key)}`, patchObj);
    return true;
  },

  // DRC-03 voluntary payments — upsert on (client_id, portal_key).
  replaceDrc03Filings: async (clientId, rows, pullTs, opts) => {
    const batch = dedupeRows(rows, ['client_id', 'portal_key']);
    if (batch.length > 0) {
      await upsert('gst_drc03_filings', 'client_id,portal_key', batch);
    }
    return guardedSoftDelete('gst_drc03_filings', `client_id=eq.${clientId}`, batch, pullTs, opts);
  },

  // Taxpayer profile — one row per client (client_id UNIQUE), so this is a
  // true upsert rather than delete-then-insert: a failed re-pull leaves
  // whatever the last successful pull wrote untouched instead of blanking
  // it, unlike the list tables above.
  // One row per Sync All attempt (success or failed) — see db.js's
  // logClientSync doc comment for the guard that keeps this scoped to the
  // 'notices' Sync All job only.
  logClientSync: (clientId, action, status, message) =>
    post('client_sync_log', [{ client_id: clientId, action, status, message: message || null }]),

  // Case folder items — upsert on (client_id, case_id, portal_key).
  replaceCaseFolderItems: async (clientId, caseId, rows, pullTs, opts) => {
    const batch = dedupeRows(rows, ['client_id', 'case_id', 'portal_key']);
    if (batch.length > 0) {
      await upsert('gst_case_folder_items', 'client_id,case_id,portal_key', batch);
    }
    return guardedSoftDelete('gst_case_folder_items', `client_id=eq.${clientId}&case_id=eq.${enc(caseId)}`, batch, pullTs, opts);
  },

  // Closing sweep (public.notices_sweep): fills case due dates from the case
  // folder and auto-closes untriaged rows by rule, for this one client.
  runSweep: async (clientId) => {
    const r = await fetch(base + 'rpc/notices_sweep', { method: 'POST', headers: H, body: JSON.stringify({ p_client_id: clientId }) });
    if (!r.ok) throw new Error('RPC notices_sweep -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.json();
  },

  // { status, new, changed, unchanged, removed, held, held_reason } — see sync_ingest.
  ingest: async (clientId, runId, step, rows, opts, scope) => {
    const complete = !opts || opts.complete !== false;
    try {
      return await rpc('sync_ingest', {
        p_client_id: clientId, p_run_id: runId || null, p_step: step, p_rows: rows || [],
        p_ext_version: EXT_VERSION, p_complete: complete, p_scope: scope || null,
      });
    } catch (e) {
      if (!isMissingRpc(e)) throw e;
      const pullTs = new Date().toISOString();
      const res = await LEGACY_REPLACE[step](clientId, rows || [], pullTs, opts, scope);
      if (step === 'notices' || step === 'drc03') { try { await API.runSweep(clientId); } catch (e2) { /* nightly sweep */ } }
      return { status: res && res.held ? 'held' : 'ok', held_reason: res && res.held, legacy: true };
    }
  },
  runStart: async (mode, clientsTotal) => {
    try { return await rpc('sync_run_start', { p_mode: mode, p_clients_total: clientsTotal, p_ext_version: EXT_VERSION, p_machine: null }); }
    catch (e) { return null; } // ledger is diagnostic; a sync never waits on it
  },
  runFinish: async (runId, status, note) => {
    if (!runId) return null;
    try { return await rpc('sync_run_finish', { p_run_id: runId, p_status: status || 'done', p_note: note || null }); }
    catch (e) { return null; }
  },
  logStep: async (runId, clientId, step, status, reasonClass, message) => {
    try {
      return await rpc('sync_log_step', {
        p_run_id: runId || null, p_client_id: clientId, p_step: step, p_status: status,
        p_reason_class: reasonClass || null, p_message: message || null, p_ext_version: EXT_VERSION,
      });
    } catch (e) { return null; }
  },
  // 0.6.0: applications on the portal and kept notice detail (GSTR-3A). Both
  // are no-ops on a database without migration 20261007122000.
  ingestApplications: async (clientId, runId, rows, caseTypes, complete) => {
    try {
      return await rpc('sync_ingest_applications', {
        p_client_id: clientId, p_run_id: runId || null, p_rows: rows || [], p_case_types: caseTypes || [],
        p_ext_version: EXT_VERSION, p_complete: complete !== false,
      });
    } catch (e) {
      if (isMissingRpc(e)) return { status: 'skipped', reason: 'database not updated' };
      throw e;
    }
  },
  noticeDetails: async (clientId, rows) => {
    if (!rows || !rows.length) return 0;
    try { return await rpc('sync_notice_details', { p_client_id: clientId, p_rows: rows }); }
    catch (e) { if (isMissingRpc(e)) return 0; throw e; }
  },

  // Portal Autopilot (agent/, 0.6.0): the office agent starts one client's job
  // here, in its own browser, exactly as a person's Sync does — same steps,
  // same ingest. job.agent marks it: the CAPTCHA goes to the app's CAPTCHA
  // wall (no desktop notice), the login wait has no 60-second give-up and the
  // watchdog leaves it to the agent, and the run belongs to the queue, so this
  // worker never finishes it.
  startAgentJob: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const mode = info.mode || 'notices_bundle';
    const periods = Array.isArray(info.periods) && info.periods.length ? info.periods : [''];
    const job = {
      mode, period: periods[0], periods, periodIdx: 0, idx: 0, step: 'login',
      startedAt: Date.now(), lastActivityAt: Date.now(), runId: info.runId || null,
      logSync: mode === 'notices' || mode === 'notices_bundle',
      agent: { jobId: info.jobId || null },
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    // The job is stored before the tab loads the portal, so the first page
    // already finds it (a fast page could otherwise run ahead of the store).
    const tab = await chrome.tabs.create({ url: 'about:blank' });
    job.tabId = tab.id;
    await setActiveJob(job);
    armWatchdog();
    await chrome.tabs.update(tab.id, { url: info.startUrl || 'https://services.gst.gov.in/services/login' });
    return { started: true, tabId: tab.id, client: c.name, version: EXT_VERSION };
  },
  // What the agent watches: null once the job is over.
  agentJobState: async () => {
    const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
    if (!job) return null;
    return {
      step: job.step, mode: job.mode, periodIdx: job.periodIdx || 0, periods: (job.periods || []).length,
      captchaRetry: job.captchaRetry || 0, retries: job.retries || 0, lastActivityAt: job.lastActivityAt || null,
      tabId: job.tabId, jobId: job.agent ? job.agent.jobId : null,
    };
  },
  agentClearJob: async () => { await chrome.storage.local.remove('gstk_active_job'); return true; },
  // The popup's ledger pull opens its own tab and hands the job here, so it
  // takes the job slot like every other start (0.7.0).
  putActiveJob: async (job) => { await setActiveJob(job); return true; },

  // What is already stored for a client, so a run skips PDFs and attachments it
  // already has and fetches case folders only for new / open cases.
  knownDocs: async (clientId) => {
    const out = { noticePdf: {}, openCases: [], knownCases: [], itemDocs: {}, drc03Pdf: {}, refundDocs: {} };
    try {
      const notices = await sel(`gst_notices?client_id=eq.${clientId}&source=eq.notices&deleted_at=is.null&select=portal_key,pdf_url,case_id,staff_status`);
      const closedRe = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;
      for (const n of notices) {
        if (n.pdf_url) out.noticePdf[n.portal_key] = n.pdf_url;
        if (n.case_id) {
          out.knownCases.push(n.case_id);
          if (!closedRe.test((n.staff_status || '').trim())) out.openCases.push(n.case_id);
        }
      }
      const items = await sel(`gst_case_folder_items?client_id=eq.${clientId}&deleted_at=is.null&select=case_id,portal_key,attachments`);
      for (const it of items) out.itemDocs[it.case_id + '|' + it.portal_key] = Array.isArray(it.attachments) ? it.attachments : [];
      const drc = await sel(`gst_drc03_filings?client_id=eq.${clientId}&deleted_at=is.null&select=arn,pdf_url`);
      for (const d of drc) if (d.arn && d.pdf_url) out.drc03Pdf[d.arn] = d.pdf_url;
      // 0.7.1: refund documents already saved, per ARN ({tab, label, url}).
      const rf = await sel(`gst_refund_applications?client_id=eq.${clientId}&deleted_at=is.null&arn=not.is.null&select=arn,documents`);
      for (const r of rf) if (r.arn && Array.isArray(r.documents) && r.documents.length) out.refundDocs[r.arn] = r.documents;
    } catch (e) { /* best-effort: an empty map just means "fetch everything" */ }
    return out;
  },
  // Sync All order: open notices due within 7 days (or overdue) first, then
  // never-synced, then the stalest (public.sync_queue). Null when unavailable.
  syncQueue: async (clientIds) => {
    try { return await rpc('sync_queue', { p_client_ids: clientIds && clientIds.length ? clientIds : null }); }
    catch (e) { return null; }
  },
  // Desktop notice that a CAPTCHA is waiting (the sync tab may be behind other windows).
  notifyCaptcha: async (clientName, progress) => {
    if (!chrome.notifications) return false;
    chrome.notifications.create('gstk-captcha', {
      type: 'basic', iconUrl: 'icon128.png', priority: 2, requireInteraction: true,
      title: 'GST Keeper: CAPTCHA waiting',
      message: 'Type the CAPTCHA for ' + (clientName || 'the next client') + (progress || '') + ' to continue the sync.',
    });
    return true;
  },
  clearCaptchaNotice: async () => { if (chrome.notifications) chrome.notifications.clear('gstk-captcha'); return true; },

  // The portal password is fetched only at the moment the login form is
  // filled, never stored with the job in chrome.storage.
  getPortalPassword: async (clientId) => {
    const rows = await sel(`clients?id=eq.${clientId}&select=gst_password&limit=1`);
    return (rows[0] && rows[0].gst_password) || null;
  },

  // 0.8.1 — a password the portal refused is never offered again. A bulk or
  // scheduled sync skips that client at once, logged as a failed login, and
  // moves to the next one, until the user ID or password saved in GST Keeper
  // changes (or someone logs that client in once by hand). Retrying a wrong
  // password achieves nothing and, a few tries in, the portal locks the
  // client's account. Only a salted SHA-256 fingerprint of the refused user ID
  // and password is kept, in this Chrome's own storage; never the password.
  // `pass` is the one the login form was filled with; the runner, which has
  // none, leaves it out and the saved one is read.
  pwRefusalCheck: async (clientId, user, pass) => {
    const all = await pwRefusals();
    const m = all[clientId];
    if (!m) return null;
    if (pass == null) pass = await API.getPortalPassword(clientId);
    if (m.fp === await pwFingerprint(user, pass)) return { at: m.at, reason: m.reason, message: m.message };
    // Changed in GST Keeper since it was refused: the new one is tried.
    delete all[clientId];
    await chrome.storage.local.set({ [PW_REFUSED_KEY]: all });
    return null;
  },
  pwRefusalMark: async (clientId, user, pass, info) => {
    const all = await pwRefusals();
    all[clientId] = {
      fp: await pwFingerprint(user, pass), at: new Date().toISOString(),
      reason: String((info && info.reason) || 'wrong_password'), message: String((info && info.message) || '').slice(0, 300),
      name: String((info && info.name) || '').slice(0, 120),
    };
    await chrome.storage.local.set({ [PW_REFUSED_KEY]: all });
    return true;
  },
  pwRefusalClear: async (clientId) => {
    const all = await pwRefusals();
    if (!all[clientId]) return false;
    delete all[clientId];
    await chrome.storage.local.set({ [PW_REFUSED_KEY]: all });
    return true;
  },
  // Every client whose saved password is waiting to be changed (name, when, why).
  pwRefusalList: async () => Object.entries(await pwRefusals())
    .map(([clientId, m]) => ({ clientId, name: m.name || null, at: m.at, reason: m.reason, message: m.message })),

  upsertTaxpayerProfile: async (clientId, patchObj) => {
    const write = async (obj) => {
      const ex = await sel(`gst_taxpayer_profile?client_id=eq.${clientId}&select=id&limit=1`);
      if (ex[0]) return patch(`gst_taxpayer_profile?id=eq.${ex[0].id}`, obj);
      return post('gst_taxpayer_profile', [{ client_id: clientId, ...obj }]);
    };
    try { return await write(patchObj); }
    catch (e) {
      // A database without migration 20261007122000 has no status columns yet.
      const { gstin_status, cancellation_date, profile_json, ...rest } = patchObj || {};
      if (gstin_status === undefined && cancellation_date === undefined && profile_json === undefined) throw e;
      return write(rest);
    }
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
    // Wait for the Referer-rewrite rule above, or this request can beat it.
    // Never blocks longer than a moment: a slow or failed registration falls
    // through to the fetch, exactly as before 0.8.0.
    try { await Promise.race([dnrReady, new Promise((r) => setTimeout(r, 3000))]); } catch (e) { /* fetch anyway */ }
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('fetchCrossOriginAsBase64 -> HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    return { base64: abToBase64(buf), contentType: r.headers.get('content-type') || 'application/octet-stream' };
  },

  // Diagnostic-only, called once per GSTR-3A batch from content.js and folded
  // into the same client_sync_log message the rest of that batch's errors
  // already go to — confirms whether the Referer-rewrite declarativeNetRequest
  // rule (registered at the top of this file) actually registered, without
  // needing anyone to open the service worker's own DevTools to check.
  getDnrDebug: async () => {
    try {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      return { ok: true, rules };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  },

  // Upload a base64 data-URL PDF to the return-pdfs bucket, return its public URL.
  // AbortController timeout (not just a content.js-side race) so a stuck
  // upload doesn't leave the request itself running indefinitely — this
  // call went from "once per notice row" to "once per case-folder
  // attachment, across every case" (see content.js's Additional Notice
  // Folder capture), multiplying how often a single slow/stuck request can
  // occur. Confirmed live 2026-08-27: a real sync hung 20+ minutes with no
  // progress and no error, on exactly this class of unbounded fetch.
  uploadPdf: async (path, dataUrl) => {
    const b64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(SUPABASE_URL + '/storage/v1/object/return-pdfs/' + path, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/pdf', 'x-upsert': 'true',
        },
        body: bytes,
        signal: controller.signal,
      });
      if (!r.ok) throw new Error('PDF upload -> ' + r.status + ' ' + (await r.text()).slice(0, 100));
      return SUPABASE_URL + '/storage/v1/object/public/return-pdfs/' + path;
    } finally {
      clearTimeout(timer);
    }
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
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
      ret: { return_type: info.return_type, period_month: info.period_month },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
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
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
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
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name };
  },

  // From the Filing Status login icon: log the client in and open the given
  // return's filing page (current tab's return + period). The human does the
  // CAPTCHA and the final OTP/DSC submission — we only log in + navigate.
  //
  // Opened in the BACKGROUND (active: false) — the user asked not to watch
  // the automated Returns-Dashboard navigation (FY/Quarter/Month/Search/tile
  // click) play out on screen. content.js brings it back to the foreground
  // itself at the two points that actually need a human: right before the
  // CAPTCHA wait in handleLogin, and right before the final "Prepare Online"
  // click in handleFiling (see focusTab/backgroundTab below). Every other
  // job-opened tab in this file is untouched — this is scoped to job.mode
  // 'filing' only, not a blanket change.
  startFilingOpen: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'filing', period: info.period_month, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
      ret: { return_type: info.return_type, period_month: info.period_month },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login', active: false });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name, return_type: info.return_type };
  },

  // From a reco page "Pull" button (GST Receivable Reco or Suspended Reco —
  // same button, same message, both pages): log the client in and pull the
  // ledger opening balances (credit ledger -> GST Receivable Reco, reversal
  // ledger -> Suspended Reco). Human does the CAPTCHA.
  //
  // mode: 'ledgers' stops the job right after the reversal ledger
  // (handleReversal's own chainOrStop) instead of falling through to
  // Liability Ledger, Cash Ledger, Notices, Refunds, DRC-03, Taxpayer
  // Profile, Challans, ... — the "no mode set" behavior this job used to
  // have, which is really the full comprehensive sync, not something
  // either reco page's own Pull button ever meant to trigger. Confirmed
  // with the user 2026-09-16: they use both pages' Pull buttons together
  // and only want the two ledgers each pull already covers, not a silent
  // full-client sync as a side effect.
  startLedgerPull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'ledgers', period: info.period_month, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
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
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name, mode: info.mode, periods: periods.length };
  },

  // Same as startSectionPull but queues MULTIPLE clients with saved
  // credentials instead of one — the Notices Dashboard's "Sync All" (every
  // credentialed client, info.clientIds omitted) and the Company List
  // page's selection-scoped "Sync"/"Fetch Company" buttons (info.clientIds
  // = the checked rows, confirmed live against Notice Alert 2026-08-26:
  // both of their equivalent buttons require and respect a row selection,
  // not "run for everyone"). content.js's queue processor (job.idx/
  // job.clients, see the top of the file) already handles an arbitrary-
  // length clients array generically — filtering which clients populate
  // that array is the only new piece, reusing the same machinery rather
  // than adding a second one. Each client still needs its own CAPTCHA typed
  // in the portal tab before the next one starts, same as the extension
  // popup's own "All clients" option.
  startAllClientsSectionPull: async (info) => {
    const all = await API.getClients();
    let withCreds = all.filter((c) => c.gst_user_id);
    // "Exclude from Notices Dashboard sync" (Edit Client) — only gates the
    // Notices Dashboard's own bulk pulls, not every bulk section pull this
    // same function serves (e.g. Company List's "Fetch Company", mode
    // 'taxpayerprofile', is unaffected). Applied even when info.clientIds is
    // scoped (a hand-picked selection), as a safety net — Company List
    // already filters its own Sync button's selection before it gets here,
    // but Notices Dashboard's unscoped "Sync All" has no such pre-filter.
    if (info.mode === 'notices' || info.mode === 'notices_bundle') {
      withCreds = withCreds.filter((c) => !c.notices_sync_excluded);
    }
    const scoped = Array.isArray(info.clientIds) && info.clientIds.length;
    if (scoped) {
      const idSet = new Set(info.clientIds);
      withCreds = withCreds.filter((c) => idSet.has(c.id));
    } else if (info.mode === 'notices' || info.mode === 'notices_bundle') {
      // An unscoped Sync All skips clients marked inactive (Edit Client);
      // a hand-picked selection still syncs them.
      withCreds = withCreds.filter((c) => !c.inactive_at_hand);
    }
    // 0.8.2: a client whose portal login was refused (Notices · Settings,
    // "Portal password issues") is skipped until its password is fixed.
    const passwordIssues = withCreds.filter((c) => c.portal_login_issue);
    withCreds = withCreds.filter((c) => !c.portal_login_issue);
    if (!withCreds.length) {
      throw new Error(passwordIssues.length
        ? 'Every selected client has a portal password issue; fix them in Notices · Settings first.'
        : scoped ? 'None of the selected clients have saved GST portal credentials.' : 'No clients have saved GST portal credentials.');
    }
    const isNotices = info.mode === 'notices' || info.mode === 'notices_bundle';
    // Notices runs go most urgent first: open notices due within 7 days (or
    // overdue), then never synced, then the stalest. Anything the queue does
    // not know keeps its name order at the end.
    if (isNotices) {
      const queue = await API.syncQueue(withCreds.map((c) => c.id));
      if (Array.isArray(queue) && queue.length) {
        const rank = new Map(queue.map((q, i) => [q.client_id, i]));
        withCreds = [...withCreds].sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
      }
    }
    const runId = isNotices ? await API.runStart(info.mode, withCreds.length) : null;
    const job = {
      mode: info.mode, period: info.period_month || '', idx: 0, step: 'login', startedAt: Date.now(), runId,
      // Only the Notices Dashboard's Sync All records a Company List
      // sync-log row per client — every other section (refunds/drc03/
      // taxpayerprofile/etc) uses this exact same job machinery unchanged.
      // 'notices_bundle' is that same Sync All button, just also chaining
      // through Refunds and DRC-03 (see chainOrStop in content.js) — still
      // one client_sync_log entry per client, from the notices step itself.
      logSync: info.mode === 'notices' || info.mode === 'notices_bundle',
      clients: withCreds.map((c) => ({
        clientId: c.id,
        creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      })),
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    job.lastActivityAt = Date.now();
    await setActiveJob(job);
    armWatchdog();
    return { started: true, count: withCreds.length, mode: info.mode, skippedPasswordIssues: passwordIssues.length };
  },

  // From the Clients → Credentials "Login" button: just log the client into the
  // GST portal and stop (mode 'login'). No return/ledger navigation. Human does
  // the CAPTCHA.
  startPortalLogin: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'login', idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name };
  },

  // From a Notices Dashboard row's "Portal" icon: log the client in and land
  // directly on the Notices & Orders list — saves "find the right client,
  // log in, navigate to Notices & Orders" before staff can search for the
  // specific reference number themselves. This does NOT open the specific
  // notice's own case/reply page: that varies by notice type (plain
  // document fetch, litserv case/folder, or a dedicated spikeweb module
  // depending on the notice — confirmed live 2026-08-25) and the actual
  // reply-submission flow couldn't be reverse-engineered because the GST
  // portal's own reply modal wasn't rendering for anyone at the time, not
  // just automation. This is the safe subset of that task: get the human to
  // the right list, logged in as the right client, instead of doing nothing.
  startNoticeOpen: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const job = {
      mode: 'noticeopen', idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
      referenceNumber: info.referenceNumber || '',
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name };
  },

  // From the GSTR-1 "Upload to GST Portal" button. Fetches the stored GSTR-1
  // JSON + client credentials, then opens a portal tab. The content script
  // logs in, navigates to the return dashboard, uploads the JSON, waits for
  // the portal to finish processing, and writes the outcome (accepted /
  // partial / failed + per-invoice errors) to chrome.storage — appbridge.js
  // relays it to the app. Filing / signing stays manual.
  // 0.8.4: info.nil === true is a NIL push — no stored JSON is needed (rowId
  // stays null); content.js ticks the portal's "File Nil GSTR-1" option
  // instead of uploading. A JSON push now carries the period's IRNs
  // (einvoice_docs, attachIrn below) so the upload does not drop them.
  startGstr1Upload: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    // gstr1_data.period_month is stored as the short label (e.g. "Jun-26")
    // — convert from the app's MM/YYYY.
    const [mm, yyyy] = String(info.period_month).split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) throw new Error('Bad period_month.');
    const short = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mm - 1] + '-' + String(yyyy).slice(-2);
    const nil = info.nil === true;
    let stored = null;
    let json = null;
    let irnAttached = 0;
    if (!nil) {
      const rows = await sel(`gstr1_data?client_id=eq.${c.id}&period_month=eq.${enc(short)}&select=id,raw_json&limit=1`);
      stored = rows && rows[0];
      if (!stored) throw new Error(`No stored GSTR-1 JSON for ${c.name} / ${short}. Import a JSON first.`);
      json = stored.raw_json;
      // A failed read of einvoice_docs must never block the push: it goes up
      // as stored, with no IRN attached.
      try {
        const einv = await sel(`einvoice_docs?client_id=eq.${c.id}&period_month=eq.${enc(info.period_month)}&select=section,ctin,doc_key,irn,irn_date`);
        const res = attachIrn(json, Array.isArray(einv) ? einv : []);
        json = res.json;
        irnAttached = res.attached;
      } catch (e) {
        console.warn('[GSTKeeper] einvoice_docs read failed — pushing without IRNs:', e && e.message);
        irnAttached = 0;
      }
    }
    const job = {
      mode: 'gstr1_upload',
      idx: 0,
      step: 'login',
      startedAt: Date.now(),
      period: info.period_month,
      actorId: info.actorId || null,
      clients: [{
        clientId: c.id,
        creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
      gstr1: {
        rowId: stored ? stored.id : null,
        periodShort: short,
        // Serialize once here — content.js will reconstruct a File from this.
        json,
        irnAttached,
        nil,
      },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name, period: short, nil, irnAttached };
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
        creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
      gstr3b: { json: info.gstr3bJson },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name };
  },

  // Content script calls this after the portal finishes processing an upload,
  // to persist the outcome so the "last uploaded" indicator survives a refresh.
  // Also records the attempt in gstr1_upload_versions for the Version History
  // dialog — one row per portal upload / refresh so the audit trail is
  // complete no matter which path triggered it.
  saveGstr1UploadResult: async ({ rowId, status, summary, errors, actorId, actionType }) => {
    // 0.8.4: a NIL push has no stored row — nothing to write.
    if (!rowId) return false;
    // Pull client_id + period_month back from gstr1_data — we need them for
    // the versions insert but the content script only knows the row id.
    const rows = await sel(`gstr1_data?id=eq.${rowId}&select=client_id,period_month,raw_json&limit=1`);
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
          // Snapshot of the JSON as uploaded, so Version History can diff two
          // attempts down to the individual invoice and figure.
          payload: row.raw_json || null,
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
        creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
      gstr1: { rowId: stored.id, periodShort: short },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name, period: short };
  },

  // 0.8.4: from the GSTR-1 page's "Pull e-invoices" button. Logs the client in
  // like the other single-client pulls; content.js (handleEinvoicePull) then
  // downloads the portal's own GSTR-1 JSON for the period — the same
  // offline/download/generate API handleGstr1JsonPull uses — and hands it to
  // saveEinvoicePull below. Human does the CAPTCHA.
  startEinvoicePull: async (info) => {
    const c = await API.getClient(info.clientId);
    if (!c || !c.gst_user_id) throw new Error('This client has no saved GST credentials.');
    const [mm, yyyy] = String(info.period_month).split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) throw new Error('Bad period_month.');
    const job = {
      mode: 'einvoice_pull',
      idx: 0,
      step: 'login',
      startedAt: Date.now(),
      period: info.period_month,
      actorId: info.actorId || null,
      clients: [{
        clientId: c.id,
        creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      }],
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name, period: info.period_month };
  },

  // Saves one e-invoice pull. With `json` (the portal's GSTR-1 JSON) its
  // IRN-bearing documents are upserted into einvoice_docs — never deleted, so
  // a re-pull only adds or refreshes rows; first_seen_at is not sent, so the
  // database default stays on insert and is kept on update. Every call
  // (ok / none / pending / failed) records the attempt in einvoice_pulls.
  saveEinvoicePull: async ({ clientId, period_month, actorId, json, status, message }) => {
    let st = status || 'failed';
    let msg = message || null;
    let docsFound = 0;
    if (json) {
      const now = new Date().toISOString();
      const docs = extractEinvoiceDocs(json);
      docsFound = docs.length;
      try {
        const rows = dedupeRows(docs.map((d) => ({
          ...d, client_id: clientId, period_month, source: 'portal_gstr1', last_seen_at: now,
        })), ['section', 'ctin', 'doc_key']);
        for (let i = 0; i < rows.length; i += 500) {
          await upsert('einvoice_docs', 'client_id,period_month,section,ctin,doc_key', rows.slice(i, i + 500));
        }
        st = docsFound ? 'ok' : 'none';
        msg = docsFound
          ? docsFound + ' e-invoice document(s) with an IRN found in the portal\'s GSTR-1.'
          : 'No document in the portal\'s GSTR-1 for this period carries an IRN.';
      } catch (e) {
        st = 'failed';
        msg = 'Could not save the e-invoice documents: ' + ((e && e.message) || e);
      }
    }
    try {
      await upsert('einvoice_pulls', 'client_id,period_month', [{
        client_id: clientId, period_month, status: st, docs_found: docsFound, message: msg,
        pulled_by: actorId || null, pulled_at: new Date().toISOString(),
      }]);
    } catch (e) {
      console.warn('[GSTKeeper] einvoice_pulls write failed:', e && e.message);
    }
    return { status: st, docsFound, message: msg };
  },
};

// ── E-invoice (IRN) documents (0.8.4) ───────────────────────────────────────
// Plain-JS copy of normDocKey / docMatchKey / extractDocs / attachIrn from
// src/lib/einvoice/einvoice.ts (no bundler here) — keep the two in step.
// extractDocs adds `raw` (the document as the portal gave it) for einvoice_docs.
const einvNum = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v)); return Number.isFinite(n) ? n : 0; };
const einvStr = (v) => (v == null ? '' : String(v)).trim();
const einvArr = (v) => (Array.isArray(v) ? v : []);
const einvRound2 = (n) => Math.round(n * 100) / 100;
const normDocKey = (docNo) => einvStr(docNo).toUpperCase().replace(/[^A-Z0-9]/g, '');
const docMatchKey = (d) => d.section + '|' + einvStr(d.ctin).toUpperCase() + '|' + d.doc_key;
const einvNoteType = (nt) => (einvStr(nt.ntty != null ? nt.ntty : (nt.typ != null ? nt.typ : 'C')).toUpperCase().startsWith('D') ? 'DBN' : 'CRN');

function extractDocs(json) {
  const j = json || {};
  const out = [];
  const push = (section, docType, docNo, ctin, d, date, pos, raw) => {
    const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    einvArr(d.itms).forEach((it) => {
      const x = (it && it.itm_det) || it || {};
      t.taxable += einvNum(x.txval); t.igst += einvNum(x.iamt); t.cgst += einvNum(x.camt);
      t.sgst += einvNum(x.samt); t.cess += einvNum(x.csamt);
    });
    out.push({
      section,
      doc_type: docType,
      doc_no: einvStr(docNo),
      doc_key: normDocKey(docNo),
      ctin: einvStr(ctin).toUpperCase(),
      doc_date: einvStr(date) || null,
      irn: einvStr(d.irn) || null,
      irn_date: einvStr(d.irngendate) || null,
      inv_typ: einvStr(d.inv_typ != null ? d.inv_typ : d.typ) || null,
      pos: einvStr(pos) || null,
      doc_value: einvRound2(einvNum(d.val)),
      taxable: einvRound2(t.taxable),
      igst: einvRound2(t.igst),
      cgst: einvRound2(t.cgst),
      sgst: einvRound2(t.sgst),
      cess: einvRound2(t.cess),
      raw: raw || d,
    });
  };
  einvArr(j.b2b).forEach((p) => einvArr(p.inv).forEach((inv) => push('b2b', 'INV', inv.inum, p.ctin, inv, inv.idt, inv.pos)));
  einvArr(j.cdnr).forEach((p) => einvArr(p.nt).forEach((nt) => push('cdnr', einvNoteType(nt), nt.nt_num, p.ctin, nt, nt.nt_dt, nt.pos)));
  einvArr(j.cdnur).forEach((nt) => push('cdnur', einvNoteType(nt), nt.nt_num, '', nt, nt.nt_dt, nt.pos));
  einvArr(j.exp).forEach((e) => einvArr(e.inv).forEach((inv) => push('exp', 'INV', inv.inum, '', { ...inv, typ: e.exp_typ }, inv.idt, null, inv)));
  einvArr(j.b2cl).forEach((s) => einvArr(s.inv).forEach((inv) => push('b2cl', 'INV', inv.inum, '', inv, inv.idt, s.pos)));
  return out.filter((d) => d.doc_key);
}
const extractEinvoiceDocs = (portalJson) => extractDocs(portalJson).filter((d) => !!d.irn);

// Copy of `json` with irn / irngendate / srctyp 'e-Invoice' set on every
// B2B / CDNR / CDNUR / EXP document that has a stored e-invoice and no IRN of
// its own. The figures are never changed.
function attachIrn(json, einv) {
  const copy = JSON.parse(JSON.stringify(json || {}));
  const map = new Map();
  einvArr(einv).forEach((e) => { if (e.irn) map.set(docMatchKey(e), { irn: e.irn, irn_date: e.irn_date != null ? e.irn_date : null }); });
  let attached = 0;
  let alreadyHad = 0;
  const apply = (section, ctin, docNo, d) => {
    if (einvStr(d.irn)) { alreadyHad += 1; return; }
    const hit = map.get(docMatchKey({ section, ctin: einvStr(ctin).toUpperCase(), doc_key: normDocKey(docNo) }));
    if (!hit) return;
    d.irn = hit.irn;
    if (hit.irn_date) d.irngendate = hit.irn_date;
    d.srctyp = 'e-Invoice';
    attached += 1;
  };
  einvArr(copy.b2b).forEach((p) => einvArr(p.inv).forEach((inv) => apply('b2b', p.ctin, inv.inum, inv)));
  einvArr(copy.cdnr).forEach((p) => einvArr(p.nt).forEach((nt) => apply('cdnr', p.ctin, nt.nt_num, nt)));
  einvArr(copy.cdnur).forEach((nt) => apply('cdnur', '', nt.nt_num, nt));
  einvArr(copy.exp).forEach((e) => einvArr(e.inv).forEach((inv) => apply('exp', '', inv.inum, inv)));
  return { json: copy, attached, alreadyHad };
}

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

// ── Watchdog (0.5.0) ────────────────────────────────────────────────────────
// A job used to be dropped silently by the next page load once it had been
// idle 10 minutes (or run 3 hours). Now an alarm checks every minute: a
// client stuck for 10 minutes is recorded in the run ledger (CAPTCHA not
// typed, or stalled) and the run moves on to the next client; a run past
// 3 hours is closed as abandoned with every remaining client recorded.
const WATCHDOG = 'gstk-watchdog';
const IDLE_LIMIT_MS = 10 * 60 * 1000;
const RUN_LIMIT_MS = 3 * 60 * 60 * 1000;
function armWatchdog() {
  try { chrome.alarms.create(WATCHDOG, { periodInMinutes: 1 }); } catch (e) { /* alarms unavailable */ }
}
async function watchdogTick() {
  const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
  if (!job) { try { chrome.alarms.clear(WATCHDOG); } catch (e) { /* ignore */ } return; }
  // Only notices runs (they carry a ledger run id); every other sync keeps the
  // content script's old rule (dropped on the next page load after 10 idle
  // minutes or 3 hours), exactly as content.js expects.
  if (!job.runId) return;
  const now = Date.now();
  const clients = job.clients || [];
  const idx = job.idx || 0;
  const cur = clients[idx];
  const idle = now - (job.lastActivityAt || job.startedAt || now);
  // An agent job or a scheduled job (job.runner, runner.js): the agent or the
  // runner owns the CAPTCHA wait and the run. A step stuck for 10 minutes is
  // recorded and the job dropped; the agent or the runner sees it go.
  if (job.agent || job.runner) {
    if (job.step === 'login' || idle < IDLE_LIMIT_MS || !cur) return;
    await API.logStep(job.runId, cur.clientId, job.step || 'notices', 'failed', 'stalled',
      'No progress for 10 minutes on step ' + job.step + '.');
    await chrome.storage.local.remove('gstk_active_job');
    return;
  }
  if (now - (job.startedAt || now) > RUN_LIMIT_MS) {
    for (let i = idx; i < clients.length; i++) {
      await API.logStep(job.runId, clients[i].clientId, job.step === 'login' ? 'login' : (job.step || 'notices'), 'skipped', 'stalled', 'Run stopped after 3 hours before reaching this client.');
    }
    await API.runFinish(job.runId, 'abandoned', 'Stopped after 3 hours.');
    await chrome.storage.local.remove('gstk_active_job');
    notify('gstk-run', 'GST Keeper: sync stopped', 'The sync ran for 3 hours and was stopped. ' + (clients.length - idx) + ' client(s) were not reached; they are marked in the run ledger.');
    return;
  }
  if (idle < IDLE_LIMIT_MS || !cur) return;
  const atLogin = job.step === 'login';
  await API.logStep(job.runId, cur.clientId, atLogin ? 'login' : (job.step || 'notices'), 'failed',
    atLogin ? 'captcha_timeout' : 'stalled',
    atLogin ? 'No CAPTCHA entered for 10 minutes — moved on.' : 'No progress for 10 minutes on step ' + job.step + ' — moved on.');
  job.idx = idx + 1;
  delete job.captchaRetry;
  job.retries = 0;
  job.lastActivityAt = now;
  if (job.idx >= clients.length) {
    await API.runFinish(job.runId, 'done', 'Last client stalled.');
    await chrome.storage.local.remove('gstk_active_job');
    return;
  }
  job.periodIdx = 0;
  if (Array.isArray(job.periods)) job.period = job.periods[0];
  job.step = 'logout';
  await chrome.storage.local.set({ gstk_active_job: job });
  if (job.tabId != null) {
    try { await chrome.tabs.update(job.tabId, { url: 'https://services.gst.gov.in/services/logout' }); } catch (e) { /* tab closed */ }
  }
  notify('gstk-run', 'GST Keeper: moved on', (cur.creds && cur.creds.name ? cur.creds.name : 'A client') + ' made no progress for 10 minutes and was skipped.');
}
function notify(id, title, message) {
  try { chrome.notifications.create(id, { type: 'basic', iconUrl: 'icon128.png', title, message, priority: 1 }); } catch (e) { /* ignore */ }
}
if (chrome.alarms && chrome.alarms.onAlarm) {
  // Inside the job slot: its read, ledger write and write-back never interleave with a new start.
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === WATCHDOG) jobSlot(watchdogTick).catch(() => {}); });
}
if (chrome.notifications && chrome.notifications.onClicked) {
  // Clicking the CAPTCHA notice brings the sync tab forward.
  chrome.notifications.onClicked.addListener(async (id) => {
    if (id !== 'gstk-captcha') return;
    const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
    if (job && job.tabId != null) {
      try {
        const tab = await chrome.tabs.update(job.tabId, { active: true });
        if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) { /* tab closed */ }
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.gstk) return;
  if (msg.fn === 'whoami') {
    sendResponse({ ok: true, data: { tabId: sender && sender.tab ? sender.tab.id : null, version: chrome.runtime.getManifest().version } });
    return true;
  }
  // Bring/send the CALLING tab to/from the foreground — content.js's own
  // tab, identified via sender.tab.id the same way whoami() is (a content
  // script has no chrome.tabs.* access itself; only the background worker
  // does). Currently only called from the 'filing' job mode (see
  // handleLogin/handleFiling in content.js) — first precedent for this
  // pattern in the extension, kept generic in case another flow wants it
  // later rather than being filing-specific itself.
  if (msg.fn === 'focusTab' || msg.fn === 'backgroundTab') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (tabId == null) { sendResponse({ error: 'no sender tab' }); return true; }
    const active = msg.fn === 'focusTab';
    chrome.tabs.update(tabId, { active })
      .then((tab) => (active && tab && tab.windowId != null) ? chrome.windows.update(tab.windowId, { focused: true }) : null)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
    return true;
  }
  const fn = API[msg.fn];
  if (!fn) { sendResponse({ error: 'unknown fn: ' + msg.fn }); return; }
  Promise.resolve(fn(...(msg.args || [])))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
  return true; // keep the channel open for the async response
});

// Scheduled syncs in this Chrome (0.7.0): the runner, off until switched on in the popup.
importScripts('runner.js');
