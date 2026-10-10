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
  // instead of uploading.
  // 0.8.7: e-invoices are kept, not re-sent. The page sends
  // info.einvoice = { keep: [{ section, ctin, doc_type, doc_no }], planAt }:
  // the books documents already on the portal's GSTR-1 as e-invoices with the
  // same figures. Each is left out of the copy uploaded (keepEinvoices below),
  // so the portal keeps its own record with the Source, IRN and IRN date; an
  // uploaded copy would overwrite it and lose them (GSTN advisory para 6).
  // Every other document, HSN (Table 12) and Table 13 go up as stored. The
  // IRN fields themselves are never written into an upload any more.
  // The plan also names the version of the return it was made on
  // (basisUpdatedAt: gstr1_data.updated_at as the page read it). The stored
  // row is read with its updated_at, and a different one (the return was
  // edited, re-imported or regenerated after the plan) refuses the push
  // before anything else: before the Upload History snapshot is cleared and
  // before a portal tab opens. A kept document edited meanwhile would
  // otherwise be left out with its new figures never sent. Compared by
  // instant (Date.parse), and only against the database's own timestamp, so
  // no PC's clock is involved.
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
    // null when the page sent no e-invoice plan (an older page): nothing is
    // left out, and the version row records no count.
    let einvoiceKept = null;
    let einvoiceKeepUnmatched = 0;
    const plan = !nil && info.einvoice && Array.isArray(info.einvoice.keep) ? info.einvoice : null;
    const basis = plan && plan.basisUpdatedAt != null && String(plan.basisUpdatedAt).trim() ? String(plan.basisUpdatedAt) : null;
    if (!nil) {
      const rows = await sel(`gstr1_data?client_id=eq.${c.id}&period_month=eq.${enc(short)}&select=id,raw_json,updated_at&limit=1`);
      stored = rows && rows[0];
      if (!stored) throw new Error(`No stored GSTR-1 JSON for ${c.name} / ${short}. Import a JSON first.`);
      if (basis && Date.parse(stored.updated_at) !== Date.parse(basis)) throw new Error(EINVOICE_BASIS_CHANGED);
      // 0.8.6: an earlier upload's Upload History snapshot (content.js
      // pretopKey) goes before anything else, so a push that dies before its
      // file is attached leaves none and Refresh errors records nothing for it.
      await chrome.storage.local.remove(PRETOP_PREFIX + stored.id);
      json = stored.raw_json;
      if (plan) {
        const res = keepEinvoices(json, plan.keep);
        json = res.json;
        einvoiceKept = res.kept;
        einvoiceKeepUnmatched = res.unmatched;
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
        einvoiceKept,
        einvoiceKeepUnmatched,
        einvoicePlanAt: plan && plan.planAt ? String(plan.planAt) : null,
        nil,
      },
    };
    const tab = await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    job.tabId = tab.id;
    await setActiveJob(job);
    return { started: true, client: c.name, period: short, nil, einvoiceKept: einvoiceKept || 0, einvoiceKeepUnmatched };
  },

  // From the GSTR-3B "Push to GST Portal" button. Unlike GSTR-1, there is no
  // gstr3b_data table — GSTR-3B is computed on the fly by the app's own
  // buildGstr3bJson() every time the page loads — so the app computes the
  // draft itself and passes the finished JSON straight through here rather
  // than this function re-deriving it from gstr1_data/itc_summaries/rcm_data
  // a second time (which would duplicate real tax-computation logic in two
  // languages and risk them drifting apart). 0.8.6: the outcome is recorded
  // by recordGstr3bPush below, with this job's client and period.
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
  // 0.8.7: an UPLOAD row also says which extension pushed (ext_version) and
  // how many e-invoices it left out so the portal keeps their IRN
  // (einvoice_kept; only when the page sent an e-invoice plan). A database
  // without those columns refuses the row; it is then written without them,
  // so a push is never recorded worse than before over them.
  saveGstr1UploadResult: async ({ rowId, status, summary, errors, actorId, actionType, einvoiceKept }) => {
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
      const action = actionType || 'UPLOAD';
      const version = {
        client_id: row.client_id,
        period_month: row.period_month,
        action_type: action,
        actor_id: actorId || null,
        status: status || null,
        summary: summary || null,
        errors: errors || null,
        // Snapshot of the stored books JSON (not the copy with e-invoices left
        // out), so Version History can diff two attempts down to the
        // individual invoice and figure.
        payload: row.raw_json || null,
      };
      const extra = {};
      if (action === 'UPLOAD') {
        extra.ext_version = EXT_VERSION;
        if (Number.isInteger(einvoiceKept) && einvoiceKept >= 0) extra.einvoice_kept = einvoiceKept;
      }
      try {
        await post('gstr1_upload_versions', [{ ...version, ...extra }]);
      } catch (e) {
        // A database without migration 0.8.7's columns (PGRST204, "Could not
        // find the 'einvoice_kept' column"): the row goes in without them.
        // Any other failure is tried the same way once; if the versions table
        // isn't there at all, the main row update above still stands.
        if (Object.keys(extra).length) {
          try { await post('gstr1_upload_versions', [version]); } catch (e2) { /* ignore */ }
        }
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

  // 0.8.5: a NIL push is recorded here, not only by the GSTR-1 page — the
  // page may have been closed while the portal was being driven, and then
  // the period never showed as Pushed in Filing Status. Same RPC the page
  // calls (mark_filing_pushed: stamps pushed_at, 'Pushed' unless Filed).
  markGstr1NilPushed: async ({ clientId, period_month, actorId }) => {
    if (!clientId || !period_month) return false;
    return rpc('mark_filing_pushed', {
      p_client_id: clientId, p_return_type: 'GSTR-1', p_period_month: period_month, p_actor: actorId || null,
    });
  },

  // 0.8.6: every GSTR-3B push (filled, partial or failed) is recorded here, by
  // the job's own client and period, as a Push History row — before, only an
  // open GSTR-3B page recorded it, against whatever client it showed. Same
  // REST path and anon key as gstr1_upload_versions (the table's policy is
  // open to public). status: 'ok' for 'filled', else 'partial' / 'failed'; a
  // database trigger turns an 'ok' row into Pushed in Filing Status, so
  // mark_filing_pushed is not called here. portalFilled entries (3.1(a)/(b),
  // left to the portal) are kept with the skipped ones. The content script
  // awaits this and tells the page whether it landed (`recorded`).
  recordGstr3bPush: async ({ clientId, period_month, actorId, status, summary, filled, skipped, portalFilled, payload }) => {
    if (!clientId || !period_month) return false;
    await post('gstr3b_push_versions', [{
      client_id: clientId,
      period_month,
      actor_id: actorId || null,
      status: status === 'filled' ? 'ok' : status,
      summary: summary || null,
      filled_count: Number(filled) || 0,
      skipped: [...(skipped || []), ...(portalFilled || [])],
      payload: payload || null,
    }]);
    return true;
  },

  // 0.8.6: how every GSTR-3B push ends (content.js finishGstr3b): its Push
  // History row (recordGstr3bPush), then the result for the page saying
  // whether that row landed, then the job cleared, in one step of the job
  // slot. pushTabClosed runs in the same slot, so a portal tab closed
  // meanwhile finds either the push unfinished (and reports it) or no job
  // (and writes nothing): never a second row, or the tab's words for a push
  // whose own outcome was known.
  finishGstr3bPush: (outcome) => jobSlot(async () => {
    const { tabId, status, summary, error, filled, skipped, portalFilled } = outcome || {};
    const target = { clientId: (outcome && outcome.clientId) || null, period_month: (outcome && outcome.period_month) || null };
    let recorded = false;
    try { recorded = (await API.recordGstr3bPush(outcome || {})) === true; } catch (e) { recorded = false; }
    await chrome.storage.local.set({ gstk_gstr3b_push_result: {
      ok: status !== 'failed', status, summary, ...(error ? { error } : {}), filled, skipped, portalFilled,
      ...target, recorded, at: Date.now(),
    } });
    const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
    if (job && job.mode === 'gstr3b_push' && (tabId == null || job.tabId === tabId)) await chrome.storage.local.remove('gstk_active_job');
    return recorded;
  }),

  // Saves one e-invoice pull. With `json` (the portal's GSTR-1 JSON):
  //   - 0.8.7: the JSON must be this client's (gstin) and this period's (fp,
  //     MMYYYY). A portal session left open for another client, or a file for
  //     another month, is 'failed' and no document is saved or marked.
  //   - 0.8.7: the file must have been generated today (IST). The portal
  //     names it returns_<ddmmyyyy>_..., the day it generated the file, and
  //     flag=0 can hand back a file generated days ago, which lacks every
  //     e-invoice auto-populated since. A file from an earlier day is recorded
  //     as status 'stale' with the steps to generate a fresh one, and no
  //     document is saved or marked. A name with no date is taken as today's,
  //     with a warning in the message. einvoice_pulls.generated_on keeps the
  //     date (null when the name gives none).
  //   - its IRN-bearing documents are upserted into einvoice_docs (source
  //     'portal_gstr1'), one row per section, buyer GSTIN, document type and
  //     exact document number (doc_key: upper case, spaces collapsed), so a
  //     credit note and a debit note with the same number are two rows.
  //     first_seen_at is not sent, so the database default stays on insert
  //     and is kept on update. Each carries last_seen_at = now and
  //     gone_at = null (a document back on the draft is no longer gone).
  //   - 0.8.7: once every upsert has succeeded, that client and period's
  //     'portal_gstr1' rows this pull did not see are marked gone_at = now,
  //     never deleted: the IRN stays on record, and the page reads the
  //     document as "IRN lost on the portal" rather than as never e-invoiced.
  //     Which rows went is decided by identity (section, buyer, type, number)
  //     against this pull's own rows, then patched by id, so no PC's clock is
  //     compared with another's.
  //   - 0.8.7: before its first write to einvoice_docs, the pull records
  //     itself in einvoice_pulls as status 'running' ('Pull in progress',
  //     pulled_at = now), and its final status replaces that at the end. The
  //     page refuses to push (or download the JSON) on a running pull, and a
  //     push re-reads the row before it starts, so it never plans on records
  //     half-way through a save. If 'running' cannot be written, nothing is
  //     saved or marked and the pull is 'failed'. A failure part-way through
  //     the save ends 'failed', never left 'running'.
  // Every call (ok / none / stale / pending / failed) records the attempt in
  // einvoice_pulls (source 'portal_gstr1'), with pulled_at = the same `now`
  // the pull stamped on last_seen_at and gone_at. A file for another client
  // or period, or a stale one, writes no document, so it goes straight to
  // its final status.
  // Written for migration 0.8.7's schema (doc_type in the unique key, source
  // in both keys, gone_at, generated_on); an older database refuses the
  // upsert and the pull is 'failed', never saved on the old key.
  // Not in the job slot by itself: content.js reaches it through
  // finishEinvoicePull below, which is.
  saveEinvoicePull: async ({ clientId, period_month, actorId, json, status, message, fileName, excelStep }) => {
    const now = new Date().toISOString();
    let st = status || 'failed';
    let msg = message || null;
    let docsFound = 0;
    let goneMarked = 0;
    let generatedOn = null;
    if (json) {
      generatedOn = einvoiceFileDate(fileName);
      try {
        const wrong = await einvoicePullMismatch(clientId, period_month, json);
        if (wrong) {
          st = 'failed';
          msg = wrong;
        } else if (generatedOn && generatedOn < istDay(now)) {
          st = 'stale';
          msg = einvoiceStaleText(generatedOn, period_month);
        } else {
          const rows = dedupeRows(extractEinvoiceDocs(json).map((d) => ({
            ...d, client_id: clientId, period_month, source: 'portal_gstr1', last_seen_at: now, gone_at: null,
          })), ['section', 'ctin', 'doc_type', 'doc_key']);
          // 'running' first: a push that reads the records from here until
          // the final status is written is refused (it throws if not saved).
          await writeEinvoicePullRow({
            client_id: clientId, period_month, source: 'portal_gstr1', status: 'running', docs_found: 0,
            message: EINVOICE_PULL_RUNNING, pulled_by: actorId || null, pulled_at: now, generated_on: generatedOn,
          });
          docsFound = rows.length;
          for (let i = 0; i < rows.length; i += 500) {
            await upsert('einvoice_docs', 'client_id,period_month,section,ctin,doc_type,doc_key,source', rows.slice(i, i + 500));
          }
          goneMarked = await markEinvoicesGone(clientId, period_month, rows, now);
          st = docsFound ? 'ok' : 'none';
          // 0.8.9: say exactly what the file held, and how it compares with
          // the e-invoice Excel imported for the month (10 Oct 2026: "no
          // document carries an IRN" read as "no e-invoices", when uploads
          // had replaced them on GSTR-1).
          let excel = null;
          try { excel = await einvoiceExcelOnDraft(clientId, period_month, rows); } catch (e) { excel = null; }
          msg = einvoicePullText(period_month, generatedOn, gstr1DocCounts(json), docsFound, excel)
            + (goneMarked ? ' ' + goneMarked + ' e-invoice(s) saved by an earlier pull are no longer on the portal as e-invoices.' : '')
            + (generatedOn ? '' : ' ' + einvoiceNoDateText(fileName));
        }
      } catch (e) {
        st = 'failed';
        docsFound = 0;
        goneMarked = 0;
        msg = 'Could not save the e-invoice documents: ' + ((e && e.message) || e);
      }
    }
    // 0.9.0: what the pull did on the month's GSTR-1 first (its e-invoice details).
    // 0.9.1: an import that landed after the pull stopped waiting is found here
    // (database time against database time: the row is not the baseline one).
    if (excelStep && excelStep.ok && !excelStep.imported && 'baseline' in excelStep) {
      try {
        const latest = await API.einvoiceExcelLatest(clientId, period_month);
        if (latest && latest.status === 'ok' && latest.pulled_at !== excelStep.baseline) {
          excelStep.imported = { docs: latest.docs_found, at: latest.pulled_at, message: latest.message || '' };
        }
      } catch (e) { /* said as not imported */ }
    }
    if (excelStep) msg = einvoiceEndText(excelStep, period_month, msg);
    const pull = {
      client_id: clientId, period_month, source: 'portal_gstr1', status: st, docs_found: docsFound, message: msg,
      pulled_by: actorId || null, pulled_at: now, generated_on: generatedOn,
    };
    try {
      await writeEinvoicePullRow(pull);
    } catch (e) {
      console.warn('[GSTKeeper] einvoice_pulls write failed:', e && e.message);
    }
    // staleRemoved: the same count under its first 0.8.7 name, for a page
    // written against it.
    return { status: st, docsFound, goneMarked, staleRemoved: goneMarked, generatedOn, message: msg };
  },

  // 0.8.7: how every e-invoice pull ends (content.js reportEinvoicePull): the
  // save (saveEinvoicePull), the result for the page, and the job cleared, in
  // one step of the job slot, as finishGstr3bPush does for GSTR-3B.
  // pushTabClosed runs in the same slot, so whichever comes first decides,
  // and the page hears one result:
  //   - the save first: it is done, the page hears its real outcome and the
  //     job is cleared; the closed tab then finds no job and writes nothing.
  //   - the closed tab first: the page hears "Nothing was saved" and the job
  //     is cleared; this then finds no job and saves nothing, so that stays
  //     true (also when the sync was stopped from the popup).
  // A job of another tab or mode (another sync took the slot meanwhile): the
  // pull is still saved (it was checked against its own client and period)
  // and its result written, and that other job is left alone. Never throws.
  // 0.9.0: the e-invoice Excel import recorded for this client and month
  // (einvoice_pulls, source einvoice_excel: one row, replaced by each import,
  // pulled_at = the database's now()), or null. 0.9.1: the pull reads it
  // before pressing the portal's download button and waits for a row that is
  // not that one, so no PC clock is compared with the database's.
  einvoiceExcelLatest: async (clientId, period_month) => {
    const rows = await sel(`einvoice_pulls?client_id=eq.${clientId}&period_month=eq.${enc(period_month)}&source=eq.einvoice_excel&select=status,docs_found,pulled_at,message&limit=1`);
    return (rows && rows[0]) || null;
  },

  finishEinvoicePull: (info) => jobSlot(async () => {
    const i = info || {};
    const target = { clientId: i.clientId || null, period_month: i.period_month || null };
    const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
    if (!job) {
      return { status: 'failed', docsFound: 0, goneMarked: 0, staleRemoved: 0, generatedOn: null, message: EINVOICE_ENDED, saved: false, ...target };
    }
    let res;
    try {
      res = await API.saveEinvoicePull(i);
    } catch (e) {
      res = { status: 'failed', docsFound: 0, goneMarked: 0, staleRemoved: 0, generatedOn: null, message: 'Could not save the e-invoice documents: ' + ((e && e.message) || e) };
    }
    const gone = Number(res.goneMarked) || 0;
    await chrome.storage.local.set({ gstk_einvoice_pull_result: {
      ok: res.status === 'ok' || res.status === 'none', status: res.status, docsFound: res.docsFound || 0,
      goneMarked: gone, staleRemoved: gone, generatedOn: res.generatedOn || null, message: res.message || '',
      ...target, at: Date.now(),
    } });
    if (job.mode === 'einvoice_pull' && (i.tabId == null || job.tabId === i.tabId)) await chrome.storage.local.remove('gstk_active_job');
    return { ...res, saved: true, ...target };
  }),
};

// What a pull's einvoice_pulls row says while it saves (status 'running').
const EINVOICE_PULL_RUNNING = 'Pull in progress';
// 0.8.7: one einvoice_pulls row (client, period, source). A database without
// generated_on (PGRST204) gets the row without the date; any other failure
// is tried once more the same way. Throws when neither write lands.
async function writeEinvoicePullRow(pull) {
  try {
    await upsert('einvoice_pulls', 'client_id,period_month,source', [pull]);
  } catch (e) {
    const older = { ...pull };
    delete older.generated_on;
    await upsert('einvoice_pulls', 'client_id,period_month,source', [older]);
  }
}

// 0.8.7: the day an e-invoice pull's file was generated, as yyyy-mm-dd, from
// the name of the JSON inside the portal's ZIP (returns_<ddmmyyyy>_R1_
// <gstin>_offline..., the day the portal generated it); null when the name
// carries no such date, or an impossible one.
function einvoiceFileDate(name) {
  const m = /returns_(\d{2})(\d{2})(\d{4})_/i.exec(einvStr(name));
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  if (yyyy < 2017 || yyyy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return yyyy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}
// The IST calendar day (yyyy-mm-dd) of an ISO instant.
const istDay = (iso) => new Date(Date.parse(iso) + 330 * 60 * 1000).toISOString().slice(0, 10);
const einvDmy = (ymd) => ymd.slice(8, 10) + '-' + ymd.slice(5, 7) + '-' + ymd.slice(0, 4);
// How staff make the portal generate a fresh GSTR-1 JSON for the period.
const EINVOICE_FRESH_STEPS = 'open GSTR-1 for the period on the portal and choose Prepare Offline → Download → Generate JSON file to download';
// 0.9.0: what the pull did on the month's GSTR-1 before reading its file:
// opened it and downloaded its e-invoice details (and whether GST Keeper
// imported them, when, and how many), or why it could not.
function einvoiceExcelStepText(step, period_month) {
  const [mm, yyyy] = String(period_month || '').split('/').map((n) => parseInt(n, 10));
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const label = mm && yyyy ? names[mm - 1] + ' ' + yyyy : einvStr(period_month);
  const ist = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + 330 * 60000).toISOString().slice(11, 16) + ' IST' : ''; };
  if (!step.ok) return 'Could not take the e-invoice details from the portal: ' + (step.note || 'unknown reason') + '.';
  const opened = 'Opened GSTR-1 for ' + label + ' on the portal and downloaded its e-invoice details (Excel)';
  if (!step.imported) {
    return opened + ', but GST Keeper did not import them (its GSTR-1 page was not open, or the file held no e-invoice of this client for this month; the GSTR-1 page says which): import the Excel by hand if the month has e-invoices.';
  }
  const n = Number(step.imported.docs) || 0;
  return opened + '; GST Keeper imported ' + n + ' e-invoice' + (n === 1 ? '' : 's') + ' from them' + (step.imported.at ? ' at ' + ist(step.imported.at) : '') + '.';
}
// The pull's message with what it did on the month's GSTR-1 in front. Once the
// e-invoice details were imported, "Nothing was saved" (a pull that then
// failed, stalled or lost its tab) is about the GSTR-1 file only.
function einvoiceEndText(step, period_month, text) {
  let t = text || '';
  if (step && step.ok && step.imported) t = t.replace(/Nothing was saved/g, 'Nothing from the GSTR-1 file was saved');
  return einvoiceExcelStepText(step, period_month) + (t ? ' ' + t : '');
}
// 0.8.9: how many documents a GSTR-1 JSON holds, per table the pull reads.
function gstr1DocCounts(json) {
  const n = { b2b: 0, cdnr: 0, cdnur: 0, exp: 0 };
  for (const p of (json && json.b2b) || []) n.b2b += ((p && p.inv) || []).length;
  for (const p of (json && json.cdnr) || []) n.cdnr += ((p && p.nt) || []).length;
  n.cdnur = ((json && json.cdnur) || []).length;
  for (const e of (json && json.exp) || []) n.exp += ((e && e.inv) || []).length;
  return n;
}
// The e-invoices the Excel imported for this month lists (cancelled ones are
// never saved), and how many of them the portal's GSTR-1 holds with an IRN
// (same identity as a pulled row). Null when no Excel was imported.
async function einvoiceExcelOnDraft(clientId, period_month, rows) {
  // In pages: the server caps a read at 1,000 rows (as markEinvoicesGone does).
  const xs = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await sel(`einvoice_docs?client_id=eq.${clientId}&period_month=eq.${enc(period_month)}&source=eq.einvoice_excel&select=id,section,ctin,doc_type,doc_key&order=id&limit=1000&offset=${offset}`);
    if (!page || !page.length) break;
    xs.push(...page);
    if (page.length < 1000) break;
  }
  if (!xs.length) return null;
  const key = (d) => einvDocKey(d.section, d.ctin, d.doc_type, d.doc_key);
  const onDraft = new Set(rows.map(key));
  return { count: xs.length, onDraft: xs.filter((d) => onDraft.has(key(d))).length };
}
// The pull's result in exact numbers: the period, the file's date, its
// documents per table, how many carry an IRN, and the Excel's e-invoices.
function einvoicePullText(period_month, generatedOn, c, withIrn, excel) {
  const total = c.b2b + c.cdnr + c.cdnur + c.exp;
  const parts = [['B2B', c.b2b], ['CDNR', c.cdnr], ['CDNUR', c.cdnur], ['Exports', c.exp]].filter((x) => x[1]).map((x) => x[0] + ' ' + x[1]).join(', ');
  // 0.9.1: only what the file shows, never more: "none carries an IRN" is about
  // the GSTR-1 file, and the month's e-invoice details (when imported) say how
  // many e-invoices there are and how many of them the file holds with an IRN.
  let t = 'The portal\'s GSTR-1 file for ' + einvStr(period_month) + (generatedOn ? ' (generated ' + einvDmy(generatedOn) + ')' : '')
    + ' holds ' + total + ' document' + (total === 1 ? '' : 's') + (parts ? ' (' + parts + ')' : '') + '; '
    + (withIrn ? withIrn + (withIrn === 1 ? ' of them carries an IRN.' : ' of them carry an IRN.')
      : (total ? 'none of them carries an IRN.' : 'it holds no document.'));
  if (excel && excel.count) {
    const missing = excel.count - excel.onDraft;
    t += ' The month\'s e-invoice details list ' + excel.count + ' e-invoice' + (excel.count === 1 ? '' : 's')
      + (missing
        ? (excel.onDraft ? ': ' + excel.onDraft + ' in the GSTR-1 file with ' + (excel.onDraft === 1 ? 'its' : 'their') + ' IRN, ' + missing : ': ' + missing)
          + (missing === 1 ? ' has' : ' have') + ' no IRN in the GSTR-1 file (an upload replaced ' + (missing === 1 ? 'it' : 'them')
          + ', or auto-population has not run yet).'
        : (excel.count === 1 ? ', in the GSTR-1 file with its IRN.' : ', all in the GSTR-1 file with their IRN.'));
  }
  return t;
}
function einvoiceStaleText(generatedOn, period_month) {
  return 'The portal gave a GSTR-1 JSON generated on ' + einvDmy(generatedOn) + ', not today, so it lacks every e-invoice'
    + ' auto-populated since. Nothing was saved. To get a fresh file, ' + EINVOICE_FRESH_STEPS + ' (' + einvStr(period_month) + '),'
    + ' wait until the portal has generated it (up to 20 minutes), then pull e-invoices again.';
}
function einvoiceNoDateText(fileName) {
  return 'Warning: the portal\'s file name (' + (einvStr(fileName) || 'none') + ') carries no generation date, so GST Keeper could'
    + ' not check that the file is today\'s. If e-invoices were added since it was last generated, ' + EINVOICE_FRESH_STEPS
    + ', wait, then pull again.';
}
// 0.8.7: marks gone_at = now on the client and period's 'portal_gstr1' rows
// whose identity is not among `seen` (this pull's rows, already upserted).
// Read by identity, patched by id in chunks: no timestamp from any PC is
// compared, and a row this pull saw is never marked. Read page by page until
// an empty page, so a server row cap cannot hide a row. Returns how many.
async function markEinvoicesGone(clientId, period_month, seen, now) {
  const keyOf = (r) => einvDocKey(r.section, r.ctin, r.doc_type, r.doc_key);
  const seenKeys = new Set(seen.map(keyOf));
  const scope = 'einvoice_docs?client_id=eq.' + enc(clientId) + '&period_month=eq.' + enc(period_month) + '&source=eq.portal_gstr1';
  const gone = [];
  for (let offset = 0; ;) {
    const page = await sel(scope + '&select=id,section,ctin,doc_type,doc_key&order=id&limit=1000&offset=' + offset);
    if (!Array.isArray(page) || !page.length) break;
    page.forEach((r) => { if (r && r.id && !seenKeys.has(keyOf(r))) gone.push(r.id); });
    offset += page.length;
  }
  for (let i = 0; i < gone.length; i += 100) {
    await patch('einvoice_docs?id=in.(' + gone.slice(i, i + 100).map(enc).join(',') + ')&source=eq.portal_gstr1', { gone_at: now });
  }
  return gone.length;
}

