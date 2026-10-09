// 0.8.6: a Refresh errors that lands on the wrong portal page goes back to the
// dashboard, exactly as an upload does, and never reads that page as GSTR-1's
// Upload History. (A tile click once landed on GSTR-2B's download page, whose
// "Generated" row with a link would otherwise be read as an error report.)
// Same harness as 08: the REAL background.js and content.js in Node VM
// contexts, a stubbed chrome.* API and a fake database that records each call.
//   node test/09-refresh-wrong-page.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';

// ── The fake database ─────────────────────────────────────────────────────
const calls = [];
let failVersions = false;
let slowVersions = 0;
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, headers: init.headers || {}, body });
  if (u.startsWith(DB + '/rest/v1/gstr3b_push_versions') && method === 'POST') {
    if (slowVersions) await new Promise((r) => setTimeout(r, slowVersions));
    return failVersions ? new Response('{"message":"boom"}', { status: 500 }) : new Response(null, { status: 201 });
  }
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr1_data?client_id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'r1', raw_json: { fp: '092026' } }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_docs') && method === 'GET') return new Response('[]', { status: 200 });
  if (u.startsWith(DB + '/rest/v1/gstr1_data?id=eq.') && method === 'GET') {
    return new Response(JSON.stringify([{ client_id: 'c1', period_month: 'Sep-26', raw_json: globalThis.__rawJson || {} }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr1_data') && method === 'PATCH') return new Response(null, { status: 204 });
  if (u.startsWith(DB + '/rest/v1/gstr1_upload_versions') && method === 'POST') return new Response(null, { status: 201 });
  throw new Error('fake database has no route for ' + method + ' ' + u);
}
const posts = (table) => calls.filter((c) => c.method === 'POST' && c.url.startsWith(DB + '/rest/v1/' + table));
const patches = (table) => calls.filter((c) => c.method === 'PATCH' && c.url.startsWith(DB + '/rest/v1/' + table));

// ── chrome.* shared by the background worker and every page ─────────────────
const storage = {};
let bgListener = null;
let tabRemoved = null;
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
  tabs: { create: async () => ({ id: 1 }), update: async () => ({ id: 1, windowId: 1 }), onRemoved: { addListener: (fn) => { tabRemoved = fn; } } },
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
// opts.rows(): the Upload History's rows (tr(...cells)); opts.fileInput: the
// upload page's file input; opts.checkbox: the "File Nil GSTR-1" toggle.
function makeDocument(opts) {
  const byId = {};
  const el = (extra) => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, dispatchEvent() {}, focus() {}, blur() {},
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, offsetParent: {}, value: '', ...extra,
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: (s) => (opts.username && s === '#username' ? el() : s === 'input[type=file]' && opts.fileInput ? opts.fileInput : null),
    querySelectorAll: (s) => {
      if (opts.throwOn && s === opts.throwOn) throw new Error('boom');
      if (s === 'table tr' && opts.rows) return opts.rows();
      if (s === 'a, button, li, span' && opts.tabs) return opts.tabs;
      if (s === 'input[type=file]' && opts.fileInput) return [opts.fileInput];
      if (s === 'input[type=checkbox], [role=switch], [role=checkbox]' && opts.checkbox) return [opts.checkbox];
      return [];
    },
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
    banner: () => (byId['gstk-banner'] ? byId['gstk-banner'].textContent : ''),
  };
}
async function runPage(href, opts = {}) {
  const document = makeDocument(opts);
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date: opts.Date || Date, fetch: opts.fetch, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (f) => this.files.push(f) }; } },
    Event: class { constructor(t) { this.type = t; } }, KeyboardEvent: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: chromeFor(1), document,
    location: { href, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} },
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async () => null, logStep: async () => null,
      getPortalPassword: async () => null, focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async () => null, clearCaptchaNotice: async () => null,
      markGstr1NilPushed: async () => { nilRpc.push({ result: clone(storage.gstk_gstr1_upload_result || null), job: clone(storage.gstk_active_job || null) }); return true; },
    },
    jspdf: {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 50)); // fire-and-forget messages land
  return document;
}

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const nilRpc = [];
const reset = () => { calls.length = 0; for (const k of Object.keys(storage)) delete storage[k]; failVersions = false; slowVersions = 0; nilRpc.length = 0; };
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', selectedReturns: [] } };
const job3b = (extra) => ({ mode: 'gstr3b_push', idx: 0, step: 'gstr3b_fill4', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [client], gstr3b: { json: { ret_period: '092026' }, filled31: ['3.1(c) Nil/exempt col 1'],
    skipped31: ['3.1(a) Outward taxable supplies — row not found', '3.1(b) Zero rated — row not found'] }, ...extra });
const job1 = (extra) => ({ mode: 'gstr1_upload', idx: 0, step: 'gstr1_upload', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [client], gstr1: { rowId: 'r1', periodShort: 'Sep-26', json: {}, irnAttached: 0, nil: false }, ...extra });
const LOGIN = 'https://services.gst.gov.in/services/login';
const trL = (href, ...cells) => ({ querySelector: (s) => (s === 'td' ? {} : s === 'a[href], button' ? { getAttribute: () => href, click() {} } : null), querySelectorAll: (s) => (s === 'td' ? cells.map((t) => ({ textContent: t })) : []), offsetParent: {} });
const WRONG = 'https://return.gst.gov.in/returns2/auth/gstr2b/download';
const refreshJob = () => job1({ mode: 'gstr1_refresh', gstr1: { rowId: 'r1', periodShort: 'Sep-26' } });

reset();
storage.gstk_active_job = refreshJob();
await runPage(WRONG, { rows: () => [trL('/gstr2b.json', 'GSTR-2B', 'Generated', 'Download')], fetch: async () => new Response('not json', { status: 200 }) });
ok(patches('gstr1_data').length === 0, 'Refresh on the wrong page: gstr1_data untouched');
ok(posts('gstr1_upload_versions').length === 0, 'Refresh on the wrong page: no version row');
ok(storage.gstk_active_job && storage.gstk_active_job.step === 'gstr1_dash' && storage.gstk_active_job.wrongPageRetries === 1, 'Refresh on the wrong page: back to the dashboard to retry');

reset();
storage.gstk_active_job = job1();
await runPage(WRONG, { rows: () => [] });
ok(storage.gstk_active_job && storage.gstk_active_job.step === 'gstr1_dash' && storage.gstk_active_job.wrongPageRetries === 1, 'Upload on the wrong page: back to the dashboard, as before');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
