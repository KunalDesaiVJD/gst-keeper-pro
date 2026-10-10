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
//   - the e-invoice pull refuses a JSON for another GSTIN or period and saves
//     nothing; an ok / none pull upserts on the new key and deletes the
//     period's rows it did not see; a closed tab or an idle pull gives the
//     page a failed result naming its return
//   node test/10-einvoice-keep.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

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
let oldVersionsSchema = false; // gstr1_upload_versions without einvoice_kept / ext_version
let oldEinvSchema = false; // einvoice_docs without the 0.8.7 unique key
let staleRows = [];
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
    return new Response(JSON.stringify([{ id: 'r1', raw_json: rawJson }]), { status: 200 });
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
    if (oldEinvSchema) return new Response(JSON.stringify({ code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }), { status: 400 });
    return new Response(null, { status: 201 });
  }
  if (u.startsWith(DB + '/rest/v1/einvoice_docs') && method === 'DELETE') return new Response(JSON.stringify(staleRows), { status: 200 });
  if (u.startsWith(DB + '/rest/v1/einvoice_pulls') && method === 'POST') return new Response(null, { status: 201 });
  throw new Error('fake database has no route for ' + method + ' ' + u);
}
const posts = (table) => calls.filter((c) => c.method === 'POST' && c.url.startsWith(DB + '/rest/v1/' + table));
const dels = (table) => calls.filter((c) => c.method === 'DELETE' && c.url.startsWith(DB + '/rest/v1/' + table));
const gets = (table) => calls.filter((c) => c.method === 'GET' && c.url.startsWith(DB + '/rest/v1/' + table));

// ── chrome.* shared by the background worker and every page ─────────────────
const storage = {};
let bgListener = null;
let tabRemoved = null;
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
const chromeFor = (tabId, onChanged) => ({
  storage: { local, onChanged: onChanged || { addListener() {}, removeListener() {} } },
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
    querySelector: (s) => (opts.username && s === '#username' ? el() : s === 'input[type=file]' && opts.fileInput ? opts.fileInput : null),
    querySelectorAll: (s) => {
      if (s === 'table tr' && opts.rows) return opts.rows();
      if (s === 'input[type=file]' && opts.fileInput) return [opts.fileInput];
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
  const toBg = (fn) => (info) => new Promise((resolve, reject) => bgListener({ gstk: true, fn, args: [info] }, { tab: { id: 1 } },
    (r) => (r && r.ok ? resolve(r.data) : reject(new Error((r && r.error) || 'failed')))));
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
      saveEinvoicePull: toBg('saveEinvoicePull'),
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
const reset = () => {
  calls.length = 0; for (const k of Object.keys(storage)) delete storage[k];
  rawJson = clone(BOOKS); oldVersionsSchema = false; oldEinvSchema = false; staleRows = [];
};
const hasIrnField = (j) => /"(irn|irngendate|srctyp)"/.test(JSON.stringify(j));
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'SUNRISE RENTAL SERVICES', gstin: '24AAAAA0000A1Z5', selectedReturns: [] } };
const LOGIN = 'https://services.gst.gov.in/services/login';
const UPLOAD_PAGE = 'https://return.gst.gov.in/returns/auth/gstr1/offlineupload';

// ── 1. The upload leaves out exactly the documents named ───────────────────
reset();
{
  const resp = await bgCall('startGstr1Upload', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', einvoice: { keep: KEEP, planAt: PLAN_AT } });
  ok(resp && resp.ok && resp.data.started, 'the upload job starts');
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
  ok(row && row.einvoice_kept === 6 && row.ext_version === MANIFEST_VERSION && MANIFEST_VERSION === '0.8.7', 'the UPLOAD row carries einvoice_kept 6 and ext_version 0.8.7');
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

for (const [label, json, re] of [
  ['another GSTIN', { ...PORTAL, gstin: '24ZZZZZ9999Z1Z9' }, /for GSTIN 24ZZZZZ9999Z1Z9, not this client's 24AAAAA0000A1Z5/],
  ['another period', { ...PORTAL, fp: '082026' }, /for period 082026, not 092026/],
  ['no GSTIN in the file', { ...PORTAL, gstin: undefined }, /for GSTIN \(none\)/],
]) {
  reset();
  const resp = await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', json, status: 'ok' });
  const d = resp.data;
  ok(d.status === 'failed' && re.test(d.message) && /Nothing was saved/.test(d.message) && d.docsFound === 0, 'pull of ' + label + ': failed, saying why');
  ok(posts('einvoice_docs').length === 0 && dels('einvoice_docs').length === 0, 'pull of ' + label + ': no document saved or removed');
  const p = pullRow();
  ok(p && p.body[0].status === 'failed' && p.body[0].source === 'portal_gstr1' && /on_conflict=client_id,period_month,source$/.test(p.url),
    'pull of ' + label + ': the failed attempt is recorded in einvoice_pulls');
}
reset();
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c2', period_month: '09/2026', json: { ...PORTAL } })).data;
  ok(d.status === 'failed' && /no GSTIN saved/.test(d.message) && posts('einvoice_docs').length === 0, 'a client with no GSTIN: nothing is saved');
}

// An ok pull: the new key, the exact number, both notes, the stale rows removed.
reset();
staleRows = [{ id: 'old-1' }, { id: 'old-2' }];
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', actorId: 'u-1', json: PORTAL, status: 'ok' })).data;
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
  ok(rows.every((r) => r.last_seen_at === lastSeen), 'ok pull: every row carries the pull time');
  const del = dels('einvoice_docs');
  ok(del.length === 1, 'ok pull: one delete of rows not seen');
  const q = del[0] && new URL(del[0].url).searchParams;
  ok(q && q.get('client_id') === 'eq.c1' && q.get('period_month') === 'eq.09/2026' && q.get('source') === 'eq.portal_gstr1' && q.get('last_seen_at') === 'lt.' + lastSeen,
    'ok pull: the delete is this client and period\'s portal_gstr1 rows older than the pull');
  ok(calls.indexOf(del[0]) > calls.indexOf(up[0]), 'ok pull: the delete runs after the upsert');
  ok(d.status === 'ok' && d.staleRemoved === 2 && /2 e-invoice\(s\) saved by an earlier pull are no longer on the portal/.test(d.message), 'ok pull: status ok, 2 stale rows removed');
  const p = pullRow();
  ok(p && p.body[0].status === 'ok' && p.body[0].docs_found === 5 && p.body[0].source === 'portal_gstr1' && /on_conflict=client_id,period_month,source$/.test(p.url),
    'ok pull: einvoice_pulls written with source portal_gstr1 on (client, period, source)');
}

// A pull with no IRN at all: status none, and every stored row for the period goes.
reset();
staleRows = [{ id: 'old-1' }];
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', json: { gstin: '24AAAAA0000A1Z5', fp: '092026', b2b: [{ ctin: 'X', inv: [{ inum: '1', val: 1 }] }] } })).data;
  ok(d.status === 'none' && d.docsFound === 0 && posts('einvoice_docs').length === 0, 'none pull: nothing upserted');
  ok(dels('einvoice_docs').length === 1 && d.staleRemoved === 1, 'none pull: the period\'s stored e-invoices are removed');
}

// The new key is not in the database yet: the pull fails and removes nothing.
reset();
oldEinvSchema = true;
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', json: PORTAL })).data;
  ok(d.status === 'failed' && /Could not save the e-invoice documents/.test(d.message) && dels('einvoice_docs').length === 0, 'old einvoice_docs key: failed, nothing removed');
}

