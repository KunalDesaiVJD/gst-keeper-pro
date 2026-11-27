// 0.19.0: vendor GSTINs on the portal's logged-in Search Taxpayer (mode
// gstin_search), the Vendor GSTIN Risk report's Pull. After the client's login
// it looks up each GSTIN of job.gstins from a services.gst.gov.in page and
// saves one vendor_gstin_lookups row per GSTIN (ok / not_found / error), with
// the portal's answer in payload. Stops, never retrying in a loop, on a
// dropped session, a CAPTCHA, no Search Taxpayer address at all, or three
// errors in a row. Same harness as 19: the REAL background.js and content.js in
// Node VM contexts, a stubbed chrome.* API, a fake database and a fake portal.
//   node test/23-gstin-search.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';
const GITA = '10000000-0000-0000-0000-000000000002';
const CLIENT_GSTIN = '24ABCDE1234F1Z5';

// ── The fake database (background.js) ─────────────────────────────────────
const calls = [];
let lookupsDown = false;
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, body, headers: { ...(init.headers || {}) } });
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'FICTIONAL FABRICS', gstin: CLIENT_GSTIN, gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/vendor_gstin_lookups') && method === 'POST') {
    return lookupsDown ? new Response('{"message":"down"}', { status: 503 }) : new Response(null, { status: 201 });
  }
  throw new Error('fake database has no route for ' + method + ' ' + u);
}

// ── chrome.* shared by the background worker and the page ──────────────────
const storage = {};
let bgListener = null;
const clone = (v) => JSON.parse(JSON.stringify(v));
const local = {
  get: async (k) => {
    if (k == null) return clone(storage);
    const out = {};
    for (const key of (Array.isArray(k) ? k : [k])) if (key in storage) out[key] = clone(storage[key]);
    return out;
  },
  set: async (o) => { for (const [k, v] of Object.entries(o)) storage[k] = clone(v); },
  remove: async (k) => { for (const key of (Array.isArray(k) ? k : [k])) delete storage[key]; },
};
const chromeFor = (tabId) => ({
  storage: { local, onChanged: { addListener() {}, removeListener() {} } },
  runtime: {
    getManifest: () => JSON.parse(read('manifest.json')),
    sendMessage: (msg, cb) => { bgListener(msg, { tab: { id: tabId } }, (resp) => cb && cb(resp)); },
    onMessage: { addListener: (fn) => { bgListener = fn; } },
    getContexts: async () => [],
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  downloads: { onCreated: { addListener() {} }, onChanged: { addListener() {} }, search: async () => [] },
  notifications: { create() {}, onClicked: { addListener() {} } },
  tabs: { create: async () => ({ id: 1 }), update: async () => ({ id: 1, windowId: 1 }), onRemoved: { addListener() {} } },
  windows: { update: async () => ({}) },
  declarativeNetRequest: { updateDynamicRules: async () => {} },
});
const bg = vm.createContext({
  chrome: chromeFor(null), fetch: dbFetch, console, URL, Response, setTimeout, clearTimeout, setInterval, clearInterval,
  atob, btoa, TextEncoder, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set,
});
bg.globalThis = bg;
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: ANON }; };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve) => bgListener({ gstk: true, fn, args }, {}, resolve));

// ── The fake portal (the page's fetch) ─────────────────────────────────────
const portalCalls = [];
let portal = null; // (url, init, body) => Response
async function portalFetch(url, init = {}) {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.endsWith('/services/auth/profile/detail')) return new Response(JSON.stringify({ gstin: CLIENT_GSTIN }), { status: 200 });
  portalCalls.push({ url: u, method: init.method || 'GET', body });
  return portal(u, init, body);
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const html404 = () => new Response('<html><body>404 Not Found</body></html>', { status: 404 });

