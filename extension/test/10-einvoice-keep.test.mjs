// 0.8.7: e-invoices are kept, not re-sent. The page sends the books documents
// already on the portal as e-invoices with the same figures
// (einvoice.keep: [{ section, ctin, doc_type, doc_no }]); the extension leaves
// exactly those out of the copy it uploads, so the portal keeps its own record
// with the Source, IRN and IRN date (GSTN advisory para 6: an uploaded copy
// overwrites it and loses them). Same harness as 08 / 09: the REAL
// background.js, content.js and appbridge.js in Node VM contexts, a stubbed
// chrome.* API and a fake database that records each call.
//   - b2b, cdnr (a CRN and a DBN with one number: only the one named goes),
//     cdnur, exp and b2cl are left out on the exact identity (section, buyer
//     GSTIN, type, number upper-cased with spaces collapsed); a group or a
//     section left empty goes; every other section is untouched
//   - a number that only matches once separators are stripped is never left
//     out; keep entries that name no document are counted, the push goes on
//   - no irn, irngendate or srctyp is ever added, and einvoice_docs is not read
//   - the result carries einvoiceKept / einvoiceKeepUnmatched (no irnAttached)
//   - the UPLOAD version row carries einvoice_kept and ext_version, its payload
//     is still the stored books JSON, and a database without those columns
//     gets the row without them
//   - a plan made on another version of the return (basisUpdatedAt is not
//     the stored gstr1_data.updated_at) is refused before the Upload History
//     snapshot is cleared and before a portal tab opens; the same instant
//     written another way goes ahead
//   - the e-invoice pull refuses a JSON for another GSTIN or period and saves
//     nothing; a file the portal generated before today (returns_<ddmmyyyy>_
//     in its name) is recorded 'stale' and nothing is saved or marked; a name
//     with no date is taken as today's, with a warning; generated_on is kept
//   - an ok / none pull upserts on the new key with gone_at null and
//     last_seen_at = now, then marks (never deletes) the period's rows it did
//     not see, by identity and id, in chunks; einvoice_pulls.pulled_at is the
//     same now
//   - before its first einvoice_docs write the pull records itself as
//     'running' ('Pull in progress', pulled_at = now), and its final status
//     replaces that at the end: every document write and mark happens while
//     the row says running; a failure part-way (the upsert, the read or the
//     mark) leaves the row 'failed', never 'running'; if 'running' cannot be
//     written nothing is saved; a wrong or stale file writes no 'running'
//   - the save, the result and the job clear are one step of the job slot
//     (finishEinvoicePull): a tab closed after it hears nothing more, a tab
//     closed before it means nothing is saved; either way, one result
//   - content.js reads the file's name from the ZIP and the whole pull runs
//     end to end; a closed tab or an idle pull gives the page a failed
//     result naming its return
//   node test/10-einvoice-keep.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';
const MANIFEST_VERSION = JSON.parse(read('manifest.json')).version;
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── The stored books JSON (gstr1_data.raw_json) ────────────────────────────
const itm = (txval) => [{ num: 1, itm_det: { rt: 18, txval, camt: txval * 0.09, samt: txval * 0.09 } }];
const BOOKS = {
  gstin: '24AAAAA0000A1Z5', fp: '092026', version: 'GST3.2.4', hash: 'hash',
  b2b: [
    { ctin: '24bbbbb1111b1z1', inv: [ // the books carry a lower-case GSTIN
      { inum: 'INV/001', idt: '01-09-2026', val: 118, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(100) },
      { inum: 'INV/002', idt: '02-09-2026', val: 118, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(100) },
    ] },
    { ctin: '24CCCCC2222C1Z2', inv: [
      { inum: ' INV  /  003 ', idt: '03-09-2026', val: 236, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(200) },
    ] },
  ],
  cdnr: [{ ctin: '24BBBBB1111B1Z1', nt: [
    { nt_num: '1', ntty: 'C', nt_dt: '05-09-2026', val: 11.8, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(10) },
    { nt_num: '1', ntty: 'D', nt_dt: '06-09-2026', val: 23.6, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(20) },
  ] }],
  cdnur: [
    { typ: 'EXPWOP', nt_num: 'ECN-1', ntty: 'C', nt_dt: '08-09-2026', val: 50, itms: [{ rt: 0, txval: 50 }] },
    { typ: 'B2CL', nt_num: 'CN-9', ntty: 'C', nt_dt: '09-09-2026', pos: '27', val: 300000, itms: [{ rt: 18, txval: 254237.29, iamt: 45762.71 }] },
  ],
  exp: [
    { exp_typ: 'WOPAY', inv: [{ inum: 'EXP/9', idt: '07-09-2026', val: 500, itms: [{ rt: 0, txval: 500 }] }] },
    { exp_typ: 'WPAY', inv: [
      { inum: 'EXP/10', idt: '07-09-2026', val: 118, itms: [{ rt: 18, txval: 100, iamt: 18 }] },
      { inum: 'EXP/11', idt: '07-09-2026', val: 118, itms: [{ rt: 18, txval: 100, iamt: 18 }] },
    ] },
  ],
  b2cl: [{ pos: '27', inv: [{ inum: 'BL-1', idt: '10-09-2026', val: 300000, itms: [{ num: 1, itm_det: { rt: 18, txval: 254237.29, iamt: 45762.71 } }] }] }],
  b2cs: [{ sply_ty: 'INTRA', pos: '24', typ: 'OE', rt: 18, txval: 1000, camt: 90, samt: 90 }],
  nil: { inv: [{ sply_ty: 'INTRAB2B', expt_amt: 0, nil_amt: 10, ngsup_amt: 0 }] },
  hsn: { hsn_b2b: [{ num: 1, hsn_sc: '9965', uqc: 'NA', qty: 0, rt: 18, txval: 5000, iamt: 0, camt: 450, samt: 450, csamt: 0 }] },
  doc_issue: { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: 'INV/001', to: 'INV/050', totnum: 50, cancel: 0, net_issue: 50 }] }] },
};
const PLAN_AT = '2026-10-10T07:00:00.000Z';
const KEEP = [
  { section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_no: 'INV/001' },
  { section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_no: 'INV/001' }, // the same document twice
  { section: 'b2b', ctin: '24CCCCC2222C1Z2', doc_type: 'INV', doc_no: 'inv / 003' }, // case and spaces only
  { section: 'cdnr', ctin: '24BBBBB1111B1Z1', doc_type: 'CRN', doc_no: '1' },
  { section: 'cdnur', ctin: '', doc_type: 'CRN', doc_no: 'ECN-1' },
  { section: 'exp', ctin: '', doc_type: 'INV', doc_no: 'EXP/9' },
  { section: 'b2cl', ctin: '', doc_type: 'INV', doc_no: 'BL-1' },
  { section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_no: 'INV-002' }, // normalised match only: never left out
  { section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_no: 'NOPE-1' }, // no such document
];

// ── The fake database ─────────────────────────────────────────────────────
const calls = [];
let rawJson = clone(BOOKS);
const STORED_UPDATED_AT = '2026-10-10T06:59:58.123456+00:00'; // gstr1_data.updated_at as PostgREST gives it
let storedUpdatedAt = STORED_UPDATED_AT;
let oldVersionsSchema = false; // gstr1_upload_versions without einvoice_kept / ext_version
let oldEinvSchema = false; // einvoice_docs without the 0.8.7 unique key
let oldPullsSchema = false; // einvoice_pulls without generated_on
// einvoice_pulls as the database holds it, merged on (client, period, source).
let pullsDb = [];
let pullsDown = false; // every einvoice_pulls write fails (a dropped connection)
let failDocsGet = false; // the period's rows cannot be read (marking fails)
let failDocsPatch = false; // the gone marks cannot be written
// The pull row's status at each einvoice_docs write or mark, as a push
// reading the records at that moment would see it.
let pullStatusAtDocWrite = [];
const pullKey = (r) => [r.client_id, r.period_month, r.source].join('|');
const storedPull = (clientId = 'c1', period = '09/2026', source = 'portal_gstr1') =>
  pullsDb.find((r) => pullKey(r) === [clientId, period, source].join('|')) || null;
