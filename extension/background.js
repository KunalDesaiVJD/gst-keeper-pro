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
