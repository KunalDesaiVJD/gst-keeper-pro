// In-memory PostgREST / Supabase emulator installed as a Playwright route handler.
// Nothing ever leaves the machine: *.supabase.co is answered here, Google Fonts
// come from a local cache, everything else is aborted and logged.
//
// Modes
//   strict  (default) — answers exactly as PostgREST would against the schema the
//           repo declares (types.ts ∪ migrations): unknown column → 400 42703,
//           unknown embed → 400 PGRST200, unknown write key → 400 PGRST204,
//           missing NOT NULL column → 400 23502, unknown table → 404 PGRST205.
//   lenient — tolerates unknown columns (returns null / stores them) and skips
//           NOT NULL checks, to show what a screen was *meant* to look like.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname);

export function createDb(buildData) {
  let tables;
  const db = {
    reset() { tables = structuredClone(buildData().tables); },
    get tables() { return tables; },
  };
  db.reset();
  return db;
}

// ───────────────────────── tiny PDF ─────────────────────────
function makePdf(text) {
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const stream = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET\nBT /F1 11 Tf 60 735 Td (Placeholder served by the audit mock - fictional demo data only.) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const PDF = makePdf('MOCK DOCUMENT');

// ───────────────────────── select parser ─────────────────────────
function parseSelect(s) {
  let i = 0;
  const parseList = () => {
    const items = [];
    while (i < s.length && s[i] !== ')') {
      items.push(parseItem());
      if (s[i] === ',') i++;
    }
    return items;
  };
  const parseItem = () => {
    const start = i;
    while (i < s.length && !',()'.includes(s[i])) i++;
    let token = s.slice(start, i).trim();
    if (s[i] === '(') {
      i++;
      const children = parseList();
      i++;
      let spread = false;
      if (token.startsWith('...')) { spread = true; token = token.slice(3); }
      let alias = null;
      const ci = token.indexOf(':');
      if (ci >= 0) { alias = token.slice(0, ci); token = token.slice(ci + 1); }
      const parts = token.split('!');
      const hints = parts.slice(1);
      return { type: 'embed', rel: parts[0], alias, inner: hints.includes('inner'), hint: hints.find((h) => h !== 'inner' && h !== 'left') || null, spread, children };
    }
    if (token === '*' || token === '') return { type: 'star' };
    let name = token, alias = null;
    const castIdx = name.indexOf('::');
    if (castIdx >= 0) name = name.slice(0, castIdx);
    const ci = name.indexOf(':');
    if (ci >= 0) { alias = name.slice(0, ci); name = name.slice(ci + 1); }
    let jsonPath = null;
    const ar = name.indexOf('->');
    if (ar >= 0) { jsonPath = name.slice(ar); name = name.slice(0, ar); }
    return { type: 'col', name, alias, jsonPath };
  };
  return parseList();
}

// ───────────────────────── filters ─────────────────────────
const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'match', 'imatch', 'is', 'in', 'cs', 'cd', 'ov', 'fts', 'plfts', 'phfts', 'wfts', 'isdistinct']);
const isoish = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
function cmp(val, arg) {
  if (typeof val === 'number') { const n = Number(arg); return val < n ? -1 : val > n ? 1 : 0; }
  if (typeof val === 'boolean') { const b = arg === 'true'; return val === b ? 0 : (val ? 1 : -1); }
  const sv = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (isoish(sv) && isoish(arg)) { const a = Date.parse(sv.length === 10 ? sv + 'T00:00:00Z' : sv), b = Date.parse(arg.length === 10 ? arg + 'T00:00:00Z' : arg); if (!isNaN(a) && !isNaN(b)) return a < b ? -1 : a > b ? 1 : 0; }
  return sv < arg ? -1 : sv > arg ? 1 : 0;
}
const likeRe = (pat, ci) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.') + '$', ci ? 'is' : 's');
function parseInList(arg) {
  const inner = arg.replace(/^\(/, '').replace(/\)$/, '');
  const out = []; let cur = '', q = false;
  for (const ch of inner) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { out.push(cur); cur = ''; continue; } cur += ch; }
  if (cur.length || inner.endsWith(',')) out.push(cur);
  return out;
}
const parseArr = (arg) => { const s = arg.trim(); if (s.startsWith('[')) { try { return JSON.parse(s); } catch { return []; } } return parseInList(s.replace(/^\{/, '(').replace(/\}$/, ')')); };
function evalOp(val, op, arg) {
  switch (op) {
    case 'eq': return val != null && cmp(val, arg) === 0;
    case 'neq': return val != null && cmp(val, arg) !== 0;
    case 'gt': return val != null && cmp(val, arg) > 0;
    case 'gte': return val != null && cmp(val, arg) >= 0;
    case 'lt': return val != null && cmp(val, arg) < 0;
    case 'lte': return val != null && cmp(val, arg) <= 0;
    case 'like': return val != null && likeRe(arg, false).test(String(val));
    case 'ilike': return val != null && likeRe(arg, true).test(String(val));
    case 'match': return val != null && new RegExp(arg).test(String(val));
    case 'imatch': return val != null && new RegExp(arg, 'i').test(String(val));
    case 'is': {
      const a = arg.toLowerCase();
      if (a === 'null' || a === 'unknown') return val == null;
      if (a === 'true') return val === true;
      if (a === 'false') return val === false;
      return false;
    }
    case 'isdistinct': return String(val) !== arg;
    case 'in': return val != null && parseInList(arg).some((x) => cmp(val, x) === 0);
    case 'cs': { if (!Array.isArray(val)) return false; const need = parseArr(arg); return need.every((x) => val.map(String).includes(String(x))); }
    case 'cd': { if (!Array.isArray(val)) return false; const allow = parseArr(arg).map(String); return val.every((x) => allow.includes(String(x))); }
    case 'ov': { if (!Array.isArray(val)) return false; const o = parseArr(arg).map(String); return val.some((x) => o.includes(String(x))); }
    default: return true; // fts etc. — treated as pass-through
  }
}
// "not.eq.x" / "eq.x" / "in.(a,b)"
function parseExpr(expr) {
  let neg = false, e = expr;
  if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
  const dot = e.indexOf('.');
  const op = dot >= 0 ? e.slice(0, dot) : e;
  const arg = dot >= 0 ? e.slice(dot + 1) : '';
  if (!OPS.has(op)) return { bad: true, op };
  return { neg, op, arg };
}
function evalLeaf(row, col, expr) {
  const p = parseExpr(expr);
  if (p.bad) return true;
  const val = row[col];
  const r = evalOp(val, p.op, p.arg);
  if (!p.neg) return r;
  if (p.op === 'is') return !r;
  return val != null && !r;
}
// or=(a.eq.1,b.is.null,and(c.gt.2,d.lt.3))
function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function evalLogic(row, kind, body, neg, cols) {
  const inner = body.replace(/^\(/, '').replace(/\)$/, '');
  const parts = splitTop(inner);
  const results = parts.map((p) => {
    const m = p.match(/^(not\.)?(or|and)\((.*)\)$/s);
    if (m) return evalLogic(row, m[2], '(' + m[3] + ')', !!m[1], cols);
    const dot = p.indexOf('.');
    const col = p.slice(0, dot);
    cols.push(col);
    return evalLeaf(row, col, p.slice(dot + 1));
  });
  const r = kind === 'or' ? results.some(Boolean) : results.every(Boolean);
  return neg ? !r : r;
}

