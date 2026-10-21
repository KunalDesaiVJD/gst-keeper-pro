// The scheduled Chrome runner (runner.js, autopilot_settings.runner =
// 'chrome', live since 6 Oct 2026) keeps the person who queued a job
// (portal_jobs.requested_by, which portal_job_claim returns) on the job it
// starts, as the office agent does (agent/src/jobStart.ts), so the pull's
// writes carry x-gst-actor and the change log names them (round 2 review: a
// pull Gita queued from the app was logged as "Extension, no person
// recorded"). A job nobody queued (the schedule) names no one. Runs the REAL
// background.js and runner.js in a Node VM.
//   node test/18-runner-actor.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';
const GITA = '10000000-0000-0000-0000-000000000002';
const CLIENT = { id: 'c1', name: 'SUNRISE TRADERS', gstin: '24AAAAA0000A1Z5', gst_user_id: 'sunrise_gst', selected_returns: ['GSTR-3B'] };
let claimed = null;
const calls = [];
async function dbFetch(url, init = {}) {
  const u = String(url);
  calls.push({ method: init.method || 'GET', url: u, headers: { ...(init.headers || {}) } });
  const rpc = u.startsWith(DB + '/rest/v1/rpc/') ? u.slice((DB + '/rest/v1/rpc/').length) : null;
  if (rpc === 'autopilot_heartbeat') return new Response(JSON.stringify({ enabled: true, runner: 'chrome', serves: true, captcha_wait_secs: 120 }), { status: 200 });
  if (rpc === 'portal_job_claim') return new Response(JSON.stringify(claimed), { status: 200 });
  if (rpc === 'portal_job_start') return new Response('true', { status: 200 });
  if (rpc) return new Response('null', { status: 200 });
  if ((init.method || 'GET') === 'GET' && u.includes('/rest/v1/clients?')) return new Response(JSON.stringify([CLIENT]), { status: 200 });
  if ((init.method || 'GET') === 'GET') return new Response('[]', { status: 200 });
  return new Response(null, { status: 201 });
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const area = (st) => ({
  get: async (k) => { if (k == null) return clone(st); const o = {}; for (const key of (Array.isArray(k) ? k : [k])) if (key in st) o[key] = clone(st[key]); return o; },
  set: async (o) => { for (const [k, v] of Object.entries(o)) st[k] = clone(v); },
  remove: async (k) => { for (const key of (Array.isArray(k) ? k : [k])) delete st[key]; },
});
const local = area({});
let bgListener = null;
const chromeStub = {
  storage: { local, session: area({}), onChanged: { addListener() {}, removeListener() {} } },
  runtime: { getManifest: () => JSON.parse(read('manifest.json')), sendMessage: () => {}, onMessage: { addListener: (fn) => { bgListener = fn; } },
    lastError: null, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  alarms: { create() {}, clear() {}, get: async () => null, onAlarm: { addListener() {} } },
  notifications: { create() {}, onClicked: { addListener() {} } },
  idle: { queryState: async () => 'idle', onStateChanged: { addListener() {} } },
  tabs: { create: async () => ({ id: 7 }), update: async () => ({ id: 7, windowId: 9 }), query: async () => [], get: async () => ({ id: 7, windowId: 9 }),
    remove: async () => {}, onRemoved: { addListener() {}, removeListener() {} }, onUpdated: { addListener() {}, removeListener() {} } },
  windows: { create: async () => ({ id: 9, tabs: [{ id: 7 }] }), update: async () => ({}), remove: async () => {}, onRemoved: { addListener() {}, removeListener() {} } },
  declarativeNetRequest: { updateDynamicRules: async () => {} },
};
const bg = vm.createContext({ chrome: chromeStub, fetch: dbFetch, console, URL, Response, setTimeout, clearTimeout, setInterval, clearInterval,
  atob, btoa, TextEncoder, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set, AbortController, crypto: globalThis.crypto });
bg.globalThis = bg;
bg.importScripts = (f) => { if (f === 'config.js') bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: ANON }; else vm.runInContext(read(f), bg, { filename: f }); };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve) => bgListener({ gstk: true, fn, args }, {}, resolve));

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };

await local.set({ gstk_runner: { enabled: true, id: 'pc1', label: 'Office PC' } });
const cases = [
  ['a pull Gita queued from the app', GITA, GITA],
  ['a scheduled job (nobody queued it)', null, null],
];
for (const [name, requestedBy, expected] of cases) {
  await local.remove('gstk_active_job');
  claimed = { id: 'j-' + name.length, client_id: 'c1', client_name: CLIENT.name, gstin: CLIENT.gstin, job_type: 'FETCH_REPORT',
    payload: { mode: 'gstr3b_pull', periods: ['09/2026'] }, run_id: 'r1', attempts: 0, requested_by: requestedBy };
  await bgCall('runnerNow');
  const { gstk_active_job: job } = await local.get('gstk_active_job');
  ok(!!job && job.mode === 'gstr3b_pull' && !!job.runner, `${name}: the runner started it`);
  ok(!!job && (job.actorId ?? null) === expected, `${name}: the job ${expected ? 'keeps the person who queued it' : 'names no one'}`);
  calls.length = 0;
  await bgCall('upsertFiledReturn', 'c1', '09/2026', 'GSTR-3B', { status: 'Filed' });
  const writes = calls.filter((c) => c.url.startsWith(DB + '/rest/v1/') && c.method !== 'GET');
  ok(writes.length > 0 && writes.every((c) => c.headers['x-gst-source'] === 'extension' && (c.headers['x-gst-actor'] ?? null) === expected),
    `${name}: the pull's writes carry ${expected ? 'her id' : 'no person'} (x-gst-source extension)`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
