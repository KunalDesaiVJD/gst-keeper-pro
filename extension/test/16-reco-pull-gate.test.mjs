// 0.16.0: the GSTR-3B push asks the database's gate first, and a reco pull
// saves through reco_record_pull (migration 20261021120000). Runs the REAL
// background.js and appbridge.js in Node VM contexts with a stubbed chrome.*
// API and a fake REST endpoint that records each call:
//   - startGstr3bPush calls rpc/gstr3b_push_gate for the job's client and
//     period before any tab opens; a gate that says no, an error, a missing
//     function or a malformed answer stops it with the reasons and opens
//     nothing ("fails closed"); a gate that passes opens the portal and keeps
//     the check on the job;
//   - the page's __gstkPushGstr3b through appbridge.js gets a failed result
//     carrying the gate's reasons, and nothing is recorded;
//   - the Push History row carries the gate it passed, and is written without
//     it on a database that lacks the column;
//   - startLedgerPull keeps the app user who asked (actorId) on the job, and
//     recordRecoPull sends it with the figures to rpc/reco_record_pull;
//   - content.js saves both ledgers through recordRecoPull with the job's
//     actor (no direct table write left), and classifyLedgerRows reads ITC
//     utilised as 0 when ledger rows were read with no set-off debit.
//   node test/16-reco-pull-gate.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';

// ── The fake database ─────────────────────────────────────────────────────
const calls = [];
let gateAnswer = null; // { status, body }
let versionsRefuseGate = false;
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, body });
  if (u === DB + '/rest/v1/rpc/gstr3b_push_gate' && method === 'POST') {
    const a = gateAnswer || { status: 200, body: { ok: true, reasons: [], checked_at: '2026-10-21T10:00:00Z' } };
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  }
  if (u === DB + '/rest/v1/rpc/reco_record_pull' && method === 'POST') {
    return new Response(JSON.stringify({ ok: true, id: 'r1', pulled_by: body.p_actor_id }), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr3b_push_versions') && method === 'POST') {
    if (versionsRefuseGate && body[0] && 'gate' in body[0]) {
      return new Response('{"code":"PGRST204","message":"Could not find the \'gate\' column of \'gstr3b_push_versions\' in the schema cache"}', { status: 400 });
    }
    return new Response(null, { status: 201 });
  }
  throw new Error('fake database has no route for ' + method + ' ' + u);
}
const rpcCalls = (fn) => calls.filter((c) => c.url === DB + '/rest/v1/rpc/' + fn);

