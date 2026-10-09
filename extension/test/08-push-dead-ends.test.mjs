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
//   - a closed portal tab gives a result marked tabClosed; only a GSTR-1
//     upload whose file was attached is saved 'failed' (so Refresh errors is
//     offered), and nothing else is written
// Refresh errors records an outcome only for an upload this app sent:
//   - the upload keeps the Upload History's top row before it attaches the
//     file, and drops it once the outcome is recorded; a new upload job drops
//     an earlier one, so a push that dies before attaching leaves none
//   - with no snapshot, or the same row on top, Refresh writes nothing and
//     says the portal shows no upload since this push; a newer row that the
//     portal Processed is saved 'accepted'; In-Progress writes nothing
// A terminal result never races a closed tab: NIL stores its result before
// the RPC, and a GSTR-3B push ends in the background's job slot
// (finishGstr3bPush) with one Push History row whichever comes first.
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
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Number, String, Object, Array,
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
  ok(r && r.ok === false && r.status === 'failed' && r.error === 'The portal tab was closed before the push finished. Check the portal and push again.',
    '3B tab closed: a failed result in the agreed words');
  ok(r && r.tabClosed === true, '3B tab closed: marked tabClosed (outcome unknown)');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026' && r.recorded === false, '3B tab closed: names its return, not recorded');
  ok(!storage.gstk_active_job, '3B tab closed: the job is cleared');
}
// A GSTR-1 upload closed before its file was attached: no snapshot.
storage.gstk_active_job = job1({ tabId: 9, step: 'gstr1_dash' });
tabRemoved(9);
await new Promise((r) => setTimeout(r, 20));
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'failed' && r.error === 'The portal tab was closed before the push finished. Check the portal and push again.' && r.tabClosed === true,
    'GSTR-1 tab closed before the attach: push again, never Refresh errors');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'GSTR-1 tab closed: a result for its return');
}
// NIL and Refresh errors never name a Refresh the page would not offer.
storage.gstk_active_job = job1({ tabId: 11, step: 'gstr1_nil', gstr1: { rowId: null, periodShort: 'Sep-26', json: null, irnAttached: 0, nil: true } });
tabRemoved(11);
await new Promise((r) => setTimeout(r, 20));
ok(/push again\.$/.test(storage.gstk_gstr1_upload_result.error) && storage.gstk_gstr1_upload_result.tabClosed, 'NIL tab closed: push again');
storage.gstk_active_job = job1({ tabId: 12, mode: 'gstr1_refresh', gstr1: { rowId: 'r1', periodShort: 'Sep-26' } });
storage.gstk_gstr1_pretop_r1 = { key: 'old', at: now };
tabRemoved(12);
await new Promise((r) => setTimeout(r, 20));
ok(storage.gstk_gstr1_upload_result.error === 'The portal tab was closed before Refresh errors finished. Nothing was changed; click Refresh errors again.',
  'Refresh tab closed: click Refresh errors again, nothing changed');
delete storage.gstk_gstr1_pretop_r1;
storage.gstk_active_job = { mode: 'notices', tabId: 10, clients: [client] };
tabRemoved(10);
await new Promise((r) => setTimeout(r, 20));
ok(storage.gstk_active_job && storage.gstk_active_job.mode === 'notices', 'a sync\'s tab closing is left to the runner, as before');
ok(calls.length === 0, 'a closed tab writes nothing to the database unless the upload\'s file was attached');

// A GSTR-1 upload closed after its file was attached (the snapshot is there):
// saved 'failed' with the words the page offers Refresh errors for.
reset();
storage.gstk_active_job = job1({ tabId: 13 });
storage.gstk_gstr1_pretop_r1 = { key: 'old', at: now };
tabRemoved(13);
await new Promise((r) => setTimeout(r, 20));
{
  const r = storage.gstk_gstr1_upload_result;
  const TEXT = 'Portal tab closed during the upload; outcome unknown. Use Refresh errors once the portal shows a result.';
  const p = patches('gstr1_data')[0];
  ok(p && p.body.last_upload_status === 'failed' && p.body.last_upload_summary === TEXT, 'GSTR-1 tab closed after the attach: saved failed, outcome unknown');
  ok(posts('gstr1_upload_versions').length === 1, 'GSTR-1 tab closed after the attach: one version row, as for the 6-minute timeout');
  ok(r && r.status === 'failed' && r.error === TEXT && r.tabClosed === true && r.clientId === 'c1', 'GSTR-1 tab closed after the attach: the page hears it');
  ok(storage.gstk_gstr1_pretop_r1 && !storage.gstk_active_job, 'GSTR-1 tab closed after the attach: the snapshot stays for Refresh, the job goes');
}

