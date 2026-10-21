// 0.17.0: every database request from the extension says where it comes from
// and, while a job the app started is running, who started it, so the change
// log (gst_change_log, migration 20261021130000) can name the person. Runs the
// REAL background.js in a Node VM, as 11-session-identity does.
//   - every /rest/v1 request (select, insert, upsert, patch, delete, RPC)
//     carries x-gst-source: extension and an x-gst-request id
//   - with an active job whose actorId is a user id: x-gst-actor is that id
//   - a scheduled job (no actorId) or no job: no x-gst-actor
//   - an actorId that is not a uuid is never sent
//   - the API key headers and Prefer are unchanged; Storage uploads get none
//   - every job the app starts (through the real appbridge.js and start
//     functions) and every agent job keeps the person's id, and the pull's
//     writes carry it; without one, no one is named
//   node test/17-actor-headers.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';
const GITA = '10000000-0000-0000-0000-000000000002';

const calls = [];
const CLIENT = { id: 'c1', name: 'SUNRISE TRADERS', gstin: '24AAAAA0000A1Z5', gst_user_id: 'sunrise_gst', selected_returns: ['GSTR-1', 'GSTR-3B'] };
async function dbFetch(url, init = {}) {
  const u = String(url);
  calls.push({ method: init.method || 'GET', url: u, headers: { ...(init.headers || {}) } });
  if (u.startsWith(DB + '/rest/v1/rpc/')) return new Response('{"ok":true}', { status: 200 });
  if ((init.method || 'GET') === 'GET' && u.startsWith(DB + '/rest/v1/clients?')) return new Response(JSON.stringify([CLIENT]), { status: 200 });
  if ((init.method || 'GET') === 'GET') return new Response('[]', { status: 200 });
  return new Response(null, { status: 201 });
}

const storage = {};
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
let bgListener = null;
const chromeStub = {
  storage: { local, onChanged: { addListener() {}, removeListener() {} } },
  runtime: {
    getManifest: () => JSON.parse(read('manifest.json')),
    sendMessage: () => {},
    onMessage: { addListener: (fn) => { bgListener = fn; } },
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  notifications: { create() {}, onClicked: { addListener() {} } },
  tabs: { create: async () => ({ id: 1 }), update: async () => ({ id: 1, windowId: 1 }), onRemoved: { addListener() {} } },
  windows: { update: async () => ({}) },
  declarativeNetRequest: { updateDynamicRules: async () => {} },
};
const bg = vm.createContext({
  chrome: chromeStub, fetch: dbFetch, console, URL, Response, setTimeout, clearTimeout, setInterval, clearInterval,
  atob, btoa, TextEncoder, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set, AbortController,
});
bg.globalThis = bg;
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: ANON }; };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve) => bgListener({ gstk: true, fn, args }, {}, resolve));

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const restCalls = () => calls.filter((c) => c.url.startsWith(DB + '/rest/v1/'));

const version = JSON.parse(read('manifest.json')).version;
ok(version === '0.17.0', 'manifest is 0.17.0');

// 1. A job the app started: every write names the app user.
await local.set({ gstk_active_job: { mode: 'filing', actorId: GITA, tabId: 1 } });
calls.length = 0;
await bgCall('upsertFilingStatus', [{ client_id: 'c1', return_type: 'GSTR-3B', period_month: '09/2026', status: 'Filed' }]);
await bgCall('replaceCreditLedgerTxns', 'c1', '09/2026', [{ is_debit: true, igst: 1, cgst: 0, sgst: 0, description: 'x' }]);
await bgCall('upsertReco', 'suspended_reco', 'c1', '09/2026', { opening_igst: 10 });
await bgCall('runSweep', 'c1');
const during = restCalls();
ok(during.length >= 4, `requests made (${during.length})`);
ok(during.every((c) => c.headers['x-gst-source'] === 'extension'), 'every request: x-gst-source extension');
ok(during.every((c) => c.headers['x-gst-actor'] === GITA), 'every request: the app user who started the job');
ok(during.every((c) => /^extension 0\.17\.0 [0-9a-f]{1,8}$/.test(c.headers['x-gst-request'] || '')), 'every request: a request id naming the version');
ok(during.every((c) => c.headers.apikey === ANON && c.headers.Authorization === 'Bearer ' + ANON), 'the key headers unchanged');
ok(during.some((c) => c.method === 'DELETE') && during.some((c) => c.method === 'POST'), 'deletes and inserts both carry them');
const upsertCall = during.find((c) => /resolution=merge-duplicates/.test(c.headers.Prefer || ''));
ok(!!upsertCall && upsertCall.headers['x-gst-actor'] === GITA, 'an upsert keeps its Prefer and carries the actor');
ok(during.some((c) => c.url.includes('/rpc/') && c.headers['x-gst-actor'] === GITA), 'an RPC carries the actor');

// 2. A scheduled job (no person) or no job at all: no actor.
await local.set({ gstk_active_job: { mode: 'notices', actorId: null, scheduled: true } });
calls.length = 0;
await bgCall('replaceCreditLedgerTxns', 'c1', '09/2026', [{ is_debit: false, igst: 2, cgst: 0, sgst: 0, description: 'y' }]);
ok(restCalls().length > 0 && restCalls().every((c) => !('x-gst-actor' in c.headers) && c.headers['x-gst-source'] === 'extension'),
  'a scheduled job: source only, no actor');
await local.remove('gstk_active_job');
calls.length = 0;
await bgCall('replaceCreditLedgerTxns', 'c1', '09/2026', [{ is_debit: false, igst: 3, cgst: 0, sgst: 0, description: 'z' }]);
ok(restCalls().length > 0 && restCalls().every((c) => !('x-gst-actor' in c.headers)), 'no job: no actor');

