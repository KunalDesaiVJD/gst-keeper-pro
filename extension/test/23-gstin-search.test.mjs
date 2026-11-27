// 0.19.2: vendor GSTINs on the portal's own Search Taxpayer page (mode
// gstin_search), the Vendor GSTIN Risk report's Pull. After the client's login
// it opens Search Taxpayer > Search by GSTIN/UIN from the dashboard's menu,
// types each GSTIN into the page, presses Search, reads the result (the JSON
// the page's own request got back, copied by inject.js, and the rendered
// labels), presses Show Filing Table, and saves one vendor_gstin_lookups row
// per GSTIN (ok / not_found / error). Seen live with 0.19.1 (27 Nov 2026): a
// "Request Rejected" page and a 403 from guessed addresses stopped the whole
// run as "session ended" with the person still logged in. Here: those never
// stop the run, a real logout logs in again, a CAPTCHA is waited for (never
// filled), and only 5 failures in a row stop it.
// The REAL background.js, content.js and inject.js in Node VM contexts, a
// stubbed chrome.* API, a fake database and a fake portal with a small DOM.
//   node test/23-gstin-search.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const extDir = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, extDir), 'utf8');
const DB = 'https://db.test';
const ANON = 'anon-key';
const GITA = '10000000-0000-0000-0000-000000000002';
const CLIENT_GSTIN = '24ABCDE1234F1Z5';
const ORIGIN = 'https://services.gst.gov.in';
const VERSION = JSON.parse(read('manifest.json')).version;

// ── The fake database (background.js) ─────────────────────────────────────
const calls = [];
let lookupsDown = false;
async function dbFetch(url, init = {}) {
  const u = String(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: u, body, headers: { ...(init.headers || {}) } });
  if (u.startsWith(DB + '/rest/v1/clients?id=eq.c1') && method === 'GET') {
    return new Response(JSON.stringify([{ id: 'c1', name: 'FICTIONAL FABRICS', gstin: CLIENT_GSTIN, gst_user_id: 'u', selected_returns: [] }]), { status: 200 });
  }
  if (u.startsWith(DB + '/rest/v1/vendor_gstin_lookups') && method === 'POST') {
    return lookupsDown ? new Response('{"message":"down"}', { status: 503 }) : new Response(null, { status: 201 });
  }
  throw new Error('fake database has no route for ' + method + ' ' + u);
}

// ── chrome.* shared by the background worker and the page ──────────────────
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
    getContexts: async () => [],
    lastError: null,
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  downloads: { onCreated: { addListener() {} }, onChanged: { addListener() {} }, search: async () => [] },
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
bg.importScripts = () => { bg.GSTK_CONFIG = { SUPABASE_URL: DB, SUPABASE_ANON_KEY: ANON }; };
vm.runInContext(read('background.js'), bg, { filename: 'background.js' });
const bgCall = (fn, ...args) => new Promise((resolve) => bgListener({ gstk: true, fn, args }, {}, resolve));

