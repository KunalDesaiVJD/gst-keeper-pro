// 0.15.0: the Filing Status pull of filed returns.
//  (i)   the stored PDF is the filed return and shows its ARN: never the
//        GSTR-3B "System generated summary" (when it comes first, it is passed
//        over; when it is all there is, no PDF is stored and the reason is);
//  (ii)  the exact return type: GSTR-1A is never taken for GSTR-1 (the type
//        option and the e-Filed Returns row), and a GSTR-1A seen is kept as
//        its own record in gst_filed_returns;
//  (iii) ARN and filing date from the portal (form details, else the row,
//        else the PDF's ARN date), never the day of the pull;
//  (iv)  everything goes through filing_record_pull, which answers filed /
//        refreshed / conflict: the extension never writes filing_status
//        itself, and it shows the answer (a conflict is not a success);
//  (v)   the page hears each outcome, and every return asked for at the end;
//        returns not reached (the session kept dropping, the tab closed) are
//        logged in GST Keeper too (round 1);
//  (vi)  a checked PDF gets a new name on every pull and is uploaded without
//        overwrite, so no other copy can replace it (round 1).
// The REAL filedpdf.js, background.js, db.js and content.js in Node VM
// contexts, with a stubbed chrome.*, a fake database and a fake portal.
// Fixture PDFs: test/fixtures (fictional, made by test/_pdffixture.mjs the
// way the portal's pdfmake makes them).
//   node test/16-filed-return-pull.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const fixture = (f) => new Uint8Array(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url)));
const dataUrl = (bytes) => 'data:application/pdf;base64,' + Buffer.from(bytes).toString('base64');
const DB = 'https://db.test';
const ANON = 'anon-key';

let fail = 0;
const ok = (cond, name, info) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || info === undefined ? '' : '\n     ' + JSON.stringify(info))); if (!cond) fail++; };

// ── filedpdf.js on its own ────────────────────────────────────────────────
const pdfCtx = vm.createContext({ DecompressionStream, atob, Uint8Array, Map, Set, Number, String, Math, Object, Array, Promise, Error, RegExp });
pdfCtx.globalThis = pdfCtx;
vm.runInContext(read('filedpdf.js'), pdfCtx, { filename: 'filedpdf.js' });
const P = pdfCtx.GSTKFiledPdf;

const t3b = await P.extractText(fixture('filed-gstr3b.pdf'));
ok(/Form GSTR-3B/.test(t3b.text) && t3b.text.replace(/\s+/g, '').includes('AB240926123456X'), '(i) the text is read through the fonts\' ToUnicode maps, ARN split across a kern included', t3b.text.slice(0, 120));
let v = await P.checkBytes(fixture('filed-gstr3b.pdf'), { arn: 'AB240926123456X', returnType: 'GSTR-3B' });
ok(v.ok && v.arnDate === '2026-10-11', '(i) the filed GSTR-3B is accepted, its Date of ARN read', v);
v = await P.checkBytes(fixture('filed-gstr3b.pdf'), { arn: 'AB240926123456X', returnType: 'GSTR-3B (Q)' });
ok(v.ok, '(i) the same PDF is accepted for GSTR-3B (Q)', v);
v = await P.checkBytes(fixture('system-summary-gstr3b.pdf'), { arn: 'AB240926123456X', returnType: 'GSTR-3B' });
ok(!v.ok && v.reason === 'The portal gave the System generated summary, not the filed return.', '(i) the System generated summary is refused', v);
v = await P.checkBytes(fixture('filed-gstr3b.pdf'), { arn: 'AB240826123456X', returnType: 'GSTR-3B' });
ok(!v.ok && /does not show ARN AB240826123456X/.test(v.reason), '(i) a filed return of another month (another ARN) is refused', v);
v = await P.checkBytes(fixture('filed-gstr1.pdf'), { arn: 'AA240926123456X', returnType: 'GSTR-3B' });
ok(!v.ok && /not a filed GSTR-3B/.test(v.reason), '(i) a GSTR-1 for the GSTR-3B is refused', v);
v = await P.checkBytes(fixture('filed-gstr1.pdf'), { arn: 'AA240926123456X', returnType: 'GSTR-1' });
ok(v.ok && v.arnDate === '2026-10-10', '(i) the filed GSTR-1 is accepted, its ARN date read', v);
v = await P.checkBytes(fixture('filed-gstr1a.pdf'), { arn: 'AA240926000001Z', returnType: 'GSTR-1' });
ok(!v.ok && v.reason === 'The PDF is a GSTR-1A, not the GSTR-1.', '(ii) a GSTR-1A PDF is never the GSTR-1, even with its own ARN', v);
v = await P.checkBytes(fixture('consolidated-gstr1-1a.pdf'), { arn: 'AA240926123456X', returnType: 'GSTR-1' });
ok(!v.ok && /GSTR-1A/.test(v.reason), '(ii) the "Consolidated Summary of FORM GSTR-1 and GSTR-1A" is not the GSTR-1', v);
v = await P.checkBytes(fixture('filed-gstr1a.pdf'), { arn: 'AA240926000001Z', returnType: 'GSTR-1A' });
ok(v.ok, '(ii) the GSTR-1A PDF is a GSTR-1A', v);
v = await P.checkBytes(new TextEncoder().encode('<html>Access Denied</html>'), { arn: 'AB240926123456X', returnType: 'GSTR-3B' });
ok(!v.ok && v.reason === 'The file the portal gave is not a PDF.', '(i) a page that is not a PDF is refused', v);
v = await P.checkBytes(new TextEncoder().encode('%PDF-1.3\n1 0 obj\n<< /Type /Page >>\nendobj\n'), { arn: 'AB240926123456X', returnType: 'GSTR-3B' });
ok(!v.ok && /could not be read/.test(v.reason), '(i) a PDF without readable text is "not certain": refused', v);

