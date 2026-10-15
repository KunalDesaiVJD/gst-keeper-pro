// 0.13.0: GSTR-2A and GSTR-2B pulled together (mode gstr2a2b_pull, the 2A vs
// 2B report's Pull), the GSTR-2B multi-month fix, a missing 2B tile that no
// longer ends the job, the 2A pull keeping the portal's supplier fields with a
// record of failed suppliers, and a failed 2A supplier list that keeps the
// earlier 2A. Same harness as 09: the REAL background.js and content.js in Node
// VM contexts, a stubbed chrome.* API, a fake database and a fake portal.
//   node test/14-gstr2a2b-pull.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';

// ── The fake database (background.js) ─────────────────────────────────────
const calls = [];
let existingFiled = [];
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, body });
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'FICTIONAL FABRICS', gstin: '24ABCDE1234F1Z5', gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gst_filed_returns') && method === 'GET') return new Response(JSON.stringify(existingFiled), { status: 200 });
  if (u.startsWith(DB + '/rest/v1/gst_filed_returns') && method === 'PATCH') return new Response(null, { status: 204 });
  if (u.startsWith(DB + '/rest/v1/gst_filed_returns') && method === 'POST') return new Response(null, { status: 201 });
  throw new Error('fake database has no route for ' + method + ' ' + u);
}

// ── chrome.* shared by the background worker and every page ─────────────────
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
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
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

// ── One page load of content.js on the portal tab (tab 1) ──────────────────
const contentSrc = read('content.js');
const upserts = [];
function makeDocument(opts) {
  const byId = {};
  const el = (extra) => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, dispatchEvent() {}, focus() {}, blur() {}, click() {},
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, offsetParent: {}, value: '', ...extra,
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  // The returns dashboard's cascading selects, as one select holding every option.
  const options = ['2026-27', 'Quarter 2 (Jul - Sep)', 'July', 'August'].map((t, index) => ({ textContent: t, value: t, index, disabled: false, selected: false }));
  const select = { ...el(), options, selectedIndex: -1, disabled: false };
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: (s) => (s === 'select' && opts.dashboard ? select : s === 'button.srchbtn' && opts.dashboard ? el() : null),
    querySelectorAll: (s) => (s === 'select' && opts.dashboard ? [select] : []),
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
    banner: () => (byId['gstk-banner'] ? byId['gstk-banner'].textContent : ''),
  };
}
// A clock that runs fast, so the dashboard's 15-second wait for a tile is a moment.
const fastDate = () => { let t = Date.now(); return class extends Date { static now() { t += 2500; return t; } }; };
let lastHref = null;
async function runPage(href, opts = {}) {
  const document = makeDocument(opts);
  const location = { get href() { return href; }, set href(v) { lastHref = v; }, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date: opts.Date || Date, fetch: opts.fetch, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (f) => this.files.push(f) }; } },
    Event: class { constructor(t) { this.type = t; } }, KeyboardEvent: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: chromeFor(1), document, location,
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async () => null, logStep: async () => null,
      getPortalPassword: async () => null, focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async () => null, clearCaptchaNotice: async () => null,
      upsertFiledReturn: async (...args) => { upserts.push(clone(args)); return true; },
    },
    jspdf: {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  lastHref = null;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 50));
  return document;
}

let fail = 0;
const ok = (cond, name, info) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || info === undefined ? '' : '\n     ' + JSON.stringify(info))); if (!cond) fail++; };
const reset = () => { calls.length = 0; upserts.length = 0; existingFiled = []; for (const k of Object.keys(storage)) delete storage[k]; };
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS', gstin: '24ABCDE1234F1Z5', selectedReturns: [] } };
const job = (extra) => ({ idx: 0, startedAt: now, lastActivityAt: now, tabId: 1, clients: [client], periodIdx: 0, ...extra });
const DASH = 'https://return.gst.gov.in/returns/auth/dashboard';
const G2B = 'https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

// The portal: a ctin list of two suppliers; ALPHA answers, BETA fails (500).
const ALPHA = '24AAAPA0001A1Z1';
const BETA = '27AAAPB0002B1Z2';
const portal2A = (ctinAnswer) => async (url) => {
  const u = String(url);
  if (u.includes('/api/gstr2a/ctin')) return ctinAnswer ? ctinAnswer() : json({ cpty: [{ stin: ALPHA, cname: 'ALPHA TRADERS' }, { stin: BETA, cname: 'BETA STEEL' }] });
  if (u.includes('/api/gstr2a/b2b') && u.includes(ALPHA)) {
    return json({ b2b: [{ ctin: ALPHA, cfs: 'Y', cfs3b: 'N', flprdr1: 'Jul-26', dtcancel: '15-07-2026', fldtr1: '10-Aug-26', inv: [{ inum: 'A-101', idt: '05-07-2026', txval: 100 }] }] });
  }
  if (u.includes('/api/gstr2a/b2b')) return json({ error: 'boom' }, 500);
  throw new Error('fake portal has no route for ' + u);
};

