// 0.19.1: the full GSTR-1 pull (mode gstr1_full_pull) for the full-year GSTR-1
// documents report. The REAL background.js and content.js in Node VM contexts,
// a fake database and a fake portal (same harness as 14). Covers: a month whose
// portal file is still being prepared is read section by section (B2B and CDNR
// counterparty by counterparty, B2CL by state, a failing read retried), checked
// against the summary's counts and saved with that record; a month whose file is
// ready is taken whole; an incomplete month is queued once more at the end of
// the run; a dropped session goes to the login page without moving on; a month
// with no summary is NOT FILED and the run moves on; the address that answered
// is remembered for the next month.
//   node test/24-gstr1-full-pull.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const FILES = {};


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
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date: opts.Date || Date, fetch: opts.fetch, Number, String, Object, Array, DataView, TextDecoder, Uint8Array, ArrayBuffer, atob, btoa, Response, DecompressionStream,
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
      fetchCrossOriginAsBase64: async (u) => ({ base64: FILES[u] }),
    },
    jspdf: {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  lastHref = null;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  // The full pull sleeps between reads (throttle, retries): wait until the page navigates or the job ends.
  const until = Date.now() + 60000;
  await new Promise((r) => setTimeout(r, 50));
  while (lastHref === null && storage.gstk_active_job && storage.gstk_active_job.step === 'gstr1_full_pull' && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
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

const A = '27AAAAA0000A1Z5', B = '29BBBBB1111B1Z5';
const SUMMARY = { status: 1, data: { ret_period: '072026', sec_sum: [
  { sec_nm: 'B2B', ttl_rec: 3, cpty_sum: [{ ctin: A, ttl_rec: 2 }, { ctin: B, ttl_rec: 1 }] },
  { sec_nm: 'CDNR', ttl_rec: 1, cpty_sum: [{ ctin: A, ttl_rec: 1 }] },
  { sec_nm: 'B2CL', ttl_rec: 1, cpty_sum: [{ state_cd: '29', ttl_rec: 1 }] },
  { sec_nm: 'B2CS', ttl_rec: 2 },
  { sec_nm: 'EXP', ttl_rec: 0 },
  { sec_nm: 'HSN', ttl_rec: 1 },
  { sec_nm: 'NIL', ttl_rec: 0 },
  { sec_nm: 'DOC_ISSUE', ttl_rec: 1 },
] } };
const inv = (n) => ({ inum: n, idt: '05-07-2026', val: 118, itms: [{ num: 1, itm_det: { rt: 18, txval: 100, iamt: 18 } }] });
let bFails = 0;
const hits = [];
const portal = (opts = {}) => async (url) => {
  const u = String(url);
  hits.push(u);
  if (u.includes('/api/gstr1/summary')) return opts.noSummary ? json({ status: 0, error: { message: 'No data found' } }) : json(opts.summary || SUMMARY);
  if (u.includes('/api/formdetails')) return json({ status: 1, data: { arn: 'AA240726123456', fil_dt: '11-08-2026', status: 'FIL' } });
  if (u.includes('/offline/download/generate')) return opts.fileUrl ? json({ status: 1, data: { url: [opts.fileUrl] } }) : json({ status: 0, message: 'Request accepted, file will be generated in 20 minutes' });
  if (opts.sessionLost) return new Response('nope', { status: 401 });
  if (u.includes('/api/gstr1/b2b?') && u.includes(A)) return json({ b2b: [{ ctin: A, inv: [inv('INV-1'), inv('INV-2')] }] });
  if (u.includes('/api/gstr1/b2b?') && u.includes(B)) { if (bFails++ < 1) return json({ error: 'busy' }, 500); return json({ b2b: [{ ctin: B, inv: [inv('INV-3')] }] }); }
  if (u.includes('/api/gstr1/cdnr?')) return json({ cdnr: [{ ctin: A, nt: [{ ntty: 'C', nt_num: 'CN-1', nt_dt: '06-07-2026', val: 11.8, itms: [{ num: 1, itm_det: { rt: 18, txval: 10, iamt: 1.8 } }] }] }] });
  if (u.includes('/api/gstr1/b2cl?') && u.includes('state_cd=29')) return json({ data: { b2cl: [{ pos: '29', inv: [inv('BL-1')] }] } });
  if (u.includes('/api/gstr1/b2cs?')) return json({ b2cs: [{ pos: '24', rt: 5, txval: 100 }, { pos: '24', rt: 12, txval: 50 }] });
  if (u.includes('/api/gstr1/hsnsum?')) return json({ status: 0, error: { message: 'unknown' } }, 404);
  if (u.includes('/api/gstr1/hsn?')) return json({ hsn: { hsn_b2b: [{ hsn_sc: '8471', txval: 100 }] } });
  if (u.includes('/api/gstr1/nil?')) return json({ status: 0, error: { message: 'No Data Found' } });
  if (u.includes('/api/gstr1/docissue?')) return json({ doc_issue: { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: '1', to: '3', totnum: 3, cancel: 0, net_issue: 3 }] }] } });
  return json({ status: 0, error: { message: 'unknown route' } }, 404);
};

