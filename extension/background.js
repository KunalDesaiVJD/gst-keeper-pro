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

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const { gstk_active_job: job } = await chrome.storage.local.get('gstk_active_job');
    if (!job || job.mode !== 'twob' || !job.clients) return;
    const fileUrl = item.finalUrl || item.url || '';
    const hint = (item.filename || '') + ' ' + fileUrl;
    const looksLike2b = /\.(xlsx|xls|zip)(\?|$)/i.test(hint) || /gstr-?2b|gstr2b/i.test(hint);
    if (!looksLike2b || !/^https?:/i.test(fileUrl)) return; // blob:/data: handled in-page
    const resp = await fetch(fileUrl, { credentials: 'include' });
    if (!resp.ok) return;
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength < 100) return;
    const mime = resp.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const dataUrl = 'data:' + mime + ';base64,' + abToBase64(buf);
    const cur = job.clients[job.idx || 0];
    if (!cur) return;
    await chrome.storage.local.set({ gstk_twob_result: {
      ok: true, clientId: cur.clientId, gstin: (cur.creds && cur.creds.gstin) || '', period: job.period,
      fileB64: dataUrl, fileName: item.filename || ('GSTR2B_' + cur.clientId + '.xlsx'), at: Date.now(),
    } });
  } catch (e) { /* ignore — the in-page path or a timeout will report */ }
});

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
