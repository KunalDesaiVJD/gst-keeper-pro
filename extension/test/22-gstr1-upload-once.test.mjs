// 0.18.6: a GSTR-1 push sends its JSON once and waits for the portal's status.
// Seen from 30 Oct to 2 Nov 2026 (TISHA INTERNATIONAL and others): the JSON was
// uploaded, the portal then showed its login page, the push logged in again
// and attached the same JSON again, and went round the login page until the
// tab was closed ("Portal tab closed during the upload" on every push).
// Runs the REAL background.js and content.js as 08-push-dead-ends does:
//   - the attach is recorded on the job (gstr1.attached) before the file goes
//   - back on the upload page with the JSON attached: the status is read, the
//     file is never attached again
//   - sent to the login page after the attach: logs in again only to read the
//     status (twice at most, counted on the upload, not job.retries); a third
//     time ends with "The JSON was uploaded to the portal at ...", the
//     snapshot kept for Refresh errors
//   - before the attach a bounce is handled as before (job.retries)
//   - no final status within a look: the upload page is opened again from the
//     dashboard; none within 20 minutes of the attach: "Timed out ... (20 min)"
//   - an error after the attach says the JSON was uploaded
//   node test/22-gstr1-upload-once.test.mjs
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
// One look at the Upload History lasts 1 s here (2 minutes live), so a test
// sees the page opened again without waiting minutes; the 20-minute watch is
// the shipped one.
const shipped = read('content.js');
const LOOK_LINE = '  const GSTR1_LOOK_MS = 2 * 60 * 1000;';
if (!shipped.includes(LOOK_LINE)) throw new Error('GSTR1_LOOK_MS not found in content.js');
const contentSrc = shipped.replace(LOOK_LINE, '  const GSTR1_LOOK_MS = 1000;');
const WATCH_MS = 20 * 60 * 1000;
if (!shipped.includes('  const GSTR1_WATCH_MS = 20 * 60 * 1000;')) throw new Error('GSTR1_WATCH_MS changed: update the test');
let lastLoc = null;
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
    location: (lastLoc = { href, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} }),
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
const tr = (...cells) => ({ querySelector: (s) => (s === 'td' ? {} : null), querySelectorAll: (s) => (s === 'td' ? cells.map((t) => ({ textContent: t })) : []), offsetParent: {} });
const keyOf = (cells) => cells.join('|');
const istCells = (ms) => {
  const d = new Date(ms + 330 * 60 * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return [p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(), p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds())];
};
const UPLOAD_PAGE = 'https://return.gst.gov.in/returns/auth/gstr1/offlineupload';
const DASH = 'https://return.gst.gov.in/returns/auth/dashboard';
const OLD = [...istCells(now - 3 * 86400000), 'AB0001', 'Processed', 'NA'];
const NEW_RUNNING = [...istCells(now - 30 * 1000), 'AB0002', 'In Progress', 'NA'];
const NEW_DONE = [...istCells(now - 30 * 1000), 'AB0002', 'Processed', 'NA'];
const UPLOADED = /^The JSON was uploaded to the portal at \d\d:\d\d IST, but its status could not be read: /;
const attachedJob = (extra = {}, g = {}) => job1({ ...extra, gstr1: { rowId: 'r1', periodShort: 'Sep-26', json: {}, nil: false,
  attached: { at: now - 60 * 1000, key: keyOf(OLD) }, ...g } });
const fileInputSpy = (onAttach) => ({ accept: '.json', files: null, attaches: 0, dispatchEvent(e) {
  if (e.type !== 'change') return; this.attaches++; if (onAttach) onAttach(); } });

// ── 1. The attach is on the job before the file goes; no status in the first
//       look: the upload page is opened again, the JSON not sent again ───────
reset();
{
  let rows = [tr(...OLD)];
  let jobAtAttach = null;
  const fileInput = fileInputSpy(() => { jobAtAttach = clone(storage.gstk_active_job); rows = [tr(...NEW_RUNNING), tr(...OLD)]; });
  storage.gstk_active_job = job1();
  await runPage(UPLOAD_PAGE, { rows: () => rows, fileInput });
  ok(fileInput.attaches === 1, '1: the JSON is attached once');
  ok(jobAtAttach && jobAtAttach.gstr1.attached && jobAtAttach.gstr1.attached.key === keyOf(OLD), '1: the attach (with the row on top before) is saved on the job before the file goes');
  const j = storage.gstk_active_job;
  ok(j && j.step === 'gstr1_dash' && lastLoc.href === DASH, '1: still In Progress after the look: the upload page is opened again from the dashboard');
  ok(j && j.gstr1.attached && j.gstr1.looks === 1, '1: the job keeps the attach');
  ok(!storage.gstk_gstr1_upload_result && patches('gstr1_data').length === 0, '1: nothing recorded yet');
  ok(storage.gstk_gstr1_pretop_r1 && storage.gstk_gstr1_pretop_r1.key === keyOf(OLD), '1: the snapshot for Refresh errors stays');

  // The reopened upload page: the portal now shows it Processed.
  const again = fileInputSpy();
  storage.gstk_active_job.step = 'gstr1_upload';
  await runPage(UPLOAD_PAGE, { rows: () => [tr(...NEW_DONE), tr(...OLD)], fileInput: again });
  ok(again.attaches === 0, '1: the reopened page never attaches the JSON again');
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.ok && r.status === 'accepted' && r.clientId === 'c1', '1: the status is read: accepted');
  ok(patches('gstr1_data').some((c) => c.body.last_upload_status === 'accepted'), '1: gstr1_data saved accepted');
  ok(posts('gstr1_upload_versions').length === 1, '1: one version row for the push');
  ok(!storage.gstk_active_job && !('gstk_gstr1_pretop_r1' in storage), '1: the job and the snapshot go');
}