// A ZIP holding one stored (uncompressed) .json file, as the portal's file comes.
function zipOf(obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const name = Buffer.from('returns_072026_R1.json');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = 30 + name.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, name, data, cd, name, eocd]).toString('base64');
}

// 1. Background: Pull starts the new mode over several months.
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstr1_full_pull', period_month: '07/2026', period_months: ['07/2026', '08/2026'] });
ok(storage.gstk_active_job && storage.gstk_active_job.mode === 'gstr1_full_pull' && storage.gstk_active_job.periods.join() === '07/2026,08/2026', 'startSectionPull queues the months', storage.gstk_active_job);

// 2. July, file still being prepared: read section by section, complete, saved.
reset(); hits.length = 0; bFails = 0;
storage.gstk_active_job = job({ mode: 'gstr1_full_pull', step: 'gstr1_full_pull', period: '07/2026', periods: ['07/2026', '08/2026'] });
await runPage(DASH, { fetch: portal() });
const jul = upserts.find((a) => a[1] === '07/2026' && a[2] === 'GSTR1');
const fj = jul && jul[3].full_json;
ok(fj && fj.b2b.length === 2 && fj.b2b.reduce((n, p) => n + p.inv.length, 0) === 3, 'B2B read customer by customer, the failing one retried', fj && fj.b2b);
ok(fj && fj.cdnr[0].nt[0].nt_num === 'CN-1' && fj.b2cl[0].inv[0].inum === 'BL-1' && fj.b2cs.length === 2, 'CDNR, B2CL (by state, under data) and B2CS read', fj);
ok(fj && fj.hsn && fj.hsn.hsn_b2b && fj.doc_issue && fj.doc_issue.doc_det, 'HSN (second address) and documents issued read', fj && { hsn: fj.hsn, doc: fj.doc_issue });
ok(fj && fj._gstk && fj._gstk.source === 'sections' && fj._gstk.complete === true && fj._gstk.fileRequested === true, 'record: read section by section, complete, file requested', fj && fj._gstk);
ok(fj && fj._gstk.sections.B2B.expected === 3 && fj._gstk.sections.B2B.read === 3 && fj._gstk.sections.HSN.api === 'hsn', 'record: B2B 3 of 3, HSN via hsn', fj && fj._gstk.sections);
ok(jul && jul[3].summary && jul[3].summary.sec_sum && jul[3].arn === 'AA240726123456' && jul[3].full_json_pulled_at, 'summary, ARN and pulled time saved with it', jul && jul[3]);
ok(!hits.some((u) => u.includes('/api/gstr1/exp')), 'a section the summary gives 0 records is not asked for');
ok(storage.gstk_active_job.g1Api && storage.gstk_active_job.g1Api.HSN === 'hsn', 'the address that answered is kept for the next month', storage.gstk_active_job.g1Api);
ok(storage.gstk_active_job.period === '08/2026' && !storage.gstk_active_job.g1Later, 'a complete month moves on, nothing queued again', storage.gstk_active_job);

