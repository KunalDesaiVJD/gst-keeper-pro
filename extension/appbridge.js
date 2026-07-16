// Runs on the GST Keeper app. Bridges the Filing Status "Pull from portal" button
// (which posts a window message) to the extension's background worker, which opens
// the portal and pulls that one return's ARN + PDF + marks it Filed.
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object' || !d.__gstkPullReturn) return;
  const info = d.__gstkPullReturn;
  if (!info.clientId || !info.return_type || !info.period_month) return;
  chrome.runtime.sendMessage({ gstk: true, fn: 'startReturnPull', args: [info] }, (resp) => {
    const ok = resp && resp.ok;
    const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
    window.postMessage({ __gstkPullResult: ok ? { ok: true } : { ok: false, error } }, '*');
  });
});

// Tell the app the extension is present, so it can enable the button + hint.
window.postMessage({ __gstkExtensionReady: true }, '*');