// 1. Background: Pull passes `want` into the job.
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstr2a2b_pull', period_month: '07/2026', period_months: ['07/2026', '08/2026'], want: { '07/2026': ['2A', '2B'], '08/2026': ['2B'] } });
ok(storage.gstk_active_job && storage.gstk_active_job.mode === 'gstr2a2b_pull' && JSON.stringify(storage.gstk_active_job.want) === '{"07/2026":["2A","2B"],"08/2026":["2B"]}', 'startSectionPull keeps want on the job', storage.gstk_active_job);
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstr2a_pull', period_month: '07/2026' });
ok(storage.gstk_active_job && storage.gstk_active_job.want === null, 'startSectionPull without want: want is null');

// 2. 2A of July with 2B wanted: supplier fields kept, a failed supplier recorded, then the 2B step.
reset();
storage.gstk_active_job = job({ mode: 'gstr2a2b_pull', step: 'gstr2a_pull', period: '07/2026', periods: ['07/2026', '08/2026'], want: { '07/2026': ['2A', '2B'], '08/2026': ['2B'] } });
await runPage(DASH, { fetch: portal2A() });
const saved2A = upserts.find((a) => a[2] === 'GSTR2A');
const w = saved2A && saved2A[3].summary && saved2A[3].summary.b2b[0];
ok(w && w.cfs === 'Y' && w.cfs3b === 'N' && w.flprdr1 === 'Jul-26' && w.dtcancel === '15-07-2026' && w.supfildt === '10-Aug-26' && w.trdnm === 'ALPHA TRADERS', '2A wrapper keeps cfs / cfs3b / flprdr1 / dtcancel', w);
const meta = saved2A && saved2A[3].summary._meta;
ok(meta && meta.counterparties === 2 && meta.failed === 1 && meta.failedCtins.join() === BETA, '_meta counts the supplier whose fetch failed (500)', meta);
ok(storage.gstk_active_job.step === 'gstr2b_pull_dash' && storage.gstk_active_job.period === '07/2026' && lastHref === DASH, 'after the 2A: the same month\'s 2B from the dashboard', storage.gstk_active_job);

// 3. 2B of July saved: advance() gives August with the 2B step (August wants only 2B).
upserts.length = 0;
storage.gstk_active_job = { ...storage.gstk_active_job, step: 'gstr2b_pull' };
const portal2B = async (url) => (String(url).includes('/gstr2b/getdata') ? json({ data: { gendt: '14-08-2026', rtnprd: '072026', docdata: { b2b: [] } } }) : json({}, 404));
await runPage(G2B, { fetch: portal2B });
ok(upserts.some((a) => a[2] === 'GSTR2B' && a[3].status === 'Generated'), '2B of July saved');
ok(storage.gstk_active_job.period === '08/2026' && storage.gstk_active_job.step === 'gstr2b_pull_dash', 'advance(): August starts at the 2B dashboard step', storage.gstk_active_job);

// 4. A month that wants 2A goes back to the 2A step on advance().
reset();
storage.gstk_active_job = job({ mode: 'gstr2a2b_pull', step: 'gstr2b_pull', period: '07/2026', periods: ['07/2026', '08/2026'], want: { '07/2026': ['2B'] } });
await runPage(G2B, { fetch: portal2B });
ok(storage.gstk_active_job.period === '08/2026' && storage.gstk_active_job.step === 'gstr2a_pull', 'advance(): a month not listed in want gets 2A first', storage.gstk_active_job);

// 5. gstr2b_pull over two months: the step resets to the dashboard (the 0.12.0 bug).
reset();
storage.gstk_active_job = job({ mode: 'gstr2b_pull', step: 'gstr2b_pull', period: '07/2026', periods: ['07/2026', '08/2026'] });
await runPage(G2B, { fetch: portal2B });
ok(storage.gstk_active_job && storage.gstk_active_job.period === '08/2026' && storage.gstk_active_job.step === 'gstr2b_pull_dash', 'gstr2b_pull: the second month starts from the dashboard tile again', storage.gstk_active_job);

// 6. 2A only wanted: after the 2A, the next period (no 2B step).
reset();
storage.gstk_active_job = job({ mode: 'gstr2a2b_pull', step: 'gstr2a_pull', period: '06/2026', periods: ['06/2026', '08/2026'], want: { '06/2026': ['2A'], '08/2026': ['2B'] } });
await runPage(DASH, { fetch: portal2A() });
ok(storage.gstk_active_job.period === '08/2026' && storage.gstk_active_job.step === 'gstr2b_pull_dash', 'a 2A-only month moves on to the next period', storage.gstk_active_job);