// ── The content.js helpers (between their markers) ────────────────────────
const contentSrc = read('content.js');
const h0 = contentSrc.indexOf('  // ── Filed-return pull helpers (0.15.0)');
const h1 = contentSrc.indexOf('  // ── end of filed-return pull helpers');
ok(h0 > 0 && h1 > h0, 'helper block found in content.js');
const H = vm.runInNewContext(contentSrc.slice(h0, h1) + '\n({ filedRetAlnum, filedTypeMatches, portalDateToIso, efiledRowInfo, efiledRowMatches, filedPdfPath })', { Date, Number, String, Math });
ok(H.filedTypeMatches('GSTR1', 'GSTR-1') && !H.filedTypeMatches('GSTR1A', 'GSTR-1') && !H.filedTypeMatches('GSTR-1A', 'GSTR-1 (IFF)'), '(ii) GSTR1A never matches GSTR-1 or GSTR-1 (IFF)');
ok(H.filedTypeMatches('GSTR1A', 'GSTR-1A') && !H.filedTypeMatches('GSTR1', 'GSTR-1A'), '(ii) GSTR-1A matches only GSTR1A');
ok(H.filedTypeMatches('GSTR3B', 'GSTR-3B (Q)') && !H.filedTypeMatches('GSTR3B', 'GSTR-1'), 'GSTR-3B (Q) is the portal\'s GSTR3B');
ok(H.filedTypeMatches('GSTR1 - Details of outward supplies', 'GSTR-1') && H.filedTypeMatches('GSTR1 (IFF)', 'GSTR-1 (IFF)'), 'a label that goes on in words still matches');
ok(!H.filedTypeMatches('GSTR10', 'GSTR-1') && !H.filedTypeMatches('GSTR-7A', 'GSTR-7') && !H.filedTypeMatches('GSTR6A', 'GSTR-6'), '(ii) GSTR-10, GSTR-7A, GSTR-6A are other forms');
ok(H.portalDateToIso('11/10/2026') === '2026-10-11' && H.portalDateToIso('11-10-2026') === '2026-10-11' && H.portalDateToIso('11/10/2026 18:22:05') === '2026-10-11',
  '(iii) the portal\'s date with slashes, dashes or a time');