// ── Refresh errors records an outcome only for an upload this app sent ─────
const tr = (...cells) => ({ querySelector: (s) => (s === 'td' ? {} : null), querySelectorAll: (s) => (s === 'td' ? cells.map((t) => ({ textContent: t })) : []), offsetParent: {} });
const keyOf = (cells) => cells.join('|');
// The portal's date and time cells for an upload at `ms`, in IST.
const istCells = (ms) => {
  const d = new Date(ms + 330 * 60 * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return [p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(), p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds())];
};
const UPLOAD_PAGE = 'https://return.gst.gov.in/returns/auth/gstr1/offlineupload';
const OLD = [...istCells(now - 3 * 86400000), 'AB0001', 'Processed', 'NA'];
const refreshJob = () => job1({ mode: 'gstr1_refresh', gstr1: { rowId: 'r1', periodShort: 'Sep-26' } });
const NO_UPLOAD = 'The portal shows no upload from GST Keeper since this push. Upload the JSON again to record it.';
const wroteNothing = () => patches('gstr1_data').length === 0 && posts('gstr1_upload_versions').length === 0;

// A new upload job drops the last snapshot; this push then dies at the login,
// before any file is attached (the portal still shows an older Processed row).
reset();
storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD), at: now - 3 * 86400000 };
{
  const started = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1' });
  ok(started && started.ok && started.data.started, 'a JSON upload job starts');
  ok(!('gstk_gstr1_pretop_r1' in storage), 'a new upload job drops the earlier upload\'s snapshot');
}
await runPage(LOGIN, { username: true });
ok(storage.gstk_gstr1_upload_result && storage.gstk_gstr1_upload_result.status === 'failed' && !('gstk_gstr1_pretop_r1' in storage),
  'the push died before attaching: failed, and no snapshot left');
calls.length = 0;
delete storage.gstk_gstr1_upload_result;
storage.gstk_active_job = refreshJob();
await runPage(UPLOAD_PAGE, { rows: () => [tr(...OLD)] });
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.ok === false && r.status === 'pending' && r.summary === NO_UPLOAD && r.error === NO_UPLOAD, 'Refresh with no snapshot: pending, no upload since this push');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'Refresh with no snapshot: the result names its return');
  ok(wroteNothing(), 'Refresh with no snapshot: the older Processed row is never saved accepted');
  ok(!storage.gstk_active_job, 'Refresh with no snapshot: the job is cleared');
}

// The upload attached its file, but the portal never added a row: the
// snapshot's row is still on top.
reset();
storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD), at: now - 60 * 1000 };
storage.gstk_active_job = refreshJob();
await runPage(UPLOAD_PAGE, { rows: () => [tr(...OLD)] });
ok(storage.gstk_gstr1_upload_result.status === 'pending' && storage.gstk_gstr1_upload_result.summary === NO_UPLOAD && wroteNothing(),
  'a snapshot whose row is still on top: pending, nothing written');
ok(storage.gstk_gstr1_pretop_r1, 'and the snapshot stays for a later Refresh');

// A row older than the attach whose cells changed is not this upload either.
reset();
storage.gstk_gstr1_pretop_r1 = { key: 'something else', at: now - 60 * 1000 };
storage.gstk_active_job = refreshJob();
await runPage(UPLOAD_PAGE, { rows: () => [tr(...OLD)] });
ok(storage.gstk_gstr1_upload_result.status === 'pending' && wroteNothing(), 'an older row (by its date) with another key: pending, nothing written');

// A newer row, Processed: this upload's, saved accepted.
reset();
const NEW = [...istCells(now - 30 * 1000), 'AB0002', 'Processed', 'NA'];
storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD), at: now - 60 * 1000 };
storage.gstk_active_job = refreshJob();
await runPage(UPLOAD_PAGE, { rows: () => [tr(...NEW), tr(...OLD)] });
{
  const r = storage.gstk_gstr1_upload_result;
  const p = patches('gstr1_data')[0];
  const v = posts('gstr1_upload_versions')[0];
  ok(r && r.ok === true && r.status === 'accepted' && /Processed, with no errors/.test(r.summary), 'a newer Processed row: accepted');
  ok(p && p.body.last_upload_status === 'accepted', 'a newer Processed row: gstr1_data saved accepted');
  ok(v && v.body[0].action_type === 'REFRESH_ERRORS' && v.body[0].status === 'accepted', 'a newer Processed row: a REFRESH_ERRORS version row');
  ok(!('gstk_gstr1_pretop_r1' in storage), 'the outcome is recorded: the snapshot is dropped');
}

// Still processing on the portal, whatever its spelling: nothing written.
for (const label of ['In-Progress', 'In-progress', 'In Progress']) {
  reset();
  storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD), at: now - 60 * 1000 };
  storage.gstk_active_job = refreshJob();
  await runPage(UPLOAD_PAGE, { rows: () => [tr(...NEW.slice(0, 3), label, 'NA'), tr(...OLD)] });
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'pending' && r.ok === false && r.summary.includes('still processing') && r.summary.includes(label) && wroteNothing(),
    label + ': pending, still processing, nothing written');
  ok(storage.gstk_gstr1_pretop_r1, label + ': the snapshot stays');
}
reset();
storage.gstk_active_job = refreshJob();
await runPage(UPLOAD_PAGE, { rows: () => [tr(...NEW.slice(0, 3), 'In-progress', 'NA')] });
ok(storage.gstk_gstr1_upload_result.status === 'pending' && wroteNothing(), 'In-progress with no snapshot: pending, nothing written');