// ── 2. Logged out after the attach: logs in again only to read the status ──
reset();
storage.gstk_active_job = attachedJob({ step: 'gstr1_upload', retries: 0 });
storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD), at: now - 60 * 1000 };
{
  const doc = await runPage(LOGIN);
  const j = storage.gstk_active_job;
  ok(j && j.step === 'login' && j.gstr1.relogins === 1 && j.gstr1.attached, '2: bounce after the attach: logs in again, counted on the upload, attach kept');
  ok(/the JSON is not sent again/.test(doc.banner()), '2: the banner says the JSON is not sent again');
  ok(!storage.gstk_gstr1_upload_result && calls.length === 0, '2: nothing recorded yet');
}
// The login resets job.retries; the upload's own count still ends it.
storage.gstk_active_job = attachedJob({ step: 'gstr1_dash', retries: 0 }, { relogins: 2 });
{
  await runPage(LOGIN);
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'failed' && UPLOADED.test(r.error) && /logged the tab out 2 times/.test(r.error), '2: a third logout ends the push: the JSON was uploaded, status unread');
  const p = patches('gstr1_data')[0];
  ok(p && p.body.last_upload_status === 'failed' && UPLOADED.test(p.body.last_upload_summary), '2: saved failed with words the GSTR-1 page offers Refresh errors for');
  ok(storage.gstk_gstr1_pretop_r1 && !storage.gstk_active_job, '2: the snapshot stays for Refresh errors, the job goes');
}

// ── 3. Before the attach a bounce is handled as before ────────────────────
reset();
storage.gstk_active_job = job1({ step: 'gstr1_dash', retries: 0 });
await runPage(LOGIN);
{
  const j = storage.gstk_active_job;
  ok(j && j.step === 'login' && j.retries === 1 && !j.gstr1.relogins && !j.gstr1.attached, '3: no attach yet: job.retries counts, as in 0.18.5');
}

// ── 4. No final status within 20 minutes of the attach ───────────────────
reset();
storage.gstk_active_job = attachedJob({ step: 'gstr1_upload' }, { attached: { at: Date.now() - WATCH_MS + 1500, key: keyOf(OLD) }, looks: 3 });
storage.gstk_gstr1_pretop_r1 = { key: keyOf(OLD), at: now - WATCH_MS };
{
  const fi = fileInputSpy();
  await runPage(UPLOAD_PAGE, { rows: () => [tr(...NEW_RUNNING), tr(...OLD)], fileInput: fi });
  const r = storage.gstk_gstr1_upload_result;
  ok(fi.attaches === 0, '4: never attached again');
  ok(r && r.status === 'failed' && /^Timed out waiting for the portal to finish processing \(20 min\)\./.test(r.error), '4: timed out after 20 minutes, Refresh errors offered');
  ok(storage.gstk_gstr1_pretop_r1 && !storage.gstk_active_job, '4: the snapshot stays, the job goes');
}

// ── 5. An older row whose text changed is not this upload's ──────────────
reset();
{
  const OLD_CHANGED = [...istCells(now - 3 * 86400000), 'AB0001', 'Processed', 'Download error report'];
  storage.gstk_active_job = attachedJob({ step: 'gstr1_upload' }, { looks: 1 });
  await runPage(UPLOAD_PAGE, { rows: () => [tr(...OLD_CHANGED)], fileInput: fileInputSpy() });
  ok(!storage.gstk_gstr1_upload_result && storage.gstk_active_job && storage.gstk_active_job.step === 'gstr1_dash', '5: an older row (by its date) is never read as the upload: the page is opened again');
}

// ── 6. An error after the attach says the JSON was uploaded ──────────────
reset();
storage.gstk_active_job = attachedJob({ step: 'gstr1_upload' });
await runPage(UPLOAD_PAGE, { throwOn: 'a, button, li, span' });
{
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.status === 'failed' && UPLOADED.test(r.error) && /Unexpected error on step gstr1_upload: boom/.test(r.error), '6: an unexpected error after the attach: uploaded, status unread');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
