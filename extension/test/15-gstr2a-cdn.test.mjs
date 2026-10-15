// 0.14.0: the GSTR-2A pull also reads the credit and debit notes (CDN), so the
// 2A vs 2B report can match the 2B's notes. The endpoints are not confirmed
// live, so this checks every fallback and failure: the notes read fine (and an
// empty month), no supplier list under either name, one supplier's notes
// failing, every supplier's failing, the cdnr fallback, a wrapper without its
// nt list, a month with notes but no B2B suppliers, and a notes read that
// throws. In each failure the invoices are saved exactly as before and no
// notes are saved. Same harness as 14: the REAL background.js and content.js
// in Node VM contexts, a stubbed chrome.* API and a fake portal.
//   node test/15-gstr2a-cdn.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';

// ── The fake database (background.js); content.js saves through GSTKdb below ──
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  if (u.startsWith(DB + '/rest/v1/gst_filed_returns')) return method === 'GET' ? new Response('[]', { status: 200 }) : new Response(null, { status: 204 });
  throw new Error('fake database has no route for ' + method + ' ' + u);
}

// ── chrome.* shared by the background worker and every page ─────────────────
const storage = {};
let bgListener = null;
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
  tabs: { create: async () => ({ id: 1 }), update: async () => ({ id: 1, windowId: 1 }), onRemoved: { addListener() {} } },
  windows: { update: async () => ({}) },
  declarativeNetRequest: { updateDynamicRules: async () => {} },
});
const bg = vm.createContext({
  chrome: chromeFor(null), fetch: dbFetch, console, URL, Response, setTimeout, clearTimeout, setInterval, clearInterval,
  atob, btoa, TextEncoder, Uint8Array, ArrayBuffer, Date, Math, JSON, Promise, Error, Map, Set,
});
bg.globalThis = bg;
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: 'anon-key' }; };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });

// ── One page load of content.js on the portal tab (tab 1) ──────────────────
const contentSrc = read('content.js');
const upserts = [];
const banners = [];
function makeDocument() {
  const byId = {};
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, dispatchEvent() {}, focus() {}, blur() {}, click() {},
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, offsetParent: {}, value: '',
    set textContent(v) { this._t = v; if (this.id === 'gstk-banner') banners.push(v); }, get textContent() { return this._t || ''; } });
  return {
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { appendChild: (e) => { if (e && e.id) byId[e.id] = e; } },
    body: { appendChild() {}, innerText: '' },
    addEventListener() {},
  };
}
async function runPage(href, fetchFn) {
  const document = makeDocument();
  const location = { get href() { return href; }, set href(v) { /* navigation is not followed */ }, get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, reload() {} };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, fetch: fetchFn, Number, String, Object, Array,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (f) => this.files.push(f) }; } },
    Event: class { constructor(t) { this.type = t; } }, KeyboardEvent: class { constructor(t) { this.type = t; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: chromeFor(1), document, location,
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async () => null, logStep: async () => null,
      getPortalPassword: async () => null, focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async () => null, clearCaptchaNotice: async () => null,
      upsertFiledReturn: async (...args) => { upserts.push(clone(args)); return true; },
    },
    jspdf: {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 50));
}

let fail = 0;
const ok = (cond, name, info) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || info === undefined ? '' : '\n     ' + JSON.stringify(info))); if (!cond) fail++; };
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS', gstin: '24ABCDE1234F1Z5', selectedReturns: [] } };
const DASH = 'https://return.gst.gov.in/returns/auth/dashboard';
const API = 'https://return.gst.gov.in/returns/auth/api/gstr2a/';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

// Fictional suppliers: ALPHA has invoices and a credit note, GAMMA two notes.
const ALPHA = '24AAAPA0001A1Z1';
const GAMMA = '29AAAPG0003G1Z3';
const itm = (txval, rt) => [{ num: 1, itm_det: { rt, txval, iamt: 0, camt: txval * rt / 200, samt: txval * rt / 200, csamt: 0 } }];
const ALPHA_B2B = { b2b: [{ ctin: ALPHA, cfs: 'Y', cfs3b: 'Y', flprdr1: 'Jul-26', fldtr1: '10-Aug-26', inv: [{ inum: 'A-101', idt: '05-07-2026', val: 1180, txval: 1000 }] }] };
const ALPHA_CDN = { ctin: ALPHA, cfs: 'Y', cfs3b: 'Y', fldtr1: '11-Aug-26', flprdr1: 'Jul-26', dtcancel: null,
  nt: [{ ntty: 'C', nt_num: 'CN-1', nt_dt: '25-07-2026', val: 118, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(100, 18) }] };