// ── chrome.* for the background worker ─────────────────────────────────────
const storage = {};
let bgListener = null;
const tabsCreated = [];
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
const chromeApi = {
  storage: { local, onChanged: { addListener() {}, removeListener() {} } },
  runtime: {
    getManifest: () => JSON.parse(read('manifest.json')),
    sendMessage: (msg, cb) => { bgListener(msg, {}, (resp) => cb && cb(resp)); },
    onMessage: { addListener: (fn) => { bgListener = fn; } },
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  notifications: { create() {}, onClicked: { addListener() {} } },
  tabs: { create: async (o) => { tabsCreated.push(o); calls.push({ method: 'TAB', url: 'tab:' + o.url }); return { id: 7 }; }, update: async () => ({ id: 7, windowId: 1 }), onRemoved: { addListener() {} } },
  windows: { update: async () => ({}) },
  declarativeNetRequest: { updateDynamicRules: async () => {} },
};
const bg = vm.createContext({
  chrome: chromeApi, fetch: dbFetch, console, URL, Response, setTimeout, clearTimeout, setInterval, clearInterval,
  atob, btoa, TextEncoder, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set,
});
bg.globalThis = bg;
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: ANON }; };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve) => bgListener({ gstk: true, fn, args }, {}, resolve));

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const reset = () => { calls.length = 0; tabsCreated.length = 0; for (const k of Object.keys(storage)) delete storage[k]; gateAnswer = null; versionsRefuseGate = false; };
const pushInfo = { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', gstr3bJson: { ret_period: '092026' } };

ok(JSON.parse(read('manifest.json')).version === '0.16.0', 'manifest is 0.16.0');

// ── The gate passes: the portal opens and the job keeps the check ──────────
reset();
{
  const r = await bgCall('startGstr3bPush', pushInfo);
  const g = rpcCalls('gstr3b_push_gate');
  ok(r && r.ok === true, 'gate ok: the push starts');
  ok(g.length === 1 && g[0].body.p_client_id === 'c1' && g[0].body.p_period === '09/2026', 'the gate is asked for the job\'s client and MM/YYYY period');
  const gi = calls.findIndex((c) => c.url.endsWith('/rpc/gstr3b_push_gate'));
  const ti = calls.findIndex((c) => c.method === 'TAB');
  ok(gi >= 0 && ti > gi && tabsCreated.length === 1, 'the portal tab opens only after the gate answered');
  const job = storage.gstk_active_job;
  ok(job && job.mode === 'gstr3b_push' && job.gstr3b.gate && job.gstr3b.gate.ok === true && job.gstr3b.gate.checked_at === '2026-10-21T10:00:00Z',
    'the job keeps the gate check that let it start');
}

// ── The gate says no: nothing opens, the reasons come back ─────────────────
reset();
gateAnswer = { status: 200, body: { ok: false, reasons: [
  { code: 'suspended_not_pulled', message: 'Suspended Reco for Sep 2026 is not pulled from the portal.' },
  { code: 'receivable_difference', message: 'GST Receivable Reco for Sep 2026 has a difference of ₹250.00.' },
] } };
{
  const r = await bgCall('startGstr3bPush', pushInfo);
  ok(r && !r.ok && /GSTR-3B push stopped: Suspended Reco for Sep 2026 is not pulled from the portal\. GST Receivable Reco for Sep 2026 has a difference of ₹250\.00\./.test(r.error),
    'gate no: the push is refused with every reason');
  ok(tabsCreated.length === 0 && !storage.gstk_active_job, 'gate no: no portal tab, no job');
}

// ── Fails closed: an error, a missing function, a malformed or empty answer ─
for (const [label, ans] of [
  ['an error in the database', { status: 500, body: '{"message":"boom"}' }],
  ['a database without the gate (404)', { status: 404, body: '{"code":"PGRST202","message":"Could not find the function public.gstr3b_push_gate"}' }],
  ['an answer without ok', { status: 200, body: { reasons: [] } }],
  ['ok but with a reason', { status: 200, body: { ok: true, reasons: [{ code: 'x', message: 'Something is off.' }] } }],
  ['an empty answer', { status: 200, body: '' }],
]) {
  reset();
  gateAnswer = ans;
  const r = await bgCall('startGstr3bPush', pushInfo);
  ok(r && !r.ok && /^GSTR-3B push stopped/.test(r.error) && tabsCreated.length === 0 && !storage.gstk_active_job, `fails closed on ${label}`);
}

// ── Through the page bridge: the page hears the refusal ────────────────────
reset();
gateAnswer = { status: 200, body: { ok: false, reasons: [{ code: 'suspended_not_pulled', message: 'Suspended Reco for Sep 2026 is not pulled from the portal.' }] } };
{
  const posted = [];
  let pageListener = null;
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') pageListener = fn; },
    postMessage: (data) => posted.push(data),
  };
  const ab = vm.createContext({
    chrome: { ...chromeApi, runtime: { ...chromeApi.runtime, sendMessage: (msg, cb) => bgListener(msg, {}, cb) } },
    window: win, location: { origin: 'https://gst.vjdesai.com' }, console, setTimeout, clearTimeout, JSON, Promise,
  });
  vm.runInContext(read('appbridge.js'), ab, { filename: 'appbridge.js' });
  pageListener({ source: win, origin: 'https://gst.vjdesai.com', data: { __gstkPushGstr3b: pushInfo } });
  await new Promise((r) => setTimeout(r, 30));
  const res = posted.find((p) => p.__gstkPushGstr3bResult);
  const v = res && res.__gstkPushGstr3bResult;
  ok(v && v.ok === false && v.status === 'failed' && /not pulled from the portal/.test(v.error), 'the page\'s push message comes back failed with the gate\'s reason');
  ok(v && v.recorded === false && v.clientId === 'c1' && v.period_month === '09/2026', 'named for its return and not recorded');
  ok(calls.every((c) => !c.url.includes('gstr3b_push_versions')), 'no Push History row for a push the gate stopped');
  ok(tabsCreated.length === 0, 'and no portal tab');
}