// 0.8.7: why a downloaded GSTR-1 JSON is not this client's or this period's,
// or null when it is. The client's GSTIN is read from the database, not from
// the portal session (which may still be another client's).
async function einvoicePullMismatch(clientId, period_month, json) {
  const [mm, yyyy] = String(period_month || '').split('/');
  const wantFp = String(parseInt(mm, 10) || '').padStart(2, '0') + String(yyyy || '').trim();
  const c = await API.getClient(clientId);
  const wantGstin = einvStr(c && c.gstin).toUpperCase();
  if (!wantGstin) return 'This client has no GSTIN saved in GST Keeper, so the portal\'s GSTR-1 JSON could not be checked. Nothing was saved.';
  const gotGstin = einvStr(json && json.gstin).toUpperCase();
  const gotFp = einvStr(json && json.fp);
  if (gotGstin !== wantGstin) {
    return 'The portal\'s GSTR-1 JSON is for GSTIN ' + (gotGstin || '(none)') + ', not this client\'s ' + wantGstin
      + ' (the portal session may still be another client\'s). Nothing was saved; log out of the portal and pull again.';
  }
  if (gotFp !== wantFp) {
    return 'The portal\'s GSTR-1 JSON is for period ' + (gotFp || '(none)') + ', not ' + wantFp + '. Nothing was saved; pull again.';
  }
  return null;
}