// ── One page load of content.js on the portal tab (tab 1) ──────────────────
const contentSrc = read('content.js');
function makeDocument() {
  const byId = {};
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
    banner: () => (byId['gstk-banner'] ? byId['gstk-banner'].textContent : ''),
  };
}
// The 1.5 s pace between portal requests, as a moment.
const fastTimeout = (fn, ms, ...a) => setTimeout(fn, ms > 50 ? 1 : ms, ...a);
const sleeps = [];
let lastHref = null;
async function runPage(href) {
  const document = makeDocument();
  const location = { get href() { return href; }, set href(v) { lastHref = v; }, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} };
  const sandbox = {
    console, setTimeout: (fn, ms, ...a) => { if (ms >= 1000) sleeps.push(ms); return fastTimeout(fn, ms, ...a); }, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, fetch: portalFetch, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    Event: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: chromeFor(1), document, location,
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async () => null, logStep: async () => null,
      getPortalPassword: async () => null, focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async () => null, clearCaptchaNotice: async () => null,
      // Through the real background worker, as db.js does.
      saveVendorGstinLookup: (row) => new Promise((resolve, reject) => bgListener({ gstk: true, fn: 'saveVendorGstinLookup', args: [row] }, { tab: { id: 1 } },
        (resp) => (resp && resp.error ? reject(new Error(resp.error)) : resolve(resp && resp.data)))),
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.postMessage = () => {};
  sandbox.atob = atob; sandbox.btoa = btoa;
  lastHref = null;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  // The lookups run on after the script's first await: wait for the job to end.
  for (let i = 0; i < 400 && storage.gstk_active_job && storage.gstk_active_job.step === 'gstin_search' && !lastHref; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
  return document;
}

let fail = 0;
const ok = (cond, name, info) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || info === undefined ? '' : '\n     ' + JSON.stringify(info, null, 1).slice(0, 1500))); if (!cond) fail++; };
const reset = () => {
  calls.length = 0; portalCalls.length = 0; sleeps.length = 0; lookupsDown = false;
  for (const k of Object.keys(storage)) delete storage[k];
};
const rows = () => calls.filter((c) => c.method === 'POST' && c.url.startsWith(DB + '/rest/v1/vendor_gstin_lookups')).map((c) => c.body[0]);
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS', gstin: CLIENT_GSTIN, selectedReturns: [] } };
const job = (extra) => ({ mode: 'gstin_search', step: 'gstin_search', idx: 0, startedAt: now, lastActivityAt: now, tabId: 1, actorId: GITA,
  clients: [client], period: '04/2025', periods: ['04/2025'], periodIdx: 0, ...extra });
const WELCOME = 'https://services.gst.gov.in/services/auth/fowelcome';
const V1 = '27AAACR5055K1Z7'; // found, Active, with filings
const V2 = '29AAAAA0000A1Z0'; // the portal has no such GSTIN
const V3 = '24BBBBB1111B1Z1'; // found, Cancelled
const TP1 = {
  gstin: V1, lgnm: 'FICTIONAL STEEL PRIVATE LIMITED', tradeNam: 'FICTIONAL STEEL', sts: 'Active', rgdt: '01/07/2017', cxdt: '',
  ctb: 'Private Limited Company', dty: 'Regular', stj: 'State - Maharashtra, Zone - Mumbai', ctj: 'Commissionerate - MUMBAI EAST',
  pradr: { adr: '12, Fictional Estate, Andheri East, Mumbai, Maharashtra, 400069', addr: { bno: '12' } },
  nba: ['Factory / Manufacturing', 'Wholesale Business'], einvoiceStatus: 'Yes', aggreTurnOver: 'Slab: Rs. 100 Cr. to 500 Cr.', aggreTurnOverFY: '2024-2025',
};
const TP3 = { gstin: V3, lgnm: 'FICTIONAL TRADERS', tradeNam: 'FICTIONAL TRADERS', sts: 'Cancelled', rgdt: '15/09/2019', cxdt: '31/03/2025', ctb: 'Proprietorship', dty: 'Regular',
  stj: 'Ghatak 5', ctj: 'Range II', pradr: { addr: { bno: '4', st: 'Fictional Road', loc: 'Surat', stcd: 'Gujarat', pncd: '395003' } }, nba: 'Retail Business' };