// ───────────────────────── PostgREST errors ─────────────────────────
const err = (status, code, message, details = null, hint = null) => ({ status, body: { code, details, hint, message } });

export async function installMock(context, opts) {
  const { db, schema, getMode = () => 'strict', onLog = () => {}, fontDir } = opts;
  let tick = 0;
  const nowMs = opts.nowMs || (() => Date.now()); // browser clock is fixed; callers pass the same instant
  const nowIso = () => new Date(nowMs() + (++tick) * 1000).toISOString();
  const T = schema.tables;
  const cols = (t) => T[t]?.columns || [];
  const hasCol = (t, c) => cols(t).includes(c);
  let idSeq = 900000;
  const newId = () => `${crypto.randomUUID().slice(0, 8)}-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`;

  // font cache
  const fontCss = fontDir && fs.existsSync(path.join(fontDir, 'fonts.css')) ? fs.readFileSync(path.join(fontDir, 'fonts.css'), 'utf8') : null;

  function resolveRel(parent, node) {
    const P = T[parent];
    if (!P) return null;
    const target = node.rel;
    if (T[target]) {
      let fks = P.fks.filter((f) => f.refTable === target);
      if (node.hint) fks = fks.filter((f) => f.col === node.hint || node.hint.includes(f.col));
      if (fks.length) return { kind: 'm2o', target, col: fks[0].col, refCol: fks[0].refCol };
      let back = T[target].fks.filter((f) => f.refTable === parent);
      if (node.hint) back = back.filter((f) => f.col === node.hint || node.hint.includes(f.col));
      if (back.length) return { kind: 'o2m', target, col: back[0].col, refCol: back[0].refCol };
      return null;
    }
    const fk = P.fks.find((f) => f.col === target);
    if (fk) return { kind: 'm2o', target: fk.refTable, col: fk.col, refCol: fk.refCol };
    return null;
  }

  // validate select tree; returns error or null
  function validateSelect(table, nodes, strict) {
    for (const n of nodes) {
      if (n.type === 'col' && strict && !hasCol(table, n.name)) return err(400, '42703', `column ${table}.${n.name} does not exist`);
      if (n.type === 'embed') {
        const rel = resolveRel(table, n);
        if (!rel) return err(400, 'PGRST200', `Could not find a relationship between '${table}' and '${n.rel}' in the schema cache`, `Searched for a foreign key relationship between '${table}' and '${n.rel}' in the schema 'public', but no matches were found.`);
        const e = validateSelect(rel.target, n.children, strict);
        if (e) return e;
      }
    }
    return null;
  }
  function project(table, row, nodes) {
    const out = {};
    for (const n of nodes) {
      if (n.type === 'star') { for (const c of cols(table)) out[c] = row[c] ?? null; for (const k of Object.keys(row)) if (!(k in out)) out[k] = row[k]; continue; }
      if (n.type === 'col') {
        let v = row[n.name] ?? null;
        if (n.jsonPath && v && typeof v === 'object') {
          const keys = n.jsonPath.split(/->>?/).filter(Boolean).map((k) => k.replace(/'/g, ''));
          for (const k of keys) v = v == null ? null : v[k];
        }
        out[n.alias || (n.jsonPath ? n.jsonPath.split(/->>?/).pop().replace(/'/g, '') : n.name)] = v ?? null;
        continue;
      }
      if (n.type === 'embed') {
        const rel = resolveRel(table, n);
        const rows = db.tables[rel.target] || [];
        let val;
        if (rel.kind === 'm2o') {
          const hit = row[rel.col] == null ? null : rows.find((r) => r[rel.refCol] === row[rel.col]);
          val = hit ? project(rel.target, hit, n.children) : null;
        } else {
          val = rows.filter((r) => r[rel.col] === row[rel.refCol]).map((r) => project(rel.target, r, n.children));
        }
        if (n.spread && val && !Array.isArray(val)) Object.assign(out, val);
        else out[n.alias || n.rel] = val;
      }
    }
    return out;
  }

  function applyFilters(table, rows, sp, strict) {
    const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
    let list = rows;
    for (const [key, value] of sp.entries()) {
      if (RESERVED.has(key)) continue;
      const lk = key.match(/^(not\.)?(or|and)$/);
      if (lk) {
        const seen = [];
        list = list.filter((r) => evalLogic(r, lk[2], value, !!lk[1], seen));
        if (strict) for (const c of seen) if (!hasCol(table, c)) return { error: err(400, '42703', `column ${table}.${c} does not exist`) };
        continue;
      }
      if (key.includes('.')) continue; // embedded-resource filter — not used by the module
      if (strict && !hasCol(table, key)) return { error: err(400, '42703', `column ${table}.${key} does not exist`) };
      const p = parseExpr(value);
      if (p.bad) return { error: err(400, 'PGRST100', `"failed to parse filter (${value})" (line 1, column 1)`) };
      list = list.filter((r) => evalLeaf(r, key, value));
    }
    return { rows: list };
  }

  function applyOrder(table, rows, orderStr, strict) {
    if (!orderStr) return { rows };
    const terms = orderStr.split(',').map((t) => {
      const [col, ...mods] = t.split('.');
      const desc = mods.includes('desc');
      const nullsFirst = mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : desc;
      return { col, desc, nullsFirst };
    });
    if (strict) for (const t of terms) if (!t.col.includes('(') && !hasCol(table, t.col)) return { error: err(400, '42703', `column ${table}.${t.col} does not exist`) };
    const sorted = [...rows].sort((a, b) => {
      for (const t of terms) {
        const va = a[t.col], vb = b[t.col];
        if (va == null && vb == null) continue;
        if (va == null) return t.nullsFirst ? -1 : 1;
        if (vb == null) return t.nullsFirst ? 1 : -1;
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : cmp(va, String(vb));
        if (c !== 0) return t.desc ? -c : c;
      }
      return 0;
    });
    return { rows: sorted };
  }

  const TABLE_DEFAULTS = {
    gst_notices: { source: 'notices', staff_status: null },
    litigation_matters: { lifecycle: 'demand', stage: 'Captured', status: 'Open', priority: 'Medium', demand_tax: 0, demand_interest: 0, demand_penalty: 0, demand_cess: 0, paid_total: 0, pre_deposit_total: 0 },
    matter_payments: { kind: 'voluntary', tax: 0, interest: 0, penalty: 0, cess: 0 },
    matter_hearings: { mode: 'physical', adjourned: false },
    matter_documents: { kind: 'notice', source: 'upload' },
    matter_deadlines: { source: 'computed', is_met: false },
    email_outbox: { status: 'pending' },
    notice_alert_log: { status: 'sent' },
  };
  const UNIQUE = { litigation_matters: [['client_id', 'matter_no']], gst_notices: [['client_id', 'source', 'portal_key']] };
  const FK_CHECK = { email_outbox: [{ col: 'template_key', table: 'email_templates', ref: 'key', name: 'email_outbox_template_key_fkey' }] };

  function buildRow(table, obj) {
    const now = nowIso();
    const row = {};
    for (const c of cols(table)) row[c] = null;
    Object.assign(row, TABLE_DEFAULTS[table] || {});
    for (const c of ['created_at', 'updated_at', 'first_seen_at', 'last_seen_at', 'pulled_at', 'changed_at', 'granted_at', 'joined_at']) if (hasCol(table, c)) row[c] = now;
    if (hasCol(table, 'id')) row.id = newId();
    Object.assign(row, obj);
    return row;
  }

  function respond(route, status, body, headers = {}, method = 'GET') {
    const h = { 'content-type': 'application/json; charset=utf-8', ...CORS(route), ...headers };
    const payload = method === 'HEAD' || body === undefined || body === null && status === 204 ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    return route.fulfill({ status, headers: h, body: payload });
  }
  function CORS(route) {
    const reqHeaders = route.request().headers()['access-control-request-headers'];
    return {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
      'access-control-allow-headers': reqHeaders || 'authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-retry-count,accept',
      'access-control-expose-headers': 'Content-Range,Range,Content-Location,Preference-Applied,X-Total-Count,Location',
    };
  }

  async function handleRest(route, req, url) {
    const method = req.method();
    const headers = req.headers();
    const strict = getMode() !== 'lenient';
    const parts = url.pathname.split('/').filter(Boolean); // rest, v1, table
    const table = decodeURIComponent(parts[2] || '');
    const sp = url.searchParams;
    const accept = headers['accept'] || '';
    const wantsObject = accept.includes('vnd.pgrst.object');
    const prefer = Object.fromEntries((headers['prefer'] || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => { const [k, v] = p.split('='); return [k, v ?? true]; }));
    const log = { method, table, query: decodeURIComponent(url.search).slice(0, 400) };

    if (table === 'rpc') {
      const fn = parts[3];
      const res = err(404, 'PGRST202', `Could not find the function public.${fn} without parameters in the schema cache`);
      onLog({ ...log, table: 'rpc/' + fn, status: res.status, code: res.body.code, message: res.body.message, unhandled: true });
      return respond(route, res.status, res.body);
    }
    if (!T[table] && !db.tables[table]) {
      const res = err(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`);
      onLog({ ...log, status: 404, code: res.body.code, message: res.body.message });
      return respond(route, 404, res.body);
    }
    const rows = db.tables[table] || (db.tables[table] = []);
    const finish = (status, body, extraHeaders, code, message) => { onLog({ ...log, status, code, message }); return respond(route, status, body, extraHeaders, method); };
    const fail = (e) => finish(e.status, e.body, {}, e.body.code, e.body.message);

    const nodes = parseSelect(sp.get('select') || '*');

    if (method === 'GET' || method === 'HEAD') {
      const ve = validateSelect(table, nodes, strict);
      if (ve) return fail(ve);
      const f = applyFilters(table, rows, sp, strict);
      if (f.error) return fail(f.error);
      const o = applyOrder(table, f.rows, sp.get('order'), strict);
      if (o.error) return fail(o.error);
      let list = o.rows;
      // !inner embeds filter parents
      for (const n of nodes) if (n.type === 'embed' && n.inner) {
        const rel = resolveRel(table, n);
        list = list.filter((r) => rel.kind === 'm2o' ? (db.tables[rel.target] || []).some((x) => x[rel.refCol] === r[rel.col]) : (db.tables[rel.target] || []).some((x) => x[rel.col] === r[rel.refCol]));
      }
      const total = list.length;
      let offset = Number(sp.get('offset') || 0), limit = sp.get('limit') != null ? Number(sp.get('limit')) : Infinity;
      const range = headers['range'];
      if (range && /^\d+-\d*$/.test(range)) { const [a, b] = range.split('-'); offset = Number(a); if (b) limit = Number(b) - offset + 1; }
      const page = list.slice(offset, offset + limit).map((r) => project(table, r, nodes));
      const cr = page.length ? `${offset}-${offset + page.length - 1}/${prefer.count ? total : '*'}` : `*/${prefer.count ? total : '*'}`;
      if (wantsObject) {
        if (page.length !== 1) return finish(406, { code: 'PGRST116', details: `The result contains ${page.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, {}, 'PGRST116', `${page.length} rows`);
        return finish(200, page[0], { 'content-range': cr });
      }
      return finish(200, page, { 'content-range': cr });
    }

    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }

    if (method === 'POST') {
      const arr = Array.isArray(body) ? body : body ? [body] : [];
      const upsert = String(prefer.resolution || '').includes('duplicates');
      const onConflict = (sp.get('on_conflict') || '').split(',').filter(Boolean);
      const inserted = [];
      for (const obj of arr) {
        if (strict) {
          for (const k of Object.keys(obj)) if (!hasCol(table, k)) return fail(err(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`));
          for (const req2 of T[table]?.required || []) {
            if (obj[req2] == null && !(TABLE_DEFAULTS[table] && TABLE_DEFAULTS[table][req2] != null) && req2 !== 'id') {
              return fail(err(400, '23502', `null value in column "${req2}" of relation "${table}" violates not-null constraint`, 'Failing row contains (…).'));
            }
          }
          for (const fk of FK_CHECK[table] || []) {
            if (obj[fk.col] != null && !(db.tables[fk.table] || []).some((r) => r[fk.ref] === obj[fk.col])) {
              return fail(err(409, '23503', `insert or update on table "${table}" violates foreign key constraint "${fk.name}"`, `Key (${fk.col})=(${obj[fk.col]}) is not present in table "${fk.table}".`));
            }
          }
        }
        const keySets = onConflict.length ? [onConflict] : (UNIQUE[table] || []);
        let existing = null;
        for (const ks of keySets) { existing = rows.find((r) => ks.every((k) => r[k] != null && r[k] === obj[k])); if (existing) break; }
        if (existing && !upsert) return fail(err(409, '23505', `duplicate key value violates unique constraint "uq_${table}"`, 'Key already exists.'));
        if (existing && upsert) { if (prefer.resolution !== 'ignore-duplicates') Object.assign(existing, obj); inserted.push(existing); continue; }
        const row = buildRow(table, obj);
        rows.push(row);
        inserted.push(row);
      }
      if (prefer.return === 'representation') {
        const ve = validateSelect(table, nodes, strict);
        if (ve) return fail(ve);
        const out = inserted.map((r) => project(table, r, nodes));
        if (wantsObject) return out.length === 1 ? finish(201, out[0]) : finish(406, { code: 'PGRST116', details: `The result contains ${out.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, {}, 'PGRST116');
        return finish(201, out);
      }
      return finish(201, '', {});
    }

    if (method === 'PATCH' || method === 'DELETE') {
      if (method === 'PATCH' && strict && body) for (const k of Object.keys(body)) if (!hasCol(table, k)) return fail(err(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`));
      const f = applyFilters(table, rows, sp, strict);
      if (f.error) return fail(f.error);
      const hit = f.rows;
      if (method === 'PATCH') for (const r of hit) Object.assign(r, body || {});
      else db.tables[table] = rows.filter((r) => !hit.includes(r));
      const extra = prefer.count ? { 'content-range': `*/${hit.length}` } : {};
      if (prefer.return === 'representation') {
        const out = hit.map((r) => project(table, r, nodes));
        if (wantsObject) return out.length === 1 ? finish(200, out[0], extra) : finish(406, { code: 'PGRST116', details: `The result contains ${out.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, {}, 'PGRST116');
        return finish(200, out, extra);
      }
      return finish(204, '', extra, null, `${hit.length} row(s)`);
    }
    return finish(405, { message: 'method not allowed' }, {}, '405');
  }

  async function handleSupabase(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS(route), body: '' });
    if (p.startsWith('/rest/v1/')) return handleRest(route, req, url);
    if (p.startsWith('/storage/v1/')) {
      onLog({ method: req.method(), table: 'storage', query: p.slice(0, 200), status: 200 });
      if (req.method() === 'GET' && /\/object\/(public|sign|authenticated)\//.test(p)) return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', ...CORS(route) }, body: PDF });
      if (req.method() === 'POST' && /\/object\/sign\//.test(p)) return respond(route, 200, { signedURL: p.replace('/storage/v1', '') + '?token=mock' });
      if (req.method() === 'POST' || req.method() === 'PUT') return respond(route, 200, { Key: p.replace('/storage/v1/object/', ''), Id: newId() });
      return respond(route, 200, []);
    }
    if (p.startsWith('/functions/v1/')) {
      const fn = p.split('/')[3];
      if (fn === 'send-gst-email') {
        const pending = (db.tables.email_outbox || []).filter((r) => r.status === 'pending');
        pending.forEach((r) => { r.status = 'sent'; r.sent_at = nowIso(); });
        onLog({ method: req.method(), table: 'functions/' + fn, status: 200, message: `${pending.length} sent (mock)` });
        return respond(route, 200, { sent: pending.length, failed: 0, skipped: 0, errors: [] });
      }
      onLog({ method: req.method(), table: 'functions/' + fn, status: 404, unhandled: true });
      return respond(route, 404, { error: 'function not mocked' });
    }
    if (p.startsWith('/auth/v1/')) {
      onLog({ method: req.method(), table: 'auth' + p.slice(8), status: 200, unhandled: true });
      return respond(route, 200, {});
    }
    onLog({ method: req.method(), table: p, status: 404, unhandled: true });
    return respond(route, 404, { message: 'not mocked' });
  }

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'file:' || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '4173') return route.continue();
    if (/(^|\.)supabase\.co$/.test(url.hostname)) return handleSupabase(route);
    if (url.hostname === 'fonts.googleapis.com' && fontCss) return route.fulfill({ status: 200, headers: { 'content-type': 'text/css; charset=utf-8', 'access-control-allow-origin': '*' }, body: fontCss });
    if (url.hostname === 'fonts.gstatic.com' && fontDir) {
      const f = path.join(fontDir, url.pathname.slice(1).replace(/\//g, '_'));
      if (fs.existsSync(f)) return route.fulfill({ status: 200, headers: { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
    }
    onLog({ method: route.request().method(), table: 'BLOCKED ' + url.hostname, query: url.pathname.slice(0, 120), status: 0, blocked: true });
    return route.abort('blockedbyclient');
  });

  // Realtime websockets: answered locally, never connected to a server.
  await context.routeWebSocket(/.*/, (ws) => {
    onLog({ method: 'WS', table: 'websocket ' + new URL(ws.url()).hostname, status: 101, message: 'mocked (no server connection)' });
    ws.onMessage((message) => {
      let m; try { m = JSON.parse(String(message)); } catch { return; }
      if (Array.isArray(m)) {
        const [joinRef, ref, topic, event, payload] = m;
        if (['phx_join', 'heartbeat', 'access_token', 'phx_leave'].includes(event)) ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: event === 'phx_join' ? { postgres_changes: ((payload && payload.config && payload.config.postgres_changes) || []).map((c, i) => ({ ...c, id: i + 1 })) } : {} }]));
      } else if (m && m.event) {
        if (['phx_join', 'heartbeat', 'access_token', 'phx_leave'].includes(m.event)) ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: m.event === 'phx_join' ? { postgres_changes: ((m.payload && m.payload.config && m.payload.config.postgres_changes) || []).map((c, i) => ({ ...c, id: i + 1 })) } : {} }, ref: m.ref, join_ref: m.join_ref }));
      }
    });
  });
}

export function loadSchema() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'schema.json'), 'utf8'));
}
