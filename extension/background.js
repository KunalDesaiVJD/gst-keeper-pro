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
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.gstk) return;
  const fn = API[msg.fn];
  if (!fn) { sendResponse({ error: 'unknown fn: ' + msg.fn }); return; }
  Promise.resolve(fn(...(msg.args || [])))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
  return true; // keep the channel open for the async response
});