// ── The Push History row carries the gate ──────────────────────────────────
reset();
{
  const recorded = await bgCall('recordGstr3bPush', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', status: 'filled', summary: 'ok', filled: 3, skipped: [], portalFilled: [], payload: {}, gate: { ok: true, checked_at: 'T' } });
  const rows = calls.filter((c) => c.url.startsWith(DB + '/rest/v1/gstr3b_push_versions'));
  ok(recorded && recorded.data === true && rows.length === 1 && rows[0].body[0].gate.ok === true, 'the Push History row keeps the gate it passed');
}
reset();
versionsRefuseGate = true;
{
  const recorded = await bgCall('recordGstr3bPush', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', status: 'filled', summary: 'ok', filled: 3, skipped: [], portalFilled: [], payload: {}, gate: { ok: true } });
  const rows = calls.filter((c) => c.url.startsWith(DB + '/rest/v1/gstr3b_push_versions'));
  ok(recorded && recorded.data === true && rows.length === 2 && !('gate' in rows[1].body[0]), 'a database without the gate column takes the row without it');
}

// ── The pull: who asked rides on the job and reaches reco_record_pull ──────
reset();
{
  const r = await bgCall('startLedgerPull', { clientId: 'c1', period_month: '09/2026', actorId: 'u-9' });
  ok(r && r.ok && storage.gstk_active_job && storage.gstk_active_job.actorId === 'u-9' && storage.gstk_active_job.mode === 'ledgers', 'the ledger pull job keeps who asked');
  await bgCall('recordRecoPull', { reco: 'receivable', clientId: 'c1', period: '09/2026', actorId: 'u-9',
    opening: { igst: 1, cgst: 2, sgst: 3 }, utilised: { igst: 0, cgst: 0, sgst: 0 }, drc: { igst: 0, cgst: 4, sgst: 4 } });
  const p = rpcCalls('reco_record_pull')[0];
  ok(p && p.body.p_actor_id === 'u-9' && p.body.p_reco === 'receivable' && p.body.p_client_id === 'c1' && p.body.p_period === '09/2026',
    'recordRecoPull sends who, which reco, client and period');
  ok(p && p.body.p_opening.cgst === 2 && p.body.p_utilised.cgst === 0 && p.body.p_drc.cgst === 4 && p.body.p_ext_version === '0.16.0',
    'with the figures and the extension version');
  ok(calls.every((c) => !/rest\/v1\/(suspended_reco|gst_receivable_reco)/.test(c.url)), 'no direct write to the reco tables');
}

// ── content.js: both ledgers saved through the pull door, with the actor ───
const content = read('content.js');
ok(!/upsertReco/.test(content) && !/upsertReco/.test(read('background.js')) && !/upsertReco/.test(read('db.js')), 'the direct reco write (upsertReco) is gone');
ok((content.match(/GSTKdb\.recordRecoPull\(\{\s*reco: '(receivable|suspended)', clientId: cur\.clientId, period: job\.period, actorId: job\.actorId \|\| null,/g) || []).length === 2,
  'handleLedger and handleReversal both save through recordRecoPull with the job\'s actor');
ok(/gate: \(job\.gstr3b && job\.gstr3b\.gate\) \|\| null/.test(content), 'finishGstr3b passes the gate to the Push History row');

// classifyLedgerRows, cut from content.js as test 07 does.
const sig = '\n  function classifyLedgerRows(';
const i = content.indexOf(sig);
const fnSrc = content.slice(i + 1, content.indexOf('\n  }\n', i) + 4);
const cx = vm.createContext({});
vm.runInContext(fnSrc + '\nthis.classifyLedgerRows = classifyLedgerRows;', cx);
const credit = { isDebit: false, text: 'ITC accrued through - Inputs Credit', igst: 0, cgst: 500, sgst: 500 };
const setoff = { isDebit: true, text: 'Debit Other than reverse charge', igst: 10, cgst: 200, sgst: 200 };
const drc = { isDebit: true, text: 'DRC-03 Debit', igst: 0, cgst: 7, sgst: 7 };
const rcm = { isDebit: true, text: 'Debit reverse charge', igst: 0, cgst: 99, sgst: 99 };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(eq(cx.classifyLedgerRows([credit]).utilised, { igst: 0, cgst: 0, sgst: 0 }), 'rows read with no set-off debit: ITC utilised is 0');
ok(cx.classifyLedgerRows([]).utilised === null, 'no ledger row read: ITC utilised is not saved');
const c3 = cx.classifyLedgerRows([credit, setoff, drc, rcm]);
ok(eq(c3.utilised, { igst: 10, cgst: 200, sgst: 200 }) && eq(c3.drc, { igst: 0, cgst: 7, sgst: 7 }), 'the set-off debit is ITC utilised; other debits but reverse charge are DRC-03');

console.log(fail ? `\n${fail} check(s) FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