let rowCap = 1000; // the server's max rows per GET
// einvoice_docs as the database holds it: an upsert merges on the identity
// (client, period, section, ctin, doc_type, doc_key, source), a PATCH by id
// sets what it names, and a DELETE would remove rows (none is expected).
let einvDb = [];
let nextId = 1;
const idKey = (r) => [r.client_id, r.period_month, r.section, r.ctin, r.doc_type, r.doc_key, r.source].join('|');
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, headers: init.headers || {}, body });
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c2') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c2', name: 'NO GSTIN', gstin: null, gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr1_data?client_id=eq.c1') && method === 'GET') {
    const row = { id: 'r1', raw_json: rawJson };
    if (/select=[^&]*updated_at/.test(u)) row.updated_at = storedUpdatedAt;
    return new Response(JSON.stringify([row]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr1_data?id=eq.') && method === 'GET') {
    return new Response(JSON.stringify([{ client_id: 'c1', period_month: 'Sep-26', raw_json: rawJson }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/gstr1_data') && method === 'PATCH') return new Response(null, { status: 204 });
  if (u.startsWith(DB + '/rest/v1/gstr1_upload_versions') && method === 'POST') {
    if (oldVersionsSchema && body && body[0] && ('einvoice_kept' in body[0] || 'ext_version' in body[0])) {
      const col = 'einvoice_kept' in body[0] ? 'einvoice_kept' : 'ext_version';
      return new Response(JSON.stringify({ code: 'PGRST204', message: `Could not find the '${col}' column of 'gstr1_upload_versions' in the schema cache` }), { status: 400 });
    }
    return new Response(null, { status: 201 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_docs') && method === 'POST') {
    pullStatusAtDocWrite.push(storedPull() && storedPull().status);
    if (oldEinvSchema) return new Response(JSON.stringify({ code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }), { status: 400 });
    for (const r of body) {
      const hit = einvDb.find((x) => idKey(x) === idKey(r));
      if (hit) Object.assign(hit, r); else einvDb.push({ id: 'n' + (nextId++), ...r });
    }
    return new Response(null, { status: 201 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_docs?') && method === 'GET') {
    if (failDocsGet) return new Response('upstream timeout', { status: 504 });
    const q = new URL(u).searchParams;
    const want = (k) => (q.get(k) || '').replace(/^eq\./, '');
    const rows = einvDb.filter((r) => r.client_id === want('client_id') && r.period_month === want('period_month') && r.source === want('source'))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const offset = Number(q.get('offset') || 0);
    const limit = Math.min(Number(q.get('limit') || rowCap), rowCap);
    const cols = (q.get('select') || '').split(',');
    return new Response(JSON.stringify(rows.slice(offset, offset + limit).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_docs?') && method === 'PATCH') {
    pullStatusAtDocWrite.push(storedPull() && storedPull().status);
    if (failDocsPatch) return new Response('upstream timeout', { status: 504 });
    const q = new URL(u).searchParams;
    const ids = ((q.get('id') || '').match(/^in\.\((.*)\)$/) || [, ''])[1].split(',').filter(Boolean);
    const src = (q.get('source') || '').replace(/^eq\./, '');
    einvDb.filter((r) => ids.includes(r.id) && (!src || r.source === src)).forEach((r) => Object.assign(r, body));
    return new Response(null, { status: 204 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_docs') && method === 'DELETE') return new Response(JSON.stringify([]), { status: 200 });
  if (u.startsWith(DB + '/rest/v1/einvoice_pulls?') && method === 'GET') {
    const q = new URL(u).searchParams;
    const want = (k) => (q.get(k) || '').replace(/^eq\./, '');
    return new Response(JSON.stringify(pullsDb.filter((r) => r.client_id === want('client_id') && r.period_month === want('period_month') && (r.source || 'portal_gstr1') === want('source'))), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_pulls') && method === 'POST') {
    if (pullsDown) return new Response('upstream timeout', { status: 504 });
    if (oldPullsSchema && body && body[0] && 'generated_on' in body[0]) {
      return new Response(JSON.stringify({ code: 'PGRST204', message: 'Could not find the \'generated_on\' column of \'einvoice_pulls\' in the schema cache' }), { status: 400 });
    }
    for (const r of body) {
      const hit = pullsDb.find((x) => pullKey(x) === pullKey(r));
      if (hit) Object.assign(hit, r); else pullsDb.push({ ...r });
    }
    return new Response(null, { status: 201 });
  }
  throw new Error('fake database has no route for ' + method + ' ' + u);
}
const posts = (table) => calls.filter((c) => c.method === 'POST' && c.url.startsWith(DB + '/rest/v1/' + table));
const dels = (table) => calls.filter((c) => c.method === 'DELETE' && c.url.startsWith(DB + '/rest/v1/' + table));
const gets = (table) => calls.filter((c) => c.method === 'GET' && c.url.startsWith(DB + '/rest/v1/' + table));
// The pull's own reads of the period's pulled rows (0.8.9 also reads the Excel's, once).
const portalGets = () => gets('einvoice_docs').filter((c) => new URL(c.url).searchParams.get('source') === 'eq.portal_gstr1');
const patches = (table) => calls.filter((c) => c.method === 'PATCH' && c.url.startsWith(DB + '/rest/v1/' + table));

// ── chrome.* shared by the background worker and every page ─────────────────
const storage = {};
let bgListener = null;
let tabRemoved = null;
let tabsCreated = 0;
const local = {
  get: async (k) => {
    if (k == null) return clone(storage);
    const out = {};
    for (const key of (Array.isArray(k) ? k : [k])) if (key in storage) out[key] = clone(storage[key]);
    return out;
  },
  // 0.9.0: a write is heard by chrome.storage.onChanged listeners, as in Chrome.
  set: async (o) => {
    const changes = {};
    for (const [k, v] of Object.entries(o)) { storage[k] = clone(v); changes[k] = { newValue: clone(v) }; }
    for (const fn of [...storageListeners]) fn(changes, 'local');
  },
  remove: async (k) => { for (const key of (Array.isArray(k) ? k : [k])) delete storage[key]; },
};
const storageListeners = new Set();
const chromeFor = (tabId, onChanged) => ({
  storage: { local, onChanged: onChanged || { addListener: (fn) => storageListeners.add(fn), removeListener: (fn) => storageListeners.delete(fn) } },
  runtime: {
    getManifest: () => JSON.parse(read('manifest.json')),
    sendMessage: (msg, cb) => { bgListener(msg, { tab: { id: tabId } }, (resp) => cb && cb(resp)); },
    onMessage: { addListener: (fn) => { bgListener = fn; } },
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  notifications: { create() {}, onClicked: { addListener() {} } },
  tabs: { create: async () => { tabsCreated++; return { id: 1 }; }, update: async () => ({ id: 1, windowId: 1 }), onRemoved: { addListener: (fn) => { tabRemoved = fn; } } },
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
    querySelector: (s) => (opts.username && s === '#username' ? el() : s === 'input[type=file]' && opts.fileInput ? opts.fileInput : null),
    querySelectorAll: (s) => {
      if (s === 'table tr' && opts.rows) return opts.rows();
      if (s === 'input[type=file]' && opts.fileInput) return [opts.fileInput];
      if (s === 'button, a' && opts.buttons) return opts.buttons;
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
  // No GSTKdb.saveEinvoicePull: since 0.8.7 the pull's tab saves only through
  // the worker's finishEinvoicePull (chrome.runtime.sendMessage below).
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
      ...(opts.db || {}),
    },
    jspdf: {},
    ...(opts.globals || {}),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 50)); // fire-and-forget messages land
  return document;
}

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const reset = () => {
  calls.length = 0; for (const k of Object.keys(storage)) delete storage[k];
  rawJson = clone(BOOKS); oldVersionsSchema = false; oldEinvSchema = false; oldPullsSchema = false;
  storedUpdatedAt = STORED_UPDATED_AT; rowCap = 1000; einvDb = []; nextId = 1; tabsCreated = 0;
  pullsDb = []; pullsDown = false; failDocsGet = false; failDocsPatch = false; pullStatusAtDocWrite = [];
};
const hasIrnField = (j) => /"(irn|irngendate|srctyp)"/.test(JSON.stringify(j));
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', selectedReturns: [] } };
const LOGIN = 'https://services.gst.gov.in/services/login';
const UPLOAD_PAGE = 'https://return.gst.gov.in/returns/auth/gstr1/offlineupload';

// ── 1. The upload leaves out exactly the documents named ───────────────────
reset();
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT, basisUpdatedAt: STORED_UPDATED_AT } });
  ok(resp && resp.ok && resp.data.started, 'the upload job starts (the plan names the stored version of the return)');
  ok(gets('gstr1_data')[0] && /select=id,raw_json,updated_at&/.test(gets('gstr1_data')[0].url), 'the stored return is read with its updated_at');
  ok(resp.data.einvoiceKept === 6 && resp.data.einvoiceKeepUnmatched === 2, 'start answers 6 left out, 2 unmatched');
  const job = storage.gstk_active_job;
  const g = job.gstr1;
  const j = g.json;
  ok(g.einvoiceKept === 6 && g.einvoiceKeepUnmatched === 2 && g.einvoicePlanAt === PLAN_AT, 'the job carries einvoiceKept 6, einvoiceKeepUnmatched 2 and planAt');
  ok(!('irnAttached' in g), 'the job no longer carries irnAttached');
  // b2b: INV/001 gone from the first buyer, whose INV/002 stays; the second
  // buyer's only invoice ('INV  /  003', kept as 'inv / 003') gone with its group.
  ok(j.b2b.length === 1 && j.b2b[0].ctin === '24bbbbb1111b1z1', 'b2b: the buyer left with no invoice is dropped, the other buyer stays as stored');
  ok(j.b2b[0].inv.length === 1 && j.b2b[0].inv[0].inum === 'INV/002', 'b2b: INV/001 left out; INV/002 goes up (INV-002 never matches it)');
  ok(JSON.stringify(j.b2b[0].inv[0]) === JSON.stringify(BOOKS.b2b[0].inv[1]), 'b2b: the document that goes up is unchanged');
  // cdnr: CRN 1 and DBN 1 to one buyer; only the CRN was named.
  ok(j.cdnr.length === 1 && j.cdnr[0].nt.length === 1 && j.cdnr[0].nt[0].ntty === 'D' && j.cdnr[0].nt[0].nt_num === '1',
    'cdnr: the credit note 1 is left out, the debit note 1 goes up');
  ok(j.cdnur.length === 1 && j.cdnur[0].nt_num === 'CN-9', 'cdnur: ECN-1 left out, CN-9 goes up');
  ok(j.exp.length === 1 && j.exp[0].exp_typ === 'WPAY' && j.exp[0].inv.length === 2, 'exp: the WOPAY group left empty is dropped, WPAY untouched');
  ok(!('b2cl' in j), 'b2cl: the section left empty is dropped');
  for (const s of ['gstin', 'fp', 'version', 'hash', 'b2cs', 'nil', 'hsn', 'doc_issue']) {
    ok(JSON.stringify(j[s]) === JSON.stringify(BOOKS[s]), s + ': untouched (Table 12 and Table 13 always go in full)');
  }
  ok(!hasIrnField(j), 'no irn, irngendate or srctyp is added');
  ok(JSON.stringify(rawJson) === JSON.stringify(BOOKS), 'the stored books JSON itself is not changed');
  ok(gets('einvoice_docs').length === 0, 'einvoice_docs is not read for a push');
}

// ── 2. Everything in a section left out: the section goes, others are as stored
reset();
{
  const keep = [
    { section: 'b2b', ctin: '24bbbbb1111b1z1', doc_type: 'INV', doc_no: 'INV/001' },
    { section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'inv', doc_no: 'inv/002' },
    { section: 'b2b', ctin: '24CCCCC2222C1Z2', doc_type: 'INV', doc_no: 'INV / 003' },
  ];
  await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', einvoice: { keep, planAt: PLAN_AT } });
  const g = storage.gstk_active_job.gstr1;
  ok(g.einvoiceKept === 3 && g.einvoiceKeepUnmatched === 0, 'all three B2B invoices left out, none unmatched');
  ok(!('b2b' in g.json), 'b2b: the section left with no buyer is dropped');
  for (const s of Object.keys(BOOKS).filter((k) => k !== 'b2b')) {
    ok(JSON.stringify(g.json[s]) === JSON.stringify(BOOKS[s]), s + ': not touched when nothing in it was named');
  }
}

// ── 3. A DBN named, not the CRN; and a keep entry for another section type ──
reset();
{
  const keep = [
    { section: 'cdnr', ctin: '24BBBBB1111B1Z1', doc_type: 'DBN', doc_no: '1' },
    { section: 'cdnr', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_no: '1' }, // a note is never an INV
    { section: 'exp', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_no: 'EXP/10' }, // exp has no buyer GSTIN
  ];
  await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', einvoice: { keep, planAt: PLAN_AT } });
  const g = storage.gstk_active_job.gstr1;
  ok(g.einvoiceKept === 1 && g.einvoiceKeepUnmatched === 2, 'only the debit note matches; two unmatched entries are counted');
  ok(g.json.cdnr[0].nt.length === 1 && g.json.cdnr[0].nt[0].ntty === 'C', 'cdnr: the credit note with the same number still goes up');
  ok(JSON.stringify(g.json.exp) === JSON.stringify(BOOKS.exp), 'exp: an entry with a buyer GSTIN names no export');
}

// ── 4. Nothing matched / no plan (an older page) ───────────────────────────
reset();
{
  await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', einvoice: { keep: [{ section: 'b2b', ctin: 'X', doc_type: 'INV', doc_no: 'Y' }], planAt: PLAN_AT } });
  const g = storage.gstk_active_job.gstr1;
  ok(g.einvoiceKept === 0 && g.einvoiceKeepUnmatched === 1, 'a plan that matches nothing: 0 left out, 1 unmatched, the push still starts');
  ok(JSON.stringify(g.json) === JSON.stringify(BOOKS), 'and the JSON goes up exactly as stored');
}
reset();
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026' });
  const g = storage.gstk_active_job.gstr1;
  ok(resp.ok && g.einvoiceKept === null && g.einvoiceKeepUnmatched === 0, 'no plan sent: nothing left out (einvoiceKept null in the job)');
  ok(JSON.stringify(g.json) === JSON.stringify(BOOKS) && !hasIrnField(g.json), 'no plan sent: the stored JSON as it is, with no IRN field');
  ok(gets('einvoice_docs').length === 0, 'no plan sent: einvoice_docs is not read either');
}
reset();
{
  await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', nil: true, einvoice: { keep: KEEP, planAt: PLAN_AT } });
  const g = storage.gstk_active_job.gstr1;
  ok(g.nil === true && g.json === null && g.einvoiceKept === null, 'a NIL push ignores an e-invoice plan');
}

// ── 4b. The plan must rest on the stored version of the return (E14) ─────────
// The return was saved again after the plan (a colleague's edit): refused
// before the Upload History snapshot is cleared and before any tab opens.
reset();
storage.gstk_gstr1_pretop_r1 = { key: 'old', at: now };
storedUpdatedAt = '2026-10-10T07:00:03.000001+00:00';
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT, basisUpdatedAt: STORED_UPDATED_AT } });
  ok(resp && !resp.ok && resp.error === 'This return changed after the e-invoice plan was made. Reload it and click Upload again.',
    'basis changed: the push is refused with words that say to reload and upload again');
  ok(!!storage.gstk_gstr1_pretop_r1, 'basis changed: refused before the Upload History snapshot is cleared');
  ok(tabsCreated === 0 && !storage.gstk_active_job, 'basis changed: no portal tab is opened and no job is set');
  ok(calls.every((c) => c.method === 'GET'), 'basis changed: nothing is written');
}
// The same instant written another way (PostgREST's +00:00 vs the page's
// +05:30): the push goes ahead.
reset();
storage.gstk_gstr1_pretop_r1 = { key: 'old', at: now };
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT, basisUpdatedAt: '2026-10-10T12:29:58.123456+05:30' } });
  ok(resp && resp.ok && resp.data.started && resp.data.einvoiceKept === 6, 'basis the same instant: the push starts and leaves out the 6 documents');
  ok(!storage.gstk_gstr1_pretop_r1 && tabsCreated === 1 && storage.gstk_active_job && storage.gstk_active_job.mode === 'gstr1_upload',
    'basis the same instant: the old snapshot is cleared, the tab opens and the job is set');
}
// A basis that is not a time at all is never taken for a match.
reset();
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', einvoice: { keep: [], planAt: PLAN_AT, basisUpdatedAt: 'yesterday' } });
  ok(resp && !resp.ok && /changed after the e-invoice plan/.test(resp.error) && tabsCreated === 0, 'an unreadable basis is refused, even with nothing kept');
}
// No basis (an older page): no check, as before.
reset();
storedUpdatedAt = '2026-10-10T07:00:03.000001+00:00';
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', einvoice: { keep: KEEP, planAt: PLAN_AT } });
  ok(resp && resp.ok && resp.data.started, 'no basis sent: the push starts as before');
}