// 7. A 500 supplier list: status only (the earlier 2A is kept), then the 2B step.
reset();
storage.gstk_active_job = job({ mode: 'gstr2a2b_pull', step: 'gstr2a_pull', period: '07/2026', periods: ['07/2026'], want: { '07/2026': ['2A', '2B'] } });
await runPage(DASH, { fetch: portal2A(() => json({ error: 'down' }, 500)) });
const failedList = upserts.find((a) => a[2] === 'GSTR2A');
ok(failedList && !('summary' in failedList[3]) && /^PULL FAILED: GSTR-2A supplier list unavailable \(HTTP 500\)/.test(failedList[3].status), 'a 500 supplier list: status only, no summary key', failedList);
ok(storage.gstk_active_job.step === 'gstr2b_pull_dash', 'a failed 2A still goes on to the wanted 2B');

// 8. An answer without a supplier list that says there is no data: NO DATA with an empty 2A.
reset();
storage.gstk_active_job = job({ mode: 'gstr2a_pull', step: 'gstr2a_pull', period: '07/2026', periods: ['07/2026'] });
await runPage(DASH, { fetch: portal2A(() => json({ status: 0, error: { error_cd: 'RET2A01', message: 'No Data Found' } })) });
const noData = upserts.find((a) => a[2] === 'GSTR2A');
ok(noData && noData[3].status === 'NO DATA / NOT FOUND' && Array.isArray(noData[3].summary.b2b) && noData[3].summary.b2b.length === 0, '"No Data Found": saved as NO DATA with an empty b2b', noData);
ok(!storage.gstk_active_job, 'gstr2a_pull of one month: the job ends after it');

// 8b. The other no-data phrasings, and a success answer without a list: NO DATA.
for (const [answer, name] of [
  [{ status: 0, error: { message: 'No Invoices found for the provided Inputs' } }, '"No Invoices found for the provided Inputs"'],
  [{ status: 0, error: { message: 'No document found for the provided Inputs' } }, '"No document found for the provided Inputs"'],
  [{}, 'an empty object'],
  [{ status: 1 }, '{ status: 1 }'],
]) {
  reset();
  storage.gstk_active_job = job({ mode: 'gstr2a_pull', step: 'gstr2a_pull', period: '07/2026', periods: ['07/2026'] });
  await runPage(DASH, { fetch: portal2A(() => json(answer)) });
  const nd = upserts.find((a) => a[2] === 'GSTR2A');
  ok(nd && nd[3].status === 'NO DATA / NOT FOUND' && nd[3].summary.b2b.length === 0 && nd[3].summary._meta.counterparties === 0, name + ': saved as NO DATA', nd);
}

// 8c. Any other error answer: a failure, carrying the portal's code and words.
reset();
storage.gstk_active_job = job({ mode: 'gstr2a_pull', step: 'gstr2a_pull', period: '07/2026', periods: ['07/2026'] });
await runPage(DASH, { fetch: portal2A(() => json({ status: 0, error: { error_cd: 'RT-500', message: 'Something went wrong, try again' } })) });
const errList = upserts.find((a) => a[2] === 'GSTR2A');
ok(errList && !('summary' in errList[3]) && /^PULL FAILED: .*RT-500.*Something went wrong/.test(errList[3].status), 'an error answer: PULL FAILED with the portal\'s words, status only', errList);

// 9. The background's upsert: a status-only patch leaves the summary alone.
reset();
existingFiled = [{ id: 'r9' }];
await bgCall('upsertFiledReturn', 'c1', '07/2026', 'GSTR2A', { status: 'PULL FAILED: GSTR-2A supplier list unavailable (HTTP 500)' });
const p = calls.find((c) => c.method === 'PATCH');
ok(p && p.url.includes('gst_filed_returns?id=eq.r9') && !('summary' in p.body), 'upsertFiledReturn: status-only PATCH, no summary', p);

// 10. No GSTR-2B tile: NOT GENERATED recorded (status only) and the queue moves on.
reset();
storage.gstk_active_job = job({ mode: 'gstr2b_pull', step: 'gstr2b_pull_dash', period: '07/2026', periods: ['07/2026', '08/2026'] });
await runPage(DASH, { dashboard: true, Date: fastDate(), fetch: async () => json({}) });
const ng = upserts.find((a) => a[2] === 'GSTR2B');
ok(ng && /^NOT GENERATED \/ NOT FOUND/.test(ng[3].status) && !('summary' in ng[3]), 'no 2B tile: NOT GENERATED, status only', ng);
ok(storage.gstk_active_job && storage.gstk_active_job.period === '08/2026' && storage.gstk_active_job.step === 'gstr2b_pull_dash', 'no 2B tile: the job moves to the next month instead of ending', storage.gstk_active_job);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