ok(H.portalDateToIso('31/02/2026') === null && H.portalDateToIso('') === null && H.portalDateToIso('Oct 11, 2026') === null, '(iii) an impossible or unknown date is no date');
const row = (cells) => H.efiledRowInfo(cells);
const want1 = { return_type: 'GSTR-1', period_month: '09/2026' };
ok(H.efiledRowMatches(row(['GSTR1', '2026-27', 'September', 'AA240926123456X', '10/10/2026']), want1), '(ii) the GSTR-1 row of the month matches');
ok(!H.efiledRowMatches(row(['GSTR1A', '2026-27', 'September', 'AA240926000001Z', '20/10/2026']), want1), '(ii) the GSTR-1A row does not');
ok(!H.efiledRowMatches(row(['GSTR1', '2026-27', 'August', 'AA240826123456X', '10/09/2026']), want1), 'another month\'s row does not');
ok(!H.efiledRowMatches(row(['GSTR1', '2025-26', 'September', 'AA240925123456X', '10/10/2025']), want1), 'another year\'s row does not');
ok(!H.efiledRowMatches(row(['GSTR1', '2026-27', 'September', 'NOT-AN-ARN', '10/10/2026']), want1), 'a row without an ARN does not');
ok(H.filedPdfPath('c1', { return_type: 'GSTR-3B', period_month: '09/2026' }, 'AB240926123456X', 1761030000000) === 'c1/09-2026/GSTR-3B-AB240926123456X-1761030000000.pdf',
  '(vi) the PDF path carries the pull\'s time, so every pull has its own file');

// ── The fake database (background.js) ─────────────────────────────────────
const calls = [];
let pullAnswer = () => ({ outcome: 'filed', message: 'Filed, from the portal.' });
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body || null;
  calls.push({ method, url: u, body, headers: init.headers || {} });
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'FICTIONAL FABRICS', gstin: '24ABCDE1234F1Z5', gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c2') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c2', name: 'NO LOGIN LTD', gstin: '24ZZZZZ9999Z1Z1', gst_user_id: null, selected_returns: [] }]), { status: 200 });
  }
  if (u === DB + '/rest/v1/rpc/filing_record_pull') return new Response(JSON.stringify(pullAnswer(body)), { status: 200 });
  if (u === DB + '/rest/v1/rpc/filing_pull_report') return new Response(JSON.stringify('log-id'), { status: 200 });
  if (u.startsWith(DB + '/storage/v1/object/return-pdfs/') && method === 'POST') return new Response('{}', { status: 200 });
  if (u.startsWith(DB + '/rest/v1/gst_filed_returns') && method === 'GET') return new Response('[]', { status: 200 });
  if (u.startsWith(DB + '/rest/v1/gst_filed_returns') && method === 'POST') return new Response(null, { status: 201 });
  throw new Error('fake database has no route for ' + method + ' ' + u);
}

// ── chrome.* shared by the background worker and the pages ────────────────
const storage = {};
let bgListener = null;
const clone = (x) => JSON.parse(JSON.stringify(x));
const local = {
  get: async (k) => {
    if (k == null) return clone(storage);
    const out = {};
    for (const key of (Array.isArray(k) ? k : [k])) if (key in storage) out[key] = clone(storage[key]);
    return out;
  },
  set: async (o) => { for (const [k, val] of Object.entries(o)) storage[k] = clone(val); },
  remove: async (k) => { for (const key of (Array.isArray(k) ? k : [k])) delete storage[key]; },
};
let tabsCreated = 0;
let tabRemoved = null;
const chromeFor = (tabId) => ({
  storage: { local, onChanged: { addListener() {}, removeListener() {} } },
  runtime: {
    getManifest: () => JSON.parse(read('manifest.json')),
    sendMessage: (msg, cb) => { bgListener(msg, { tab: { id: tabId } }, (resp) => cb && cb(resp)); },
    onMessage: { addListener: (fn) => { bgListener = fn; } },
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  notifications: { create() {}, onClicked: { addListener() {} } },
  tabs: { create: async () => { tabsCreated++; return { id: 1 }; }, update: async () => ({ id: 1, windowId: 1 }), onRemoved: { addListener: (fn) => { tabRemoved = fn; } } },
  windows: { update: async () => ({}) },
  declarativeNetRequest: { updateDynamicRules: async () => {} },
});
const bg = vm.createContext({
  chrome: chromeFor(null), fetch: dbFetch, console, URL, Response, setTimeout, clearTimeout, setInterval, clearInterval,
  atob, btoa, TextEncoder, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set, AbortController,
});
bg.globalThis = bg;
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: ANON }; };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve) => bgListener({ gstk: true, fn, args }, {}, resolve));