// ── 5. The upload's result and its version row ─────────────────────────────
const tr = (...cells) => ({ querySelector: (s) => (s === 'td' ? {} : null), querySelectorAll: (s) => (s === 'td' ? cells.map((t) => ({ textContent: t })) : []), offsetParent: {} });
const istCells = (ms) => {
  const d = new Date(ms + 330 * 60 * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return [p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(), p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds())];
};
const OLD = [...istCells(now - 3 * 86400000), 'AB0001', 'Processed', 'NA'];
const NEW = [...istCells(now - 30 * 1000), 'AB0002', 'Processed', 'NA'];
async function uploadOnce() {
  let rows = [tr(...OLD)];
  const fileInput = { accept: '.json', files: null, dispatchEvent(e) { if (e.type === 'change') rows = [tr(...NEW), tr(...OLD)]; } };
  const job = storage.gstk_active_job;
  job.step = 'gstr1_upload';
  job.tabId = 1;
  job.lastActivityAt = Date.now();
  storage.gstk_active_job = job;
  await runPage(UPLOAD_PAGE, { rows: () => rows, fileInput });
  return fileInput;
}
reset();
await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT } });
{
  const fileInput = await uploadOnce();
  await new Promise((r) => setTimeout(r, 30));
  const r = storage.gstk_gstr1_upload_result;
  ok(fileInput.files && fileInput.files.length === 1, 'the upload attached its file');
  ok(r && r.status === 'accepted' && r.einvoiceKept === 6 && r.einvoiceKeepUnmatched === 2, 'the result tells the page: 6 e-invoices left out, 2 keep entries unmatched');
  ok(r && !('irnAttached' in r), 'the result no longer carries irnAttached');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'the result names its return');
  const v = posts('gstr1_upload_versions');
  const row = v[0] && v[0].body[0];
  ok(v.length === 1 && row.action_type === 'UPLOAD' && row.status === 'accepted', 'one UPLOAD version row');
  ok(row && row.einvoice_kept === 6 && row.ext_version === MANIFEST_VERSION && MANIFEST_VERSION === '0.9.1', 'the UPLOAD row carries einvoice_kept 6 and ext_version 0.9.1 (the manifest)');
  ok(row && JSON.stringify(row.payload) === JSON.stringify(BOOKS), 'its payload is still the stored books JSON');
}

// A database without the two columns: the row goes in without them.
reset();
oldVersionsSchema = true;
await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT } });
{
  await uploadOnce();
  await new Promise((r) => setTimeout(r, 30));
  const v = posts('gstr1_upload_versions');
  ok(v.length === 2, 'old schema: the version row is tried, refused, and written again');
  const first = v[0].body[0], second = v[1].body[0];
  ok('einvoice_kept' in first && 'ext_version' in first, 'old schema: the first try carries both fields');
  ok(!('einvoice_kept' in second) && !('ext_version' in second), 'old schema: the retry carries neither');
  ok(second.action_type === 'UPLOAD' && second.status === 'accepted' && JSON.stringify(second.payload) === JSON.stringify(BOOKS),
    'old schema: the retried row is otherwise the same');
  ok(storage.gstk_gstr1_upload_result.status === 'accepted', 'old schema: the push is not failed over the columns');
}

// The background write directly: the action types and the no-plan case.
reset();
{
  await bgCall('saveGstr1UploadResult', { rowId: 'r1', status: 'accepted', summary: 's', errors: [], actorId: 'u-1' });
  let row = posts('gstr1_upload_versions').pop().body[0];
  ok(row.action_type === 'UPLOAD' && row.ext_version === MANIFEST_VERSION && !('einvoice_kept' in row), 'no plan: the UPLOAD row has ext_version, and no einvoice_kept');
  await bgCall('saveGstr1UploadResult', { rowId: 'r1', status: 'accepted', summary: 's', errors: [], actorId: 'u-1', einvoiceKept: 0 });
  row = posts('gstr1_upload_versions').pop().body[0];
  ok(row.einvoice_kept === 0, 'a plan with nothing left out records einvoice_kept 0');
  await bgCall('saveGstr1UploadResult', { rowId: 'r1', status: 'partial', summary: 's', errors: [], actorId: 'u-1', actionType: 'REFRESH_ERRORS', einvoiceKept: 4 });
  row = posts('gstr1_upload_versions').pop().body[0];
  ok(row.action_type === 'REFRESH_ERRORS' && !('einvoice_kept' in row) && !('ext_version' in row), 'a REFRESH_ERRORS row carries neither field');
}

// A failed upload and a closed tab still report the tally.
reset();
await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT } });
storage.gstk_active_job.step = 'gstr1_upload';
storage.gstk_active_job.tabId = 13;
storage.gstk_gstr1_pretop_r1 = { key: 'old', at: now };
tabRemoved(13);
await new Promise((r) => setTimeout(r, 30));
{
  const r = storage.gstk_gstr1_upload_result;
  const row = posts('gstr1_upload_versions')[0] && posts('gstr1_upload_versions')[0].body[0];
  ok(r && r.tabClosed === true && r.einvoiceKept === 6 && r.einvoiceKeepUnmatched === 2, 'upload tab closed after the attach: the result carries the tally');
  ok(row && row.status === 'failed' && row.einvoice_kept === 6 && row.ext_version === MANIFEST_VERSION, 'upload tab closed after the attach: the UPLOAD row carries both fields');
}