// ── A small DOM: enough for the portal pages and content.js ────────────────
const banners = [];
class TextNode { constructor(t) { this.t = String(t); this.parentElement = null; } get textContent() { return this.t; } }
function parseSel(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^([a-zA-Z*]+)?(.*)$/);
    const parts = { tag: m[1] && m[1] !== '*' ? m[1].toUpperCase() : null, ids: [], cls: [], attrs: [] };
    const rx = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
    let t;
    while ((t = rx.exec(m[2]))) {
      if (t[1]) parts.ids.push(t[1]); else if (t[2]) parts.cls.push(t[2]); else parts.attrs.push([t[3], t[4]]);
    }
    return parts;
  });
}
const matchOne = (el, p) => (!p.tag || el.tagName === p.tag) && p.ids.every((i) => el.id === i)
  && p.cls.every((c) => String(el.className || '').split(/\s+/).includes(c))
  && p.attrs.every(([k, v]) => { const a = el.getAttribute(k); return v === undefined ? a != null : String(a) === v; });
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.id = attrs.id || '';
    this.className = attrs.class || '';
    this.name = attrs.name || '';
    this.type = attrs.type || (this.tagName === 'INPUT' ? 'text' : undefined);
    this._value = attrs.value || '';
    this.hidden = !!attrs.hidden;
    this.disabled = false;
    this.childNodes = [];
    this.parentElement = null;
    this.listeners = {};
    this.style = {};
    this.selectedIndex = 0;
  }
  get value() {
    if (this.tagName === 'SELECT') { const o = this.options[this.selectedIndex]; return o ? o.value : ''; }
    return this._value;
  }
  set value(v) {
    if (this.tagName === 'SELECT') { const i = this.options.findIndex((o) => o.value === String(v)); if (i >= 0) this.selectedIndex = i; return; }
    this._value = String(v);
    if (this.onValue) this.onValue(this._value);
  }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION').map((o, i) => Object.assign(o, { index: i })); }
  get children() { return this.childNodes.filter((n) => n instanceof El); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) {
    this.childNodes = [new TextNode(v)];
    if (this.id === 'gstk-banner') banners.push(String(v));
  }
  get innerText() { return this.textContent; }
  set innerHTML(v) { this.childNodes = [new TextNode(String(v).replace(/<[^>]*>/g, ' '))]; }
  get connected() { let e = this; while (e.parentElement) e = e.parentElement; return e.tagName === 'HTML'; }
  get offsetParent() { for (let e = this; e; e = e.parentElement) if (e.hidden) return null; return this.connected ? {} : null; }
  getClientRects() { return this.offsetParent ? [{}] : []; }
  get nextElementSibling() { const p = this.parentElement; if (!p) return null; const ch = p.children; return ch[ch.indexOf(this) + 1] || null; }
  get href() { return this.attrs.href ? new URL(this.attrs.href, ORIGIN).href : ''; }
  getAttribute(k) { if (k === 'id') return this.id || null; if (k === 'class') return this.className || null; if (k === 'name') return this.name || null; if (k === 'type') return this.type || null; return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  appendChild(k) { if (typeof k === 'string') k = new TextNode(k); if (k.parentElement) k.parentElement.removeChild(k); k.parentElement = this; this.childNodes.push(k); return k; }
  append(...ks) { for (const k of ks) this.appendChild(k); }
  removeChild(k) { this.childNodes = this.childNodes.filter((n) => n !== k); k.parentElement = null; }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  clear() { for (const c of [...this.childNodes]) { if (c instanceof El) c.parentElement = null; } this.childNodes = []; }
  descendants() { const out = []; const walk = (e) => { for (const c of e.children) { out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) { const ps = parseSel(sel); return this.descendants().filter((e) => ps.some((p) => matchOne(e, p))); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { const ps = parseSel(sel); for (let e = this; e; e = e.parentElement) if (ps.some((p) => matchOne(e, p))) return e; return null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener() {}
  dispatchEvent(e) { for (const f of this.listeners[e.type] || []) f(e); return true; }
  click() { this.clicks = (this.clicks || 0) + 1; this.dispatchEvent({ type: 'click' }); }
  focus() {}
  blur() {}
}
const h = (tag, attrs = {}, ...kids) => { const e = new El(tag, attrs); for (const k of kids.flat()) if (k != null) e.appendChild(k); return e; };
function makeDocument() {
  const html = new El('html');
  const body = new El('body');
  html.appendChild(body);
  return {
    documentElement: html, body,
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    getElementById: (id) => html.descendants().find((e) => e.id === id) || null,
    createElement: (t) => new El(t),
    addEventListener() {},
    banner: () => { const b = html.descendants().find((e) => e.id === 'gstk-banner'); return b ? b.textContent : ''; },
  };
}

// ── The fake portal ─────────────────────────────────────────────────────────
const V1 = '27AAACR5055K1Z7'; // found, Active, with filings
const V2 = '29AAAAA0000A1Z0'; // the portal has no such GSTIN
const V3 = '24BBBBB1111B1Z1'; // found, Cancelled
const V4 = '27BBBBB2222B1Z2';
const V5 = '27CCCCC3333C1Z3';
const V6 = '27DDDDD4444D1Z4';
const TP1 = {
  gstin: V1, lgnm: 'FICTIONAL STEEL PRIVATE LIMITED', tradeNam: 'FICTIONAL STEEL', sts: 'Active', rgdt: '01/07/2017', cxdt: '',
  ctb: 'Private Limited Company', dty: 'Regular', stj: 'State - Maharashtra, Zone - Mumbai', ctj: 'Commissionerate - MUMBAI EAST',
  pradr: { adr: '12, Fictional Estate, Andheri East, Mumbai, Maharashtra, 400069' },
  nba: ['Factory / Manufacturing', 'Wholesale Business'], einvoiceStatus: 'Yes', aggreTurnOver: 'Slab: Rs. 100 Cr. to 500 Cr.', aggreTurnOverFY: '2024-2025',
};
const TP3 = { gstin: V3, lgnm: 'FICTIONAL TRADERS', tradeNam: 'FICTIONAL TRADERS', sts: 'Cancelled', rgdt: '15/09/2019', cxdt: '31/03/2025', ctb: 'Proprietorship', dty: 'Regular',
  stj: 'Ghatak 5', ctj: 'Range II', pradr: { addr: { bno: '4', st: 'Fictional Road', loc: 'Surat', stcd: 'Gujarat', pncd: '395003' } }, nba: 'Retail Business' };
const tpFor = (g) => (g === V1 ? TP1 : g === V3 ? TP3 : { ...TP1, gstin: g, lgnm: 'VENDOR ' + g, tradeNam: 'VENDOR ' + g });
const FILINGS = {
  [V1]: [
    { fy: '2025-2026', taxp: 'October', mof: 'ONLINE', dof: '11/11/2025', rtntype: 'GSTR1', arn: 'AA2710250000001', status: 'Filed' },
    { fy: '2025-2026', taxp: 'October', mof: 'ONLINE', dof: '20/11/2025', rtntype: 'GSTR3B', arn: 'AA2710250000002', status: 'Filed' },
    { fy: '2024-2025', taxp: 'March', mof: 'ONLINE', dof: '11/04/2025', rtntype: 'GSTR1', arn: 'AA2703250000003', status: 'Filed' },
  ],
};
const NOT_FOUND = { errorCode: 'SWEB_9035', message: 'No records found for the provided GSTIN.' };
const WAF = '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.<br><br>Your support ID is: 1234567890123456789</body></html>';
const API_TP = ORIGIN + '/services/auth/api/search/tpDetails';     // the page's own request (made up for the fake)
const API_RET = ORIGIN + '/services/auth/api/search/tpReturns';
const SEARCH = ORIGIN + '/services/auth/searchtp';
const WELCOME = ORIGIN + '/services/auth/fowelcome';
const LOGIN = ORIGIN + '/services/login';

// Per test: what the portal does for each GSTIN ('ok' | 'nf' | 'waf' | '403' | 'hang' | 'logout'),
// whether answers are JSON (domOnly: an encrypted body, the page draws from it anyway),
// whether the page asks a CAPTCHA, and what a replay of the page's request gets.
let P;
const resetPortal = (over = {}) => { P = { loggedIn: true, kind: {}, domOnly: false, captcha: false, replay: 'same', noSearchPage: false, pageXhr: [], ...over }; };
const kindOf = (g) => P.kind[g] || (g === V2 ? 'nf' : 'ok');
// The portal's answer to one request: { status, text } or null (never answers).
function api(method, url, bodyText, from) {
  let b = {};
  try { b = JSON.parse(bodyText || '{}'); } catch (e) { b = {}; }
  const g = String(b.gstin || '').toUpperCase();
  if (!P.loggedIn) return { status: 401, text: '{"message":"Unauthorized"}' };
  const k = kindOf(g);
  if (from === 'replay' && P.replay === 'waf') return { status: 200, text: WAF };
  if (url === API_TP && method === 'POST') {
    if (k === 'waf') return { status: 200, text: WAF };
    if (k === '403') return { status: 403, text: '<html><body>403 Forbidden</body></html>' };
    if (k === 'hang') return null;
    if (k === 'logout') { P.loggedIn = false; return { status: 401, text: '{"message":"Unauthorized"}' }; }
    if (P.domOnly) return { status: 200, text: 'U2FsdGVkX1+encrypted' };
    if (k === 'nf') return { status: 200, text: JSON.stringify(NOT_FOUND) };
    return { status: 200, text: JSON.stringify(tpFor(g)) };
  }
  if (url === API_RET && method === 'POST') {
    if (P.domOnly) return { status: 200, text: 'U2FsdGVkX1+encrypted' };
    const fy = String(b.fy || '2025-26').replace(/^(\d{4})-(\d{2})$/, (m, a) => a + '-' + (+a + 1));
    return { status: 200, text: JSON.stringify({ filingStatus: [(FILINGS[g] || []).filter((r) => r.fy === fy)] }) };
  }
  return { status: 404, text: '<html>404</html>' };
}
function makeXHR() {
  return class XHR {
    constructor() { this.listeners = {}; this.responseType = ''; this.status = 0; this.responseText = ''; this.responseURL = ''; }
    open(m, u) { this.m = m; this.u = new URL(u, ORIGIN).href; }
    setRequestHeader(k, v) { (this.h = this.h || {})[k] = v; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    send(body) {
      P.pageXhr.push({ url: this.u, body });
      setTimeout(() => {
        const r = api(this.m, this.u, body, 'page');
        if (!r) return;
        this.status = r.status; this.responseText = r.text; this.responseURL = this.u;
        for (const f of this.listeners.load || []) f.call(this);
      }, 2);
    }
  };
}
const fyOptions = [['2025-26', '2025-2026'], ['2024-25', '2024-2025']];
// One page of the portal, with its own scripts (they use the page world's XHR).
function buildPage(href, W, nav) {
  const doc = W.document;
  const u = new URL(href);
  const header = () => h('div', { class: 'header' }, h('span', {}, 'FICTIONAL FABRICS'), h('a', { href: '/services/logout' }, 'Logout'));
  if (/\/services\/login/.test(u.pathname)) {
    doc.body.append(h('form', {}, h('input', { id: 'username' }), h('input', { id: 'user_pass', type: 'password' }), h('button', {}, 'LOGIN')));
    return;
  }
  if (/\/fowelcome/.test(u.pathname)) {
    doc.body.append(header(), h('ul', { class: 'nav' }, h('li', {}, h('a', { href: '#' }, 'Search Taxpayer'),
      P.noSearchPage ? null : h('ul', { class: 'dropdown-menu', hidden: true }, h('li', {}, h('a', { href: '//services.gst.gov.in/services/auth/searchtp' }, 'Search by GSTIN/UIN'))))));
    return;
  }
  if (!/searchtp/.test(u.pathname)) return;
  doc.body.append(header());
  if (P.noSearchPage) { doc.body.append(h('p', {}, 'This page is under maintenance.')); return; }
  const input = h('input', { id: 'for_gstin', name: 'for_gstin', placeholder: 'Enter GSTIN/UIN of the Taxpayer' });
  const cap = P.captcha ? h('input', { id: 'fo-captcha', name: 'captcha', placeholder: 'Enter Characters shown below' }) : null;
  const btn = h('button', { id: 'lotsearch', type: 'submit' }, 'Search');
  const err = h('span', { class: 'err', hidden: true }, '');
  const result = h('div', { id: 'result' });
  doc.body.append(h('form', {}, h('label', {}, 'GSTIN/UIN of the Taxpayer'), input, err, cap, btn), result);
  W.captchaBox = cap;
  const field = (label, value) => h('div', { class: 'col-sm-4' }, h('p', {}, h('strong', {}, label)), h('p', {}, value || ''));
  const renderTable = (g, fy) => {
    const old = result.querySelector('#filings');
    if (old) old.remove();
    const rows = (FILINGS[g] || []).filter((r) => r.fy === fy.replace(/^(\d{4})-(\d{2})$/, (m, a) => a + '-' + (+a + 1)));
    const sel = h('select', { id: 'fy' }, ...fyOptions.map(([v, t]) => h('option', { value: v }, t)));
    sel.selectedIndex = fyOptions.findIndex(([v]) => v === fy);
    sel.addEventListener('change', () => askReturns(g, sel.value));
    result.append(h('div', { id: 'filings' }, h('label', {}, 'Financial Year'), sel,
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...['Return Type', 'Financial Year', 'Tax Period', 'Date of filing', 'Status'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, ...[r.rtntype, r.fy, r.taxp, r.dof, r.status].map((t) => h('td', {}, t))))))));
  };
  const askReturns = (g, fy) => {
    const x = new W.XMLHttpRequest();
    x.open('POST', API_RET);
    x.setRequestHeader('Content-Type', 'application/json');
    x.addEventListener('load', () => renderTable(g, fy));
    x.send(JSON.stringify({ gstin: g, fy }));
  };
  const renderResult = (g) => {
    const t = tpFor(g);
    const kids = [h('h4', {}, 'Search Result based on GSTIN/UIN : ' + g),
      field('Legal Name of Business', t.lgnm), field('Trade Name', t.tradeNam), field('Effective Date of registration', t.rgdt),
      field('Constitution of Business', t.ctb), field('GSTIN / UIN Status', t.sts), field('Taxpayer Type', t.dty),
      h('div', { class: 'col-sm-4' }, h('p', {}, h('strong', {}, 'Administrative Office'), h('span', {}, '(JURISDICTION - STATE)')),
        h('ul', {}, ...String(t.stj).split(', ').map((s) => h('li', {}, s)))),
      h('div', { class: 'col-sm-4' }, h('p', {}, h('strong', {}, 'Other Office'), h('span', {}, '(JURISDICTION - CENTER)')),
        h('ul', {}, h('li', {}, t.ctj))),
      field('Principal Place of Business', t.pradr.adr || [t.pradr.addr.bno, t.pradr.addr.st, t.pradr.addr.loc, t.pradr.addr.stcd, t.pradr.addr.pncd].join(', ')),
      field('Whether Aadhaar Authenticated?', 'Yes'),
      h('div', {}, h('p', {}, h('strong', {}, 'Nature Of Business Activities')), h('ul', {}, ...[].concat(t.nba).map((s) => h('li', {}, s)))),
      field('Aggregate Turnover (FY 2024-2025)', t.aggreTurnOver || ''),
    ];
    if (t.cxdt) kids.push(field('Date of Cancellation', t.cxdt));
    const show = h('button', { id: 'filingTable' }, 'Show Filing Table');
    show.addEventListener('click', () => askReturns(g, '2025-26'));
    kids.push(show);
    result.append(...kids);
  };
  btn.addEventListener('click', () => {
    const g = String(input.value || '').trim().toUpperCase();
    if (cap && !String(cap.value || '').trim()) { err.textContent = 'Enter valid Letters shown.'; err.hidden = false; return; }
    if (cap) cap.value = '';
    err.hidden = true;
    result.clear();
    const x = new W.XMLHttpRequest();
    x.open('POST', API_TP);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('at', 'page-token');
    x.addEventListener('load', () => {
      if (x.status === 401) {
        // The portal's session ended: its app sends the tab to the login page.
        doc.body.clear();
        doc.body.append(h('form', {}, h('input', { id: 'user_pass', type: 'password' })));
        nav(LOGIN);
        return;
      }
      if (x.status !== 200 || /Request Rejected/.test(x.responseText)) return; // the page shows nothing
      const k = kindOf(g);
      if (k === 'nf') { err.textContent = 'No records found for the provided GSTIN.'; err.hidden = false; return; }
      renderResult(g);
    });
    x.send(JSON.stringify({ gstin: g }));
  });
}

// ── The content script's own fetch: the session check and the replays ─────
const portalCalls = [];
async function portalFetch(url, init = {}) {
  const u = new URL(String(url), ORIGIN).href;
  if (u.endsWith('/services/auth/profile/detail')) return new Response(JSON.stringify({ gstin: CLIENT_GSTIN }), { status: 200 });
  portalCalls.push({ url: u, method: init.method || 'GET', body: init.body || null, headers: { ...(init.headers || {}) } });
  const r = api(init.method || 'GET', u, init.body, 'replay');
  if (!r) return new Promise(() => {});
  return new Response(r.text, { status: r.status });
}

// ── One page load of the tab: inject.js (page world) + content.js ──────────
const contentSrc = read('content.js');
const injectSrc = read('inject.js');
let tabSession = new Map();
const sessionStorageFor = () => ({
  getItem: (k) => (tabSession.has(k) ? tabSession.get(k) : null),
  setItem: (k, v) => { tabSession.set(k, String(v)); },
  removeItem: (k) => { tabSession.delete(k); },
});
const fastTimeout = (fn, ms, ...a) => setTimeout(fn, ms > 50 ? 1 : ms, ...a);
const sleeps = [];
let curPage = null;
async function runPage(href) {
  const document = makeDocument();
  let nav = null;
  let reloaded = false;
  const setNav = (v) => { if (!nav && !reloaded) nav = new URL(v, href).href; };
  const location = {
    get href() { return href; }, set href(v) { setNav(v); }, assign: setNav, replace: setNav,
    get hostname() { return new URL(href).hostname; }, get pathname() { return new URL(href).pathname; }, get origin() { return new URL(href).origin; },
    reload() { if (!nav) reloaded = true; },
  };
  const ss = sessionStorageFor();
  // The page world: inject.js hooks this page's XHR, as Chrome runs it (world MAIN).
  class PageURL extends URL {}
  const W = { location, sessionStorage: ss, document, XMLHttpRequest: makeXHR(), URL: PageURL, FileReader: class {}, Blob: class {}, JSON, Date, setTimeout, console, postMessage() {}, fetch: async () => { throw new Error('the fake page uses XHR'); } };
  W.window = W;
  vm.runInNewContext(injectSrc, vm.createContext(W), { filename: 'inject.js' });
  buildPage(href, W, setNav);
  curPage = { document, W, href };
  const sandbox = {
    console, setTimeout: (fn, ms, ...a) => { if (ms >= 1000) sleeps.push(ms); return fastTimeout(fn, ms, ...a); }, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, fetch: portalFetch, Number, String, Object, Array, Response,
    Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, URL, encodeURIComponent, Blob: class {}, File: class {},
    Event: class { constructor(t) { this.type = t; } },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    sessionStorage: ss, chrome: chromeFor(1), document, location,
    GSTKdb: {
      whoami: async () => ({ tabId: 1 }), logClientSync: async () => null, logStep: async () => null,
      getPortalPassword: async () => null, focusTab: async () => true, backgroundTab: async () => true,
      pwRefusalClear: async () => null, loginIssueSet: async () => null, clearCaptchaNotice: async () => null,
      saveVendorGstinLookup: (row) => new Promise((resolve, reject) => bgListener({ gstk: true, fn: 'saveVendorGstinLookup', args: [row] }, { tab: { id: 1 } },
        (resp) => (resp && resp.error ? reject(new Error(resp.error)) : resolve(resp && resp.data)))),
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.postMessage = () => {};
  sandbox.atob = atob; sandbox.btoa = btoa;
  await vm.runInNewContext(contentSrc, vm.createContext(sandbox), { filename: 'content.js' });
  await new Promise((r) => setTimeout(r, 10));
  return { document, nav, reloaded };
}
// Follows the tab from page to page (a server redirect to the login page when
// logged out) until the job ends, waits at the login step, or stays put.
async function drive(href, max = 40) {
  const visits = [];
  let r = null;
  for (let i = 0; i < max; i++) {
    let real = href;
    if (!P.loggedIn && /\/services\/auth\//.test(new URL(href).pathname)) real = LOGIN;
    visits.push(real);
    r = await runPage(real);
    const j = storage.gstk_active_job;
    if (!j) return { visits, doc: r.document, end: 'done' };
    if (j.step === 'login') return { visits, doc: r.document, end: 'login', nav: r.nav };
    if (r.nav) href = r.nav;
    else if (r.reloaded) href = real;
    else return { visits, doc: r.document, end: 'stuck' };
  }
  return { visits, doc: r && r.document, end: 'overflow' };
}

let fail = 0;
const ok = (cond, name, info) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || info === undefined ? '' : '\n     ' + JSON.stringify(info, null, 1).slice(0, 2000))); if (!cond) fail++; };
const reset = (over) => {
  calls.length = 0; portalCalls.length = 0; sleeps.length = 0; banners.length = 0; lookupsDown = false;
  for (const k of Object.keys(storage)) delete storage[k];
  tabSession = new Map();
  resetPortal(over);
};
const rows = () => calls.filter((c) => c.method === 'POST' && c.url.startsWith(DB + '/rest/v1/vendor_gstin_lookups')).map((c) => c.body[0]);
const now = Date.now();
const client = { clientId: 'c1', creds: { user: 'u', name: 'FICTIONAL FABRICS', gstin: CLIENT_GSTIN, selectedReturns: [] } };
const job = (extra) => ({ mode: 'gstin_search', step: 'gstin_search', idx: 0, startedAt: now, lastActivityAt: now, tabId: 1, actorId: GITA,
  clients: [client], period: '04/2025', periods: ['04/2025'], periodIdx: 0, ...extra });
const pageSearches = (g) => P.pageXhr.filter((x) => x.url === API_TP && String(x.body).includes(g)).length;

// 1. Background: the Pull starts a gstin_search job carrying its GSTINs; no other mode gets the field.
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstin_search', period_month: '04/2025', period_months: ['04/2025'], gstins: [V1, ' ' + V2.toLowerCase() + ' ', 'NOT-A-GSTIN', V3], actorId: GITA });
const started = storage.gstk_active_job;
ok(started && started.mode === 'gstin_search' && started.step === 'login' && started.actorId === GITA, 'startSectionPull: a gstin_search job, at login, naming the app user', started);
ok(started && JSON.stringify(started.gstins) === JSON.stringify([V1, V2, V3]), 'startSectionPull: the GSTINs as given, upper-cased, the malformed one left out', started && started.gstins);
reset();
await bgCall('startSectionPull', { clientId: 'c1', mode: 'gstr9_8a_pull', period_month: '03/2026', period_months: ['03/2026'], gstins: [V1] });
ok(storage.gstk_active_job && !('gstins' in storage.gstk_active_job), 'startSectionPull: another mode\'s job is as before (no gstins field)', storage.gstk_active_job);

// 2. Logged in: the job goes to fowelcome for the lookups.
reset();
storage.gstk_active_job = job({ step: 'login', gstins: [V1] });
let pg = await runPage(WELCOME);
ok(storage.gstk_active_job && storage.gstk_active_job.step === 'gstin_search' && pg.nav === WELCOME, 'login: on to the lookups, from fowelcome', { job: storage.gstk_active_job, nav: pg.nav });
ok(P.pageXhr.length === 0 && rows().length === 0, 'login: nothing looked up or saved yet');

// 3. The lookups on the page: the menu's link, the GSTIN typed, Search pressed,
//    the result and the filing table read; then the page's own request replayed.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3] });
let d = await drive(WELCOME);
let r = rows();
ok(d.end === 'done' && d.visits[0] === WELCOME && d.visits[1] === SEARCH, 'flow: fowelcome, then the menu\'s Search by GSTIN/UIN page', d.visits);
ok(r.length === 3 && r.map((x) => x.gstin).join() === [V1, V2, V3].join(), 'flow: three rows, in order', r.map((x) => [x.gstin, x.status]));
ok(/done: 2 found, 1 not found, 0 failed/.test(d.doc.banner()), 'flow: the banner counts them', d.doc.banner());
const a = r[0] || {};
ok(a.status === 'ok' && a.legal_name === TP1.lgnm && a.trade_name === 'FICTIONAL STEEL' && a.reg_status === 'Active' && a.reg_date === '2017-07-01' && a.cancel_date === null,
  'ok row: names, status, dates dd/mm/yyyy -> ISO (an empty cancel date is null)', a);
ok(a.constitution === 'Private Limited Company' && a.taxpayer_type === 'Regular' && a.state_jurisdiction === TP1.stj && a.centre_jurisdiction === TP1.ctj,
  'ok row: constitution, taxpayer type, jurisdictions', a);
ok(a.address === TP1.pradr.adr && JSON.stringify(a.nature_of_business) === JSON.stringify(TP1.nba) && a.einvoice_status === 'Yes' && a.ato_slab === 'Slab: Rs. 100 Cr. to 500 Cr. (FY 2024-2025)',
  'ok row: address, nature of business, e-invoice, turnover slab with its FY', a);
ok(Array.isArray(a.filings) && a.filings.length === 2 && a.filings[0].rtntype === 'GSTR1' && a.filings[0].dof === '2025-11-11' && a.filings[1].status === 'Filed'
  && a.filings[0].fy === '2025-2026' && a.filings[0].taxp === 'October',
  'ok row: the filing table (Show Filing Table pressed), dof as ISO', a.filings);
ok(a.payload && a.payload.flow === 'page' && a.payload.page === SEARCH && a.payload.sources.legal_name === 'json' && a.payload.sources.filings === 'json+page'
  && a.payload.json.details.url === '/services/auth/api/search/tpDetails' && a.payload.json.details.body.lgnm === TP1.lgnm
  && a.payload.dom.labels['Legal Name of Business'] === TP1.lgnm && a.payload.json.returns.length === 1,
  'ok row: payload names the page, the source of each column, the page\'s own request and the labels read', a.payload);
ok(a.looked_up_by === GITA && a.via_client_id === 'c1' && a.extension_version === VERSION && a.source === 'gst_portal_search_taxpayer' && !('looked_up_at' in a),
  'ok row: who asked, whose login, the version; the time is the database\'s', a);
const b = r[1] || {};
ok(b.status === 'not_found' && /No records found/.test(b.error) && b.legal_name === undefined, 'not found: status not_found, the portal\'s words', b);
const c3 = r[2] || {};
ok(c3.status === 'ok' && c3.reg_status === 'Cancelled' && c3.cancel_date === '2025-03-31' && c3.address === '4, Fictional Road, Surat, Gujarat, 395003'
  && JSON.stringify(c3.nature_of_business) === '["Retail Business"]' && Array.isArray(c3.filings) && c3.filings.length === 0,
  'ok row: a cancelled GSTIN, the address built from its parts, an empty filing table []', c3);
ok(pageSearches(V1) === 1 && pageSearches(V2) === 0 && pageSearches(V3) === 0 && b.payload.flow === 'replay' && c3.payload.flow === 'replay'
  && portalCalls.some((p) => p.url === API_TP && p.body.includes(V3) && p.headers.at === 'page-token'),
  'replay: after the page\'s own request is seen, it is sent again (same address, body, headers) for the next GSTINs', { xhr: P.pageXhr, portalCalls });
const posts = calls.filter((c) => c.url.startsWith(DB + '/rest/v1/vendor_gstin_lookups'));
ok(posts.every((p) => p.headers['x-gst-actor'] === GITA && p.headers['x-gst-source'] === 'extension' && p.headers.apikey === ANON), 'every insert names the app user and the extension (x-gst-actor / x-gst-source)', posts.map((p) => p.headers));
ok(!portalCalls.some((p) => /\/services\/api\/search\/taxpayerDetails/.test(p.url)) && portalCalls.every((p) => /\/services\/auth\//.test(p.url)),
  'never the public (CAPTCHA) search API; replays only to logged-in addresses', portalCalls.map((p) => p.url));
ok(sleeps.filter((ms) => ms >= 2000 && ms < 3000).length >= 2, 'GSTINs are paced 2 to 3 s apart', sleeps);

// 4. The page only (answers not JSON): every column read off the page, the
//    page's "no records" as not_found, a clean reload after it, and an FY the
//    page's dropdown offers chosen for the filing table.
reset({ domOnly: true });
storage.gstk_active_job = job({ gstins: [V1, V2, V3], period: '04/2024', periods: ['04/2024', '04/2025'] });
d = await drive(WELCOME);
r = rows();
const p1 = r[0] || {};
ok(d.end === 'done' && r.length === 3 && r.map((x) => x.status).join() === 'ok,not_found,ok', 'page only: ok, not_found, ok', r.map((x) => [x.gstin, x.status, x.error]));
ok(p1.legal_name === TP1.lgnm && p1.trade_name === TP1.tradeNam && p1.reg_status === 'Active' && p1.reg_date === '2017-07-01' && p1.constitution === TP1.ctb
  && p1.taxpayer_type === 'Regular' && p1.state_jurisdiction === TP1.stj && p1.centre_jurisdiction === TP1.ctj && p1.address === TP1.pradr.adr
  && JSON.stringify(p1.nature_of_business) === JSON.stringify(TP1.nba) && p1.ato_slab === 'Slab: Rs. 100 Cr. to 500 Cr. (FY 2024-2025)',
  'page only: the labels mapped to the columns (jurisdiction by its STATE / CENTER qualifier)', p1);
ok(p1.payload.sources.legal_name === 'page' && p1.payload.sources.filings === 'page' && p1.payload.json.details === null, 'page only: payload says each column came from the page', p1.payload);
ok(Array.isArray(p1.filings) && p1.filings.length === 3 && p1.filings.some((f) => f.fy === '2024-2025' && f.taxp === 'March' && f.dof === '2025-04-11')
  && p1.payload.fys.some((x) => x.fy === '2024-25' && x.note === 'read') && p1.payload.fys.some((x) => x.fy === '2025-26' && x.note === 'shown'),
  'page only: the FY dropdown chosen for each FY of the job, every table row kept', { filings: p1.filings, fys: p1.payload.fys });
ok(/No records found/.test(r[1].error) && r[1].payload.flow === 'page', 'page only: the page\'s "No records found" is not_found', r[1]);
ok(d.visits.filter((v) => v === SEARCH).length >= 2 && pageSearches(V3) === 1 && portalCalls.length === 0,
  'page only: a clean reload after "No records found" (never read as the next GSTIN\'s answer); no replay without JSON', { visits: d.visits, n: pageSearches(V3) });

// 5. The firewall's "Request Rejected" to the page's own request: an error row
//    after one retry, the run goes on (never "session ended").
reset({ kind: { [V1]: 'waf' } });
storage.gstk_active_job = job({ gstins: [V1, V3] });
d = await drive(WELCOME);
r = rows();
ok(d.end === 'done' && r.length === 2 && r[0].status === 'error' && r[1].status === 'ok', 'Request Rejected: an error row, then on to the next GSTIN', r.map((x) => [x.gstin, x.status, x.error]));
ok(/Request Rejected.*support ID 1234567890123456789/.test(r[0].error) && /still open/.test(r[0].error) && !/session ended/.test(r[0].error)
  && r[0].payload.refused[0].kind === 'request_rejected' && r[0].payload.tries === 2,
  'Request Rejected: named as the firewall\'s refusal with its support ID, tried twice, not a session end', r[0]);
ok(pageSearches(V1) === 2 && d.visits.filter((v) => v === SEARCH).length === 2 && /done: 1 found, 0 not found, 1 failed/.test(d.doc.banner()),
  'Request Rejected: one retry after reloading the page; the run finishes', { visits: d.visits, b: d.doc.banner() });

// 6. HTTP 403 with the person still logged in: the same, never a session end.
reset({ kind: { [V1]: '403' } });
storage.gstk_active_job = job({ gstins: [V1, V3] });
d = await drive(WELCOME);
r = rows();
ok(d.end === 'done' && r.length === 2 && r[0].status === 'error' && /HTTP 403/.test(r[0].error) && /still open/.test(r[0].error) && r[1].status === 'ok'
  && !d.visits.includes(LOGIN) && !storage.gstk_active_job,
  '403 while logged in: an error row, no re-login, the run goes on and finishes', { rows: r.map((x) => [x.status, x.error]), visits: d.visits });

// 7. A replay the firewall refuses: that GSTIN on the page instead, replay off for the run.
reset({ replay: 'waf' });
storage.gstk_active_job = job({ gstins: [V1, V3, V4] });
d = await drive(WELCOME);
r = rows();
ok(d.end === 'done' && r.length === 3 && r.every((x) => x.status === 'ok'), 'replay refused: every GSTIN still found', r.map((x) => [x.gstin, x.status, x.error]));
ok(portalCalls.length === 1 && pageSearches(V3) === 1 && pageSearches(V4) === 1 && /Request Rejected/.test(r[1].payload.replayOff.reason) && r[1].payload.flow === 'page',
  'replay refused: asked once, then the page for that GSTIN and the rest', { portalCalls, replayOff: r[1].payload.replayOff });

// 8. A real logout midway: the client's login again, then on from the GSTIN not yet saved.
reset({ kind: { [V3]: 'logout' } });
storage.gstk_active_job = job({ gstins: [V1, V3, V4] });
d = await drive(WELCOME);
ok(d.end === 'login' && rows().length === 1 && rows()[0].gstin === V1 && storage.gstk_active_job.gs.relogins === 1 && storage.gstk_active_job.gs.idx === 1,
  'logout: the job goes back to the login step, V1 saved, V3 not', { end: d.end, gs: storage.gstk_active_job && storage.gstk_active_job.gs, rows: rows().map((x) => x.gstin) });
ok(banners.some((t) => /session ended.*Logging in again \(1 of 2\).*from vendor GSTIN 2 of 3/.test(t)), 'logout: the banner says it logs in again', banners.slice(-4));
// The person types the login CAPTCHA; the portal is logged in again.
P.loggedIn = true; P.kind = {};
pg = await runPage(WELCOME);
ok(storage.gstk_active_job && storage.gstk_active_job.step === 'gstin_search' && pg.nav === WELCOME, 'logout: after the login, back to the lookups', storage.gstk_active_job);
d = await drive(WELCOME);
r = rows();
ok(d.end === 'done' && r.map((x) => x.gstin + ':' + x.status).join() === [V1 + ':ok', V3 + ':ok', V4 + ':ok'].join(), 'logout: resumed after the last saved GSTIN, one row each', r.map((x) => [x.gstin, x.status]));

// 9. A third session loss in one run stops it, with the reason.
reset();
storage.gstk_active_job = job({ gstins: [V1, V3], gs: { idx: 1, ok: 1, not_found: 0, error: 0, errorsInRow: 0, saveFails: 0, relogins: 2 } });
pg = await runPage(LOGIN);
ok(!storage.gstk_active_job && /stopped: the portal session ended again .*after 2 logins again/.test(pg.document.banner()) && rows().length === 0,
  'a third session loss: the run stops and says why', pg.document.banner());

// 10. Sent to the login page at the start: the login again (not a stop).
reset();
storage.gstk_active_job = job({ gstins: [V1] });
pg = await runPage(LOGIN);
ok(storage.gstk_active_job && storage.gstk_active_job.step === 'login' && storage.gstk_active_job.gs.relogins === 1 && rows().length === 0 && pg.nav === LOGIN,
  'bounced to login: logs in again, nothing saved', storage.gstk_active_job);

// 11. A CAPTCHA on the page: waited for a person (never filled), then Search;
//     one never typed: an error row after 3 minutes, and the run goes on.
reset({ captcha: true, replay: 'waf' });
storage.gstk_active_job = job({ gstins: [V1, V3, V4] });
const person = setInterval(() => {
  const cp = curPage;
  if (!cp || !cp.W.captchaBox) return;
  const g = String((cp.document.querySelector('#for_gstin') || {}).value || '');
  if (g && g !== V3 && !cp.W.captchaBox.value) cp.W.captchaBox.value = 'ABC123';
}, 15);
d = await drive(WELCOME);
clearInterval(person);
r = rows();
ok(d.end === 'done' && r.map((x) => x.status).join() === 'ok,error,ok', 'captcha: ok, error (never typed), ok', r.map((x) => [x.gstin, x.status, x.error]));
ok(/CAPTCHA.*not typed within 3 minutes/.test(r[1].error) && r[1].payload.kind === 'captcha_timeout', 'captcha: the reason names the CAPTCHA wait', r[1]);
ok(banners.some((t) => /Type the CAPTCHA on the portal page to continue/.test(t)), 'captcha: the banner asks a person to type it', banners.filter((t) => /CAPTCHA/.test(t)).slice(0, 2));
ok(pageSearches(V3) === 0, 'captcha: Search is never pressed with the CAPTCHA box empty (GST Keeper never fills it)', P.pageXhr);

// 12. Five failed lookups in a row stop the run, with the last reason.
reset({ kind: { [V1]: 'hang', [V2]: 'hang', [V3]: 'hang', [V4]: 'hang', [V5]: 'hang' } });
storage.gstk_active_job = job({ gstins: [V1, V2, V3, V4, V5, V6] });
d = await drive(WELCOME, 60);
r = rows();
ok(d.end === 'done' && r.length === 5 && r.every((x) => x.status === 'error' && /no result within 45 s/.test(x.error))
  && /stopped: 5 lookups failed in a row \(last: no result within 45 s\).*1 not looked up/.test(d.doc.banner()),
  'five failures in a row: five error rows, then stop with the last reason', { rows: r.map((x) => x.error), b: d.doc.banner() });

// 13. Four failures then a success: the run goes on (only 5 in a row stop it).
reset({ kind: { [V1]: 'hang', [V2]: 'hang', [V3]: 'hang', [V4]: 'hang' } });
storage.gstk_active_job = job({ gstins: [V1, V2, V3, V4, V5, V6] });
d = await drive(WELCOME, 60);
ok(d.end === 'done' && rows().length === 6 && /done: 2 found, 0 not found, 4 failed/.test(d.doc.banner()), 'four failures then found: the run finishes', d.doc.banner());

// 14. GST Keeper does not take the rows: stop after two failed saves.
reset();
lookupsDown = true;
storage.gstk_active_job = job({ gstins: [V1, V2, V3] });
d = await drive(WELCOME);
ok(rows().length === 2 && !storage.gstk_active_job && /did not take the lookups/.test(d.doc.banner()), 'database down: two tries, then stop', d.doc.banner());

// 15. A reload midway resumes after the last saved GSTIN.
reset();
storage.gstk_active_job = job({ gstins: [V1, V2, V3], gs: { idx: 2, ok: 1, not_found: 1, error: 0, errorsInRow: 0, saveFails: 0, relogins: 0 } });
d = await drive(SEARCH);
ok(rows().length === 1 && rows()[0].gstin === V3 && /done: 2 found, 1 not found/.test(d.doc.banner()), 'resume: only the GSTIN not yet done', { rows: rows().map((x) => x.gstin), b: d.doc.banner() });

// 16. No Search Taxpayer page anywhere: each address tried once, then stop.
reset({ noSearchPage: true });
storage.gstk_active_job = job({ gstins: [V1, V2] });
d = await drive(WELCOME);
ok(d.end === 'done' && rows().length === 0 && d.visits.join() === [WELCOME, SEARCH, ORIGIN + '/services/searchtp'].join()
  && /could not open the portal's Search Taxpayer page/.test(d.doc.banner()),
  'no search page: the fallback addresses tried once each, then stop', { visits: d.visits, b: d.doc.banner() });

// 17. inject.js keeps its copies on services.gst.gov.in only, and copies GSTR-9 as before.
{
  class PageURL extends URL {}
  const mk = (host) => {
    const store = new Map();
    const X = makeXHR();
    const W = { location: { hostname: host }, sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, XMLHttpRequest: X, URL: PageURL, FileReader: class {}, Blob: class {}, JSON, Date, setTimeout, postMessage() {}, fetch: async () => new Response('{}') };
    W.window = W;
    vm.runInNewContext(injectSrc, vm.createContext(W));
    return { W, store };
  };
  resetPortal();
  const s1 = mk('services.gst.gov.in');
  const x = new s1.W.XMLHttpRequest(); x.open('POST', API_TP); x.setRequestHeader('at', 't'); x.send(JSON.stringify({ gstin: V1 }));
  const s2 = mk('return.gst.gov.in');
  const y = new s2.W.XMLHttpRequest(); y.open('POST', API_TP); y.send(JSON.stringify({ gstin: V1 }));
  await new Promise((res) => setTimeout(res, 20));
  const kept = JSON.parse(s1.store.get('__gstkGS') || '[]');
  ok(kept.length === 1 && kept[0].url === API_TP && kept[0].method === 'POST' && kept[0].status === 200 && kept[0].json.lgnm === TP1.lgnm
    && kept[0].reqHeaders.at === 't' && JSON.parse(kept[0].reqBody).gstin === V1 && !s2.store.has('__gstkGS'),
    'inject.js: the page\'s own search request and answer copied on services.gst.gov.in only', { kept, other: [...s2.store.keys()] });
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