// 3. August, file ready: taken whole.
const AUG = { gstin: '24ABCDE1234F1Z5', fp: '082026', b2b: [{ ctin: A, inv: [inv('INV-9')] }] };
FILES['https://files.test/aug'] = zipOf(AUG);
upserts.length = 0; hits.length = 0;
await runPage(DASH, { fetch: portal({ fileUrl: 'https://files.test/aug', summary: { status: 1, data: { sec_sum: [{ sec_nm: 'B2B', ttl_rec: 1, cpty_sum: [{ ctin: A, ttl_rec: 1 }] }] } } }) });
const aug = upserts.find((a) => a[1] === '08/2026');
ok(aug && aug[3].full_json.fp === '082026' && aug[3].full_json._gstk.source === 'file' && aug[3].full_json._gstk.complete === true, "a ready file is taken whole", aug && aug[3].full_json && aug[3].full_json._gstk);
ok(!hits.some((u) => u.includes('/api/gstr1/b2b?')), 'no section reads when the file came');
ok(!storage.gstk_active_job || storage.gstk_active_job.mode !== 'gstr1_full_pull' || storage.gstk_active_job.step !== 'gstr1_full_pull', 'the last month ends the pull', storage.gstk_active_job);

// 4. Another period's file is refused, and the month read section by section instead.
reset(); hits.length = 0; bFails = 1;
FILES['https://files.test/wrong'] = zipOf({ fp: '062026', b2b: [] });
storage.gstk_active_job = job({ mode: 'gstr1_full_pull', step: 'gstr1_full_pull', period: '07/2026', periods: ['07/2026'] });
await runPage(DASH, { fetch: portal({ fileUrl: 'https://files.test/wrong' }) });
const w = upserts.find((a) => a[1] === '07/2026');
ok(w && w[3].full_json._gstk.source === 'sections' && /not 072026/.test(w[3].full_json._gstk.fileProblem), "another period's file is refused", w && w[3].full_json._gstk);

// 5. An incomplete month is tried again once at the end of the run.
reset(); hits.length = 0; bFails = -100; // B fails every time
storage.gstk_active_job = job({ mode: 'gstr1_full_pull', step: 'gstr1_full_pull', period: '07/2026', periods: ['07/2026'] });
await runPage(DASH, { fetch: portal() });
const inc = upserts.find((a) => a[1] === '07/2026');
ok(inc && inc[3].full_json._gstk.complete === false && inc[3].full_json._gstk.sections.B2B.failed.join() === B, 'incomplete: B2B short, the customer named', inc && inc[3].full_json._gstk.sections.B2B);
const j5 = storage.gstk_active_job;
ok(j5 && j5.periods.join() === '07/2026,07/2026' && j5.g1Sweep.join() === '1' && j5.period === '07/2026' && j5.periodIdx === 1, 'the month is queued once more at the end', j5);

// 6. Session lost while reading: to the login page, the month not moved past.
reset(); hits.length = 0;
storage.gstk_active_job = job({ mode: 'gstr1_full_pull', step: 'gstr1_full_pull', period: '07/2026', periods: ['07/2026', '08/2026'] });
await runPage(DASH, { fetch: portal({ sessionLost: true }) });
ok(/services\/login/.test(lastHref || '') && storage.gstk_active_job.period === '07/2026' && storage.gstk_active_job.step === 'gstr1_full_pull', 'a dropped session: login again, same month', { lastHref, job: storage.gstk_active_job });
ok(!upserts.some((a) => a[3].full_json), 'nothing half-read is saved over the month');

// 7. No summary: NOT FILED, next month.
reset();
storage.gstk_active_job = job({ mode: 'gstr1_full_pull', step: 'gstr1_full_pull', period: '07/2026', periods: ['07/2026', '08/2026'] });
await runPage(DASH, { fetch: portal({ noSummary: true }) });
const nf = upserts.find((a) => a[1] === '07/2026');
ok(nf && nf[3].status === 'NOT FILED / NOT FOUND' && !('full_json' in nf[3]), 'no summary: NOT FILED, status only', nf);
ok(storage.gstk_active_job.period === '08/2026', 'and the run moves on');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