// ── 6. The e-invoice pull ──────────────────────────────────────────────────
const IRN = (c) => c.repeat(64);
const PORTAL = {
  gstin: '24AAAAA0000A1Z5', fp: '092026',
  b2b: [
    { ctin: '24bbbbb1111b1z1', inv: [
      { inum: 'INV/001', idt: '01-09-2026', val: 118, pos: '24', rchrg: 'N', inv_typ: 'R', irn: IRN('a'), irngendate: '01-09-2026', srctyp: 'E-Invoice', flag: 'U', itms: itm(100) },
      { inum: ' inv  /  003 ', idt: '03-09-2026', val: 236, pos: '24', rchrg: 'N', inv_typ: 'R', irn: IRN('b'), irngendate: '03-09-2026', srctyp: 'E-Invoice', flag: 'U', itms: itm(200) },
      { inum: 'MANUAL-7', idt: '04-09-2026', val: 118, pos: '24', rchrg: 'N', inv_typ: 'R', flag: 'U', itms: itm(100) }, // no IRN: not stored
    ] },
  ],
  cdnr: [{ ctin: '24BBBBB1111B1Z1', nt: [
    { nt_num: '1', ntty: 'C', nt_dt: '05-09-2026', val: 11.8, pos: '24', rchrg: 'N', inv_typ: 'R', irn: IRN('d'), irngendate: '05-09-2026', srctyp: 'E-Invoice', itms: itm(10) },
    { nt_num: '1', ntty: 'D', nt_dt: '06-09-2026', val: 23.6, pos: '24', rchrg: 'N', inv_typ: 'R', irn: IRN('e'), irngendate: '06-09-2026', srctyp: 'E-Invoice', itms: itm(20) },
  ] }],
  exp: [{ exp_typ: 'WOPAY', inv: [{ inum: 'EXP/9', idt: '07-09-2026', val: 500, irn: IRN('f'), irngendate: '07-09-2026', srctyp: 'E-Invoice', itms: [{ rt: 0, txval: 500 }] }] }],
};
const pullRow = () => { const p = posts('einvoice_pulls'); return p.length ? p[p.length - 1] : null; };
// The day the portal generated a file, as its ZIP entry names it
// (returns_<ddmmyyyy>_R1_<gstin>_offline...), in IST like the portal.
const istYmd = (ms) => new Date(ms + 330 * 60 * 1000).toISOString().slice(0, 10);
const TODAY = istYmd(Date.now());
const YESTERDAY = istYmd(Date.now() - 86400000);
const TOMORROW = istYmd(Date.now() + 86400000);
const dmy = (ymd) => ymd.slice(8, 10) + '-' + ymd.slice(5, 7) + '-' + ymd.slice(0, 4);
const fileFor = (ymd) => 'returns_' + ymd.slice(8, 10) + ymd.slice(5, 7) + ymd.slice(0, 4) + '_R1_24AAAAA0000A1Z5_offline_others_0.json';
const einvCalls = () => calls.filter((c) => c.url.includes('/einvoice_docs'));
const save = (extra) => bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', json: PORTAL, fileName: fileFor(TODAY), status: 'ok', ...extra })
  .then((r) => r.data);
// Rows a pull saved earlier for c1 / 09/2026.
const seed = (rows) => rows.forEach((r) => einvDb.push({
  client_id: 'c1', period_month: '09/2026', source: 'portal_gstr1', irn: IRN('z'), last_seen_at: '2026-10-09T05:00:00.000Z', gone_at: null, ...r,
}));

for (const [label, json, re, fileName = fileFor(TODAY)] of [
  ['another GSTIN', { ...PORTAL, gstin: '24ZZZZZ9999Z1Z9' }, /for GSTIN 24ZZZZZ9999Z1Z9, not this client's 24AAAAA0000A1Z5/],
  ['another period', { ...PORTAL, fp: '082026' }, /for period 082026, not 092026/],
  ['no GSTIN in the file', { ...PORTAL, gstin: undefined }, /for GSTIN \(none\)/],
  // the wrong client is the graver fault: it is what the pull says
  ['another GSTIN in an old file', { ...PORTAL, gstin: '24ZZZZZ9999Z1Z9' }, /for GSTIN 24ZZZZZ9999Z1Z9/, fileFor(YESTERDAY)],
]) {
  reset();
  const d = await save({ json, fileName });
  ok(d.status === 'failed' && re.test(d.message) && /Nothing was saved/.test(d.message) && d.docsFound === 0, 'pull of ' + label + ': failed, saying why');
  ok(einvCalls().length === 0, 'pull of ' + label + ': einvoice_docs untouched (nothing saved, read or marked)');
  const p = pullRow();
  ok(p && p.body[0].status === 'failed' && p.body[0].source === 'portal_gstr1' && /on_conflict=client_id,period_month,source$/.test(p.url),
    'pull of ' + label + ': the failed attempt is recorded in einvoice_pulls');
}
reset();
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c2', period_month: '09/2026', json: { ...PORTAL }, fileName: fileFor(TODAY) })).data;
  ok(d.status === 'failed' && /no GSTIN saved/.test(d.message) && posts('einvoice_docs').length === 0, 'a client with no GSTIN: nothing is saved');
}