// ── The fake portal pages ──────────────────────────────────────────────────
function el(extra = {}) {
  return {
    style: {}, children: [], appendChild() {}, remove() {}, addEventListener() {}, dispatchEvent() {}, focus() {}, blur() {},
    click() {}, scrollIntoView() {}, querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, closest: () => null,
    offsetParent: {}, value: '', className: '',
    set textContent(t) { this._t = t; }, get textContent() { return this._t || ''; },
    ...extra,
  };
}
// page: { efiled: { options, rows } } or { view: { kind: '3b' | '1', blobs } }
function makeDocument(page, win) {
  const byId = {};
  const clicks = [];
  const select = el({ options: [], selectedIndex: -1, disabled: false });
  let table = null;
  let search = null;
  const buttons = [];
  if (page.efiled) {
    select.options = page.efiled.options.map((t, index) => ({ textContent: t, value: t, index, disabled: false, selected: false }));
    search = el({ textContent: 'SEARCH', click() { clicks.push('search'); } });
    buttons.push(search);
    const trs = page.efiled.rows.map((cells, i) => {
      const view = el({ textContent: 'View', click() { clicks.push('view:' + i); } });
      return el({
        textContent: cells.join(' '),
        children: cells.map((c) => el({ textContent: c })),
        querySelector: (s) => (s === 'a.btn-edit' ? view : null),
        querySelectorAll: () => [view],
      });
    });
    table = el({ querySelector: (s) => (s === 'tbody tr' ? trs[0] || null : null), querySelectorAll: (s) => (s === 'tbody tr' ? trs : []) });
  }
  let popup = null;
  let download = null;
  if (page.view) {
    popup = el({ id: 'statustable', _display: page.view.kind === '3b' ? 'block' : 'none' });
    popup.querySelector = (s) => (s === 'button[data-dismiss="modal"]' ? el({ click() { popup._display = 'none'; clicks.push('close-popup'); } }) : null);
    download = el({
      textContent: page.view.kind === '3b' ? 'DOWNLOAD FILED GSTR-3B' : 'DOWNLOAD (PDF)',
      click() {
        clicks.push('download');
        page.view.blobs.forEach((b, i) => setTimeout(() => win.postMessage({ __gstkPdf: b, size: 1, type: 'application/pdf' }, '*'), 30 * (i + 1)));
      },
    });
    if (page.view.kind === '1') buttons.push(el({ textContent: 'VIEW SUMMARY', click() { clicks.push('view-summary'); } }));
    buttons.push(download);
  }
  return {
    clicks,
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: (s) => {
      if (s === 'select') return page.efiled ? select : null;
      if (s === 'table') return table;
      if (s === '#statustable') return popup;
      if (s === 'button[data-ng-click="downloadPrePdf()"]') return page.view && page.view.kind === '3b' ? download : null;
      return null;
    },
    querySelectorAll: (s) => {
      if (s === 'select') return page.efiled ? [select] : [];
      if (/button/.test(s)) return buttons;
      return [];
    },
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
    banner: () => (byId['gstk-banner'] ? byId['gstk-banner'].textContent : ''),
    selected: () => select.options[select.selectedIndex] && select.options[select.selectedIndex].textContent,
  };
}

let lastHref = null;
async function runPage(href, page, portalFetch) {
  const listeners = [];
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    DecompressionStream, atob, btoa, Uint8Array, TextEncoder,
    Event: class { constructor(t) { this.type = t; } }, KeyboardEvent: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getComputedStyle: (e) => ({ display: e && e._display ? e._display : 'block' }),
    fetch: portalFetch || (async () => new Response('{}', { status: 404 })),
    chrome: chromeFor(1), jspdf: {},
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage: (data) => { for (const fn of listeners.slice()) fn({ data, source: sandbox }); },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  sandbox.document = makeDocument(page, sandbox);
  sandbox.location = { get href() { return href; }, set href(x) { lastHref = x; }, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} };
  lastHref = null;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read('db.js'), ctx, { filename: 'db.js' });
  vm.runInContext(read('filedpdf.js'), ctx, { filename: 'filedpdf.js' });
  await vm.runInContext(contentSrc, ctx, { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 50));
  return sandbox.document;
}