const GAMMA_CDN = { ctin: GAMMA, cfs: 'Y', cfs3b: 'N', fldtr1: '09-Aug-26', flprdr1: 'Jul-26',
  nt: [{ ntty: 'D', nt_num: 'DN-7', nt_dt: '20-07-2026', val: 590, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(500, 18) },
    { ntty: 'C', nt_num: 'CN-8', nt_dt: '28-07-2026', val: 236, pos: '24', rchrg: 'N', inv_typ: 'R', itms: itm(200, 18) }] };

// The fake portal: every call is logged (path and query, without the host);
// `cdn` overrides the notes routes per case. B2B always answers ALPHA.
const seen = [];
const portal = (cdn = {}) => async (url) => {
  const u = String(url);
  const short = u.replace(API, '');
  seen.push(short);
  const q = new URL(u).searchParams;
  if (short.startsWith('ctin?')) {
    const section = q.get('section_name');
    if (section === 'B2B') return cdn.b2bList ? cdn.b2bList() : json({ cpty: [{ stin: ALPHA, cname: 'ALPHA TRADERS' }] });
    const answer = cdn['list' + section];
    if (answer) return answer();
    return json({ status: 0, error: { error_cd: 'RT-404', message: 'no route in the fake portal for ' + section } }, 404);
  }
  if (short.startsWith('b2b?')) return json(ALPHA_B2B);
  for (const api of ['cdn', 'cdnr']) {
    if (short.startsWith(api + '?')) {
      const answer = cdn[api] && cdn[api](q.get('ctin'));
      if (answer) return answer;
      return json({ error: 'no route' }, 404);
    }
  }
  throw new Error('fake portal has no route for ' + u);
};
const bothList = () => json({ cpty: [{ stin: ALPHA, cname: 'ALPHA TRADERS' }, { stin: GAMMA, cname: 'GAMMA PACKAGING' }] });
const notesOf = (key) => (ctin) => (ctin === ALPHA ? json({ [key]: [ALPHA_CDN] }) : ctin === GAMMA ? json({ [key]: [GAMMA_CDN] }) : null);

// One 2A pull of July 2026, alone (mode gstr2a_pull); returns the saved patch.
async function pull(cdn, period = '07/2026') {
  upserts.length = 0; banners.length = 0; seen.length = 0;
  for (const k of Object.keys(storage)) delete storage[k];
  storage.gstk_active_job = { idx: 0, startedAt: now, lastActivityAt: now, tabId: 1, clients: [client], periodIdx: 0, mode: 'gstr2a_pull', step: 'gstr2a_pull', period, periods: [period] };
  await runPage(DASH, portal(cdn));
  const saved = upserts.filter((a) => a[2] === 'GSTR2A');
  return { saved, patch: saved[0] && saved[0][3], banner: banners.find((b) => /GSTR-2A 07\/2026|No GSTR-2A/.test(b)) || '' };
}
const b2bAsBefore = (patch) => patch && patch.status === 'Pulled' && JSON.stringify(patch.summary.b2b) === JSON.stringify([{ ...ALPHA_B2B.b2b[0], ctin: ALPHA, trdnm: 'ALPHA TRADERS', supfildt: '10-Aug-26', inv: ALPHA_B2B.b2b[0].inv }])
  && patch.summary._meta.counterparties === 1 && patch.summary._meta.failed === 0 && patch.summary._meta.failedCtins.length === 0;

// (a) The supplier list under CDN and every supplier's notes read.
{
  const { saved, patch, banner } = await pull({ listCDN: bothList, cdn: notesOf('cdn') });
  const m = patch && patch.summary._meta;
  ok(saved.length === 1, '(a) one save holds invoices and notes', saved.length);
  ok(b2bAsBefore(patch), '(a) the invoices are saved as before', patch && patch.summary);
  ok(Array.isArray(patch.summary.cdn) && patch.summary.cdn.length === 2, '(a) summary.cdn holds both suppliers', patch.summary.cdn);
  const a = patch.summary.cdn.find((w) => w.ctin === ALPHA);
  const g = patch.summary.cdn.find((w) => w.ctin === GAMMA);
  ok(a && a.trdnm === 'ALPHA TRADERS' && a.supfildt === '11-Aug-26' && a.cfs3b === 'Y' && a.flprdr1 === 'Jul-26' && a.nt.length === 1 && a.nt[0].nt_num === 'CN-1', '(a) wrapper: name from the list, supfildt from fldtr1, the portal\'s fields and nt kept', a);
  ok(g && g.trdnm === 'GAMMA PACKAGING' && g.nt.length === 2 && g.cfs3b === 'N', '(a) GAMMA: two notes', g);
  ok(m && JSON.stringify(m.sections) === '["b2b","cdn"]' && m.noteCounterparties === 2 && m.cdnFailed === 0 && m.cdnFailedCtins.length === 0 && m.cdnList === 'CDN' && m.cdnApi === 'cdn' && !('cdnProblem' in m), '(a) _meta: sections b2b + cdn, nothing failed, CDN / cdn used', m);
  const want = ['ctin?rtn_prd=072026&section_name=B2B', 'b2b?rtn_prd=072026&ctin=' + ALPHA, 'ctin?rtn_prd=072026&section_name=CDN', 'cdn?rtn_prd=072026&ctin=' + ALPHA, 'cdn?rtn_prd=072026&ctin=' + GAMMA];
  ok(JSON.stringify(seen) === JSON.stringify(want), '(a) endpoints: B2B list, b2b, CDN list, cdn per supplier (no CDNR call)', seen);
  ok(/saved ✓ \(1 counterparties; 3 notes from 2 suppliers\)/.test(banner), '(a) the banner counts the notes', banner);
  ok(banners.some((b) => /Reading GSTR-2A credit\/debit notes for 07\/2026/.test(b)), '(a) a progress banner while the notes are read', banners);
}