// 3. Only a user id is ever sent as the actor.
await local.set({ gstk_active_job: { mode: 'filing', actorId: 'Gita <script>', tabId: 1 } });
calls.length = 0;
await bgCall('replaceCreditLedgerTxns', 'c1', '09/2026', [{ is_debit: false, igst: 4, cgst: 0, sgst: 0, description: 'w' }]);
ok(restCalls().length > 0 && restCalls().every((c) => !('x-gst-actor' in c.headers)), 'an actorId that is not a uuid is not sent');

// 4. Storage (the return PDF upload) is another API: none of these headers.
await local.set({ gstk_active_job: { mode: 'filing', actorId: GITA, tabId: 1 } });
calls.length = 0;
await bgCall('uploadPdf', 'c1/x.pdf', 'data:application/pdf;base64,JVBERi0=');
const up = calls.find((c) => c.url.includes('/storage/v1/'));
ok(!!up && !('x-gst-actor' in up.headers) && !('x-gst-source' in up.headers), 'storage uploads unchanged');

// 5. The popup's own reads (db.js) say they come from the extension.
const dbSrc = read('db.js');
ok((dbSrc.match(/'x-gst-source': 'extension'/g) || []).length === 2, 'the popup reads carry x-gst-source');

// 6. Jobs the app starts, through the real bridge (appbridge.js) and the real
// start functions: each stores the app user's id on the job, so the pull's
// writes name them. Round 1 review: the ledger, return, 2B, 2A, section,
// all-clients and filing-page jobs named no one.
const posted = [];
const appListeners = [];
const appWindow = {
  addEventListener: (type, fn) => { if (type === 'message') appListeners.push(fn); },
  postMessage: (m) => { posted.push(m); },
};
const appCtx = vm.createContext({
  window: appWindow, location: { origin: 'https://gst.vjdesai.com' }, console, setTimeout, clearTimeout, Promise, JSON, Date,
  chrome: {
    runtime: { getManifest: chromeStub.runtime.getManifest, lastError: null, sendMessage: (msg, cb) => bgListener(msg, {}, (r) => cb && cb(r)) },
    storage: { local, onChanged: { addListener() {} } },
  },
});
vm.runInContext(read('appbridge.js'), appCtx, { filename: 'appbridge.js' });
const fromApp = async (data) => {
  for (const fn of appListeners) fn({ source: appWindow, origin: 'https://gst.vjdesai.com', data });
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};
const starts = [
  ['__gstkPullLedgers (reco Pull)', { __gstkPullLedgers: { clientId: 'c1', period_month: '09/2026' } }, 'ledgers'],
  ['__gstkPullReturn (Filing Status Portal)', { __gstkPullReturn: { clientId: 'c1', return_type: 'GSTR-3B', period_month: '09/2026' } }, 'returnpdf'],
  ['__gstkPull2B (Import 2B)', { __gstkPull2B: { clientId: 'c1', period_month: '09/2026' } }, 'twob'],
  ['__gstkPull2A (GSTR-2A)', { __gstkPull2A: { clientId: 'c1', period_month: '09/2026' } }, 'twoa'],
  ['__gstkOpenFiling (filing page)', { __gstkOpenFiling: { clientId: 'c1', return_type: 'GSTR-3B', period_month: '09/2026' } }, 'filing'],
  ['__gstkPullSection (Reports Hub, GSTR-9)', { __gstkPullSection: { clientId: 'c1', mode: 'cashledger', period_month: '09/2026' } }, 'cashledger'],
  ['__gstkPullSectionAllClients (Company List)', { __gstkPullSectionAllClients: { mode: 'taxpayerprofile', clientIds: ['c1'] } }, 'taxpayerprofile'],
];
for (const [name, data, mode] of starts) {
  const key = Object.keys(data)[0];
  for (const actorId of [GITA, null]) {
    await local.remove('gstk_active_job');
    await fromApp({ [key]: { ...data[key], ...(actorId ? { actorId } : {}) } });
    const { gstk_active_job: job } = await local.get('gstk_active_job');
    calls.length = 0;
    await bgCall('upsertFilingStatus', [{ client_id: 'c1', return_type: 'GSTR-3B', period_month: '09/2026', status: 'Filed' }]);
    await bgCall('upsertReco', 'suspended_reco', 'c1', '09/2026', { opening_igst: 10 });
    const writes = restCalls().filter((c) => c.method !== 'GET');
    if (actorId) {
      ok(!!job && job.mode === mode && job.actorId === GITA, `${name}: the job keeps the app user`);
      ok(writes.length >= 2 && writes.every((c) => c.headers['x-gst-actor'] === GITA && c.headers['x-gst-source'] === 'extension'),
        `${name}: its writes name the app user`);
    } else {
      ok(!!job && job.mode === mode && !job.actorId && writes.every((c) => !('x-gst-actor' in c.headers)), `${name}: no user sent, no one named`);
    }
  }
}
// The office agent passes the person who queued the job (portal_jobs.requested_by).
await local.remove('gstk_active_job');
await bgCall('startAgentJob', { clientId: 'c1', mode: 'notices_bundle', periods: ['09/2026'], runId: 'r1', jobId: 'j1', actorId: GITA });
ok((await local.get('gstk_active_job')).gstk_active_job?.actorId === GITA, 'an agent job keeps the person who queued it');
await local.remove('gstk_active_job');
await bgCall('startAgentJob', { clientId: 'c1', mode: 'notices_bundle', periods: ['09/2026'], runId: 'r2', jobId: 'j2', actorId: null });
ok(!(await local.get('gstk_active_job')).gstk_active_job?.actorId, 'a scheduled agent job names no one');
await local.remove('gstk_active_job');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