const EFILED = 'https://return.gst.gov.in/returns/auth/efiledReturns';
const VIEW3B = 'https://return.gst.gov.in/returns/auth/gstr3b';
const VIEW1 = 'https://return.gst.gov.in/returns/auth/gstr1';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const formdetails = (map) => async (url) => {
  const u = String(url);
  const m = /rtn_typ=([A-Z0-9]+)/.exec(u);
  if (u.includes('/api/formdetails') && m && map[m[1]]) return json({ status: 1, data: map[m[1]] });
  return json({ status: 0 }, 404);
};
const reset = () => { calls.length = 0; for (const k of Object.keys(storage)) delete storage[k]; pullAnswer = () => ({ outcome: 'filed', message: 'Filed, from the portal.' }); };
const rpcCalls = (fn) => calls.filter((c) => c.url === DB + '/rest/v1/rpc/' + fn).map((c) => c.body);
const OPTIONS = ['2026-27', 'Monthly', 'Quarterly', 'September', 'GSTR1A', 'GSTR1', 'GSTR3B'];

// 1. The start: one client's two returns; a client without a login reported at once.
reset();
let started = await bgCall('startReturnPull', { items: [
  { clientId: 'c1', return_type: 'GSTR-1', period_month: '09/2026' },
  { clientId: 'c1', return_type: 'GSTR-3B', period_month: '09/2026' },
  { clientId: 'c2', return_type: 'GSTR-3B', period_month: '09/2026' },
], actorId: 'u-staff', requestId: 'req-1' });
const job1 = storage.gstk_active_job;
ok(started.ok && started.data.clients === 1 && started.data.returns === 2 && started.data.skipped.join() === 'NO LOGIN LTD', '(v) one login for c1\'s two returns; c2 skipped', started);
ok(job1 && job1.mode === 'returnpdf' && job1.clients[0].rets.length === 2 && job1.actorId === 'u-staff' && job1.requestId === 'req-1', 'the job carries the returns, who asked and the request', job1);
const rep = rpcCalls('filing_pull_report');
ok(rep.length === 1 && rep[0].p_client_id === 'c2' && rep[0].p_outcome === 'failed' && /no saved GST portal user ID/.test(rep[0].p_message), '(v) the skipped client is reported to GST Keeper', rep);

// 2. e-Filed Returns, GSTR-1: the GSTR1 option (not GSTR1A, listed first),
//    the GSTR1 row (not the GSTR-1A row above it), the GSTR-1A kept apart,
//    the date from the form details.
storage.gstk_active_job = { ...job1, step: 'efiledpdf', lastActivityAt: Date.now() };
let doc = await runPage(EFILED, { efiled: { options: OPTIONS, rows: [
  ['GSTR1A', '2026-27', 'September', 'AA240926000001Z', '20/10/2026'],
  ['GSTR1', '2026-27', 'September', 'AA240926123456X', '10/10/2026 18:20'],
] } }, formdetails({ GSTR1: { arn: 'AA240926123456X', fil_dt: '10-10-2026', status: 'FIL' } }));
ok(doc.selected() === 'GSTR1', '(ii) the exact return type option is chosen (0.14.0 took GSTR1A, listed first)', doc.selected());
let j = storage.gstk_active_job;
ok(j && j.step === 'efiledview' && j.ret.arn === 'AA240926123456X' && doc.clicks.includes('view:1'), '(ii) the GSTR1 row is opened, not the GSTR-1A row', j && j.ret);
ok(j && j.ret.filedDate === '2026-10-10' && j.ret.dateFrom === 'formdetails', '(iii) the filing date is the portal\'s (form details)', j && j.ret);
const g1a = calls.find((c) => c.url.startsWith(DB + '/rest/v1/gst_filed_returns') && c.method === 'POST');
ok(g1a && g1a.body[0].return_type === 'GSTR1A' && g1a.body[0].arn === 'AA240926000001Z' && g1a.body[0].filed_date === '2026-10-20', '(ii) the GSTR-1A is stored as its own record (gst_filed_returns GSTR1A)', g1a);
ok(rpcCalls('filing_pull_report').some((b) => b.p_outcome === 'gstr1a_seen' && /AA240926000001Z/.test(b.p_message)), '(ii) and logged as seen, never on the GSTR-1 row');

