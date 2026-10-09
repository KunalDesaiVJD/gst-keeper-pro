// 0.8.6: a push never ends without a result, and every result names its
// return. Runs the REAL background.js and content.js in Node VM contexts with
// a stubbed chrome.* API: content.js's messages reach background.js's own
// listener, and the database is a fake REST endpoint that records each call.
//   - a GSTR-3B push's dead end (session kept dropping, left idle) writes one
//     gstr3b_push_versions row and a 'failed' result with clientId,
//     period_month and recorded: true; recorded is false when the write fails
//   - a GSTR-1 upload's unexpected error, a NIL push with no saved password
//     and a Refresh errors that kept bouncing each give the page a result
//     (Refresh leaves gstr1_data alone)
//   - the row's shape: status 'ok' for 'filled', skipped + portalFilled
//   - a closed portal tab gives a 'failed' result and writes nothing
//   node test/08-push-dead-ends.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';

// ── The fake database ─────────────────────────────────────────────────────
const calls = [];
let failVersions = false;
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, headers: init.headers || {}, body });
  if (u.startsWith(DB + '/rest/v1/gstr3b_push_versions') && method === 'POST') {
    return failVersions ? new Response('{"message":"boom"}', { status: 500 }) : new Response(null, { status: 201 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr1_data?id=eq.') && method === 'GET') {
    return new Response(JSON.stringify([{ client_id: 'c1', period_month: 'Sep-26', raw_json: {} }]), { status: 200 });
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
function makeDocument(opts) {
  const byId = {};
  const el = (extra) => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, dispatchEvent() {}, focus() {}, blur() {},
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, offsetParent: {}, value: '', ...extra,
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: (s) => (opts.username && s === '#username' ? el() : null),
    querySelectorAll: (s) => { if (opts.throwOn && s === opts.throwOn) throw new Error('boom'); return []; },
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
    banner: () => (byId['gstk-banner'] ? byId['gstk-banner'].textContent : ''),
  };
}
async function runPage(href, opts = {}) {
  const document = makeDocument(opts);
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    Event: class { constructor(t) { this.type = t; } }, KeyboardEvent: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: chromeFor(1), document,
    location: { href, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} },
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async () => null, logStep: async () => null,
      getPortalPassword: async () => null, focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async () => null, clearCaptchaNotice: async () => null,
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
const reset = () => { calls.length = 0; for (const k of Object.keys(storage)) delete storage[k]; failVersions = false; };
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', selectedReturns: [] } };
const job3b = (extra) => ({ mode: 'gstr3b_push', idx: 0, step: 'gstr3b_fill4', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [client], gstr3b: { json: { ret_period: '092026' }, filled31: ['3.1(c) Nil/exempt col 1'],
    skipped31: ['3.1(a) Outward taxable supplies — row not found', '3.1(b) Zero rated — row not found'] }, ...extra });
const job1 = (extra) => ({ mode: 'gstr1_upload', idx: 0, step: 'gstr1_upload', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [client], gstr1: { rowId: 'r1', periodShort: 'Sep-26', json: {}, irnAttached: 0, nil: false }, ...extra });
const LOGIN = 'https://services.gst.gov.in/services/login';

// ── GSTR-3B: the session kept dropping during Table 4 ──────────────────────
reset();
storage.gstk_active_job = job3b({ retries: 2 });
await runPage(LOGIN);
{
  const r = storage.gstk_gstr3b_push_result;
  const rows = posts('gstr3b_push_versions');
  ok(rows.length === 1, '3B bounce: one Push History row written');
  const row = rows[0] && rows[0].body[0];
  ok(row && row.client_id === 'c1' && row.period_month === '09/2026' && row.actor_id === 'u-1', '3B bounce: the row is the job\'s client, MM/YYYY period and actor');
  ok(row && row.status === 'failed' && row.filled_count === 1, '3B bounce: status failed, with what Table 3.1 filled');
  ok(row && row.skipped.length === 2 && row.skipped.every((s) => s.includes('the portal keeps the value it filled from GSTR-1')), '3B bounce: skipped holds the portalFilled entries');
  ok(row && row.payload && row.payload.ret_period === '092026', '3B bounce: payload is the pushed draft');
  ok(rows[0] && rows[0].headers.apikey === ANON && rows[0].headers.Authorization === 'Bearer ' + ANON, '3B bounce: written with the anon key, like gstr1_upload_versions');
  ok(r && r.ok === false && r.status === 'failed' && /kept dropping/.test(r.error), '3B bounce: the page hears a failed result');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', '3B bounce: the result names its client and period');
  ok(r && r.recorded === true, '3B bounce: recorded is true once the row landed');
  ok(r && Array.isArray(r.portalFilled) && r.portalFilled.length === 2 && r.filled === 1, '3B bounce: the result carries filled and portalFilled');
  ok(!storage.gstk_active_job, '3B bounce: the job is cleared');
  ok(calls.every((c) => !/mark_filing_pushed/.test(c.url)), '3B: mark_filing_pushed is never called');
}

// ── GSTR-3B: left idle; the Push History write fails ──────────────────────
reset();
failVersions = true;
storage.gstk_active_job = job3b({ step: 'login', lastActivityAt: now - 11 * 60 * 1000, gstr3b: { json: {} } });
await runPage(LOGIN);
{
  const r = storage.gstk_gstr3b_push_result;
  ok(posts('gstr3b_push_versions').length === 1, '3B idle: the write was tried');
  ok(r && r.status === 'failed' && /idle/.test(r.summary) && r.clientId === 'c1', '3B idle: a failed result for its client');
  ok(r && r.recorded === false, '3B idle: recorded is false when the write failed');
  ok(!storage.gstk_active_job, '3B idle: the job is cleared');
}

// ── The row's shape for each status (background.js) ───────────────────────
reset();
for (const [status, want] of [['filled', 'ok'], ['partial', 'partial'], ['failed', 'failed']]) {
  const resp = await bgCall('recordGstr3bPush', { clientId: 'c1', period_month: '09/2026', actorId: null, status, summary: 's', filled: 3,
    skipped: ['4A(1) Import of goods col 3 — no input at that position'], portalFilled: ['3.1(a) Outward taxable supplies — not typed; the portal keeps the value it filled from GSTR-1'], payload: { a: 1 } });
  const row = posts('gstr3b_push_versions').pop().body[0];
  ok(resp.ok && resp.data === true && row.status === want, `status '${status}' is stored as '${want}'`);
  ok(row.skipped.length === 2 && row.skipped[1].startsWith('3.1(a)'), `'${status}': skipped then portalFilled`);
}
ok((await bgCall('recordGstr3bPush', { clientId: null, period_month: '09/2026', status: 'filled' })).data === false, 'no client: nothing written');

// ── GSTR-1 upload: an unexpected error on the upload page ──────────────────
reset();
storage.gstk_active_job = job1();
await runPage('https://return.gst.gov.in/returns/auth/gstr1/offlineupload', { throwOn: 'a, button, li, span' });
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.ok === false && r.status === 'failed' && /Unexpected error on step gstr1_upload: boom/.test(r.error), 'GSTR-1 error: the page hears a failed result');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'GSTR-1 error: the result names its client and period');
  ok(patches('gstr1_data').some((c) => c.body.last_upload_status === 'failed'), 'GSTR-1 error: the upload\'s outcome is saved as failed');
  ok(!storage.gstk_active_job, 'GSTR-1 error: the job is cleared');
}