// ── E-invoice (IRN) documents (0.8.4; keep, don't re-send since 0.8.7) ──────
// Plain-JS copy of extractDocs from src/lib/einvoice/einvoice.ts (no bundler
// here) — keep the two in step. extractDocs adds `raw` (the document as the
// portal gave it) for einvoice_docs.
// 0.8.7: a document's identity is its section, buyer GSTIN (upper case; ''
// for exp, cdnur and b2cl), type (INV, or CRN / DBN from ntty) and its number
// exactly as in the JSON, trimmed, upper case, with runs of spaces made one
// (einvExactNo). That number is einvoice_docs.doc_key. The page's normalised
// number (separators and case stripped) only finds "number differs" pairs; it
// never decides what is left out of an upload. attachIrn is gone: the IRN
// fields are never written into an upload.
const einvNum = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v)); return Number.isFinite(n) ? n : 0; };
const einvStr = (v) => (v == null ? '' : String(v)).trim();
const einvArr = (v) => (Array.isArray(v) ? v : []);
const einvRound2 = (n) => Math.round(n * 100) / 100;
const einvExactNo = (docNo) => einvStr(docNo).replace(/\s+/g, ' ').toUpperCase();
const einvDocKey = (section, ctin, docType, docNo) =>
  [einvStr(section).toLowerCase(), einvStr(ctin).toUpperCase(), einvStr(docType).toUpperCase(), einvExactNo(docNo)].join('|');
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
      doc_key: einvExactNo(docNo),
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