// 3. The GSTR-1 view page gives the GSTR-1A PDF first, then the GSTR-1: the
//    GSTR-1 is stored and recorded with the portal's date.
calls.length = 0;
doc = await runPage(VIEW1, { view: { kind: '1', blobs: [dataUrl(fixture('filed-gstr1a.pdf')), dataUrl(fixture('filed-gstr1.pdf'))] } });
let up = calls.filter((c) => c.url.startsWith(DB + '/storage/v1/object/return-pdfs/'));
let rec = rpcCalls('filing_record_pull');
ok(up.length === 1 && /c1\/09-2026\/GSTR-1-AA240926123456X-\d{13}\.pdf$/.test(up[0].url), '(i)(ii) only the GSTR-1 PDF is uploaded', up.map((c) => c.url));
ok(up.length === 1 && up[0].headers['x-upsert'] === 'false', '(vi) uploaded without overwrite', up[0] && up[0].headers);
ok(rec.length === 1 && rec[0].p_arn === 'AA240926123456X' && rec[0].p_return_type === 'GSTR-1' && rec[0].p_filed_date === '2026-10-10'
  && /return-pdfs\/c1\/09-2026\/GSTR-1-AA240926123456X-\d{13}\.pdf$/.test(rec[0].p_pdf_url) && rec[0].p_pdf_note === null && rec[0].p_actor_id === 'u-staff',
  '(iv) recorded through filing_record_pull with the ARN, the portal\'s date, the checked PDF and who asked', rec[0]);
j = storage.gstk_active_job;
ok(j && j.retIdx === 1 && j.step === 'efiledpdf' && lastHref === EFILED, 'then the client\'s next return (GSTR-3B) on e-Filed Returns, no new login', j && { retIdx: j.retIdx, step: j.step });
ok(j && j.retResults.length === 1 && j.retResults[0].outcome === 'filed', '(v) the outcome kept for the end', j && j.retResults);

// 4. GSTR-3B: the form details fail, so the row's date; the view page gives
//    the System generated summary first, then the filed return: the filed
//    return is kept.
calls.length = 0;
doc = await runPage(EFILED, { efiled: { options: OPTIONS, rows: [['GSTR3B', '2026-27', 'September', 'AB240926123456X', '18-10-2026']] } }, formdetails({}));
j = storage.gstk_active_job;
ok(doc.selected() === 'GSTR3B' && j.step === 'efiledview' && j.ret.filedDate === '2026-10-18' && j.ret.dateFrom === 'efiled row', '(iii) no form details: the row\'s date (dashes read), never today', j.ret);
calls.length = 0;
pullAnswer = () => ({ outcome: 'conflict', message: 'The portal gave ARN AB240926123456X, but this return holds ARN AB240926999999Z. Nothing was changed. The superadmin decides which is right.' });
doc = await runPage(VIEW3B, { view: { kind: '3b', blobs: [dataUrl(fixture('system-summary-gstr3b.pdf')), dataUrl(fixture('filed-gstr3b.pdf'))] } });
up = calls.filter((c) => c.url.startsWith(DB + '/storage/v1/object/return-pdfs/'));
rec = rpcCalls('filing_record_pull');
ok(doc.clicks.includes('close-popup') && doc.clicks.includes('download'), 'the summary popup is closed and the filed return\'s button pressed', doc.clicks);
ok(up.length === 1 && /c1\/09-2026\/GSTR-3B-AB240926123456X-\d{13}\.pdf$/.test(up[0].url) && up[0].headers['x-upsert'] === 'false', '(i) the summary is passed over; the filed GSTR-3B is the one stored', up.map((c) => c.url));
ok(rec.length === 1 && rec[0].p_pdf_note === null && rec[0].p_filed_date === '2026-10-18', '(i) recorded with the checked PDF', rec[0]);
ok(/1 filed, 1 conflict/.test(doc.banner()) && !/✓/.test(doc.banner()), '(iv) the end says a conflict happened, not a plain success', doc.banner());
ok(storage.gstk_return_pull_progress && storage.gstk_return_pull_progress.outcome === 'conflict' && storage.gstk_return_pull_progress.requestId === 'req-1',
  '(v) the page hears the conflict for its request', storage.gstk_return_pull_progress);