const FILINGS1 = { filingStatus: [[
  { fy: '2025-2026', taxp: 'October', mof: 'ONLINE', dof: '11/11/2025', rtntype: 'GSTR1', arn: 'AA2710250000001', status: 'Filed' },
  { fy: '2025-2026', taxp: 'October', mof: 'ONLINE', dof: '20/11/2025', rtntype: 'GSTR3B', arn: 'AA2710250000002', status: 'Filed' },
]] };
const NOT_FOUND = { errorCode: 'SWEB_9035', message: 'No records found for the provided GSTIN.' };
const searchTp = (fn) => (u, init, body) => {
  if (u.endsWith('/services/auth/api/search/tp') && init.method === 'POST') return fn(body.gstin);
  if (u.endsWith('/services/auth/api/search/taxpayerReturnDetails') && init.method === 'POST') {
    if (body.gstin === V1) return json(FILINGS1);
    return json({ filingStatus: [] });
  }
  return html404();
};
const happy = searchTp((g) => (g === V1 ? json(TP1) : g === V3 ? json({ data: TP3 }) : json(NOT_FOUND, 200)));

// 1. Background: the Pull starts a gstin_search job carrying its GSTINs; no other mode gets the field.
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstin_search', period_month: '04/2025', period_months: ['04/2025'], gstins: [V1, ' ' + V2.toLowerCase() + ' ', 'NOT-A-GSTIN', V3], actorId: GITA });
const started = storage.gstk_active_job;
ok(started && started.mode === 'gstin_search' && started.step === 'login' && started.actorId === GITA, 'startSectionPull: a gstin_search job, at login, naming the app user', started);
ok(started && JSON.stringify(started.gstins) === JSON.stringify([V1, V2, V3]), 'startSectionPull: the GSTINs as given, upper-cased, the malformed one left out', started && started.gstins);
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstr9_8a_pull', period_month: '03/2026', period_months: ['03/2026'], gstins: [V1] });
ok(storage.gstk_active_job && !('gstins' in storage.gstk_active_job), 'startSectionPull: another mode\'s job is as before (no gstins field)', storage.gstk_active_job);

// 2. Logged in: the job goes to a services.gst.gov.in page for the lookups.
reset();
storage.gstk_active_job = job({ step: 'login', gstins: [V1] });
portal = happy;
await runPage(WELCOME);
ok(storage.gstk_active_job && storage.gstk_active_job.step === 'gstin_search' && lastHref === WELCOME, 'login: on to the lookups, from fowelcome', { job: storage.gstk_active_job, lastHref });
ok(portalCalls.length === 0 && rows().length === 0, 'login: nothing looked up or saved yet');

// 3. The lookups: one row per GSTIN, mapped; the job ends.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3] });
portal = happy;
let page = await runPage(WELCOME);
const r = rows();
ok(r.length === 3 && r.map((x) => x.gstin).join() === [V1, V2, V3].join(), 'lookups: three rows, in order', r.map((x) => [x.gstin, x.status]));
ok(!storage.gstk_active_job, 'lookups: the job ends');
ok(/done: 2 found, 1 not found, 0 failed/.test(page.banner()), 'lookups: the banner counts them', page.banner());
const a = r[0] || {};
ok(a.status === 'ok' && a.legal_name === TP1.lgnm && a.trade_name === 'FICTIONAL STEEL' && a.reg_status === 'Active' && a.reg_date === '2017-07-01' && a.cancel_date === null,
  'ok row: names, status, dates dd/mm/yyyy -> ISO (an empty cancel date is null)', a);
ok(a.constitution === 'Private Limited Company' && a.taxpayer_type === 'Regular' && a.state_jurisdiction === TP1.stj && a.centre_jurisdiction === TP1.ctj,
  'ok row: constitution, taxpayer type, jurisdictions', a);
ok(a.address === TP1.pradr.adr && JSON.stringify(a.nature_of_business) === JSON.stringify(TP1.nba) && a.einvoice_status === 'Yes' && a.ato_slab === 'Slab: Rs. 100 Cr. to 500 Cr. (FY 2024-2025)',
  'ok row: address, nature of business, e-invoice, turnover slab with its FY', a);
