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
    uploadPdf: (path, dataUrl) => call('uploadPdf', path, dataUrl),
    markFiled: (row) => call('markFiled', row),
    logEvent: (clientId, level, message) => { console.log('[GSTKeeper]', level, clientId, message); },
  };
})();