// An ok pull: the new key, the exact number, both notes; rows not seen are
// marked gone by identity and id, never deleted (E6, E7, E11).
reset();
seed([
  { id: 'a-1', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/001', irn: IRN('a') }, // still on the draft
  { id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002', irn: IRN('c') }, // no longer on the draft
  { id: 'a-3', section: 'cdnr', ctin: '24BBBBB1111B1Z1', doc_type: 'DBN', doc_key: '1', irn: IRN('e'), gone_at: '2026-10-09T05:00:00.000Z' }, // gone before, back now
  // stamped by a PC whose clock ran ahead (later than this pull): still gone, as it is not in this pull
  { id: 'a-4', section: 'exp', ctin: '', doc_type: 'INV', doc_key: 'EXP/8', irn: IRN('g'), last_seen_at: '2099-01-01T00:00:00.000Z' },
]);
einvDb.push({ id: 'x-1', client_id: 'c1', period_month: '08/2026', source: 'portal_gstr1', section: 'b2b', ctin: 'X', doc_type: 'INV', doc_key: 'Q', irn: IRN('1'), gone_at: null });
einvDb.push({ id: 'x-2', client_id: 'c1', period_month: '09/2026', source: 'einvoice_excel', section: 'b2b', ctin: 'X', doc_type: 'INV', doc_key: 'Q', irn: IRN('2'), gone_at: null });
einvDb.push({ id: 'x-3', client_id: 'c9', period_month: '09/2026', source: 'portal_gstr1', section: 'b2b', ctin: 'X', doc_type: 'INV', doc_key: 'Q', irn: IRN('3'), gone_at: null });
{
  const d = await save();
  const up = posts('einvoice_docs');
  const rows = up.flatMap((c) => c.body);
  ok(up.length === 1 && /on_conflict=client_id,period_month,section,ctin,doc_type,doc_key,source$/.test(up[0].url), 'ok pull: upserted on (client, period, section, ctin, doc_type, doc_key, source)');
  ok(rows.length === 5 && d.docsFound === 5, 'ok pull: the 5 documents with an IRN are saved (the one without is not)');
  const notes = rows.filter((r) => r.section === 'cdnr');
  ok(notes.length === 2 && notes.some((r) => r.doc_type === 'CRN' && r.irn === IRN('d')) && notes.some((r) => r.doc_type === 'DBN' && r.irn === IRN('e')),
    'ok pull: the credit note and the debit note numbered 1 are two rows, each with its own IRN');
  const b3 = rows.find((r) => r.irn === IRN('b'));
  ok(b3 && b3.doc_key === 'INV / 003' && b3.doc_no === 'inv  /  003' && b3.ctin === '24BBBBB1111B1Z1', 'ok pull: doc_key is the exact number, upper case, spaces collapsed');
  ok(rows.every((r) => r.source === 'portal_gstr1' && r.client_id === 'c1' && r.period_month === '09/2026'), 'ok pull: every row is source portal_gstr1 for its client and period');
  const lastSeen = rows[0].last_seen_at;
  ok(rows.every((r) => r.last_seen_at === lastSeen && 'gone_at' in r && r.gone_at === null), 'ok pull: every row carries the pull time and gone_at null');
  ok(dels('einvoice_docs').length === 0, 'ok pull: nothing is deleted');
  const rd = portalGets();
  const q = rd[0] && new URL(rd[0].url).searchParams;
  ok(rd.length === 2 && q.get('client_id') === 'eq.c1' && q.get('period_month') === 'eq.09/2026' && q.get('source') === 'eq.portal_gstr1'
    && q.get('select') === 'id,section,ctin,doc_type,doc_key', 'ok pull: the period\'s portal_gstr1 rows are read by identity (one page, then an empty one)');
  const pt = patches('einvoice_docs');
  const pq = pt[0] && new URL(pt[0].url).searchParams;
  ok(pt.length === 1 && pq.get('id') === 'in.(a-2,a-4)' && pq.get('source') === 'eq.portal_gstr1' && JSON.stringify(pt[0].body) === JSON.stringify({ gone_at: lastSeen }),
    'ok pull: the two rows not seen (one stamped by a clock ahead of this one) are patched gone_at = the pull time, by id');
  ok(calls.indexOf(up[0]) < calls.indexOf(rd[0]) && calls.indexOf(rd[0]) < calls.indexOf(pt[0]), 'ok pull: upsert, then read, then mark');
  const byId = (id) => einvDb.find((r) => r.id === id);
  ok(byId('a-2') && byId('a-2').irn === IRN('c') && byId('a-2').gone_at === lastSeen && byId('a-4').gone_at === lastSeen,
    'ok pull: the rows gone keep their IRN, marked with the pull time');
  ok(byId('a-1').gone_at === null && byId('a-1').last_seen_at === lastSeen, 'ok pull: a row seen again carries the pull time, not gone');
  ok(byId('a-3').gone_at === null && byId('a-3').last_seen_at === lastSeen, 'ok pull: a row marked gone earlier and seen again is no longer gone');
  ok(['x-1', 'x-2', 'x-3'].every((id) => byId(id).gone_at === null), 'ok pull: another period, the Excel\'s records and another client are never marked');
  ok(d.status === 'ok' && d.goneMarked === 2 && d.staleRemoved === 2 && d.generatedOn === TODAY, 'ok pull: status ok, 2 marked gone (staleRemoved the same), generated today');
  ok(/2 e-invoice\(s\) saved by an earlier pull are no longer on the portal as e-invoices\./.test(d.message) && !/removed|Warning/.test(d.message),
    'ok pull: the message says the 2 are no longer on the portal as e-invoices');
  const p = pullRow();
  ok(p && p.body[0].status === 'ok' && p.body[0].docs_found === 5 && p.body[0].source === 'portal_gstr1' && /on_conflict=client_id,period_month,source$/.test(p.url),
    'ok pull: einvoice_pulls written with source portal_gstr1 on (client, period, source)');
  ok(p && p.body[0].pulled_at === lastSeen && p.body[0].generated_on === TODAY, 'ok pull: pulled_at is exactly the last_seen_at it stamped, and generated_on is today');
}

// Many rows gone under a server row cap: read page by page, marked in chunks.
reset();
rowCap = 70;
for (let k = 0; k < 250; k++) seed([{ id: 'g' + String(k).padStart(3, '0'), section: 'b2b', ctin: '24ZZZZZ9999Z1Z9', doc_type: 'INV', doc_key: 'OLD-' + k }]);
{
  const d = await save();
  const pt = patches('einvoice_docs');
  const ids = pt.flatMap((c) => new URL(c.url).searchParams.get('id').replace(/^in\.\(|\)$/g, '').split(','));
  ok(portalGets().length === 5, 'row cap 70: 255 rows read in 4 pages and an empty one');
  ok(pt.length === 3 && ids.length === 250 && new Set(ids).size === 250 && pt.every((c) => c.url.length < 4000), 'row cap 70: 250 rows marked in chunks of 100');
  ok(d.goneMarked === 250 && einvDb.filter((r) => r.id.startsWith('g')).every((r) => r.gone_at && r.gone_at === pullRow().body[0].pulled_at),
    'row cap 70: every one of them is marked, none missed');
  ok(einvDb.filter((r) => r.id.startsWith('n')).every((r) => r.gone_at === null), 'row cap 70: the 5 rows this pull saw are not marked');
}

// A pull with no IRN at all: status none, and every stored row for the period is marked gone.
reset();
seed([{ id: 'a-1', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/001' }, { id: 'a-2', section: 'exp', ctin: '', doc_type: 'INV', doc_key: 'EXP/9' }]);
{
  const d = await save({ json: { gstin: '24AAAAA0000A1Z5', fp: '092026', b2b: [{ ctin: 'X', inv: [{ inum: '1', val: 1 }] }] } });
  ok(d.status === 'none' && d.docsFound === 0 && posts('einvoice_docs').length === 0, 'none pull: nothing upserted');
  ok(d.goneMarked === 2 && einvDb.every((r) => r.gone_at === pullRow().body[0].pulled_at) && dels('einvoice_docs').length === 0,
    'none pull: the period\'s stored e-invoices are marked gone, not deleted');
  ok(/^The portal's GSTR-1 file for 09\/2026 \(generated \d\d-\d\d-\d{4}\) holds 1 document \(B2B 1\); none of them carries an IRN\./.test(d.message) && !/none is on the portal/.test(d.message),
    'none pull (0.8.9): the message gives the period, the file date, the documents per table and that none carries an IRN: ' + d.message);
}
// 0.8.9: the Excel imported for the month is compared with what the file holds.
reset();
seed([{ id: 'x-1', source: 'einvoice_excel', section: 'b2b', ctin: '24AIMPR8057L1ZJ', doc_type: 'INV', doc_key: 'TI/SGM/26-27/02' },
  { id: 'x-2', source: 'einvoice_excel', section: 'b2b', ctin: '24AIMPR8057L1ZJ', doc_type: 'INV', doc_key: 'TI/SGM/26-27/03' }]);
{
  const d = await save({ json: { gstin: '24AAAAA0000A1Z5', fp: '092026', b2b: [{ ctin: '24AIMPR8057L1ZJ', inv: [{ inum: 'TI/SGM/26-27/02', val: 1 }, { inum: 'TI/SGM/26-27/03', val: 1 }] }],
    cdnr: [{ ctin: '24AIMPR8057L1ZJ', nt: [{ nt_num: 'CN/1', val: 1 }] }] } });
  ok(d.status === 'none' && /holds 3 documents \(B2B 2, CDNR 1\); none of them carries an IRN\./.test(d.message)
    && /The month's e-invoice details list 2 e-invoices: 2 have no IRN in the GSTR-1 file \(an upload replaced them, or auto-population has not run yet\)\./.test(d.message),
    'Excel compared: 2 e-invoices in the Excel, neither on GSTR-1 with an IRN, said in numbers: ' + d.message);
  ok(einvDb.filter((r) => r.source === 'einvoice_excel').every((r) => !r.gone_at), 'Excel compared: the Excel\'s records are never marked gone by a pull');
}
reset();
seed([{ id: 'x-1', source: 'einvoice_excel', section: 'b2b', ctin: '24AIMPR8057L1ZJ', doc_type: 'INV', doc_key: 'TI/SGM/26-27/02' }]);
{
  const d = await save({ json: { gstin: '24AAAAA0000A1Z5', fp: '092026', b2b: [{ ctin: '24AIMPR8057L1ZJ', inv: [{ inum: 'TI/SGM/26-27/02', idt: '30-09-2026', val: 1, irn: 'abc', irngendate: '30-09-2026', srctyp: 'E-Invoice', itms: [] }] }] } });
  ok(d.status === 'ok' && /holds 1 document \(B2B 1\); 1 of them carries an IRN\. The month's e-invoice details list 1 e-invoice, in the GSTR-1 file with its IRN\./.test(d.message),
    'Excel compared: the one e-invoice is on GSTR-1 with its IRN: ' + d.message);
}

// ── 6b. The file must be today's (E2) ─────────────────────────────────────────
// Generated before today: 'stale', nothing saved or marked.
reset();
seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
{
  const d = await save({ fileName: fileFor(YESTERDAY) });
  ok(d.status === 'stale' && d.docsFound === 0 && d.goneMarked === 0 && d.generatedOn === YESTERDAY, 'old file: status stale, nothing found, nothing marked');
  ok(d.message.includes('generated on ' + dmy(YESTERDAY) + ', not today') && /Nothing was saved\./.test(d.message)
    && d.message.includes('Prepare Offline → Download → Generate JSON file to download') && /wait until the portal has generated it/.test(d.message)
    && /then pull e-invoices again\.$/.test(d.message), 'old file: the message gives the date and how to generate a fresh file');
  ok(einvCalls().length === 0, 'old file: einvoice_docs untouched (nothing saved, read or marked)');
  ok(einvDb[0].gone_at === null && einvDb[0].last_seen_at === '2026-10-09T05:00:00.000Z', 'old file: the stored rows are as they were');
  const p = pullRow().body[0];
  ok(p.status === 'stale' && p.docs_found === 0 && p.generated_on === YESTERDAY && p.message === d.message && !!p.pulled_at, 'old file: recorded in einvoice_pulls as stale, with its generation date');
}
// "Today" is the IST day: at 01:30 IST on 11 Oct (20:00 UTC on 10 Oct) a
// file generated on 10 Oct is old, and one generated on 11 Oct is today's.
{
  const FIXED = Date.parse('2026-10-10T20:00:00.000Z');
  class FixedDate extends Date {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  }
  bg.Date = FixedDate;
  try {
    reset();
    const old = await save({ fileName: 'returns_10102026_R1_24AAAAA0000A1Z5_offline_others_0.json' });
    reset();
    const fresh = await save({ fileName: 'returns_11102026_R1_24AAAAA0000A1Z5_offline_others_0.json' });
    ok(old.status === 'stale' && old.generatedOn === '2026-10-10', 'IST day: at 01:30 IST on 11 Oct, a file of 10 Oct is stale');
    ok(fresh.status === 'ok' && fresh.generatedOn === '2026-10-11' && pullRow().body[0].pulled_at === '2026-10-10T20:00:00.000Z', 'IST day: a file of 11 Oct is today\'s');
  } finally {
    bg.Date = Date;
  }
}
// Generated today, or a day ahead of this PC's clock: an ordinary pull.
for (const [label, ymd] of [['today', TODAY], ['tomorrow (this PC\'s clock behind)', TOMORROW]]) {
  reset();
  const d = await save({ fileName: fileFor(ymd) });
  ok(d.status === 'ok' && d.docsFound === 5 && d.generatedOn === ymd && posts('einvoice_docs').length === 1 && pullRow().body[0].generated_on === ymd,
    'file generated ' + label + ': ok, saved, generated_on ' + ymd);
}
// No date in the name, no name, an impossible date: today's behaviour with a warning.
for (const [label, fileName, shown] of [
  ['a name with no date', 'GSTR1_092026.json', 'GSTR1_092026.json'],
  ['no name at all', undefined, 'none'],
  ['an impossible date', 'returns_31022026_R1_24AAAAA0000A1Z5_offline_others_0.json', 'returns_31022026_R1_24AAAAA0000A1Z5_offline_others_0.json'],
]) {
  reset();
  const d = await save({ fileName });
  ok(d.status === 'ok' && d.docsFound === 5 && d.generatedOn === null && posts('einvoice_docs').length === 1, label + ': saved as an ordinary pull');
  ok(d.message.includes('Warning: the portal\'s file name (' + shown + ') carries no generation date') && d.message.includes('Prepare Offline → Download'),
    label + ': the message warns that the file\'s date could not be checked');
  ok(pullRow().body[0].status === 'ok' && pullRow().body[0].generated_on === null, label + ': recorded ok with generated_on null');
}

// The new key is not in the database yet: the pull fails and marks nothing.
reset();
oldEinvSchema = true;
{
  const d = await save();
  ok(d.status === 'failed' && /Could not save the e-invoice documents/.test(d.message) && patches('einvoice_docs').length === 0 && dels('einvoice_docs').length === 0,
    'old einvoice_docs key: failed, nothing marked or removed');
}
// einvoice_pulls without generated_on: the attempt is still recorded.
reset();
oldPullsSchema = true;
{
  const d = await save();
  const p = posts('einvoice_pulls');
  ok(d.status === 'ok' && p.length === 4 && 'generated_on' in p[0].body[0] && !('generated_on' in p[1].body[0]) && p[1].body[0].status === 'running'
    && 'generated_on' in p[2].body[0] && !('generated_on' in p[3].body[0]) && p[3].body[0].status === 'ok',
    'einvoice_pulls without generated_on: running and the final status are each refused, then written without it');
  ok(storedPull().status === 'ok' && !('generated_on' in storedPull()), 'einvoice_pulls without generated_on: the row ends ok');
}

// A pending or failed pull with no JSON never touches einvoice_docs.
reset();
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', status: 'pending', message: 'still generating' })).data;
  ok(d.status === 'pending' && einvCalls().length === 0, 'pending pull: einvoice_docs untouched');
  ok(pullRow().body[0].generated_on === null && !!pullRow().body[0].pulled_at, 'pending pull: recorded, with no generation date');
}

// ── 6c. 'running' while the pull saves (second review N1) ───────────────────
// An ok pull: 'running' first, every document write and mark under it, then ok.
reset();
seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
{
  const d = await save();
  const p = posts('einvoice_pulls');
  const first = p[0] && p[0].body[0];
  const lastSeen = posts('einvoice_docs')[0].body[0].last_seen_at;
  ok(p.length === 2 && first.status === 'running' && first.message === 'Pull in progress' && first.docs_found === 0
    && first.source === 'portal_gstr1' && first.client_id === 'c1' && first.period_month === '09/2026' && /on_conflict=client_id,period_month,source$/.test(p[0].url),
    'running: the pull row is written as running, "Pull in progress", on (client, period, source)');
  ok(first.pulled_at === lastSeen && p[1].body[0].pulled_at === lastSeen && first.pulled_by === 'u-1' && first.generated_on === TODAY,
    'running: pulled_at is the pull\'s own now, the same as the final row\'s and every last_seen_at');
  ok(calls.indexOf(p[0]) < calls.indexOf(posts('einvoice_docs')[0]) && calls.indexOf(p[1]) > calls.indexOf(patches('einvoice_docs')[0]),
    'running: written before the first document write; the final status after the last mark');
  ok(pullStatusAtDocWrite.length === 2 && pullStatusAtDocWrite.every((st) => st === 'running'),
    'running: every document write and mark happens while the stored row says running (a push reading then is refused)');
  ok(d.status === 'ok' && storedPull().status === 'ok' && storedPull().docs_found === 5 && storedPull().pulled_at === lastSeen,
    'running: the stored row ends ok, with 5 documents and the same pulled_at');
}
// A none pull (no IRN in the file) still marks rows, so it is running too.
reset();
seed([{ id: 'a-1', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/001' }]);
{
  const d = await save({ json: { gstin: '24AAAAA0000A1Z5', fp: '092026', b2b: [{ ctin: 'X', inv: [{ inum: '1', val: 1 }] }] } });
  const p = posts('einvoice_pulls');
  ok(d.status === 'none' && p.length === 2 && p[0].body[0].status === 'running' && pullStatusAtDocWrite.every((st) => st === 'running')
    && storedPull().status === 'none', 'none pull: running while it marks, then none');
}
// A file for another client or period, or a stale one: no document is
// written, so no 'running', only the final status.
for (const [label, extra, want] of [
  ['another GSTIN', { json: { ...PORTAL, gstin: '24ZZZZZ9999Z1Z9' } }, 'failed'],
  ['a stale file', { fileName: fileFor(YESTERDAY) }, 'stale'],
]) {
  reset();
  const d = await save(extra);
  const p = posts('einvoice_pulls');
  ok(d.status === want && p.length === 1 && p[0].body[0].status === want && storedPull().status === want && einvCalls().length === 0,
    label + ': no running row, only the final ' + want);
}
// A pending pull (no JSON): only its own status.
reset();
{
  await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', status: 'pending', message: 'still generating' });
  ok(posts('einvoice_pulls').length === 1 && storedPull().status === 'pending', 'pending pull (no JSON): no running row');
}
// A failure part-way leaves the row failed, never running.
for (const [label, setup, re] of [
  ['the document upsert fails', () => { oldEinvSchema = true; }, /UPSERT einvoice_docs -> 400/],
  ['the read of the period\'s rows fails', () => { failDocsGet = true; }, /GET einvoice_docs.* -> 504/],
  ['the gone marks fail', () => { failDocsPatch = true; }, /PATCH einvoice_docs.* -> 504/],
]) {
  reset();
  seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
  setup();
  const d = await save();
  const p = posts('einvoice_pulls');
  ok(d.status === 'failed' && re.test(d.message) && d.docsFound === 0 && d.goneMarked === 0, label + ': the pull is failed, saying why');
  ok(p.length === 2 && p[0].body[0].status === 'running' && p[1].body[0].status === 'failed' && p[1].body[0].docs_found === 0,
    label + ': running, then failed');
  ok(storedPull().status === 'failed' && storedPull().message === d.message, label + ': the stored row ends failed, not running');
}
// The same through the job slot (finishEinvoicePull): the page hears failed, the row says failed.
reset();
storage.gstk_active_job = { mode: 'einvoice_pull', idx: 0, step: 'einvoice_pull', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 35, clients: [client] };
failDocsPatch = true;
seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
{
  const resp = await bgCall('finishEinvoicePull', { clientId: 'c1', period_month: '09/2026', tabId: 35, actorId: 'u-1', json: PORTAL, fileName: fileFor(TODAY), status: 'ok' });
  const r = storage.gstk_einvoice_pull_result;
  ok(resp.data.status === 'failed' && r.ok === false && r.status === 'failed' && storedPull().status === 'failed' && !storage.gstk_active_job,
    'through the slot, a failure part-way: the page hears failed, the row says failed, the job is cleared');
}
// 'running' cannot be written: nothing is saved or marked, and the pull is failed.
reset();
seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
pullsDown = true;
{
  const d = await save();
  ok(d.status === 'failed' && /einvoice_pulls -> 504/.test(d.message) && d.docsFound === 0, 'running not written: the pull is failed, saying why');
  ok(einvCalls().length === 0 && einvDb[0].gone_at === null, 'running not written: no document saved, read or marked');
  ok(posts('einvoice_pulls').length === 4 && storedPull() === null, 'running not written: running and the final status each tried twice, none stored');
}

// ── 7. The save, the result and the job: one step of the job slot (E8) ───────
const pullJob = (extra) => ({ mode: 'einvoice_pull', idx: 0, step: 'einvoice_pull', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [client], ...extra });
const tick = () => new Promise((r) => setTimeout(r, 20));
const finishInfo = (tabId, extra) => ({ clientId: 'c1', period_month: '09/2026', tabId, actorId: 'u-1', json: PORTAL, fileName: fileFor(TODAY), status: 'ok', ...extra });

// The save first, the tab closed while it is in flight.
reset();
seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
storage.gstk_active_job = pullJob({ tabId: 31 });
{
  const inFlight = bgCall('finishEinvoicePull', finishInfo(31));
  tabRemoved(31);
  const resp = await inFlight;
  await tick();
  const r = storage.gstk_einvoice_pull_result;
  ok(resp.ok && resp.data.saved === true && resp.data.status === 'ok' && resp.data.goneMarked === 1, 'save first: the worker answers the save\'s outcome');
  ok(r && r.ok === true && r.status === 'ok' && r.docsFound === 5 && r.goneMarked === 1 && r.staleRemoved === 1 && r.generatedOn === TODAY && !('tabClosed' in r),
    'save first: the page hears the save\'s own outcome, not the closed tab');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026', 'save first: the result names its return');
  ok(posts('einvoice_docs').length === 1 && patches('einvoice_docs').length === 1 && pullRow().body[0].status === 'ok', 'save first: the documents, the marks and the pull are saved');
  ok(!storage.gstk_active_job, 'save first: the job is cleared');
}
// The tab closed first, the save's message still in flight.
reset();
seed([{ id: 'a-2', section: 'b2b', ctin: '24BBBBB1111B1Z1', doc_type: 'INV', doc_key: 'INV/002' }]);
storage.gstk_active_job = pullJob({ tabId: 32 });
{
  tabRemoved(32);
  const resp = await bgCall('finishEinvoicePull', finishInfo(32));
  await tick();
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.ok === false && r.status === 'failed' && r.tabClosed === true && /Nothing was saved; pull e-invoices again/.test(r.message) && r.goneMarked === 0,
    'tab closed first: the page hears the closed tab\'s failed result');
  ok(resp.ok && resp.data.saved === false && resp.data.status === 'failed' && /Nothing was saved/.test(resp.data.message), 'tab closed first: the worker saves nothing and says so');
  ok(calls.length === 0, 'tab closed first: nothing is written (no document saved or marked, no pull recorded), so "Nothing was saved" holds');
  ok(einvDb[0].gone_at === null, 'tab closed first: the stored rows are as they were');
  ok(!storage.gstk_active_job, 'tab closed first: the job is cleared');
}
// Another sync took the slot meanwhile: the pull is still saved and reported,
// and the other job is left alone.
reset();
storage.gstk_active_job = { mode: 'gstr1_upload', idx: 0, step: 'login', startedAt: now, period: '09/2026', tabId: 40, clients: [client] };
{
  const resp = await bgCall('finishEinvoicePull', finishInfo(33));
  ok(resp.data.saved === true && resp.data.status === 'ok' && storage.gstk_einvoice_pull_result.status === 'ok', 'another job in the slot: the pull is saved and reported');
  ok(storage.gstk_active_job && storage.gstk_active_job.mode === 'gstr1_upload' && storage.gstk_active_job.tabId === 40, 'another job in the slot: it is left alone');
}
// A stale file through the slot: reported stale, the job cleared, nothing saved.
reset();
storage.gstk_active_job = pullJob({ tabId: 34 });
{
  const resp = await bgCall('finishEinvoicePull', finishInfo(34, { fileName: fileFor(YESTERDAY) }));
  const r = storage.gstk_einvoice_pull_result;
  ok(resp.data.status === 'stale' && r.ok === false && r.status === 'stale' && r.generatedOn === YESTERDAY && /Generate JSON file to download/.test(r.message),
    'stale through the slot: the page hears status stale with the steps');
  ok(einvCalls().length === 0 && !storage.gstk_active_job, 'stale through the slot: nothing saved, the job cleared');
}

// ── 7b. The pull's page always hears a result naming its return ────────────
reset();
storage.gstk_active_job = pullJob({ tabId: 21 });
tabRemoved(21);
await tick();
{
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.ok === false && r.status === 'failed' && r.tabClosed === true && r.docsFound === 0, 'pull tab closed: a failed result marked tabClosed');
  ok(r && r.clientId === 'c1' && r.period_month === '09/2026' && /Nothing was saved; pull e-invoices again/.test(r.message), 'pull tab closed: it names its return and says to pull again');
  ok(calls.length === 0, 'pull tab closed: nothing is written to the database');
  ok(!storage.gstk_active_job, 'pull tab closed: the job is cleared');
}
reset();
storage.gstk_active_job = pullJob({ step: 'login', lastActivityAt: now - 11 * 60 * 1000 });
await runPage(LOGIN);
{
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.status === 'failed' && /e-invoice pull sat idle/.test(r.message) && r.clientId === 'c1' && r.period_month === '09/2026', 'idle pull: a failed result for its return');
  ok(einvCalls().length === 0, 'idle pull: no document saved or marked');
  ok(pullRow() && pullRow().body[0].status === 'failed', 'idle pull: the failed attempt is recorded');
  ok(!storage.gstk_active_job, 'idle pull: the job is cleared (by the worker)');
}
reset();
storage.gstk_active_job = pullJob({ retries: 2 });
await runPage(LOGIN);
{
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.status === 'failed' && /kept dropping/.test(r.message) && r.clientId === 'c1', 'pull session kept dropping: a failed result for its return');
  ok(!storage.gstk_active_job, 'pull session kept dropping: the job is cleared');
}

// ── 7c. content.js end to end: the portal's ZIP, its file name, the save ────
// A ZIP as the portal serves it: one JSON entry, deflated (method 8) or stored.
function zipOf(name, obj, method) {
  const nameB = Buffer.from(name, 'utf8');
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
  lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
  const local = Buffer.concat([lh, nameB, data]);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42);
  const central = Buffer.concat([cd, nameB]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]).toString('base64');
}
const RETURNS = 'https://return.gst.gov.in/returns/auth/dashboard';
async function runPortalPull(name, method, jobExtra) {
  const portalCalls = [];
  const filed = [];
  const globals = {
    fetch: async (u) => { portalCalls.push(String(u)); return new Response(JSON.stringify({ status: 1, data: { url: 'https://files.gst.gov.in/f.zip' } }), { status: 200 }); },
    TextDecoder, atob, Blob, Response, DecompressionStream,
  };
  const db = {
    fetchCrossOriginAsBase64: async () => ({ base64: zipOf(name, PORTAL, method) }),
    upsertFiledReturn: async (clientId, period, rt, patchObj) => { filed.push({ clientId, period, rt, patchObj }); return true; },
  };
  const doc = await runPage(RETURNS, { globals, db });
  return { doc, portalCalls, filed };
}
reset();
storage.gstk_active_job = pullJob();
{
  const { doc, portalCalls } = await runPortalPull(fileFor(TODAY), 8);
  const r = storage.gstk_einvoice_pull_result;
  ok(portalCalls.length === 1 && portalCalls[0].includes('offline/download/generate?flag=0&rtn_prd=092026&rtn_typ=GSTR1'), 'end to end: the portal\'s GSTR-1 JSON is requested for 092026');
  ok(r && r.ok === true && r.status === 'ok' && r.docsFound === 5 && r.generatedOn === TODAY && r.clientId === 'c1', 'end to end (deflated, today\'s file): ok, 5 found, generated today');
  ok(posts('einvoice_docs').length === 1 && pullRow().body[0].generated_on === TODAY, 'end to end: saved, with the file\'s date on the pull');
  ok(!storage.gstk_active_job && /You can close this tab/.test(doc.banner()), 'end to end: the worker cleared the job; the banner says the tab can close');
}
reset();
storage.gstk_active_job = pullJob();
{
  const { doc } = await runPortalPull(fileFor(YESTERDAY), 0);
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.ok === false && r.status === 'stale' && r.generatedOn === YESTERDAY && r.message.includes(dmy(YESTERDAY)), 'end to end (stored, yesterday\'s file): stale, naming its date');
  ok(einvCalls().length === 0 && pullRow().body[0].status === 'stale', 'end to end: an old file saves nothing and is recorded stale');
  ok(!storage.gstk_active_job && /Generate JSON file to download/.test(doc.banner()), 'end to end: the job is cleared; the banner gives the steps');
}
// The worker does not answer the save: the tab tells the page itself, while
// the job is still this pull's, and never touches another job.
{
  const real = bgListener;
  bgListener = (msg, sender, cb) => (msg && msg.fn === 'finishEinvoicePull' ? cb({ error: 'worker gone' }) : real(msg, sender, cb));
  try {
    reset();
    storage.gstk_active_job = pullJob();
    await runPortalPull(fileFor(TODAY), 8);
    const r = storage.gstk_einvoice_pull_result;
    ok(r && r.ok === false && r.status === 'failed' && /background worker did not answer/.test(r.message) && r.clientId === 'c1' && r.period_month === '09/2026',
      'worker silent: the tab reports a failed pull for its return');
    ok(!storage.gstk_active_job, 'worker silent: the tab clears its own job');
    reset();
    storage.gstk_active_job = pullJob();
    const other = { mode: 'gstr1_upload', idx: 0, step: 'login', startedAt: now, period: '09/2026', tabId: 40, clients: [client] };
    bgListener = (msg, sender, cb) => {
      if (msg && msg.fn === 'finishEinvoicePull') { storage.gstk_active_job = clone(other); return cb({ error: 'worker gone' }); }
      return real(msg, sender, cb);
    };
    await runPortalPull(fileFor(TODAY), 8);
    ok(!storage.gstk_einvoice_pull_result && storage.gstk_active_job && storage.gstk_active_job.tabId === 40,
      'worker silent, another job in the slot: the tab writes nothing and leaves that job alone');
  } finally {
    bgListener = real;
  }
}
// The filed GSTR-1 JSON pull reads the same ZIP through the same reader.
reset();
storage.gstk_active_job = { mode: 'gstr1_json_pull', idx: 0, step: 'gstr1_json_pull', startedAt: now, lastActivityAt: now, period: '09/2026', tabId: 1, clients: [client] };
{
  const { filed } = await runPortalPull(fileFor(TODAY), 8);
  const f = filed.find((x) => x.rt === 'GSTR1' && x.patchObj && x.patchObj.full_json);
  ok(f && JSON.stringify(f.patchObj.full_json) === JSON.stringify(PORTAL), 'filed GSTR-1 JSON pull: saves the JSON itself (not the { json, name } pair)');
}