ok(Array.isArray(a.filings) && a.filings.length === 2 && a.filings[0].rtntype === 'GSTR1' && a.filings[0].dof === '2025-11-11' && a.filings[1].status === 'Filed'
  && a.filings[0].fy === '2025-2026' && a.filings[0].taxp === 'October' && a.filings[0].mof === 'ONLINE',
  'ok row: the filing table, dof as ISO', a.filings);
ok(a.payload && a.payload.details && a.payload.details.url === '/services/auth/api/search/tp' && a.payload.details.body.lgnm === TP1.lgnm && a.payload.returns.length >= 1,
  'ok row: the portal\'s answers kept in payload, with the address that gave them', a.payload);
ok(a.looked_up_by === GITA && a.via_client_id === 'c1' && a.extension_version === JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version && a.source === 'gst_portal_search_taxpayer' && !('looked_up_at' in a),
  'ok row: who asked, whose login, the version; the time is the database\'s', a);
const b = r[1] || {};
ok(b.status === 'not_found' && /No records found/.test(b.error) && b.legal_name === undefined && b.payload.details.body.errorCode === 'SWEB_9035', 'not found: status not_found, the portal\'s words', b);
const c3 = r[2] || {};
ok(c3.status === 'ok' && c3.reg_status === 'Cancelled' && c3.cancel_date === '2025-03-31' && c3.address === '4, Fictional Road, Surat, Gujarat, 395003'
  && JSON.stringify(c3.nature_of_business) === '["Retail Business"]' && c3.einvoice_status === null,
  'ok row (wrapped in data): a cancelled GSTIN, the address built from its parts', c3);
ok(Array.isArray(c3.filings) && c3.filings.length === 0, 'ok row: an empty filing table is [] (asked again by FY first)', c3.filings);
const posts = calls.filter((c) => c.url.startsWith(DB + '/rest/v1/vendor_gstin_lookups'));
ok(posts.every((p) => p.headers['x-gst-actor'] === GITA && p.headers['x-gst-source'] === 'extension' && p.headers.apikey === ANON), 'every insert names the app user and the extension (x-gst-actor / x-gst-source)', posts.map((p) => p.headers));
ok(portalCalls.every((p) => /\/services\/auth\//.test(p.url)) && !portalCalls.some((p) => /\/services\/api\/search\/taxpayerDetails/.test(p.url)),
  'only the logged-in services are asked, never the public (CAPTCHA) search', portalCalls.map((p) => p.url));
ok(sleeps.filter((ms) => ms === 1500).length >= portalCalls.length - 1, 'requests are paced 1.5 s apart', { sleeps, n: portalCalls.length });
const fyAsk = portalCalls.find((p) => p.body && p.body.fy);
ok(fyAsk && fyAsk.body.gstin === V3 && fyAsk.body.fy === '2025-26', 'no filing table: asked once more with the job\'s FY', portalCalls);

// 4. The first address does not serve the search: the next one is used, and kept.
reset();
storage.gstk_active_job = job({ gstins: [V1, V3] });
portal = (u, init, body) => {
  if (u.endsWith('/services/auth/api/search/tp')) return html404();
  if (u.endsWith('/services/auth/api/search/taxpayerDetails')) return json(body.gstin === V1 ? TP1 : TP3);
  if (u.endsWith('/services/auth/api/search/taxpayerReturnDetails')) return json({ filingStatus: [] });
  return html404();
};
await runPage(WELCOME);
ok(rows().length === 2 && rows().every((x) => x.status === 'ok') && rows()[1].payload.details.url === '/services/auth/api/search/taxpayerDetails', 'fallback: the second address answers for both', rows().map((x) => [x.status, x.payload && x.payload.details]));
ok(portalCalls.filter((p) => p.url.endsWith('/search/tp')).length === 1, 'fallback: the address that failed is not asked again', portalCalls.map((p) => p.url));

// 5. The session ends midway: that GSTIN is an error, the rest not asked, the job stops.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3] });
portal = searchTp((g) => (g === V1 ? json(TP1) : new Response('{"message":"Unauthorized"}', { status: 401 })));
page = await runPage(WELCOME);
ok(rows().length === 2 && rows()[0].status === 'ok' && rows()[1].status === 'error' && /session ended/.test(rows()[1].error), 'session expiry: the GSTIN in flight is recorded as an error', rows().map((x) => [x.gstin, x.status, x.error]));
ok(!portalCalls.some((p) => p.body && p.body.gstin === V3), 'session expiry: the GSTINs after it are not asked');
ok(!storage.gstk_active_job && /stopped: the portal session ended.*1 not looked up/.test(page.banner()), 'session expiry: the job stops and says so', page.banner());

// 6. A CAPTCHA asked for: stop, never fill it.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2] });
portal = searchTp(() => json({ errorCode: 'SWEB_9000', message: 'Please enter valid captcha' }));
page = await runPage(WELCOME);
ok(rows().length === 1 && rows()[0].status === 'error' && /CAPTCHA/.test(rows()[0].error), 'captcha: an error row for that GSTIN', rows());
ok(portalCalls.length === 1 && !storage.gstk_active_job && /CAPTCHA.*never fills one/.test(page.banner()), 'captcha: one request, then the job stops', { n: portalCalls.length, b: page.banner() });

// 7. No Search Taxpayer address at all: one error row, then stop (no hammering).
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3] });
portal = () => html404();
page = await runPage(WELCOME);
ok(rows().length === 1 && rows()[0].status === 'error' && /no Search Taxpayer address answered/.test(rows()[0].error) && Array.isArray(rows()[0].payload.details),
  'no endpoint: one error row naming every address tried', rows());