// ── NIL push: no saved portal password ────────────────────────────────────
reset();
storage.gstk_active_job = job1({ step: 'login', gstr1: { rowId: null, periodShort: 'Sep-26', json: null, irnAttached: 0, nil: true } });
await runPage(LOGIN, { username: true });
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'failed' && /login did not complete, so nothing was pushed: No saved GST portal password for SUNRISE RENTAL SERVICES — update it in Edit Client\.$/.test(r.error),
    'NIL with no password: the page hears why, once');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'NIL with no password: the result names its client and period');
  ok(patches('gstr1_data').length === 0, 'NIL: no gstr1_data row is touched');
}

// ── Refresh errors whose session kept dropping ────────────────────────────
reset();
storage.gstk_active_job = job1({ mode: 'gstr1_refresh', step: 'gstr1_dash', retries: 2, gstr1: { rowId: 'r1', periodShort: 'Sep-26' } });
await runPage(LOGIN);
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'failed' && /kept dropping/.test(r.error) && r.clientId === 'c1', 'Refresh bounce: a failed result for its client');
  ok(patches('gstr1_data').length === 0 && posts('gstr1_upload_versions').length === 0, 'Refresh bounce: the upload\'s own status is left alone');
}

// ── A closed portal tab ───────────────────────────────────────────────────
reset();
storage.gstk_active_job = job3b({ tabId: 7 });
tabRemoved(8);
await new Promise((r) => setTimeout(r, 20));
ok(storage.gstk_active_job && !storage.gstk_gstr3b_push_result, 'another tab closing changes nothing');
tabRemoved(7);
await new Promise((r) => setTimeout(r, 20));
{
  const r = storage.gstk_gstr3b_push_result;
  ok(r && r.ok === false && r.status === 'failed' && r.error === 'The portal tab was closed before the portal reported a result. Check the portal; for a GSTR-1 upload use Refresh errors.',
    '3B tab closed: a failed result in the agreed words');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026' && r.recorded === false, '3B tab closed: names its return, not recorded');
  ok(!storage.gstk_active_job, '3B tab closed: the job is cleared');
}
storage.gstk_active_job = job1({ tabId: 9 });
tabRemoved(9);
await new Promise((r) => setTimeout(r, 20));
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'failed' && /Refresh errors/.test(r.error) && r.clientId === 'c1' && r.period_month === '09/2026', 'GSTR-1 tab closed: a failed result for its return');
}
storage.gstk_active_job = { mode: 'notices', tabId: 10, clients: [client] };
tabRemoved(10);
await new Promise((r) => setTimeout(r, 20));
ok(storage.gstk_active_job && storage.gstk_active_job.mode === 'notices', 'a sync\'s tab closing is left to the runner, as before');
ok(calls.length === 0, 'a closed tab writes nothing to the database');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