// ── 8. appbridge passes the plan through and relays the results ────────────
{
  const posted = [];
  const sent = [];
  let changed = null;
  let onMsg = null;
  const win = {
    postMessage: (m) => posted.push(m),
    addEventListener: (t, fn) => { if (t === 'message') onMsg = fn; },
  };
  const ctx = vm.createContext({
    window: win, location: { origin: 'https://gst.vjdesai.com' }, setTimeout: () => 0, console,
    chrome: {
      runtime: { getManifest: () => ({ version: MANIFEST_VERSION }), sendMessage: (m, cb) => { sent.push(m); cb && cb({ ok: true, data: { started: true } }); }, lastError: null },
      storage: { local: { remove: async () => {} }, onChanged: { addListener: (fn) => { changed = fn; } } },
    },
  });
  vm.runInContext(read('appbridge.js'), ctx, { filename: 'appbridge.js' });
  const plan = { keep: KEEP.slice(0, 2), planAt: PLAN_AT, basisUpdatedAt: STORED_UPDATED_AT };
  onMsg({ source: win, origin: 'https://gst.vjdesai.com', data: { __gstkUploadGstr1: { clientId: 'c1', period_month: '09/2026', einvoice: plan } } });
  ok(sent[0] && sent[0].fn === 'startGstr1Upload' && JSON.stringify(sent[0].args[0].einvoice) === JSON.stringify(plan), 'appbridge: the e-invoice plan reaches startGstr1Upload as sent');
  changed({ gstk_einvoice_pull_result: { newValue: { ok: false, status: 'failed', docsFound: 0, message: 'm', tabClosed: true, clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const done = posted.find((m) => m.__gstkEinvoicePullDone);
  ok(done && done.__gstkEinvoicePullDone.tabClosed === true && done.__gstkEinvoicePullDone.clientId === 'c1' && done.__gstkEinvoicePullDone.period_month === '09/2026',
    'appbridge: the pull result carries tabClosed, clientId and period_month');
  changed({ gstk_einvoice_pull_result: { newValue: { ok: true, status: 'ok', docsFound: 5, goneMarked: 2, staleRemoved: 2, generatedOn: '2026-10-10', message: 'm', clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const done2 = posted.filter((m) => m.__gstkEinvoicePullDone).pop().__gstkEinvoicePullDone;
  ok(done2.goneMarked === 2 && done2.staleRemoved === 2 && done2.generatedOn === '2026-10-10' && !('tabClosed' in done2),
    'appbridge: an ok pull carries goneMarked (and staleRemoved, its alias), generatedOn and no tabClosed');
  changed({ gstk_einvoice_pull_result: { newValue: { ok: false, status: 'stale', docsFound: 0, goneMarked: 0, generatedOn: '2026-10-08', message: 'old file', clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const done3 = posted.filter((m) => m.__gstkEinvoicePullDone).pop().__gstkEinvoicePullDone;
  ok(done3.ok === false && done3.status === 'stale' && done3.generatedOn === '2026-10-08' && done3.message === 'old file', 'appbridge: a stale pull reaches the page as stale, with its date');
  changed({ gstk_einvoice_pull_result: { newValue: { ok: true, status: 'ok', docsFound: 5, staleRemoved: 3, message: 'm', clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const done4 = posted.filter((m) => m.__gstkEinvoicePullDone).pop().__gstkEinvoicePullDone;
  ok(done4.goneMarked === 3 && done4.staleRemoved === 3 && done4.generatedOn === null, 'appbridge: a result with only staleRemoved still gives goneMarked');
  changed({ gstk_gstr1_upload_result: { newValue: { ok: true, status: 'accepted', einvoiceKept: 6, einvoiceKeepUnmatched: 2, clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const up = posted.find((m) => m.__gstkUploadGstr1Result);
  ok(up && up.__gstkUploadGstr1Result.einvoiceKept === 6 && up.__gstkUploadGstr1Result.einvoiceKeepUnmatched === 2, 'appbridge: the upload result reaches the page with einvoiceKept');
}

// ── 0.8.8: the pull waits for the portal to build the file ──────────────────
// A period the portal never generated takes up to 20 minutes. The pull polls
// every 30 seconds for up to 22 minutes (0.8.7 gave up after ~90 seconds and
// recorded "pending"). The page's clock and timers are faked so the wait runs
// at once: every sleep moves the clock on by its length.
async function runWaitingPull(readyAfter) {
  const clock = { now: Date.now() };
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const portalCalls = [];
  const callAt = [];
  const globals = {
    Date: FakeDate,
    setTimeout: (f, ms, ...rest) => { clock.now += ms || 0; return setTimeout(f, 0, ...rest); },
    fetch: async (u) => {
      portalCalls.push(String(u)); callAt.push(clock.now);
      const ready = readyAfter != null && portalCalls.length > readyAfter;
      return new Response(JSON.stringify(ready ? { status: 1, data: { url: 'https://files.gst.gov.in/f.zip' } } : { status: 0 }), { status: 200 });
    },
    TextDecoder, atob, Blob, Response, DecompressionStream,
  };
  const db = {
    fetchCrossOriginAsBase64: async () => ({ base64: zipOf(fileFor(TODAY), PORTAL, 8) }),
    upsertFiledReturn: async () => true,
  };
  const doc = await runPage(RETURNS, { globals, db });
  // The wait itself: from the first request to the portal to the last.
  return { doc, portalCalls, waitedMs: callAt[callAt.length - 1] - callAt[0] };
}
reset();
storage.gstk_active_job = pullJob();
{
  const { portalCalls, waitedMs } = await runWaitingPull(8);
  const r = storage.gstk_einvoice_pull_result;
  ok(portalCalls.length === 9 && waitedMs === 8 * 30000, 'wait: the portal was asked 9 times, 30 seconds apart, until the file was ready (' + portalCalls.length + ' calls, ' + Math.round(waitedMs / 1000) + ' s)');
  ok(r && r.ok === true && r.status === 'ok' && r.docsFound === 5, 'wait: a file ready after 4 minutes is pulled and saved in the same run (no "pull again")');
  ok(posts('einvoice_docs').length === 1 && pullRow().body[0].status === 'ok', 'wait: recorded ok in einvoice_pulls');
}
reset();
storage.gstk_active_job = pullJob();
{
  const { doc, portalCalls, waitedMs } = await runWaitingPull(null);
  const r = storage.gstk_einvoice_pull_result;
  ok(waitedMs <= 22 * 60 * 1000 && waitedMs >= 21 * 60 * 1000 && portalCalls.length === 45,
    'wait: a file never ready is polled for up to 22 minutes, then given up (' + portalCalls.length + ' calls, ' + Math.round(waitedMs / 60000) + ' min)');
  ok(r && r.ok === false && r.status === 'pending' && /had not finished the GSTR-1 file after 22 minutes/.test(r.message) && /Nothing was saved/.test(r.message),
    'wait: given up, the pull is recorded pending with a message that says how long it waited');
  ok(einvCalls().length === 0 && pullRow().body[0].status === 'pending', 'wait: nothing saved, the pull row says pending');
  ok(!storage.gstk_active_job && /had not finished/.test(doc.banner()), 'wait: the job is cleared and the banner says so');
}

// ── 0.9.0: the pull opens the month's GSTR-1 and takes its e-invoice details ──
// Logged in, the pull goes to the returns dashboard (step einvoice_dash), not
// straight to the file.
reset();
storage.gstk_active_job = pullJob({ step: 'login' });
{
  const globals = { fetch: async (u) => new Response(JSON.stringify(/profile\/detail/.test(String(u)) ? { gstin: '24AAAAA0000A1Z5' } : {}), { status: 200 }) };
  await runPage('https://services.gst.gov.in/services/auth/fowelcome', { globals });
  ok(storage.gstk_active_job && storage.gstk_active_job.step === 'einvoice_dash', 'after login the pull opens the returns dashboard for the month (einvoice_dash)');
}
// On the month's GSTR-1 page: the portal's own button, the file it builds, the
// page's import, then the GSTR-1 file, all in one run.
const XLSX_URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBBQAAAAIAAAAIQ' + 'A'.repeat(400);
async function runExcelStep({ withButton = true, imported = true, blob = XLSX_URL } = {}) {
  const clock = { now: Date.now() };
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const winListeners = new Set();
  const clicked = [];
  const btn = { textContent: 'DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)', offsetParent: {}, disabled: false, getAttribute: () => null,
    click() { clicked.push('btn'); setTimeout(() => { for (const fn of [...winListeners]) fn({ data: { __gstkPdf: blob } }); }, 0); } };
  let importCalls = 0;
  const globals = {
    Date: FakeDate,
    // A thousand times faster, in the same order: the 60-second wait for the
    // file still outlasts the file's arrival.
    setTimeout: (f, ms, ...rest) => setTimeout(() => { clock.now += ms || 0; f(...rest); }, Math.ceil((ms || 0) / 1000)),
    addEventListener: (t, fn) => { if (t === 'message') winListeners.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'message') winListeners.delete(fn); },
    fetch: async (u) => new Response(JSON.stringify({ status: 1, data: { url: 'https://files.gst.gov.in/f.zip' } }), { status: 200 }),
    TextDecoder, atob, Blob, Response, DecompressionStream,
  };
  const db = {
    fetchCrossOriginAsBase64: async () => ({ base64: zipOf(fileFor(TODAY), PORTAL, 8) }),
    upsertFiledReturn: async () => true,
    // The month's Excel row: an earlier import (the baseline, read before the
    // press), then this file's import from the third read when `imported`.
    // Its pulled_at is the database's: deliberately far from the PC's clock.
    einvoiceExcelLatest: async () => {
      importCalls += 1;
      return imported && importCalls >= 3
        ? { status: 'ok', docs_found: 5, pulled_at: '2026-10-10T14:20:00.123+00:00', message: 'm' }
        : { status: 'ok', docs_found: 2, pulled_at: '2026-10-10T08:00:00+00:00', message: 'earlier' };
    },
  };
  const doc = await runPage('https://return.gst.gov.in/returns/auth/gstr1', { globals, db, buttons: withButton ? [btn] : [] });
  return { doc, clicked, importCalls };
}
reset();
storage.gstk_active_job = pullJob({ step: 'einvoice_excel' });
{
  const seen = [];
  const spy = (changes) => { if (changes.gstk_einvoice_excel_result) seen.push(changes.gstk_einvoice_excel_result.newValue); };
  storageListeners.add(spy);
  const { clicked, importCalls } = await runExcelStep();
  storageListeners.delete(spy);
  const r = storage.gstk_einvoice_pull_result;
  ok(clicked.length === 1, 'GSTR-1 page: the portal\'s "Download details from e-invoices (Excel)" is pressed once');
  ok(seen.length === 1 && seen[0].fileB64 === XLSX_URL && seen[0].clientId === 'c1' && seen[0].period_month === '09/2026' && seen[0].via === 'page',
    'GSTR-1 page: the file the portal built goes to GST Keeper for the job\'s client and month');
  ok(importCalls === 3, 'GSTR-1 page: the pull reads the month\'s Excel row before the press, then waits for it to change (database time only)');
  ok(r && r.status === 'ok' && /^Opened GSTR-1 for September 2026 on the portal and downloaded its e-invoice details \(Excel\); GST Keeper imported 5 e-invoices from them at 19:50 IST\. The portal's GSTR-1 file for 09\/2026/.test(r.message),
    'the pull\'s message says GSTR-1 for September 2026 was opened, its e-invoice details imported (how many, when), then what the file held: ' + (r && r.message));
}
reset();
storage.gstk_active_job = pullJob({ step: 'einvoice_excel' });
{
  const { clicked } = await runExcelStep({ withButton: false });
  const r = storage.gstk_einvoice_pull_result;
  ok(clicked.length === 0 && r && r.status === 'ok'
    && /^Could not take the e-invoice details from the portal: GSTR-1 for September 2026 shows no "Download details from e-invoices \(Excel\)" button\. The portal's GSTR-1 file/.test(r.message),
    'no button: the pull still reads the GSTR-1 file, and says why the e-invoice details were not taken: ' + (r && r.message));
}
reset();
storage.gstk_active_job = pullJob({ step: 'einvoice_excel' });
{
  const r0 = await runExcelStep({ imported: false });
  const r = storage.gstk_einvoice_pull_result;
  ok(r0.importCalls === 16 && r && /downloaded its e-invoice details \(Excel\), but GST Keeper did not import them/.test(r.message),
    'no import (GST Keeper\'s page not open): said so, and the pull goes on: ' + (r && r.message));
}
// 0.9.1: an import that lands after the pull stopped waiting is found when the pull ends.
reset();
storage.gstk_active_job = pullJob({ step: 'einvoice_excel' });
pullsDb.push({ client_id: 'c1', period_month: '09/2026', source: 'einvoice_excel', status: 'ok', docs_found: 7, pulled_at: '2026-10-10T14:25:00+00:00', message: 'late' });
{
  await runExcelStep({ imported: false });
  const r = storage.gstk_einvoice_pull_result;
  ok(r && /GST Keeper imported 7 e-invoices from them at 19:55 IST/.test(r.message) && !/did not import/.test(r.message),
    'a late import (after the 45 s wait) is found when the pull ends, and named: ' + (r && r.message));
}
// 0.9.1: the portal tab closed after the e-invoice details were imported.
reset();
storage.gstk_active_job = pullJob({ step: 'einvoice_pull', einvExcel: { ok: true, kb: 9, imported: { docs: 55, at: '2026-10-10T14:06:00+00:00' }, baseline: null } });
{
  await tabRemoved(1);
  await tick();
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.tabClosed && /^Opened GSTR-1 for September 2026 .* GST Keeper imported 55 e-invoices from them at 19:36 IST\. The portal tab was closed before the e-invoice pull finished\. Nothing from the GSTR-1 file was saved/.test(r.message),
    'tab closed after the import: the import is said, "Nothing was saved" is about the GSTR-1 file only: ' + (r && r.message));
}
reset();
storage.gstk_active_job = pullJob({ step: 'einvoice_excel' });
{
  await runExcelStep({ blob: 'data:application/pdf;base64,JVBERi0xLjQK' });
  const r = storage.gstk_einvoice_pull_result;
  ok(r && /no file came from "Download details from e-invoices \(Excel\)" on GSTR-1 for September 2026 within a minute/.test(r.message),
    'a file that is not a workbook is not taken: ' + (r && r.message));
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