// An older Processed with Error row under an unrecorded upload: its error
// report is not this upload's.
reset();
const OLD_ERR = [...istCells(now - 86400000), 'AB0003', 'Processed with Error', 'Download error report'];
storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD_ERR), at: now - 60 * 1000 };
storage.gstk_active_job = refreshJob();
await runPage(UPLOAD_PAGE, { rows: () => [tr(...OLD_ERR)] });
ok(storage.gstk_gstr1_upload_result.status === 'pending' && storage.gstk_gstr1_upload_result.summary === NO_UPLOAD && wroteNothing(),
  'an older Processed with Error under an unrecorded upload: pending, never its report');

// ── The upload keeps the snapshot from just before the attach ─────────────
reset();
{
  let rows = [tr(...OLD)];
  let atAttach;
  const fileInput = { accept: '.json', files: null, dispatchEvent(e) {
    if (e.type !== 'change') return;
    atAttach = clone(storage.gstk_gstr1_pretop_r1 || null);
    rows = [tr(...NEW), tr(...OLD)]; // the portal lists the new upload, then processes it
  } };
  storage.gstk_active_job = job1();
  const t0 = Date.now();
  await runPage(UPLOAD_PAGE, { rows: () => rows, fileInput });
  ok(fileInput.files && fileInput.files.length === 1, 'the upload attached its file');
  ok(atAttach && atAttach.key === keyOf(OLD) && atAttach.at >= t0 && atAttach.at <= Date.now(), 'the snapshot (the row on top before, and when) is stored before the attach');
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'accepted' && patches('gstr1_data').some((c) => c.body.last_upload_status === 'accepted'), 'the poll saw the new Processed row: accepted');
  ok(!('gstk_gstr1_pretop_r1' in storage), 'the poll recorded the outcome: the snapshot is dropped');
}

// ── NIL: the result is stored and the job cleared before the RPC ──────────
reset();
storage.gstk_active_job = job1({ step: 'gstr1_nil', gstr1: { rowId: null, periodShort: 'Sep-26', json: null, irnAttached: 0, nil: true } });
await runPage('https://return.gst.gov.in/returns/auth/gstr1', {
  checkbox: { checked: true, disabled: false, labels: [{ textContent: 'File Nil GSTR-1' }], getAttribute: () => null, click() {} },
});
{
  const seen = nilRpc[0];
  ok(nilRpc.length === 1, 'NIL: markGstr1NilPushed is called once (the toggle constants are initialised in time)');
  ok(seen && seen.result && seen.result.status === 'nil_marked' && seen.result.ok === true && seen.result.clientId === 'c1', 'NIL: the nil_marked result is stored before the RPC');
  ok(seen && seen.job === null, 'NIL: the job is cleared before the RPC, so a closed tab finds nothing to fail');
}

// ── GSTR-3B: finishGstr3bPush runs in the job slot ────────────────────────
const finish3b = { clientId: 'c1', period_month: '09/2026', tabId: 1, actorId: 'u-1', status: 'filled', summary: 'Filled 31 field(s).',
  filled: 31, skipped: [], portalFilled: [], payload: { ret_period: '092026' } };
// The tab closes while the Push History row is being written.
reset();
slowVersions = 40;
storage.gstk_active_job = job3b();
{
  const done = bgCall('finishGstr3bPush', finish3b);
  tabRemoved(1);
  const resp = await done;
  await new Promise((r) => setTimeout(r, 60));
  const r = storage.gstk_gstr3b_push_result;
  ok(resp.ok && resp.data === true, 'finishGstr3bPush answers recorded');
  ok(posts('gstr3b_push_versions').length === 1 && posts('gstr3b_push_versions')[0].body[0].status === 'ok', '3B finished, tab closed meanwhile: one ok row');
  ok(r && r.status === 'filled' && r.ok === true && r.recorded === true && !r.tabClosed, '3B finished, tab closed meanwhile: the real result, not the tab\'s words');
  ok(!storage.gstk_active_job, '3B finished: the job is cleared');
}
// The tab closed first: the tab's result, then the push's own; still one row.
reset();
storage.gstk_active_job = job3b();
tabRemoved(1);
await new Promise((r) => setTimeout(r, 20));
ok(storage.gstk_gstr3b_push_result.tabClosed === true && posts('gstr3b_push_versions').length === 0, '3B tab closed first: tabClosed result, no row');
await bgCall('finishGstr3bPush', { ...finish3b, status: 'failed', summary: 'x', error: 'x' });
ok(posts('gstr3b_push_versions').length === 1 && storage.gstk_gstr3b_push_result.status === 'failed' && storage.gstk_gstr3b_push_result.recorded === true,
  '3B tab closed first: one row, the push\'s own result follows');
// Another push's job is never cleared by this one.
reset();
storage.gstk_active_job = job3b({ tabId: 5 });
await bgCall('finishGstr3bPush', finish3b);
ok(storage.gstk_active_job && storage.gstk_active_job.tabId === 5, 'finishGstr3bPush leaves another tab\'s job alone');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