// (a2) An empty CDN list is a read: no notes that month, the 2B's notes are compared.
{
  const { patch } = await pull({ listCDN: () => json({ cpty: [] }) });
  ok(b2bAsBefore(patch) && Array.isArray(patch.summary.cdn) && patch.summary.cdn.length === 0 && patch.summary._meta.sections.join() === 'b2b,cdn' && patch.summary._meta.noteCounterparties === 0, '(a2) cpty [] under CDN: summary.cdn [] and sections b2b + cdn', patch && patch.summary);
  ok(!seen.some((s) => /section_name=CDNR/.test(s)), '(a2) a list under CDN: CDNR not asked', seen);
}

// (a3) "No Data Found" under both names: no notes that month (a read).
{
  const noData = () => json({ status: 0, error: { error_cd: 'RET2A01', message: 'No Data Found' } });
  const { patch } = await pull({ listCDN: noData, listCDNR: noData });
  ok(b2bAsBefore(patch) && patch.summary.cdn.length === 0 && patch.summary._meta.sections.join() === 'b2b,cdn' && patch.summary._meta.cdnList === 'CDN', '(a3) no data under CDN and CDNR: an empty read', patch && patch.summary);
  ok(seen.filter((s) => /section_name=CDN/.test(s)).length === 2, '(a3) no list under CDN: CDNR asked once', seen);
}

// (b) No supplier list under either name: no notes saved, the reason kept, invoices as before.
{
  const { saved, patch, banner } = await pull({});
  const m = patch && patch.summary._meta;
  ok(saved.length === 1 && b2bAsBefore(patch), '(b) the invoices are saved as before', patch && patch.summary);
  ok(!('cdn' in patch.summary), '(b) summary.cdn is NOT saved', Object.keys(patch.summary));
  ok(m.sections.join() === 'b2b' && /^no supplier list: CDN HTTP 404; CDNR HTTP 404$/.test(m.cdnProblem), '(b) sections b2b only, cdnProblem names both tries', m);
  ok(!seen.some((s) => /^cdnr?\?/.test(s)), '(b) no notes call without a supplier list', seen);
  ok(/notes not read: no supplier list/.test(banner), '(b) the banner says the notes were not read and why', banner);
  ok(!storage.gstk_active_job, '(b) the job still ends normally after the 2A');
}

// (b2) The list under both names is an error answer (HTTP 200): same outcome, the portal's words kept.
{
  const err = () => json({ status: 0, error: { error_cd: 'RT-500', message: 'Something went wrong' } });
  const { patch } = await pull({ listCDN: err, listCDNR: err });
  ok(b2bAsBefore(patch) && !('cdn' in patch.summary) && /CDN HTTP 200, no supplier list: .*RT-500/.test(patch.summary._meta.cdnProblem), '(b2) error answers: no notes, the portal\'s code in cdnProblem', patch && patch.summary._meta);
}

// (b3) The notes read throws (a malformed supplier list): the invoices are still saved.
{
  const { saved, patch } = await pull({ listCDN: () => json({ cpty: [null] }) });
  ok(saved.length === 1 && b2bAsBefore(patch) && !('cdn' in patch.summary) && /^error: /.test(patch.summary._meta.cdnProblem), '(b3) an exception in the notes read: invoices saved, cdnProblem "error: ..."', patch && patch.summary._meta);
}