// 5. The end: every return asked for, with its outcome; the job is cleared.
ok(!storage.gstk_active_job, 'the job ends after the client\'s last return');
const done = storage.gstk_return_pull_result;
ok(done && done.requestId === 'req-1' && done.results.length === 2 && done.results.map((r) => r.return_type + ':' + r.outcome).join() === 'GSTR-1:filed,GSTR-3B:conflict',
  '(v) the whole pull\'s results for the page', done);

// 6. Only the System generated summary comes: no PDF stored, the reason
//    recorded with the ARN and date.
reset();
storage.gstk_active_job = { mode: 'returnpdf', idx: 0, retIdx: 0, step: 'efiledview', startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
  periodIdx: 0, period: '09/2026', clients: [{ clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS' }, rets: [{ return_type: 'GSTR-3B', period_month: '09/2026' }] }],
  ret: { return_type: 'GSTR-3B', period_month: '09/2026', arn: 'AB240926123456X', filedDate: null, dateFrom: null }, retResults: [] };
doc = await runPage(VIEW3B, { view: { kind: '3b', blobs: [dataUrl(fixture('system-summary-gstr3b.pdf'))] } });
up = calls.filter((c) => c.url.startsWith(DB + '/storage/v1/object/return-pdfs/'));
rec = rpcCalls('filing_record_pull');
ok(up.length === 0, '(i) the summary alone: no PDF uploaded', up);
ok(rec.length === 1 && rec[0].p_pdf_url === null && rec[0].p_pdf_note === 'The portal gave the System generated summary, not the filed return.' && rec[0].p_filed_date === null,
  '(i)(iii) recorded without a PDF, with the reason, and no date (never the pull\'s day)', rec[0]);

// 7. No date from the form details or the row: the PDF's Date of ARN.
reset();
storage.gstk_active_job = { mode: 'returnpdf', idx: 0, retIdx: 0, step: 'efiledview', startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
  periodIdx: 0, period: '09/2026', clients: [{ clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS' }, rets: [{ return_type: 'GSTR-3B', period_month: '09/2026' }] }],
  ret: { return_type: 'GSTR-3B', period_month: '09/2026', arn: 'AB240926123456X', filedDate: null, dateFrom: null }, retResults: [] };
doc = await runPage(VIEW3B, { view: { kind: '3b', blobs: [dataUrl(fixture('filed-gstr3b.pdf'))] } });
rec = rpcCalls('filing_record_pull');
ok(rec.length === 1 && rec[0].p_filed_date === '2026-10-11' && rec[0].p_detail.date_from === 'pdf', '(iii) the PDF\'s Date of ARN when the portal pages gave none', rec[0]);

// 8. A return not on e-Filed Returns: not found, logged, nothing recorded.
reset();
storage.gstk_active_job = { mode: 'returnpdf', idx: 0, retIdx: 0, step: 'efiledpdf', startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
  periodIdx: 0, period: '09/2026', clients: [{ clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS' }, rets: [{ return_type: 'GSTR-1', period_month: '09/2026' }] }], retResults: [] };
doc = await runPage(EFILED, { efiled: { options: OPTIONS, rows: [['GSTR1A', '2026-27', 'September', 'AA240926000001Z', '20/10/2026']] } }, formdetails({}));
const nf = rpcCalls('filing_pull_report').find((b) => b.p_outcome === 'not_found');
ok(nf && /No filed GSTR-1 for 09\/2026 on the portal \(the list showed GSTR1A\)/.test(nf.p_message), '(ii) only a GSTR-1A on the list: the GSTR-1 is not found, never the 1A taken', nf);
ok(rpcCalls('filing_record_pull').length === 0, 'nothing recorded for it');

// 10. Round 1: the download navigated (the tab came back to e-Filed Returns
//     with pdfClicked set): the ARN and date already read are recorded,
//     without a PDF and with the reason, not a bare "failed".
reset();
storage.gstk_active_job = { mode: 'returnpdf', idx: 0, retIdx: 0, step: 'efiledpdf', startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
  periodIdx: 0, period: '09/2026', pdfClicked: true, actorId: 'u-staff', requestId: 'req-10',
  clients: [{ clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS' }, rets: [{ return_type: 'GSTR-3B', period_month: '09/2026' }] }],
  ret: { return_type: 'GSTR-3B', period_month: '09/2026', arn: 'AB240926123456X', filedDate: '2026-10-18', dateFrom: 'efiled row' }, retResults: [] };
doc = await runPage(EFILED, { efiled: { options: OPTIONS, rows: [] } }, formdetails({}));
rec = rpcCalls('filing_record_pull');
ok(rec.length === 1 && rec[0].p_arn === 'AB240926123456X' && rec[0].p_filed_date === '2026-10-18' && rec[0].p_pdf_url === null
  && /opened a page instead of a file/.test(rec[0].p_pdf_note), '(iii) a download that navigated keeps the ARN and date read, records no PDF and says why', rec[0]);
ok(!rpcCalls('filing_pull_report').some((b) => b.p_outcome === 'failed'), 'not reported as failed');

// 11. Round 1: the session kept dropping (third bounce to the login page):
//     each of the client's returns not reached is logged in GST Keeper as
//     failed, with the reason, and the page hears them as not reached.
reset();
storage.gstk_active_job = { mode: 'returnpdf', idx: 0, retIdx: 0, step: 'efiledpdf', startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
  periodIdx: 0, period: '09/2026', retries: 2, actorId: 'u-staff', requestId: 'req-11',
  clients: [{ clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS' }, rets: [{ return_type: 'GSTR-1', period_month: '09/2026' }, { return_type: 'GSTR-3B', period_month: '09/2026' }] }],
  retResults: [] };
doc = await runPage('https://services.gst.gov.in/services/login', {});
let missed = rpcCalls('filing_pull_report').filter((b) => b.p_outcome === 'failed');
ok(missed.length === 2 && missed.every((b) => b.p_client_id === 'c1' && /^Not pulled\. Session kept dropping for FICTIONAL FABRICS\.$/.test(b.p_message)
  && b.p_actor_id === 'u-staff' && b.p_detail.request_id === 'req-11' && b.p_detail.not_reached === true),
  '(v) both returns not reached are logged in GST Keeper with the reason', missed);
ok(storage.gstk_return_pull_result && storage.gstk_return_pull_result.results.map((r) => r.return_type + ':' + r.outcome).join() === 'GSTR-1:not_reached,GSTR-3B:not_reached',
  '(v) and the page hears them as not reached', storage.gstk_return_pull_result);

// 12. Round 1: the portal tab closed with one return done: the other is
//     logged in GST Keeper as well.
reset();
storage.gstk_active_job = { mode: 'returnpdf', idx: 0, retIdx: 1, step: 'efiledpdf', startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
  periodIdx: 0, period: '09/2026', actorId: 'u-staff', requestId: 'req-12',
  clients: [{ clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS' }, rets: [{ return_type: 'GSTR-1', period_month: '09/2026' }, { return_type: 'GSTR-3B', period_month: '09/2026' }] }],
  retResults: [{ clientId: 'c1', return_type: 'GSTR-1', period_month: '09/2026', outcome: 'filed', message: '' }] };
tabRemoved(1);
await new Promise((r) => setTimeout(r, 100));
missed = rpcCalls('filing_pull_report').filter((b) => b.p_outcome === 'failed');
ok(missed.length === 1 && missed[0].p_return_type === 'GSTR-3B' && /tab was closed/.test(missed[0].p_message) && missed[0].p_detail.request_id === 'req-12',
  '(v) a closed tab: the return not pulled is logged in GST Keeper', missed);
ok(!storage.gstk_active_job && storage.gstk_return_pull_result && storage.gstk_return_pull_result.tabClosed, 'the job ends and the page hears it');

// 9. The extension never writes filing_status itself.
ok(!calls.some((c) => /\/rest\/v1\/filing_status/.test(c.url)), '(iv) no direct filing_status write anywhere');
const gone = [await bgCall('markFiled', {}), await bgCall('upsertFilingStatus', [])];
ok(gone.every((r) => r && /unknown fn/.test(r.error)), '(iv) markFiled and upsertFilingStatus are gone from the background', gone);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
