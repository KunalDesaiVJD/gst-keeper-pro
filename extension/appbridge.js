// Runs on the GST Keeper app. Two jobs:
//  1) Detection handshake — announce the extension is present AND answer the
//     app's "are you there?" pings. Answering pings makes detection race-proof:
//     the app is a SPA, so its message listener usually mounts long AFTER this
//     content script's one-shot announcement would have fired. With the ping/
//     answer below, detection works no matter which side loads first.
//  2) Bridge the Filing Status "Portal" button (a window message) to the
//     background worker, which opens the portal and pulls that one return's
//     ARN + PDF and marks it Filed.

const EXT_VERSION = chrome.runtime.getManifest().version;
const ALLOWED_ORIGINS = ['https://gst.vjdesai.com', 'https://gst-keeper-pro.vercel.app'];

// 0.8.6: the return a push result belongs to, as the page asked for it.
const pushTarget = (info) => ({ clientId: info.clientId || null, period_month: info.period_month || null });

function announce() {
  window.postMessage({ __gstkExtensionReady: true, version: EXT_VERSION }, location.origin);
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  // Only the app's own origins — any other page (e.g. any *.vercel.app site) must
  // not be able to start portal logins, syncs or GSTR-1/3B pushes.
  if (!ALLOWED_ORIGINS.includes(e.origin)) return;
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
      window.postMessage({ __gstkPullResult: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // The Import 2B "Pull from portal" button asked to pull the GSTR-2B. This opens
  // a portal tab; the downloaded file arrives later via chrome.storage.onChanged.
  if (d.__gstkPull2B) {
    const info = d.__gstkPull2B;
    if (!info.clientId || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startTwobPull', args: [info] }, (resp) => {
      if (!(resp && resp.ok)) {
        const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
        window.postMessage({ __gstkPull2BResult: { ok: false, error } }, location.origin);
      }
    });
    return;
  }

  // The GSTR-2A Import card's "Pull from portal" button asked to pull the
  // GSTR-2A. Mirrors __gstkPull2B exactly — opens a portal tab; the downloaded
  // file arrives later via chrome.storage.onChanged.
  if (d.__gstkPull2A) {
    const info = d.__gstkPull2A;
    if (!info.clientId || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startTwoAPull', args: [info] }, (resp) => {
      if (!(resp && resp.ok)) {
        const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
        window.postMessage({ __gstkPull2AResult: { ok: false, error } }, location.origin);
      }
    });
    return;
  }

  // The Filing Status login icon asked to log a client in and open a return's
  // filing page. Opens a portal tab; the human does the CAPTCHA + OTP/DSC submit.
  if (d.__gstkOpenFiling) {
    const info = d.__gstkOpenFiling;
    if (!info.clientId || !info.return_type || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startFilingOpen', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkOpenFilingResult: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // The Clients → Credentials "Login" button asked to just log a client into the
  // GST portal (no return/ledger navigation). Human does the CAPTCHA.
  if (d.__gstkPortalLogin) {
    const info = d.__gstkPortalLogin;
    if (!info.clientId) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startPortalLogin', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkPortalLoginResult: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // A reco page "Pull" button asked to fetch the ledger opening balances.
  if (d.__gstkPullLedgers) {
    const info = d.__gstkPullLedgers;
    if (!info.clientId || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startLedgerPull', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkPullLedgersResult: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // A Reports Hub "Pull" button on one specific report asked to fetch just
  // that section (Notices / Refunds / DRC-03 / Taxpayer Profile / Challans /
  // Liability Ledger / Cash Ledger) instead of the whole reco chain.
  if (d.__gstkPullSection) {
    const info = d.__gstkPullSection;
    if (!info.clientId || !info.mode) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startSectionPull', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkPullSectionResult: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // The Notices Dashboard's "Sync All" button — same section-pull as above,
  // but for every client with saved credentials instead of one.
  if (d.__gstkPullSectionAllClients) {
    const info = d.__gstkPullSectionAllClients;
    if (!info.mode) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startAllClientsSectionPull', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkPullSectionAllClientsResult: ok ? { ok: true, count: resp.data.count } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // A Notices Dashboard row's "Portal" icon asked to log the client in and
  // land on Notices & Orders (see background.js's startNoticeOpen for why
  // this stops there instead of opening the specific notice).
  if (d.__gstkOpenNotice) {
    const info = d.__gstkOpenNotice;
    if (!info.clientId) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startNoticeOpen', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkOpenNoticeResult: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // The GSTR-1 "Upload to GST Portal" button asked to push the stored JSON to
  // the portal. Background fetches the JSON + credentials and opens a portal
  // tab; the final result (accepted / partial / failed + per-invoice errors)
  // comes back later via chrome.storage.local -> the change listener below.
  // 0.8.7: info.einvoice ({ keep: [{ section, ctin, doc_type, doc_no }],
  // planAt, basisUpdatedAt }) is passed through as sent: the documents named
  // in keep are left out of the upload so the portal keeps their IRN, and the
  // result carries einvoiceKept and einvoiceKeepUnmatched. basisUpdatedAt is
  // the gstr1_data.updated_at the plan was made on; a stored return with
  // another one is refused before a portal tab opens (a failed result below,
  // "This return changed after the e-invoice plan was made...").
  if (d.__gstkUploadGstr1) {
    const info = d.__gstkUploadGstr1;
    if (!info.clientId || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startGstr1Upload', args: [info] }, (resp) => {
      if (!(resp && resp.ok)) {
        const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
        window.postMessage({ __gstkUploadGstr1Result: { ok: false, status: 'failed', error, ...pushTarget(info) } }, location.origin);
      }
      // On resp.ok the portal automation continues asynchronously; the final
      // result is broadcast via the storage listener below.
    });
    return;
  }

  // The GSTR-1 "Refresh errors" button asked to re-check the portal for the
  // per-invoice Error Report that GSTN generates asynchronously (up to 20 min
  // after a "Processed with Error" upload). Same open-portal-tab flow as
  // Upload but without re-sending the JSON.
  if (d.__gstkRefreshGstr1Errors) {
    const info = d.__gstkRefreshGstr1Errors;
    if (!info.clientId || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startGstr1RefreshErrors', args: [info] }, (resp) => {
      if (!(resp && resp.ok)) {
        const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
        window.postMessage({ __gstkUploadGstr1Result: { ok: false, status: 'failed', error, ...pushTarget(info) } }, location.origin);
      }
    });
    return;
  }

  // 0.8.4: the GSTR-1 page's "Pull e-invoices" button. Background opens a
  // portal tab; the outcome (ok / none / stale / pending / failed) comes back later
  // via chrome.storage.local -> the change listener below.
  if (d.__gstkPullEinvoice) {
    const info = d.__gstkPullEinvoice;
    if (!info.clientId || !info.period_month) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startEinvoicePull', args: [info] }, (resp) => {
      const ok = resp && resp.ok;
      const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
      window.postMessage({ __gstkPullEinvoiceStarted: ok ? { ok: true } : { ok: false, error } }, location.origin);
    });
    return;
  }

  // The GSTR-3B "Push to GST Portal" button. Unlike GSTR-1 this carries the
  // already-computed draft JSON straight in the message (info.gstr3bJson) —
  // there's no stored row to fetch by id, the app computes GSTR-3B fresh
  // every time. Background opens a portal tab; the fill result comes back
  // later via chrome.storage.local -> the change listener below.
  if (d.__gstkPushGstr3b) {
    const info = d.__gstkPushGstr3b;
    if (!info.clientId || !info.period_month || !info.gstr3bJson) return;
    chrome.runtime.sendMessage({ gstk: true, fn: 'startGstr3bPush', args: [info] }, (resp) => {
      if (!(resp && resp.ok)) {
        // Never started, so nothing was recorded in Push History (recorded: false).
        const error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'failed';
        window.postMessage({ __gstkPushGstr3bResult: {
          ok: false, status: 'failed', error, summary: error, filled: 0, skipped: [], portalFilled: [], recorded: false, ...pushTarget(info),
        } }, location.origin);
      }
      // On resp.ok the portal automation continues asynchronously; the final
      // result is broadcast via the storage listener below.
    });
    return;
  }
});

// The portal tab stashes the captured GSTR-2B file in chrome.storage; relay it to
// the app page so it can import via its own parser, then clear it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.gstk_twob_result) {
    const v = changes.gstk_twob_result.newValue;
    if (v) {
      window.postMessage({ __gstkPull2BResult: v }, location.origin);
      chrome.storage.local.remove('gstk_twob_result');
    }
  }
  if (changes.gstk_twoa_result) {
    const v = changes.gstk_twoa_result.newValue;
    if (v) {
      window.postMessage({ __gstkPull2AResult: v }, location.origin);
      chrome.storage.local.remove('gstk_twoa_result');
    }
  }
  // Portal upload finished (accepted / partial / failed + per-invoice errors).
  // The content script writes this after reading the portal's post-processing
  // status + Error Report; we relay it to the app and clear. 0.8.6: relayed
  // unchanged, so it carries the job's clientId and period_month through.
  if (changes.gstk_gstr1_upload_result) {
    const v = changes.gstk_gstr1_upload_result.newValue;
    if (v) {
      window.postMessage({ __gstkUploadGstr1Result: v }, location.origin);
      chrome.storage.local.remove('gstk_gstr1_upload_result');
    }
  }
  // 0.8.4: e-invoice pull finished — the extension has already saved
  // einvoice_docs / einvoice_pulls; the app just re-reads them. 0.8.7: also
  // how many e-invoices saved by an earlier pull are no longer on the portal
  // (goneMarked: marked gone, never deleted; staleRemoved is the same count
  // under its earlier name), the day the portal generated the file
  // (generatedOn, yyyy-mm-dd, or null), status 'stale' for a file generated
  // before today (nothing saved), and tabClosed when the portal tab was
  // closed first (a failed pull that wrote nothing). clientId and
  // period_month are the job's, so the page can ignore another return's pull.
  if (changes.gstk_einvoice_pull_result) {
    const v = changes.gstk_einvoice_pull_result.newValue;
    if (v) {
      const gone = v.goneMarked != null ? v.goneMarked : v.staleRemoved;
      window.postMessage({ __gstkEinvoicePullDone: {
        ok: !!v.ok, status: v.status, docsFound: v.docsFound || 0, goneMarked: gone || 0, staleRemoved: gone || 0,
        generatedOn: v.generatedOn || null, message: v.message || '',
        clientId: v.clientId || null, period_month: v.period_month || null, ...(v.tabClosed ? { tabClosed: true } : {}),
      } }, location.origin);
      chrome.storage.local.remove('gstk_einvoice_pull_result');
    }
  }
  // GSTR-3B form-fill finished (or the whole flow errored out before it got
  // that far: failGstr3b writes this same key from every dead end, and the
  // background worker when the portal tab is closed). 0.8.6: relayed
  // unchanged — status ('filled' / 'partial' / 'failed'), portalFilled, the
  // job's clientId and period_month, and whether the extension already
  // recorded it in Push History (recorded).
  if (changes.gstk_gstr3b_push_result) {
    const v = changes.gstk_gstr3b_push_result.newValue;
    if (v) {
      window.postMessage({ __gstkPushGstr3bResult: v }, location.origin);
      chrome.storage.local.remove('gstk_gstr3b_push_result');
    }
  }
});

// Announce on load too (covers the case where the app's listener is already
// mounted, e.g. an in-app navigation back to a page that's listening).
announce();
setTimeout(announce, 600);