// A pending or failed pull with no JSON never touches einvoice_docs.
reset();
{
  const d = (await bgCall('saveEinvoicePull', { clientId: 'c1', period_month: '09/2026', status: 'pending', message: 'still generating' })).data;
  ok(d.status === 'pending' && calls.every((c) => !c.url.includes('einvoice_docs')), 'pending pull: einvoice_docs untouched');
}

// ── 7. The pull's page always hears a result naming its return ─────────────
const pullJob = (extra) => ({ mode: 'einvoice_pull', idx: 0, step: 'einvoice_pull', startedAt: now, lastActivityAt: now, period: '09/2026',
  actorId: 'u-1', tabId: 1, clients: [client], ...extra });
reset();
storage.gstk_active_job = pullJob({ tabId: 21 });
tabRemoved(21);
await new Promise((r) => setTimeout(r, 20));
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
  ok(posts('einvoice_docs').length === 0 && dels('einvoice_docs').length === 0, 'idle pull: no document saved or removed');
  ok(pullRow() && pullRow().body[0].status === 'failed', 'idle pull: the failed attempt is recorded');
  ok(!storage.gstk_active_job, 'idle pull: the job is cleared');
}
reset();
storage.gstk_active_job = pullJob({ retries: 2 });
await runPage(LOGIN);
{
  const r = storage.gstk_einvoice_pull_result;
  ok(r && r.status === 'failed' && /kept dropping/.test(r.message) && r.clientId === 'c1', 'pull session kept dropping: a failed result for its return');
  ok(!storage.gstk_active_job, 'pull session kept dropping: the job is cleared');
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
  const plan = { keep: KEEP.slice(0, 2), planAt: PLAN_AT };
  onMsg({ source: win, origin: 'https://gst.vjdesai.com', data: { __gstkUploadGstr1: { clientId: 'c1', period_month: '09/2026', einvoice: plan } } });
  ok(sent[0] && sent[0].fn === 'startGstr1Upload' && JSON.stringify(sent[0].args[0].einvoice) === JSON.stringify(plan), 'appbridge: the e-invoice plan reaches startGstr1Upload as sent');
  changed({ gstk_einvoice_pull_result: { newValue: { ok: false, status: 'failed', docsFound: 0, message: 'm', tabClosed: true, clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const done = posted.find((m) => m.__gstkEinvoicePullDone);
  ok(done && done.__gstkEinvoicePullDone.tabClosed === true && done.__gstkEinvoicePullDone.clientId === 'c1' && done.__gstkEinvoicePullDone.period_month === '09/2026',
    'appbridge: the pull result carries tabClosed, clientId and period_month');
  changed({ gstk_einvoice_pull_result: { newValue: { ok: true, status: 'ok', docsFound: 5, staleRemoved: 2, message: 'm', clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const done2 = posted.filter((m) => m.__gstkEinvoicePullDone).pop().__gstkEinvoicePullDone;
  ok(done2.staleRemoved === 2 && !('tabClosed' in done2), 'appbridge: an ok pull carries staleRemoved and no tabClosed');
  changed({ gstk_gstr1_upload_result: { newValue: { ok: true, status: 'accepted', einvoiceKept: 6, einvoiceKeepUnmatched: 2, clientId: 'c1', period_month: '09/2026' } } }, 'local');
  const up = posted.find((m) => m.__gstkUploadGstr1Result);
  ok(up && up.__gstkUploadGstr1Result.einvoiceKept === 6 && up.__gstkUploadGstr1Result.einvoiceKeepUnmatched === 2, 'appbridge: the upload result reaches the page with einvoiceKept');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