// 0.8.7: a copy of the books `json` with every document named in `keep` left
// out — { section, ctin, doc_type, doc_no } as the page read them from the
// stored JSON, matched on the exact identity above (b2b inv[].inum, cdnr
// nt[].nt_num with its ntty, cdnur[].nt_num, exp inv[].inum, b2cl inv[].inum).
// A buyer, export or B2CL group left with no document goes, and so does a
// section left empty. Nothing else changes: other documents, other sections,
// HSN (Table 12) and Table 13 go up exactly as stored, and no IRN field is
// added. kept: documents left out. unmatched: keep entries that named no
// document here (the push still goes ahead; the page is told how many).
function keepEinvoices(json, keep) {
  const wanted = new Set();
  einvArr(keep).forEach((k) => {
    if (k && typeof k === 'object') wanted.add(einvDocKey(k.section, k.ctin, k.doc_type, k.doc_no));
  });
  if (!wanted.size || !json || typeof json !== 'object') return { json, kept: 0, unmatched: wanted.size };
  const copy = JSON.parse(JSON.stringify(json));
  const hit = new Set();
  let kept = 0;
  const leaveOut = (key) => {
    if (!wanted.has(key)) return false;
    hit.add(key);
    kept += 1;
    return true;
  };
  // Grouped sections: drop matched documents from each group's list, then a
  // group that lost documents and has none left, then the section if empty.
  const grouped = (section, listKey, ctinOf, typeOf, noOf) => {
    if (!Array.isArray(copy[section])) return;
    let touched = false;
    copy[section] = copy[section].filter((g) => {
      if (!g || !Array.isArray(g[listKey])) return true;
      const before = g[listKey].length;
      g[listKey] = g[listKey].filter((d) => !(d && leaveOut(einvDocKey(section, ctinOf(g), typeOf(d), noOf(d)))));
      if (g[listKey].length === before) return true;
      touched = true;
      return g[listKey].length > 0;
    });
    if (touched && !copy[section].length) delete copy[section];
  };
  grouped('b2b', 'inv', (g) => g.ctin, () => 'INV', (d) => d.inum);
  grouped('cdnr', 'nt', (g) => g.ctin, (d) => einvNoteType(d), (d) => d.nt_num);
  grouped('exp', 'inv', () => '', () => 'INV', (d) => d.inum);
  grouped('b2cl', 'inv', () => '', () => 'INV', (d) => d.inum);
  if (Array.isArray(copy.cdnur)) {
    const before = copy.cdnur.length;
    copy.cdnur = copy.cdnur.filter((d) => !(d && leaveOut(einvDocKey('cdnur', '', einvNoteType(d), d.nt_num))));
    if (copy.cdnur.length !== before && !copy.cdnur.length) delete copy.cdnur;
  }
  return { json: kept ? copy : json, kept, unmatched: wanted.size - hit.size };
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
    // 0.9.0: the e-invoice details (Excel) the pull downloads from the month's GSTR-1.
    if (job.mode === 'einvoice_pull') {
      if (job.step !== 'einvoice_excel') return;
      const url0 = item.finalUrl || item.url || '';
      // 0.9.1: only the portal's own download, from the GSTR-1 page, and only a workbook or ZIP.
      let host0 = '';
      try { host0 = new URL(url0).hostname; } catch (e) { return; }
      if (!/^https?:/i.test(url0) || !/(^|\.)gst\.gov\.in$/i.test(host0)) return;
      if (item.referrer && !/^https:\/\/return\.gst\.gov\.in\//i.test(item.referrer)) return;
      if (!/\.(xlsx|xls|zip)(\?|$)|einv|e-invoice/i.test((item.filename || '') + ' ' + url0)) return;
      const r0 = await fetch(url0, { credentials: 'include' });
      if (!r0.ok) return;
      const b0 = await r0.arrayBuffer();
      if (!b0 || b0.byteLength < 100) return;
      const head0 = new Uint8Array(b0, 0, 2);
      if (head0[0] !== 0x50 || head0[1] !== 0x4b) return; // "PK": an .xlsx or a ZIP
      const c0 = job.clients[job.idx || 0];
      if (!c0) return;
      const mime0 = r0.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      await chrome.storage.local.set({ gstk_einvoice_excel_result: {
        clientId: c0.clientId, gstin: (c0.creds && c0.creds.gstin) || '', period_month: job.period,
        fileB64: 'data:' + mime0 + ';base64,' + abToBase64(b0), fileName: (item.filename || '').split(/[\\/]/).pop() || ('EINV_' + c0.clientId + '.xlsx'),
        at: Date.now(), via: 'download',
      } });
      return;
    }
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
// ── A push whose portal tab was closed (0.8.6) ──────────────────────────────
// A GSTR-1 upload, NIL, Refresh errors or GSTR-3B push reports from its own
// portal tab; closed before that, the page waited for a result for ever. Now
// it hears that the tab went (`tabClosed`: the outcome is unknown, not a
// failure). Nothing is written to gstr3b_push_versions, and gstr1_data only
// for a JSON upload whose file was attached (its Upload History snapshot is
// there): it is saved 'failed' with words the GSTR-1 page offers Refresh
// errors for, which can then record what the portal did with the file.
// 0.8.7: an e-invoice pull too. Its page hears a failed pull marked
// tabClosed, and nothing is written (einvoice_docs and einvoice_pulls keep
// the last pull that finished). Its save runs in this same slot
// (finishEinvoicePull), so a tab closed while it is saving waits for it,
// then finds no job and writes nothing: the page hears the save's outcome.
const PUSH_RESULT_KEYS = {
  gstr1_upload: 'gstk_gstr1_upload_result', gstr1_refresh: 'gstk_gstr1_upload_result', gstr3b_push: 'gstk_gstr3b_push_result',
  einvoice_pull: 'gstk_einvoice_pull_result',
};
const PRETOP_PREFIX = 'gstk_gstr1_pretop_';
const PUSH_TAB_CLOSED = 'The portal tab was closed before the push finished. Check the portal and push again.';
const PUSH_TAB_CLOSED_UPLOAD = 'Portal tab closed during the upload; outcome unknown. Use Refresh errors once the portal shows a result.';
const REFRESH_TAB_CLOSED = 'The portal tab was closed before Refresh errors finished. Nothing was changed; click Refresh errors again.';
const EINVOICE_TAB_CLOSED = 'The portal tab was closed before the e-invoice pull finished. Nothing was saved; pull e-invoices again.';
// startGstr1Upload: the stored return is not the version the e-invoice plan
// was made on (0.8.7, basisUpdatedAt).
const EINVOICE_BASIS_CHANGED = 'This return changed after the e-invoice plan was made. Reload it and click Upload again.';
// What finishEinvoicePull answers when the pull's job was already gone (its
// tab closed first, or the sync stopped from the popup): nothing is saved.
const EINVOICE_ENDED = 'The e-invoice pull ended (its portal tab was closed, or the sync was stopped) before its documents were saved. Nothing was saved; pull e-invoices again.';
// What a GSTR-1 upload's result says about e-invoices left out (0.8.7).
const einvoiceTally = (g) => ({ einvoiceKept: Number(g && g.einvoiceKept) || 0, einvoiceKeepUnmatched: Number(g && g.einvoiceKeepUnmatched) || 0 });
async function pushTabClosed(tabId) {
  const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
  const key = job && PUSH_RESULT_KEYS[job.mode];
  if (!key || job.tabId !== tabId) return;
  const c = (job.clients && job.clients[job.idx || 0]) || {};
  const target = { clientId: c.clientId || null, period_month: job.period || null };
  if (job.mode === 'einvoice_pull') {
    // 0.9.1: an e-invoice Excel already imported by this pull is said, not denied.
    const message = job.einvExcel ? einvoiceEndText(job.einvExcel, job.period, EINVOICE_TAB_CLOSED) : EINVOICE_TAB_CLOSED;
    await chrome.storage.local.set({ [key]: {
      ok: false, status: 'failed', docsFound: 0, goneMarked: 0, staleRemoved: 0, generatedOn: null, message, tabClosed: true, ...target, at: Date.now(),
    } });
    await chrome.storage.local.remove('gstk_active_job');
    return;
  }
  const g = job.gstr1 || {};
  let text = job.mode === 'gstr1_refresh' ? REFRESH_TAB_CLOSED : PUSH_TAB_CLOSED;
  if (job.mode === 'gstr1_upload' && !g.nil && g.rowId
    && (await chrome.storage.local.get(PRETOP_PREFIX + g.rowId))[PRETOP_PREFIX + g.rowId]) {
    const saved = await API.saveGstr1UploadResult({ rowId: g.rowId, status: 'failed', summary: PUSH_TAB_CLOSED_UPLOAD, errors: null,
      actorId: job.actorId || null, einvoiceKept: g.einvoiceKept })
      .then(() => true, () => false);
    if (saved) text = PUSH_TAB_CLOSED_UPLOAD;
  }
  const result = {
    ok: false, status: 'failed', error: text, summary: text, tabClosed: true, ...target, at: Date.now(),
  };
  if (job.mode === 'gstr3b_push') Object.assign(result, { filled: 0, skipped: [], portalFilled: [], recorded: false });
  else result.errors = [];
  if (job.mode === 'gstr1_upload' && !g.nil) Object.assign(result, einvoiceTally(g));
  await chrome.storage.local.set({ [key]: result });
  await chrome.storage.local.remove('gstk_active_job');
}
// In the job slot, so it never interleaves with a new start or the watchdog.
if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => { jobSlot(() => pushTabClosed(tabId)).catch(() => {}); });
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