ok(portalCalls.length === 3 && !storage.gstk_active_job, 'no endpoint: each address asked once, then the job stops', portalCalls.map((p) => p.url));

// 8. A JSON 404 that is the server's own "Not Found" is not "no such GSTIN".
reset();
storage.gstk_active_job = job({ gstins: [V1] });
portal = (u, init, body) => (u.endsWith('/search/tp') ? json({ status: 404, error: 'Not Found', path: '/services/auth/api/search/tp' }, 404)
  : u.endsWith('/search/taxpayerDetails') ? json(TP1) : json({ filingStatus: [] }));
await runPage(WELCOME);
ok(rows().length === 1 && rows()[0].status === 'ok', 'a server 404 "Not Found" moves on to the next address, not to not_found', rows().map((x) => [x.status, x.error]));

// 9. Three errors in a row: stop.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3, '27BBBBB2222B1Z2', '27CCCCC3333C1Z3'] });
portal = searchTp(() => json({ unexpected: true }));
page = await runPage(WELCOME);
ok(rows().length === 3 && rows().every((x) => x.status === 'error' && /not understood/.test(x.error)) && !storage.gstk_active_job && /3 lookups failed in a row/.test(page.banner()),
  'three errors in a row: three error rows, then stop', { rows: rows().map((x) => x.error), b: page.banner() });

// 10. Sent to the login page during the lookups: stop, nothing asked.
reset();
storage.gstk_active_job = job({ gstins: [V1] });
portal = happy;
page = await runPage('https://services.gst.gov.in/services/login');
ok(portalCalls.length === 0 && rows().length === 0 && !storage.gstk_active_job && /session ended/.test(page.banner()), 'bounced to login: stops, nothing asked or saved', page.banner());

// 11. GST Keeper does not take the rows: stop after two failed saves.
reset();
lookupsDown = true;
storage.gstk_active_job = job({ gstins: [V1, V2, V3] });
portal = happy;
page = await runPage(WELCOME);
ok(rows().length === 2 && !storage.gstk_active_job && /did not take the lookups/.test(page.banner()), 'database down: two tries, then stop', page.banner());

// 12. A reload midway resumes after the last saved GSTIN.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3], gs: { idx: 2, ok: 1, not_found: 1, error: 0, errorsInRow: 0, saveFails: 0, detailsEp: 0, returnsEp: 0, asked: true } });
portal = happy;
page = await runPage(WELCOME);
ok(rows().length === 1 && rows()[0].gstin === V3 && /done: 2 found, 1 not found/.test(page.banner()), 'resume: only the GSTIN not yet done', { rows: rows().map((x) => x.gstin), b: page.banner() });

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
