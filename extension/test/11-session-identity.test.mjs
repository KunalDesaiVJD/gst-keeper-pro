// 0.8.8: no portal action runs inside another taxpayer's session, and a saved
// password the portal can never accept is not tried. (10 Oct 2026: MAHIL INFRA's
// saved password was 17 characters, the portal takes 8 to 15; its logins failed
// silently and a push went on inside BAPA SITARAM's session.) Runs the REAL
// background.js and content.js in Node VM contexts, as 08-push-dead-ends does.
//   - a logged-in page at step 'login' whose session (profile/detail) is
//     another GSTIN is logged out and the client logged in again; the same
//     GSTIN goes on; after two logouts the job stops with a message
//   - a push whose session cannot be read is stopped, nothing sent; a pull
//     goes on (pulls check what they save)
//   - on a returns page the header's GSTIN is read; none there: the check
//     moves to services.gst.gov.in
//   - a saved password shorter than 8 or longer than 15 is never typed: the
//     client gets a password issue saying so and the push fails with it
//   node test/11-session-identity.test.mjs
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


const contentSrc = read('content.js');
const MAHIL = '24ABOFM3693A1Z9';
const BAPA = '24AAZFB2530R1ZU';
function makeDocument(opts) {
  const byId = {};
  const el = (extra) => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, dispatchEvent() {}, focus() {}, blur() {}, click() {},
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, offsetParent: {}, value: '', children: [], ...extra,
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  const user = el(); const pass = el();
  const doc = {
    user, pass,
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: (s) => (opts.loginForm && s === '#username' ? user : opts.loginForm && s === '#user_pass' ? pass : null),
    querySelectorAll: (s) => {
      if (opts.header && /header/.test(s)) return opts.header.map((t) => { const e = el(); e.textContent = t; return e; });
      return [];
    },
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
    banner: () => (byId['gstk-banner'] ? byId['gstk-banner'].textContent : ''),
  };
  return doc;
}
const issues = []; const syncLog = [];
async function runPage(href, opts = {}) {
  const document = makeDocument(opts);
  const profileCalls = [];
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {}, Response,
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (f) => this.files.push(f) }; } },
    Event: class { constructor(t) { this.type = t; } }, KeyboardEvent: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: chromeFor(1), document,
    location: { href, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} },
    fetch: async (u) => {
      if (/profile\/detail/.test(String(u))) {
        profileCalls.push(String(u));
        if (opts.profile === 'fail') return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ gstin: opts.profile }), { status: 200 });
      }
      throw new Error('no portal route for ' + u);
    },
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async (...a) => { syncLog.push(a); return null; }, logStep: async () => null,
      getPortalPassword: async () => (opts.password === undefined ? 'Secret@123' : opts.password), focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async (...a) => { issues.push(a); return null; }, clearCaptchaNotice: async () => null,
      notifyCaptcha: async () => true,
    },
    jspdf: {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 50));
  return { document, nav: sandbox.location.href, profileCalls };
}

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const reset = () => { calls.length = 0; for (const k of Object.keys(storage)) delete storage[k]; failVersions = false; slowVersions = 0; issues.length = 0; syncLog.length = 0; };
const now = Date.now();
const mahil = { clientId: 'c1', creds: { user: 'mahil_infra', name: 'MAHIL INFRA-NO ITC', gstin: MAHIL, selectedReturns: [] } };
const pushJob = (extra) => ({ mode: 'gstr1_upload', idx: 0, step: 'login', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [mahil], gstr1: { rowId: null, periodShort: 'Sep-26', json: null, nil: true }, ...extra });
const WELCOME = 'https://services.gst.gov.in/services/auth/fowelcome';
const LOGIN = 'https://services.gst.gov.in/services/login';
const RETURNS = 'https://return.gst.gov.in/returns/auth/dashboard';
const LOGOUT = 'https://services.gst.gov.in/services/logout';

