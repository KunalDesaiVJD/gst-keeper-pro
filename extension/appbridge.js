// Runs on the GST Keeper app. Two jobs:
//  1) Detection handshake — announce the extension is present AND answer the
//     app's "are you there?" pings. Answering pings makes detection race-proof:
//     the app is a SPA, so its message listener usually mounts long AFTER this
//     content script's one-shot announcement would have fired. With the ping/
//     answer below, detection works no matter which side loads first.
//  2) Bridge the Filing Status "Portal" button (a window message) to the
//     background worker, which opens the portal and pulls that one return's
//     ARN + PDF and marks it Filed.

function announce() {
  window.postMessage({ __gstkExtensionReady: true }, '*');
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;

  // The app (re)mounted and is asking whether the extension is loaded.
  if (d.__gstkAppReady) { announce(); return; }

  // The Filing Status "Portal" button asked to pull one return.
  if (d.__gstkPullReturn) {
    const info = d.__gstkPullReturn;
    if (!info.clientId || !info.return_type || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startReturnPull', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkPullResult: ok ? { ok: true } : { ok: false, error } }, '*');
    });
  }
});

// Announce on load too (covers the case where the app's listener is already
// mounted, e.g. an in-app navigation back to a page that's listening).
announce();
setTimeout(announce, 600);
