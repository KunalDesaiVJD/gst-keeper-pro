// 0.18.0: GSTR-9 Table 8A document details (mode gstr9_8a_pull), a job of its
// own beside the GSTR-9 pull. On the GSTR-9 dashboard it presses "Download
// Table 8A document details" and saves what the portal hands back (the page's
// Blob, or the browser's download through background.js) as GSTR9_8A; a portal
// that answers in words is recorded (REQUESTED / NO DATA), a missing button
// says what the page showed. Same harness as 14: the REAL background.js and
// content.js in Node VM contexts, a stubbed chrome.* API, a fake database and a
// fake portal page.
//   node test/19-gstr9-8a-pull.test.mjs
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
  if (u.startsWith('https://return.gst.gov.in/download/')) return new Response(new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(200).fill(1)]), { status: 200, headers: { 'content-type': 'application/zip' } });
  throw new Error('fake database has no route for ' + method + ' ' + u);
}

// ── chrome.* shared by the background worker and every page ─────────────────
const storage = {};
let bgListener = null;
let dlListener = null;
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
  downloads: { onCreated: { addListener: (fn) => { if (tabId == null) dlListener = fn; } } },
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
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, closest: () => null, offsetParent: {}, value: '', disabled: false, ...extra,
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  const buttons = (opts.buttons || []).map((b) => { const e = el({ click: b.click || (() => {}) }); e.textContent = b.text; return e; });
  const words = opts.words ? (() => { const e = el(); e.textContent = opts.words; return e; })() : null;
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: () => null,
    querySelectorAll: (s) => (/button/.test(s) && !/modal|dialog|swal/.test(s) ? buttons : /alert/.test(s) && words ? [words] : []),
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
  const listeners = [];
  sandbox.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn); };
  sandbox.removeEventListener = (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  sandbox.postMessage = (data) => setTimeout(() => listeners.slice().forEach((fn) => fn({ data })), 0);
  sandbox.atob = atob; sandbox.btoa = btoa;
  if (opts.onSandbox) opts.onSandbox(sandbox);
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
const G9DASH = 'https://return.gst.gov.in/returns2/auth/gstr9/dashboard';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const portal = async (url) => (String(url).includes('/api/formdetails') ? json({ status: 1, data: { status: 'NFIL' } }) : json({}, 404));
const opened = () => ({ period: '03/2026', since: Date.now(), opened: true, openedAt: Date.now(), clicked: 'PREPARE ONLINE' });
const XLSX_URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBBQAAAAIAFAKE8A';
const BUTTON = 'DOWNLOAD TABLE 8A DOCUMENT DETAILS';
const others = [{ text: 'BACK' }, { text: 'DOWNLOAD GSTR-9 SYSTEM COMPUTED SUMMARY (PDF)' }, { text: 'COMPUTE LIABILITIES' }];

// 1. Background: Pull starts the 8A job like any section pull.
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstr9_8a_pull', period_month: '03/2026', period_months: ['03/2026'] });
ok(storage.gstk_active_job && storage.gstk_active_job.mode === 'gstr9_8a_pull' && storage.gstk_active_job.step === 'login' && storage.gstk_active_job.period === '03/2026', 'startSectionPull: a gstr9_8a_pull job for 03/2026', storage.gstk_active_job);

// 2. The button gives a file (the page's Blob): saved as GSTR9_8A, Pulled; the job ends.
reset();
let pressed = 0;
let page = null;
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'], g8: opened() });
await runPage(G9DASH, {
  fetch: portal, Date: fastDate(), onSandbox: (s) => { page = s; },
  buttons: [...others, { text: BUTTON, click: () => { pressed++; page.postMessage({ __gstkPdf: XLSX_URL }); } }],
});
for (let i = 0; i < 80 && storage.gstk_active_job; i++) await new Promise((r) => setTimeout(r, 250));
const saved = upserts.find((a) => a[2] === 'GSTR9_8A');
ok(pressed === 1, 'the 8A button is pressed once (not the system-computed summary)', pressed);
ok(saved && saved[1] === '03/2026' && saved[3].status === 'Pulled' && saved[3].summary._format === 'gstk-8a-pull-v1'
  && saved[3].summary.files.length === 1 && saved[3].summary.files[0].dataUrl === XLSX_URL && saved[3].summary.files[0].via === 'page' && saved[3].summary.fy === '2025-26',
  'the file is saved as GSTR9_8A, format gstk-8a-pull-v1, as it came', saved && { ...saved[3], summary: { ...saved[3].summary, files: saved[3].summary.files.length } });
ok(saved && /8A button: "DOWNLOAD TABLE 8A DOCUMENT DETAILS" pressed/.test(saved[3].summary.read), 'what the page did is kept with it', saved && saved[3].summary.read);
ok(!storage.gstk_active_job, 'one year: the job ends after it');
ok(!upserts.some((a) => a[2] !== 'GSTR9_8A'), 'nothing else is written (no GSTR9_CALC, no GSTR-9 figures)', upserts.map((a) => a[2]));

// 3. A PDF Blob (another download on the page) is not taken for the 8A.
reset();
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'], g8: opened() });
await runPage(G9DASH, {
  fetch: portal, Date: fastDate(), onSandbox: (s) => { page = s; },
  buttons: [{ text: BUTTON, click: () => page.postMessage({ __gstkPdf: 'data:application/pdf;base64,JVBERi0xLjQK' }) }],
});
for (let i = 0; i < 400 && storage.gstk_active_job; i++) await new Promise((r) => setTimeout(r, 250));
const pdfOnly = upserts.find((a) => a[2] === 'GSTR9_8A');
ok(pdfOnly && /^PULL FAILED: /.test(pdfOnly[3].status) && !('summary' in pdfOnly[3]), 'a PDF is no 8A: PULL FAILED, status only (an earlier 8A still counts)', pdfOnly && pdfOnly[3].status);

// 4. The portal answers in words ("request accepted"): REQUESTED, status only.
reset();
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'], g8: opened() });
await runPage(G9DASH, {
  fetch: portal, Date: fastDate(), words: 'Your request for download of Table 8A document details has been accepted. Please try after 20 minutes.',
  buttons: [{ text: BUTTON }],
});
for (let i = 0; i < 400 && storage.gstk_active_job; i++) await new Promise((r) => setTimeout(r, 250));
const req = upserts.find((a) => a[2] === 'GSTR9_8A');
ok(req && /^REQUESTED: .*the portal said: "Your request/.test(req[3].status) && !('summary' in req[3]), 'a request accepted for later: REQUESTED with the portal\'s words, status only', req && req[3].status);

// 5. "No records": NO DATA, saved as an empty 8A.
reset();
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'], g8: opened() });
await runPage(G9DASH, { fetch: portal, Date: fastDate(), words: 'No record found for Table 8A', buttons: [{ text: BUTTON }] });
for (let i = 0; i < 400 && storage.gstk_active_job; i++) await new Promise((r) => setTimeout(r, 250));
const nd = upserts.find((a) => a[2] === 'GSTR9_8A');
ok(nd && /^NO DATA: /.test(nd[3].status) && nd[3].summary && nd[3].summary.empty === true && nd[3].summary.files.length === 0, 'no records: NO DATA, an empty 8A', nd && nd[3]);

// 6. No 8A button on the page: PULL FAILED naming the buttons seen.
reset();
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'], g8: opened() });
await runPage(G9DASH, { fetch: portal, Date: fastDate(), buttons: others });
for (let i = 0; i < 400 && storage.gstk_active_job; i++) await new Promise((r) => setTimeout(r, 250));
const nb = upserts.find((a) => a[2] === 'GSTR9_8A');
ok(nb && /^PULL FAILED: .*8A button: not found on \/returns2\/auth\/gstr9\/dashboard \(buttons: BACK \| DOWNLOAD GSTR-9 SYSTEM COMPUTED SUMMARY \(PDF\)/.test(nb[3].status), 'no 8A button: PULL FAILED with the buttons the page showed', nb && nb[3].status);

// 7. The browser's download (an https file on the portal): background keeps it for the page.
reset();
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'] });
await dlListener({ url: 'https://return.gst.gov.in/download/8A_24ABCDE1234F1Z5.zip', filename: 'C:\\Downloads\\8A_24ABCDE1234F1Z5.zip' });
const r = storage.gstk_g8a_result;
ok(r && r.clientId === 'c1' && r.period === '03/2026' && /^data:application\/zip;base64,UEsDB/.test(r.fileB64) && r.fileName === '8A_24ABCDE1234F1Z5.zip', 'a downloaded 8A ZIP is kept for the page', r && { ...r, fileB64: r.fileB64.slice(0, 40) });
reset();
storage.gstk_active_job = job({ mode: 'gstr9_pull', step: 'gstr9_pull', period: '03/2026', periods: ['03/2026'] });
await dlListener({ url: 'https://return.gst.gov.in/download/8A_24ABCDE1234F1Z5.zip', filename: '8A.zip' });
ok(!storage.gstk_g8a_result, 'the GSTR-9 pull (gstr9_pull) is untouched: no 8A file kept for it');
reset();
storage.gstk_active_job = job({ mode: 'gstr9_8a_pull', step: 'gstr9_8a_pull', period: '03/2026', periods: ['03/2026'] });
await dlListener({ url: 'https://evil.example/8A.zip', filename: '8A.zip' });
ok(!storage.gstk_g8a_result, 'a file from outside gst.gov.in is not taken');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