// ── another taxpayer's session: logged out, the client logged in again ──────
reset();
storage.gstk_active_job = pushJob();
{
  const { document, nav, profileCalls } = await runPage(WELCOME, { profile: BAPA });
  const j = storage.gstk_active_job;
  ok(profileCalls.length === 1, 'mismatch: the session\'s GSTIN is read from profile/detail');
  ok(j && j.step === 'logout' && j.identityLogouts === 1 && nav === LOGOUT, 'mismatch: BAPA\'s session is logged out, the job stays MAHIL\'s and logs in again');
  ok(document.banner().includes('logged in as ' + BAPA + ', not MAHIL INFRA-NO ITC'), 'mismatch: the banner names both');
  ok(!storage.gstk_gstr1_upload_result, 'mismatch: nothing pushed, no result yet (the push goes on after the new login)');
  ok(syncLog.some((a) => a[0] === 'c1' && /Portal session was 24AAZFB2530R1ZU/.test(a[3])), 'mismatch: logged in the client\'s sync log');
}
// ── the client's own session: the push goes on ──────────────────────────────
reset();
storage.gstk_active_job = pushJob({ identityLogouts: 1 });
{
  const { nav } = await runPage(WELCOME, { profile: MAHIL });
  const j = storage.gstk_active_job;
  ok(j && j.step === 'gstr1_dash' && !('identityLogouts' in j) && nav === RETURNS, 'same GSTIN: the push goes on to the returns dashboard, the logout count cleared');
}
// ── a third wrong session: the push stops with a message ────────────────────
reset();
storage.gstk_active_job = pushJob({ identityLogouts: 2 });
{
  const { nav } = await runPage(WELCOME, { profile: BAPA });
  const r = storage.gstk_gstr1_upload_result;
  ok(r && r.ok === false && /keeps logging in as 24AAZFB2530R1ZU, not MAHIL INFRA-NO ITC/.test(r.summary || r.error || '') && /saved login/.test(r.summary || r.error || ''),
    'third mismatch: the push fails, naming the other GSTIN and Chrome\'s saved logins');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'third mismatch: the result names MAHIL\'s return');
  ok(!storage.gstk_active_job && nav === WELCOME, 'third mismatch: the job is cleared, no navigation');
}
// ── a push whose session cannot be read: stopped ─────────────────────────────
reset();
storage.gstk_active_job = pushJob();
{
  const { profileCalls } = await runPage(WELCOME, { profile: 'fail' });
  const r = storage.gstk_gstr1_upload_result;
  ok(profileCalls.length === 3, 'unreadable: profile/detail tried 3 times');
  ok(r && r.ok === false && /Could not confirm that the GST portal is logged in as MAHIL INFRA-NO ITC/.test(r.summary || r.error || ''), 'unreadable: a push is stopped, nothing sent');
}
// ── a pull whose session cannot be read: goes on ─────────────────────────────
reset();
storage.gstk_active_job = pushJob({ mode: 'twob', gstr1: undefined });
{
  const { nav } = await runPage(WELCOME, { profile: 'fail' });
  const j = storage.gstk_active_job;
  ok(j && j.step === 'twob' && nav === RETURNS, 'unreadable, a pull: goes on as before (pulls check what they save)');
}
// ── a pull in another session: logged out too ────────────────────────────────
reset();
storage.gstk_active_job = pushJob({ mode: 'twob', gstr1: undefined });
{
  const { nav } = await runPage(WELCOME, { profile: BAPA });
  ok(storage.gstk_active_job.step === 'logout' && nav === LOGOUT, 'a pull in another taxpayer\'s session is logged out too');
}
// ── a returns page at step 'login': the header's GSTIN ──────────────────────
reset();
storage.gstk_active_job = pushJob();
{
  const { nav, profileCalls } = await runPage(RETURNS, { header: ['AMBER GUM INDUSTRIES', BAPA] });
  ok(profileCalls.length === 0 && storage.gstk_active_job.step === 'logout' && nav === LOGOUT, 'returns page: BAPA\'s GSTIN in the header is logged out');
}
reset();
storage.gstk_active_job = pushJob();
{
  const { nav } = await runPage(RETURNS, { header: [] });
  ok(storage.gstk_active_job.idCheckHop === true && storage.gstk_active_job.step === 'login' && nav === WELCOME, 'returns page, no GSTIN shown: checked on services.gst.gov.in');
}
reset();
storage.gstk_active_job = pushJob({ idCheckHop: true });
{
  const { nav } = await runPage(WELCOME, { profile: MAHIL });
  ok(storage.gstk_active_job.step === 'gstr1_dash' && !('idCheckHop' in storage.gstk_active_job) && nav === RETURNS, 'after the hop: the same GSTIN goes on');
}
// ── a saved password the portal cannot accept ────────────────────────────────
for (const [len, label] of [[17, 'longer than 15'], [7, 'shorter than 8']]) {
  reset();
  storage.gstk_active_job = pushJob();
  const pw = 'Abcdefghijklmnopq'.slice(0, len);
  const { document } = await runPage(LOGIN, { loginForm: true, password: pw });
  const r = storage.gstk_gstr1_upload_result;
  ok(document.pass.value === '', label + ': the password is never typed into the form');
  ok(issues.some((a) => a[0] === 'c1' && a[1] === 'wrong_password' && a[2].includes('is ' + len + ' characters long; the portal accepts 8 to 15')),
    label + ': the client gets a password issue that says why');
  ok(r && r.ok === false && (r.summary || r.error || '').includes(len + ' characters long'), label + ': the push fails with the same message');
  ok(len < 16 || (r.summary || r.error || '').includes('probably the first 15'), label + ': a long one says the portal probably kept the first 15');
}
reset();
storage.gstk_active_job = pushJob();
{
  const { document } = await runPage(LOGIN, { loginForm: true, password: 'Secret@12345678' });
  ok(document.user.value === 'mahil_infra' && document.pass.value === 'Secret@12345678' && issues.length === 0, '15 characters: filled as before');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
