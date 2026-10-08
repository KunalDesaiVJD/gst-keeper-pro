// Messaging proxy — every DB call goes to the background worker (which does the
// actual Supabase fetch reliably). Used by both the popup and the content script.
(() => {
  function call(fn, ...args) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ gstk: true, fn, args }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp) return reject(new Error('no response from background worker'));
          if (resp.error) return reject(new Error(resp.error));
          resolve(resp.data);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  globalThis.GSTKdb = {
    whoami: () => call('whoami'),
    // Bring the calling tab to/from the foreground — see background.js's
    // onMessage listener for why this has to be a message rather than a
    // direct chrome.tabs.* call (content scripts don't have that API).
    focusTab: () => call('focusTab'),
    backgroundTab: () => call('backgroundTab'),
    getClients: () => call('getClients'),
    getClient: (id) => call('getClient', id),
    upsertFilingStatus: (rows) => call('upsertFilingStatus', rows),
    upsertReco: (table, clientId, period, patchObj) => call('upsertReco', table, clientId, period, patchObj),
    replaceTwob: (clientId, period, rows) => call('replaceTwob', clientId, period, rows),
    replaceCreditLedgerTxns: (clientId, period, rows) => call('replaceCreditLedgerTxns', clientId, period, rows),
    replaceLiabilityLedgerEntries: (clientId, period, rows) => call('replaceLiabilityLedgerEntries', clientId, period, rows),
    replaceCashLedgerEntries: (clientId, period, rows) => call('replaceCashLedgerEntries', clientId, period, rows),
    replaceNotices: (clientId, rows, pullTs, opts) => call('replaceNotices', clientId, rows, pullTs, opts),
    replaceRefundApplications: (clientId, rows, pullTs, opts) => call('replaceRefundApplications', clientId, rows, pullTs, opts),
    patchRefundDocument: (clientId, arn, patchObj) => call('patchRefundDocument', clientId, arn, patchObj),
    // 0.8.0: one notice's own columns, patched on their own after the notices
    // save — the link pass's DIN, and a refund notice's PDF and reply date,
    // which only become known when the refunds step reads that case's folder
    // later in the same run. Isolated on purpose: see background.js.
    patchNoticeFields: (clientId, portalKey, patchObj) => call('patchNoticeFields', clientId, portalKey, patchObj),
    // 0.8.0: the open notices of this client that still have no PDF, reply
    // date or officer — what the refunds step's link pass patches.
    noticesNeedingDetail: (clientId) => call('noticesNeedingDetail', clientId),
    replaceDrc03Filings: (clientId, rows, pullTs, opts) => call('replaceDrc03Filings', clientId, rows, pullTs, opts),
    upsertTaxpayerProfile: (clientId, patchObj) => call('upsertTaxpayerProfile', clientId, patchObj),
    getTaxpayerRegistrationDate: (clientId) => call('getTaxpayerRegistrationDate', clientId),
    replaceChallans: (clientId, rows) => call('replaceChallans', clientId, rows),
    upsertFiledReturn: (clientId, period, returnType, patchObj) => call('upsertFiledReturn', clientId, period, returnType, patchObj),
    replaceCreditReversalReclaimEntries: (clientId, financialYear, rows) => call('replaceCreditReversalReclaimEntries', clientId, financialYear, rows),
    replaceRcmLiabilityItcEntries: (clientId, financialYear, rows) => call('replaceRcmLiabilityItcEntries', clientId, financialYear, rows),
    fetchCrossOriginAsBase64: (url) => call('fetchCrossOriginAsBase64', url),
    getDnrDebug: () => call('getDnrDebug'),
    uploadPdf: (path, dataUrl) => call('uploadPdf', path, dataUrl),
    markFiled: (row) => call('markFiled', row),
    // Records one Sync All attempt's outcome for a client — feeds the
    // Notices Dashboard's Company List "Last Download Date / Status /
    // Status Message" columns. Only called from the 'notices' Sync All job
    // (see content.js's logSyncAttempt, gated on job.logSync) — every other
    // job/mode is untouched.
    logClientSync: (clientId, action, status, message) => call('logClientSync', clientId, action, status, message),
    // Additional Notice Folder detail — one row per case-folder item, see
    // handleNotices' task-list loop in content.js for the capture.
    replaceCaseFolderItems: (clientId, caseId, rows, pullTs, opts) => call('replaceCaseFolderItems', clientId, caseId, rows, pullTs, opts),
    getPortalPassword: (clientId) => call('getPortalPassword', clientId),
    // 0.8.1: passwords the portal refused (background.js, pwRefusal*): checked
    // before a bulk or scheduled login, marked on a refusal, cleared on a login.
    pwRefusalCheck: (clientId, user, pass) => call('pwRefusalCheck', clientId, user, pass),
    pwRefusalMark: (clientId, user, pass, info) => call('pwRefusalMark', clientId, user, pass, info),
    pwRefusalClear: (clientId) => call('pwRefusalClear', clientId),
    pwRefusalList: () => call('pwRefusalList'),
    // 0.8.2: the client's portal password issue in GST Keeper (NULL clears it).
    loginIssueSet: (clientId, reason, message) => call('loginIssueSet', clientId, reason, message),
    runSweep: (clientId) => call('runSweep', clientId),
    // 0.5.0: one ingest door (public.sync_ingest) and the run ledger.
    ingest: (clientId, runId, step, rows, opts, scope) => call('ingest', clientId, runId, step, rows, opts, scope),
    runFinish: (runId, status, note) => call('runFinish', runId, status, note),
    logStep: (runId, clientId, step, status, reasonClass, message) => call('logStep', runId, clientId, step, status, reasonClass, message),
    knownDocs: (clientId) => call('knownDocs', clientId),
    // 0.6.0: applications on the portal; kept notice detail (GSTR-3A period).
    ingestApplications: (clientId, runId, rows, caseTypes, complete) => call('ingestApplications', clientId, runId, rows, caseTypes, complete),
    noticeDetails: (clientId, rows) => call('noticeDetails', clientId, rows),
    notifyCaptcha: (clientName, progress) => call('notifyCaptcha', clientName, progress),
    clearCaptchaNotice: () => call('clearCaptchaNotice'),
    logEvent: (clientId, level, message) => { console.log('[GSTKeeper]', level, clientId, message); },
    // 0.5.1 popup: start a section pull (the app's "Sync now" uses the same
    // background function) and read-only sync status straight from PostgREST.
    startSectionPull: (info) => call('startAllClientsSectionPull', info),
    getSyncStatus: () => restGet('client_sync_status?step=in.(notices,login)'
      + '&select=client_id,step,last_attempt_at,last_status,last_reason_class,last_message,last_success_at'),
    // 0.6.0: the office agent (Portal Autopilot) — is it on, and queue clients for it.
    getAutopilot: () => restRpc('autopilot_wall_ping', {}),
    queueOnAgent: (clientIds) => restRpc('autopilot_enqueue', {
      p_client_ids: clientIds && clientIds.length ? clientIds : null, p_job_type: 'PULL_NOTICES_BUNDLE',
      p_origin: 'manual', p_requested_by_name: 'Extension popup',
    }),
    getLastRun: () => restGet('sync_runs?select=id,started_at,finished_at,status,mode,clients_total,clients_done,note'
      + '&order=started_at.desc&limit=1').then((a) => (a && a[0]) || null),
    // 0.7.0: scheduled syncs in this Chrome (runner.js). runnerEndJob is the
    // content script's: a scheduled client that ended on its page.
    runnerEndJob: (info) => call('runnerEndJob', info),
    runnerGet: () => call('runnerGet'),
    runnerSet: (patch) => call('runnerSet', patch),
    runnerNow: () => call('runnerNow'),
    putActiveJob: (job) => call('putActiveJob', job),
    // Who runs the autopilot queue (chrome | office_agent), from the header badge's RPC.
    getRunnerMode: () => restRpc('autopilot_badge', {}),
  };

  // An RPC from an extension page that loads config.js (the popup).
  async function restRpc(fn, body) {
    const cfg = globalThis.GSTK_CONFIG;
    if (!cfg) throw new Error('config.js is not loaded on this page');
    const r = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error('RPC ' + fn + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.json();
  }

  // GET only, for extension pages that load config.js (the popup). The
  // background worker has no generic reader, and content scripts never call these.
  async function restGet(path) {
    const cfg = globalThis.GSTK_CONFIG;
    if (!cfg) throw new Error('config.js is not loaded on this page');
    const r = await fetch(cfg.SUPABASE_URL + '/rest/v1/' + path, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY },
    });
    if (!r.ok) throw new Error('GET ' + path.split('?')[0] + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.json();
  }
})();