// (c) One supplier's notes fail: recorded, the others saved.
{
  const { patch, banner } = await pull({ listCDN: bothList, cdn: (ctin) => (ctin === ALPHA ? json({ cdn: [ALPHA_CDN] }) : json({ error: 'boom' }, 500)) });
  const m = patch && patch.summary._meta;
  ok(b2bAsBefore(patch) && patch.summary.cdn.length === 1 && patch.summary.cdn[0].ctin === ALPHA, '(c) ALPHA\'s notes saved', patch && patch.summary.cdn);
  ok(m.sections.join() === 'b2b,cdn' && m.cdnFailed === 1 && m.cdnFailedCtins.join() === GAMMA && m.noteCounterparties === 2, '(c) cdnFailed 1, cdnFailedCtins names GAMMA', m);
  ok(/1 note from 2 suppliers, 1 failed/.test(banner), '(c) the banner says one supplier failed', banner);
}

// (c2) Every supplier's notes fail: treated as not read (no notes saved).
{
  const { patch } = await pull({ listCDN: bothList, cdn: () => json({ error: 'boom' }, 500) });
  ok(b2bAsBefore(patch) && !('cdn' in patch.summary) && patch.summary._meta.sections.join() === 'b2b' && /^the notes of every supplier failed \(cdn HTTP 500\)$/.test(patch.summary._meta.cdnProblem), '(c2) every supplier failed: no notes, cdnProblem says so', patch && patch.summary._meta);
}

// (c3) A supplier wrapper without its nt list is a failure, not "no notes".
{
  const { patch } = await pull({ listCDN: bothList, cdn: (ctin) => (ctin === ALPHA ? json({ cdn: [ALPHA_CDN] }) : json({ cdn: [{ ctin: GAMMA, cfs: 'Y' }] })) });
  ok(patch.summary.cdn.length === 1 && patch.summary._meta.cdnFailedCtins.join() === GAMMA, '(c3) GAMMA answered without nt: counted as failed', patch && patch.summary);
}

// (d) The cdnr fallback: no list under CDN, a list under CDNR; cdn 404 for the
// first supplier, cdnr works and is kept for the rest; notes under "cdnr".
{
  const { patch } = await pull({ listCDN: () => json({ error: 'bad section' }, 400), listCDNR: bothList, cdn: () => json({ error: 'not found' }, 404), cdnr: notesOf('cdnr') });
  const m = patch && patch.summary._meta;
  ok(b2bAsBefore(patch) && patch.summary.cdn.length === 2 && m.cdnList === 'CDNR' && m.cdnApi === 'cdnr' && m.cdnFailed === 0, '(d) list from CDNR, notes from cdnr, nothing failed', m);
  const want = ['ctin?rtn_prd=072026&section_name=B2B', 'b2b?rtn_prd=072026&ctin=' + ALPHA, 'ctin?rtn_prd=072026&section_name=CDN', 'ctin?rtn_prd=072026&section_name=CDNR',
    'cdn?rtn_prd=072026&ctin=' + ALPHA, 'cdnr?rtn_prd=072026&ctin=' + ALPHA, 'cdnr?rtn_prd=072026&ctin=' + GAMMA];
  ok(JSON.stringify(seen) === JSON.stringify(want), '(d) endpoints: CDN then CDNR list; cdn once, then cdnr for every supplier', seen);
}

// (d2) cdn answers 404 and cdnr fails too: cdn is kept, the first supplier counts as failed.
{
  const { patch } = await pull({ listCDN: bothList, cdn: (ctin) => (ctin === ALPHA ? json({}, 404) : json({ cdn: [GAMMA_CDN] })), cdnr: () => json({}, 404) });
  const m = patch && patch.summary._meta;
  ok(m.cdnApi === 'cdn' && m.cdnFailedCtins.join() === ALPHA && patch.summary.cdn.length === 1 && patch.summary.cdn[0].ctin === GAMMA, '(d2) neither name for ALPHA: cdn kept for GAMMA, ALPHA failed', m);
}

// (e) No B2B suppliers but notes: Pulled (not NO DATA), b2b empty, the notes saved.
{
  const { patch } = await pull({ b2bList: () => json({ status: 0, error: { message: 'No Data Found' } }), listCDN: bothList, cdn: notesOf('cdn') });
  ok(patch && patch.status === 'Pulled' && patch.summary.b2b.length === 0 && patch.summary._meta.counterparties === 0 && patch.summary.cdn.length === 2, '(e) a month with notes only: Pulled, b2b [], cdn saved', patch);
}

// (f) No B2B suppliers and no notes list: NO DATA, b2b [] as before, no notes saved.
{
  const { patch, banner } = await pull({ b2bList: () => json({ status: 0, error: { message: 'No Data Found' } }) });
  ok(patch && patch.status === 'NO DATA / NOT FOUND' && patch.summary.b2b.length === 0 && patch.summary._meta.counterparties === 0 && !('cdn' in patch.summary) && patch.summary._meta.cdnProblem, '(f) no suppliers, notes not read: NO DATA with the reason', patch);
  ok(/No GSTR-2A B2B counterparties for 07\/2026; notes not read/.test(banner), '(f) banner', banner);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
