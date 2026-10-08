// Simulation of a Notices Sync All run (extension 0.5.0) without the GST portal.
//
// The real background.js, db.js and content.js run in Node VM contexts with a
// stubbed chrome.* API. Portal calls (services/return/payment.gst.gov.in) are
// answered by the fake portal below, which counts every document download;
// Supabase calls go to a LOCAL PostgREST in front of a local PostgreSQL that
// carries the notices migrations (see supabase/tests/notices/run.sh). Never
// point this at the live project.
//
//   node extension/test/notices-sync.sim.mjs <postgrest-url> <anon-jwt-file>
//
// Scenarios: a first run, an unchanged second run (downloads skipped, closed
// cases' folders skipped), a third run with one notice gone, one new and a new
// reply in an open case, a run on the wrong GSTIN, and the watchdog.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, '..');
const PGRST = process.argv[2] || 'http://127.0.0.1:54399';
const JWT = fs.readFileSync(process.argv[3] || '/tmp/claude-0/pgrst/anon.jwt', 'utf8').trim();
const SIM_SUPABASE = 'https://sim.supabase.local';

let failures = 0;
function check(cond, label, detail) {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  FAIL ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}

// ── Supabase (local PostgREST) ─────────────────────────────────────────────
const rest = async (p, opts = {}) => {
  const r = await fetch(PGRST + '/' + p, {
    ...opts,
    headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
};

// ── Fake portal ────────────────────────────────────────────────────────────
const GSTIN = '24SIMUL0000S1Z5';
const portal = {
  gstin: GSTIN,
  notices: [],
  tasks: [],
  folders: {},      // caseId -> [{caseFolderId, caseFolderTypeCd}]
  folderItems: {},  // caseFolderId -> [{refId, itemJson}]
  refunds: [],
  drc03: [],
  applications: {}, // caseTypeCd -> case/search rows (0.6.0)
  gstr3a: {},       // order id -> summary data
  downloads: 0,     // every document fetched from the portal
  folderCalls: 0,   // case/folder calls
  refundFolderCalls: 0, // case/folder calls for refund cases (0.7.1)
};
const pdfBytes = () => new TextEncoder().encode('%PDF-1.4 ' + 'x'.repeat(400));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

async function portalFetch(url, init) {
  const u = new URL(url);
  const body = init && init.body ? JSON.parse(init.body) : {};
  if (u.pathname === '/services/auth/profile/detail') return json({ gstin: portal.gstin, lgnm: 'Sim Client', sts: 'Active', rgdt: '01/07/2017' });
  if (u.pathname === '/returns/auth/api/gstr3a/summary') {
    const d = portal.gstr3a[u.searchParams.get('order_id')];
    return d ? json({ data: d }) : json({ status: 0, error: 'not found' });
  }
  if (u.pathname === '/services/auth/api/get/notices') return json(portal.notices);
  if (u.pathname === '/litserv/auth/api/case/task/get') return json(portal.tasks);
  if (u.pathname === '/litserv/auth/api/case/folder') {
    if (body.caseTypeCd === 'RFUND') portal.refundFolderCalls++;
    else portal.folderCalls++;
    return json(portal.folders[body.caseId] || []);
  }
  if (u.pathname === '/litserv/auth/api/case/folder/items') return json(portal.folderItems[body.caseFolderId] || []);
  if (u.pathname.startsWith('/document/')) { portal.downloads++; return new Response(pdfBytes(), { status: 200 }); }
  // The real endpoint answers { <docId>: <eh token> } for each id in docIdList.
  if (/getEncrypDocIds/.test(u.pathname)) return json(Object.fromEntries((body.docIdList || []).map((id) => [id, 'eh-' + id])));
  if (u.pathname === '/downloadhb/download/new') { portal.downloads++; return new Response(pdfBytes(), { status: 200 }); }
  if (u.pathname === '/litserv/auth/api/case/search') {
    if (body.caseTypeCd === 'RFUND') return json(portal.refunds);
    if (body.caseTypeCd === 'ADJVP') return json(portal.drc03);
    if (['APPEL', 'ADJRO', 'ADJAT', 'ADJWS', 'COMPD', 'ADJPA'].includes(body.caseTypeCd)) return json(portal.applications[body.caseTypeCd] || []);
  }
  return new Response('not simulated: ' + u.pathname, { status: 404 });
}

async function simFetch(url, init = {}) {
  const s = String(url);
  if (s.startsWith(SIM_SUPABASE + '/rest/v1/')) {
    return fetch(PGRST + '/' + s.slice((SIM_SUPABASE + '/rest/v1/').length), init);
  }
  if (s.startsWith(SIM_SUPABASE + '/storage/v1/')) return new Response('{}', { status: 200 });
  if (/^https:\/\/(services|return|payment)\.gst\.gov\.in\//.test(s)) return portalFetch(s, init);
  throw new Error('unexpected fetch ' + s);
}

// ── chrome.* stub shared by both contexts ──────────────────────────────────
const storage = {};
const notifications = [];
let bgListener = null;
let alarmListener = null;
const navigations = [];
const chromeStub = {
  storage: {
    local: {
      get: async (k) => {
        if (k == null) return { ...storage };
        const keys = Array.isArray(k) ? k : [k];
        const out = {};
        for (const key of keys) if (key in storage) out[key] = JSON.parse(JSON.stringify(storage[key]));
        return out;
      },
      set: async (o) => { for (const [k, v] of Object.entries(o)) storage[k] = JSON.parse(JSON.stringify(v)); },
      remove: async (k) => { for (const key of (Array.isArray(k) ? k : [k])) delete storage[key]; },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: {
    getManifest: () => JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')),
    sendMessage: (msg, cb) => {
      bgListener(msg, { tab: { id: 1 } }, (resp) => cb && cb(resp));
    },
    onMessage: { addListener: (fn) => { bgListener = fn; } },
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener: (fn) => { alarmListener = fn; } } },
  notifications: { create: (id, o) => { notifications.push({ id, ...o }); }, clear() {}, onClicked: { addListener() {} } },
  tabs: { create: async () => ({ id: 1 }), update: async (id, o) => { if (o && o.url) navigations.push(o.url); return { id: 1, windowId: 1 }; } },
  windows: { update: async () => ({}) },
  declarativeNetRequest: { updateDynamicRules: async () => {}, getDynamicRules: async () => [] },
};

// Timers run 100x faster (a 45 s portal timeout becomes 450 ms).
const fastTimers = {
  setTimeout: (fn, ms, ...a) => setTimeout(fn, Math.max(0, Math.round((ms || 0) / 100)), ...a),
  setInterval: (fn, ms, ...a) => setInterval(fn, Math.max(5, Math.round((ms || 0) / 100)), ...a),
  clearTimeout, clearInterval,
};

// ── Background context ─────────────────────────────────────────────────────
const bg = vm.createContext({
  chrome: chromeStub, fetch: simFetch, console, atob, btoa, URL, Response, AbortController, TextEncoder,
  ...fastTimers, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set,
});
bg.globalThis = bg;
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: SIM_SUPABASE, SUPABASE_ANON_KEY: JWT }; };
vm.runInContext(fs.readFileSync(path.join(extDir, 'background.js'), 'utf8'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve, reject) => bgListener({ gstk: true, fn, args }, {}, (r) => (r && r.error ? reject(new Error(r.error)) : resolve(r && r.data))));

// ── One "page load" of the content script ──────────────────────────────────
function makeDocument() {
  const byId = {};
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, querySelector: () => null, set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {} },
  };
}
const debugLog = [];
async function runPage(href) {
  let current = href;
  const loc = {
    get href() { return current; },
    set href(v) { current = v; navigations.push(v); },
    get hostname() { return new URL(current).hostname; },
    get pathname() { return new URL(current).pathname; },
    reload() { navigations.push(current); },
  };
  const ctx = vm.createContext({
    chrome: chromeStub, fetch: simFetch, console, atob, btoa, URL, Response, AbortController, TextEncoder,
    ...fastTimers, location: loc, document: makeDocument(), Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set,
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.jspdf = { jsPDF: class { constructor() { this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }; }
    setFont() {} setFontSize() {} text() {} splitTextToSize(t) { return [t]; } addPage() {} output() { return 'data:application/pdf;base64,JVBERi0xLjQK'; } } };
  vm.runInContext(fs.readFileSync(path.join(extDir, 'db.js'), 'utf8'), ctx, { filename: 'db.js' });
  const done = vm.runInContext(fs.readFileSync(path.join(extDir, 'content.js'), 'utf8'), ctx, { filename: 'content.js' });
  await done;
  const panel = ctx.document.getElementById('gstk-debug');
  if (panel && panel.textContent) debugLog.push(panel.textContent);
  return current;
}

// Drive one client's notices_bundle (notices -> refunds -> refund documents ->
// DRC-03 -> applications -> profile) from a logged-in session, the way a real
// run continues after the CAPTCHA.
async function runBundle(clientId, runId) {
  storage.gstk_active_job = {
    mode: 'notices_bundle', idx: 0, step: 'notices', startedAt: Date.now(), lastActivityAt: Date.now(), runId, logSync: true, tabId: 1,
    clients: [{ clientId, creds: { user: 'sim', name: 'Sim Client', gstin: GSTIN, selectedReturns: [] } }],
  };
  let href = 'https://services.gst.gov.in/services/auth/notices';
  for (let i = 0; i < 12 && storage.gstk_active_job; i++) {
    const next = await runPage(href);
    if (next === href && storage.gstk_active_job && storage.gstk_active_job.step === 'notices') break;
    href = next;
    if (/services\/logout|services\/login/.test(href)) break;
  }
}

// One standalone section pull (e.g. the Refunds page's "fetch documents").
async function runMode(clientId, mode, step, startHref) {
  storage.gstk_active_job = {
    mode, idx: 0, step, startedAt: Date.now(), lastActivityAt: Date.now(), tabId: 1,
    clients: [{ clientId, creds: { user: 'sim', name: 'Sim Client', gstin: GSTIN, selectedReturns: [] } }],
  };
  let href = startHref;
  for (let i = 0; i < 6 && storage.gstk_active_job; i++) {
    href = await runPage(href);
    if (/services\/logout|services\/login/.test(href)) break;
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const itemJson = (o) => JSON.stringify(o);
function setPortalDay1() {
  portal.notices = [
    { noticeOrderId: 'ZD24SIM001', type: 'Notice', descr: 'Notice for liability mismatch (Form GST DRC-01B)', dtOfIssue: '01/10/2026', dueDate: '08/10/2026', docId: 'D1', applnId: 'A1' },
    { noticeOrderId: 'ZD24SIM002', type: 'Notice', descr: 'Show Cause Notice for Cancellation of Registration', dtOfIssue: '02/10/2026', dueDate: '12/10/2026', docId: 'D2', applnId: 'A2' },
    { noticeOrderId: 'ZD24SIM003', type: 'Order', descr: 'Registration Certificate', dtOfIssue: '01/06/2025', docId: 'D3', applnId: 'A3' },
  ];
  portal.tasks = [
    { refId: 'ZA24SIM010', caseTypeName: 'LETTER OF UNDERTAKING', taskDesc: 'Application for furnishing LUT having ARN AD24SIM10 is deemed approved as no action has been taken', assignmentDt: Date.UTC(2026, 3, 2), arn: 'AD24SIM10', caseId: 'C10', caseTpeCd: 'LUT' },
    { refId: 'ZA24SIM020', caseTypeName: 'DETERMINATION OF TAX', taskDesc: 'Show Cause Notice and Summary thereof in Form GST DRC-01', assignmentDt: Date.UTC(2026, 8, 20), arn: 'AD24SIM20', caseId: 'C20', caseTpeCd: 'DRC' },
    // Same refId as a get/notices row: links that notice to its case.
    { refId: 'ZD24SIM002', caseTypeName: 'REGISTRATION', taskDesc: 'Show Cause Notice for Cancellation of Registration', assignmentDt: Date.UTC(2026, 9, 2), arn: 'AD24SIM30', caseId: 'C30', caseTpeCd: 'REG' },
  ];
  portal.folders = {
    C10: [{ caseFolderId: 'F10O', caseFolderTypeCd: 'ORDRS' }],
    C20: [{ caseFolderId: 'F20N', caseFolderTypeCd: 'NOTCE' }],
    C30: [{ caseFolderId: 'F30N', caseFolderTypeCd: 'NOTCE' }],
  };
  portal.folderItems = {
    F10O: [{ refId: 'ZA24SIM010', itemJson: itemJson({ crn: 'AD24SIM10', docupdtl: [{ id: 'DOC10', docName: 'RFD-11A.pdf' }] }) }],
    F20N: [{ refId: 'ZD24SIM020N', itemJson: itemJson({ refdt: '20/09/2026', sdtls: { duedate: '20/10/2026' }, docupdtl: [{ id: 'DOC20', docName: 'DRC-01.pdf' }] }) }],
    F30N: [{ refId: 'ZD24SIM002', itemJson: itemJson({ refdt: '02/10/2026', docupdtl: [{ id: 'DOC30', docName: 'REG-17.pdf' }] }) }],
  };
  portal.refunds = [];
  portal.drc03 = [];
  portal.applications = {
    APPEL: [{ arn: 'AD24SIMAPL1', caseId: 'CAPL1', caseName: 'Appeal to Appellate Authority', caseTypeCd: 'APPEL',
              statusDesc: 'Submitted', caseCreationDate: '02/05/2026', caseJson: null }],
  };
}

// ── Scenarios ──────────────────────────────────────────────────────────────
const [client] = await rest('clients?select=id', {
  method: 'POST', headers: { Prefer: 'return=representation' },
  body: JSON.stringify([{ name: 'Sim Client', gstin: GSTIN, gst_user_id: 'sim', assigned_accountant: null }]),
});
const clientId = client.id;

console.log('Run 1 — first sync');
setPortalDay1();
let runId = await bgCall('runStart', 'notices_bundle', 1);
check(typeof runId === 'string', 'run started in the ledger');
await runBundle(clientId, runId);
const notices1 = await rest(`gst_notices?client_id=eq.${clientId}&select=portal_key,case_id,pdf_url,staff_status,close_reason,form_code,due_date,due_date_source`);
const byKey = Object.fromEntries(notices1.map((n) => [n.portal_key, n]));
check(notices1.length === 5, 'five notices saved (three listed, two case tasks; the duplicate task folded in)', notices1.map((n) => n.portal_key));
check(byKey.ZD24SIM002 && byKey.ZD24SIM002.case_id === 'AD24SIM30', 'the duplicate task linked its case to the listed notice (L-24)', byKey.ZD24SIM002);
check(byKey.ZD24SIM001 && byKey.ZD24SIM001.form_code === 'DRC-01B', 'classified on capture', byKey.ZD24SIM001);
check(byKey.ZA24SIM020 && byKey.ZA24SIM020.due_date_source === 'case_folder', 'the server-side sweep dated the case from its folder', byKey.ZA24SIM020);
check(byKey.ZA24SIM010 && byKey.ZA24SIM010.close_reason === 'auto:lut_approval', 'the approved LUT closed itself', byKey.ZA24SIM010);
check(byKey.ZD24SIM003 && byKey.ZD24SIM003.close_reason === 'auto:informational_order', 'the registration certificate closed itself', byKey.ZD24SIM003);
const downloads1 = portal.downloads;
check(downloads1 === 7, 'first run downloads every document (3 notices + LUT order + 3 folder attachments)', downloads1);
const items1 = await rest(`gst_case_folder_items?client_id=eq.${clientId}&select=case_id,portal_key,attachments`);
check(items1.length === 3, 'three folder items saved', items1.length);
const ledger1 = await rest(`sync_run_items?client_id=eq.${clientId}&select=step,status,rows_new,rows_seen&order=created_at`);
check(ledger1.some((i) => i.step === 'notices' && i.status === 'ok' && i.rows_new === 5), 'ledger: notices step with 5 new', ledger1);
check(ledger1.filter((i) => i.step === 'case_folder').length === 3, 'ledger: one row per case folder', ledger1);
check(ledger1.some((i) => i.step === 'refunds') && ledger1.some((i) => i.step === 'drc03'), 'ledger: refunds and DRC-03 steps recorded', ledger1);
const run1 = await rest(`sync_runs?id=eq.${runId}&select=status,clients_done`);
check(run1[0] && run1[0].status === 'done', 'run closed as done', run1);
const events1 = await rest(`notice_events?client_id=eq.${clientId}&select=event_type,actor_name`);
check(events1.filter((e) => e.event_type === 'captured').every((e) => e.actor_name === 'Portal sync'), 'captures attributed to the portal sync', events1);

console.log('Run 2 — nothing changed on the portal');
const folderCalls1 = portal.folderCalls;
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
check(portal.downloads === downloads1, 'no document downloaded again', portal.downloads - downloads1);
const folderCalls2 = portal.folderCalls - folderCalls1;
check(folderCalls2 === 2, 'only the two open cases re-read their folders (the closed LUT case waits for the weekly full pass)', folderCalls2);
const ledger2 = await rest(`sync_run_items?run_id=eq.${runId}&step=eq.notices&select=rows_new,rows_changed,rows_unchanged,rows_removed`);
check(ledger2[0] && ledger2[0].rows_new === 0 && ledger2[0].rows_changed === 0 && ledger2[0].rows_removed === 0, 'ledger: 0 new, 0 changed, 0 removed', ledger2);
const pdfs2 = await rest(`gst_notices?client_id=eq.${clientId}&pdf_url=not.is.null&select=portal_key`);
check(pdfs2.length >= 4, 'stored PDFs kept when the run skips them', pdfs2.length);

console.log('Run 3 — one notice gone, one new, a reply filed in an open case');
portal.notices = portal.notices.filter((n) => n.noticeOrderId !== 'ZD24SIM001');
portal.notices.push({ noticeOrderId: 'ZD24SIM004', type: 'Notice', descr: 'Notice to return defaulter u/s 46 for not filing return', dtOfIssue: '05/10/2026', dueDate: '20/10/2026', docId: 'D4', applnId: 'A4' });
portal.folders.C20.push({ caseFolderId: 'F20R', caseFolderTypeCd: 'REPLY' });
portal.folderItems.F20R = [{ refId: 'RP1', itemJson: itemJson({ reply: { ntcno: 'ZD24SIM020N' }, docupdtl: [{ id: 'DOC21', docName: 'Reply.pdf' }] }) }];
// The second run stored a full-pass timestamp; open cases are still read every run.
runId = await bgCall('runStart', 'notices_bundle', 1);
const downloads2 = portal.downloads;
await runBundle(clientId, runId);
check(portal.downloads - downloads2 === 2, 'only the new notice and the new reply attachment downloaded', portal.downloads - downloads2);
const ledger3 = await rest(`sync_run_items?run_id=eq.${runId}&step=eq.notices&select=rows_new,rows_removed`);
check(ledger3[0] && ledger3[0].rows_new === 1 && ledger3[0].rows_removed === 1, 'ledger: 1 new, 1 removed', ledger3);
const evs3 = await rest(`notice_events?client_id=eq.${clientId}&select=event_type&event_type=in.(removed,reply_filed,captured)`);
check(evs3.some((e) => e.event_type === 'reply_filed'), 'reply on the portal logged as an event', evs3);
check(evs3.some((e) => e.event_type === 'removed'), 'removal logged as an event', evs3);
const alerts = await rest('rpc/notice_alerts_run', { method: 'POST', body: JSON.stringify({ p_mode: 'events' }) });
check(alerts && alerts.alerts_mode === 'preview', 'alert engine ran in preview', alerts);

console.log('Run 4 — portal session belongs to another GSTIN');
portal.gstin = '24OTHER0000O1Z5';
const before4 = await rest(`gst_notices?client_id=eq.${clientId}&select=id`);
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
const after4 = await rest(`gst_notices?client_id=eq.${clientId}&select=id`);
check(before4.length === after4.length, 'nothing saved for the wrong GSTIN');
const ledger4 = await rest(`sync_run_items?run_id=eq.${runId}&select=step,status,reason_class`);
check(ledger4.some((i) => i.step === 'notices' && i.reason_class === 'session_mismatch'), 'ledger: session_mismatch recorded', ledger4);
portal.gstin = GSTIN;

console.log('Run 5 — the weekly full pass is due');
storage['gstk_folder_full_' + clientId] = Date.now() - 8 * 24 * 60 * 60 * 1000;
const folderCalls5 = portal.folderCalls;
const downloads5 = portal.downloads;
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
check(portal.folderCalls - folderCalls5 === 3, 'every case folder read, the closed LUT case included', portal.folderCalls - folderCalls5);
check(portal.downloads === downloads5, 'still nothing downloaded twice', portal.downloads - downloads5);
check(storage['gstk_folder_full_' + clientId] > Date.now() - 60 * 1000, 'full-pass time stamped for the next 7 days');

console.log('Run 6 — 0.6.0: applications, registration status, GSTR-3A kept and closed on filing');
portal.notices.push({ noticeOrderId: 'ZD24SIM006', type: 'Notice', descr: 'Notice to return defaulter u/s 46 for not filing return',
                      dtOfIssue: '20/05/2026', dueDate: '04/06/2026', pdfDownloadURL: 'gstr3a', appDefId: 'DEF6' });
portal.gstr3a.ZD24SIM006 = { retTyp: '3B', ret_period: '042026', orderId: 'ZD24SIM006', gstin: GSTIN, name: 'Sim Client', address: 'Somewhere' };
await rest('filing_status', { method: 'POST', body: JSON.stringify([{ client_id: clientId, return_type: 'GSTR-3B', period_month: '04/2026', status: 'Filed', filed_date: '2026-05-25' }]) });
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
const apps6 = await rest(`gst_portal_applications?client_id=eq.${clientId}&select=case_type_cd,arn,form_number,status,filed_date`);
check(apps6.length === 1 && apps6[0].arn === 'AD24SIMAPL1' && apps6[0].form_number === 'GST APL-01' && apps6[0].filed_date === '2026-05-02',
      'the appeal on the portal is saved', apps6);
const prof6 = await rest(`gst_taxpayer_profile?client_id=eq.${clientId}&select=gstin_status,legal_name`);
check(prof6[0] && prof6[0].gstin_status === 'Active', 'registration status read with the profile', prof6);
const n6 = await rest(`gst_notices?client_id=eq.${clientId}&portal_key=eq.ZD24SIM006&select=form_code,portal_detail,stage,close_reason,pdf_url`);
check(n6[0] && n6[0].portal_detail && n6[0].portal_detail.gstr3a && n6[0].portal_detail.gstr3a.ret_period === '042026',
      'the GSTR-3A return period is kept on the notice', n6);
check(n6[0] && n6[0].stage === 'closed' && n6[0].close_reason === 'auto:return_filed', 'and it closed itself: the return is filed', n6);
check(n6[0] && n6[0].pdf_url, 'its PDF is still rebuilt', n6);
const ledger6 = await rest(`sync_run_items?run_id=eq.${runId}&select=step,status&order=created_at`);
check(ledger6.some((i) => i.step === 'applications' && i.status === 'ok'), 'ledger: applications step recorded', ledger6);

console.log('Run 7 — 0.7.1: refunds and their documents in the notices sync');
const refundCase = (arn, caseId, statusDesc) => ({
  arn, caseId, statusDesc, caseCreationDate: '01/09/2026 10:15:00',
  appItem: { itemJson: JSON.stringify({ refundRsn: 'Export of services with payment of tax', ttlRfdAmt: 125000 }) },
});
portal.refunds = [refundCase('AA24SIMRF1', 'CR1', 'Refund Application filed'), refundCase('AA24SIMRF2', 'CR2', 'Refund disbursed successfully')];
portal.folders.CR1 = [{ caseFolderId: 'FR1A', caseFolderTypeCd: 'APLCN', caseFolderTypeName: 'APPLICATIONS' }];
portal.folders.CR2 = [{ caseFolderId: 'FR2A', caseFolderTypeCd: 'APLCN', caseFolderTypeName: 'APPLICATIONS' },
                      { caseFolderId: 'FR2O', caseFolderTypeCd: 'ORDRS', caseFolderTypeName: 'ORDERS' }];
portal.folderItems.FR1A = [{ refId: 'AA24SIMRF1', itemJson: itemJson({ crn: 'AA24SIMRF1', docupdtl: [{ id: 'RD1', docName: 'RFD-01.pdf' }] }) }];
portal.folderItems.FR2A = [{ refId: 'AA24SIMRF2', itemJson: itemJson({ crn: 'AA24SIMRF2', docupdtl: [{ id: 'RD2', docName: 'RFD-01.pdf' }] }) }];
portal.folderItems.FR2O = [{ refId: 'ZD24SIMRO2', itemJson: itemJson({ crn: 'AA24SIMRF2', docupdtl: [{ id: 'RD3', docName: 'RFD-06.pdf' }, { id: 'RD4', docName: 'PMT-03.pdf' }] }) }];
let downloads7 = portal.downloads;
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
check(portal.downloads - downloads7 === 4, 'every refund document downloaded once (4)', portal.downloads - downloads7);
const rf7 = await rest(`gst_refund_applications?client_id=eq.${clientId}&select=arn,status,documents&order=arn`);
check(rf7.length === 2 && rf7[0].documents.length === 1 && rf7[1].documents.length === 3, 'documents saved per refund (1 and 3)', rf7.map((r) => [r.arn, r.documents.length]));
check(rf7[1].documents.some((d) => d.tab === 'ORDERS' && d.label === 'RFD-06.pdf'), 'each document carries its folder and name', rf7[1].documents);
const fi7 = await rest(`gst_case_folder_items?client_id=eq.${clientId}&case_id=in.(AA24SIMRF1,AA24SIMRF2)&select=case_id,portal_key,attachments&order=portal_key`);
check(fi7.length === 3, 'the Refund Notice Folder items are saved (the pull time was undefined before 0.7.1)', fi7);
const ledger7 = await rest(`sync_run_items?run_id=eq.${runId}&select=step,status,reason_class&order=created_at`);
check(!ledger7.some((i) => i.step === 'refund_docs' && i.status === 'failed'), 'ledger: no refund document failure', ledger7);
check(ledger7.some((i) => i.step === 'drc03') && ledger7.some((i) => i.step === 'applications'), 'the bundle goes on to DRC-03 and applications', ledger7);

console.log('Run 8 — refunds unchanged');
const rfCalls8 = portal.refundFolderCalls;
const downloads8 = portal.downloads;
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
check(portal.refundFolderCalls === rfCalls8, 'no refund folder opened: both read in full, status unchanged', portal.refundFolderCalls - rfCalls8);
check(portal.downloads === downloads8, 'nothing downloaded', portal.downloads - downloads8);

console.log('Run 9 — a deficiency memo on one refund');
portal.refunds[0].statusDesc = 'Deficiency Memo Issued in GST RFD-03';
portal.folders.CR1.push({ caseFolderId: 'FR1N', caseFolderTypeCd: 'NOTAC', caseFolderTypeName: 'NOTICE/ ACKNOWLEDGEMENT' });
portal.folderItems.FR1N = [{ refId: 'ZD24SIMDM1', itemJson: itemJson({ crn: 'AA24SIMRF1', docupdtl: [{ id: 'RD5', docName: 'RFD-03.pdf' }] }) }];
const rfCalls9 = portal.refundFolderCalls;
const downloads9 = portal.downloads;
runId = await bgCall('runStart', 'notices_bundle', 1);
await runBundle(clientId, runId);
check(portal.refundFolderCalls - rfCalls9 === 1, 'only the refund whose status changed is opened', portal.refundFolderCalls - rfCalls9);
check(portal.downloads - downloads9 === 1, 'only the deficiency memo is downloaded', portal.downloads - downloads9);
const rf9 = await rest(`gst_refund_applications?client_id=eq.${clientId}&arn=eq.AA24SIMRF1&select=status,documents`);
check(rf9[0] && rf9[0].status === 'Deficiency Memo Issued in GST RFD-03' && rf9[0].documents.length === 2, 'the refund shows its new status and both documents', rf9);

console.log('Run 10 — the Refunds page fetches documents for every refund');
const rfCalls10 = portal.refundFolderCalls;
const downloads10 = portal.downloads;
await runMode(clientId, 'refund_docs', 'refund_docs', 'https://services.gst.gov.in/litserv/auth/case/search');
check(portal.refundFolderCalls - rfCalls10 === 2, 'every refund opened', portal.refundFolderCalls - rfCalls10);
check(portal.downloads === downloads10, 'no stored document downloaded again', portal.downloads - downloads10);
const rf10 = await rest(`gst_refund_applications?client_id=eq.${clientId}&select=arn,documents&order=arn`);
check(rf10[0].documents.length === 2 && rf10[1].documents.length === 3, 'the stored documents are kept in the list', rf10.map((r) => [r.arn, r.documents.length]));
check(!storage.gstk_active_job, 'the standalone pull ends', storage.gstk_active_job);

console.log('Watchdog — an agent job (0.6.0)');
runId = await bgCall('runStart', 'notices_bundle', 1);
storage.gstk_active_job = {
  mode: 'notices_bundle', idx: 0, step: 'login', startedAt: Date.now(), lastActivityAt: Date.now() - 30 * 60 * 1000, runId, logSync: true, tabId: 1,
  agent: { jobId: 'job-1' }, clients: [{ clientId, creds: { user: 'sim', name: 'Sim Client', gstin: GSTIN } }],
};
await new Promise((resolve) => { alarmListener({ name: 'gstk-watchdog' }); setTimeout(resolve, 300); });
check(storage.gstk_active_job && storage.gstk_active_job.step === 'login', 'the CAPTCHA wait of an agent job is left to the agent');
storage.gstk_active_job.step = 'refunds';
await new Promise((resolve) => { alarmListener({ name: 'gstk-watchdog' }); setTimeout(resolve, 300); });
const ledgerA = await rest(`sync_run_items?run_id=eq.${runId}&select=step,status,reason_class`);
check(!storage.gstk_active_job && ledgerA.some((i) => i.step === 'refunds' && i.reason_class === 'stalled'), 'a stuck agent step is recorded and dropped', ledgerA);
const runA = await rest(`sync_runs?id=eq.${runId}&select=status`);
check(runA[0] && runA[0].status === 'running', 'the agent job\'s run is left to the queue', runA);
const started = await bgCall('startAgentJob', { clientId, mode: 'notices_bundle', runId, jobId: 'job-2' });
check(started && started.started && storage.gstk_active_job && storage.gstk_active_job.agent && storage.gstk_active_job.agent.jobId === 'job-2',
      'startAgentJob queues one client in its own tab', storage.gstk_active_job);
const state = await bgCall('agentJobState');
check(state && state.step === 'login' && state.jobId === 'job-2', 'agentJobState reports the step', state);
await bgCall('agentClearJob');
check(!storage.gstk_active_job, 'agentClearJob drops it');

console.log('Watchdog — a CAPTCHA nobody typed');
runId = await bgCall('runStart', 'notices_bundle', 2);
storage.gstk_active_job = {
  mode: 'notices_bundle', idx: 0, step: 'login', startedAt: Date.now(), lastActivityAt: Date.now() - 11 * 60 * 1000, runId, logSync: true, tabId: 1,
  clients: [
    { clientId, creds: { user: 'sim', name: 'Sim Client', gstin: GSTIN } },
    { clientId, creds: { user: 'sim', name: 'Sim Client (2)', gstin: GSTIN } },
  ],
};
await new Promise((resolve) => { alarmListener({ name: 'gstk-watchdog' }); setTimeout(resolve, 400); });
const ledgerW = await rest(`sync_run_items?run_id=eq.${runId}&select=step,status,reason_class`);
check(ledgerW.some((i) => i.step === 'login' && i.reason_class === 'captcha_timeout'), 'ledger: CAPTCHA timeout recorded', ledgerW);
check(storage.gstk_active_job && storage.gstk_active_job.idx === 1 && storage.gstk_active_job.step === 'logout', 'run moved on to the next client', storage.gstk_active_job);
check(navigations.includes('https://services.gst.gov.in/services/logout'), 'sync tab sent to the next client');
check(notifications.some((n) => /made no progress/.test(n.message || '')), 'desktop notice that the client was skipped', notifications.map((n) => n.title));

if (process.env.SIM_DEBUG) console.log(debugLog.join('\n---\n'));
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
