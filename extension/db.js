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
    getClients: () => call('getClients'),
    getClient: (id) => call('getClient', id),
    upsertFilingStatus: (rows) => call('upsertFilingStatus', rows),
    upsertReco: (table, clientId, period, patchObj) => call('upsertReco', table, clientId, period, patchObj),
    replaceTwob: (clientId, period, rows) => call('replaceTwob', clientId, period, rows),
    replaceCreditLedgerTxns: (clientId, period, rows) => call('replaceCreditLedgerTxns', clientId, period, rows),
    replaceLiabilityLedgerEntries: (clientId, period, rows) => call('replaceLiabilityLedgerEntries', clientId, period, rows),
    replaceCashLedgerEntries: (clientId, period, rows) => call('replaceCashLedgerEntries', clientId, period, rows),
    replaceNotices: (clientId, rows) => call('replaceNotices', clientId, rows),
    replaceRefundApplications: (clientId, rows) => call('replaceRefundApplications', clientId, rows),
    patchRefundDocument: (clientId, arn, patchObj) => call('patchRefundDocument', clientId, arn, patchObj),
    replaceDrc03Filings: (clientId, rows) => call('replaceDrc03Filings', clientId, rows),
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
    replaceCaseFolderItems: (clientId, caseId, rows) => call('replaceCaseFolderItems', clientId, caseId, rows),
    logEvent: (clientId, level, message) => { console.log('[GSTKeeper]', level, clientId, message); },
  };
})();
