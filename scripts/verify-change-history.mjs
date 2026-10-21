#!/usr/bin/env node
// Checks how the Change history page loads and reads the change log
// (src/lib/changeHistory.ts over the view gst_change_history, migration
// 20261021130000_gst_change_log.sql):
//   - the filters become the query PostgREST is sent (client, month, FY,
//     page, table, person, dates in India time), newest first, one page at a
//     time, each page starting below the last row read (keyset on at, seq);
//   - the stand-in sends at most 1,000 rows a request, as the live API does:
//     the Excel export still gets every change (2,500), and pages stay right
//     while changes are saved between them;
//   - run on the rows (a stand-in for PostgREST that applies those same
//     filters), the loader returns exactly the rows that match;
//   - every change reads as lines "field: old -> new" with readable names:
//     an update, an insert, a delete, the ITC figures inside the JSON, a
//     fingerprinted GSTR-1 document, a manual-entry allowance with its badge,
//     an Annual Return figure, the Liberal switch, a truncate, an error row;
//   - the Excel export has one row per changed field;
//   - the History buttons' links open the page filtered.
//
//   node scripts/verify-change-history.mjs [rows.json]
//
// With rows.json (what supabase/tests/change_log/run.sh exports from the log
// its SQL tests wrote through the real triggers), every check that can runs
// on those rows too. Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-history-')), 'changeHistory.mjs');
await build({ entryPoints: [path.join(root, 'src/lib/changeHistory.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'error' });
const H = await import(pathToFileURL(outfile).href);

let fail = 0;
let count = 0;
const ok = (cond, name) => { count++; if (!cond) { fail++; console.log('FAIL ' + name); } else if (process.env.VERBOSE) console.log('ok   ' + name); };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : `  [got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}]`));

// ── A stand-in for PostgREST over an array of view rows ─────────────────────
function splitTop(s) {
  const out = []; let depth = 0; let cur = ''; let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== '\\') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unquote = (v) => (v.startsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : v);
function condition(expr) {
  if (expr.startsWith('and(')) { const parts = splitTop(expr.slice(4, -1)).map(condition); return (r) => parts.every((p) => p(r)); }
  if (expr.startsWith('or(')) { const parts = splitTop(expr.slice(3, -1)).map(condition); return (r) => parts.some((p) => p(r)); }
  const m = expr.match(/^([a-z_]+)\.(eq|in|is|like|lt)\.(.*)$/);
  if (!m) throw new Error('stand-in cannot read ' + expr);
  const [, col, op, raw] = m;
  if (op === 'eq') { const v = unquote(raw); return (r) => String(r[col]) === v && r[col] !== null; }
  if (op === 'is') return (r) => (raw === 'null' ? r[col] === null || r[col] === undefined : String(r[col]) === raw);
  if (op === 'in') { const vals = splitTop(raw.slice(1, -1)).map(unquote); return (r) => vals.includes(r[col]); }
  if (op === 'lt') { const v = unquote(raw); return (r) => cmp(col, r[col], col === 'at' ? v : Number(v)) < 0; }
  const re = new RegExp('^' + unquote(raw).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.') + '$');
  return (r) => typeof r[col] === 'string' && re.test(r[col]);
}
// Compares as PostgREST would: times as instants, seq as a number.
function cmp(col, a, b) {
  const x = col === 'at' ? new Date(a).getTime() : a; const y = col === 'at' ? new Date(b).getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}
// The live API sends at most this many rows a request (checked 21 Oct 2026:
// Range 0-1000 on a 3,561-row table came back 0-999/3561).
const MAX_ROWS = 1000;
function standIn(rows, log) {
  return {
    from(view) {
      log.push(['from', view]);
      return {
        select(cols) {
          log.push(['select', cols]);
          const preds = []; const orders = []; let range = null; let limit = null;
          const q = {
            eq(c, v) { log.push(['eq', c, v]); preds.push((r) => r[c] === v); return q; },
            in(c, v) { log.push(['in', c, v]); preds.push((r) => v.includes(r[c])); return q; },
            gte(c, v) { log.push(['gte', c, v]); preds.push((r) => r[c] !== null && r[c] !== undefined && cmp(c, r[c], v) >= 0); return q; },
            lt(c, v) { log.push(['lt', c, v]); preds.push((r) => new Date(r[c]) < new Date(v)); return q; },
            lte(c, v) { log.push(['lte', c, v]); preds.push((r) => r[c] !== null && r[c] !== undefined && cmp(c, r[c], v) <= 0); return q; },
            limit(n) { log.push(['limit', n]); limit = n; return q; },
            or(f) { log.push(['or', f]); const parts = splitTop(f).map(condition); preds.push((r) => parts.some((p) => p(r))); return q; },
            order(c, o) { log.push(['order', c, o.ascending]); orders.push([c, o.ascending]); return q; },
            range(a, b) { log.push(['range', a, b]); range = [a, b]; return q; },
            then(resolve, reject) {
              try {
                let out = rows.filter((r) => preds.every((p) => p(r)));
                out = [...out].sort((x, y) => {
                  for (const [c, asc] of orders) {
                    const d = cmp(c, x[c], y[c]);
                    if (d) return asc ? d : -d;
                  }
                  return 0;
                });
                if (range) out = out.slice(range[0], range[1] + 1);
                if (limit !== null) out = out.slice(0, limit);
                out = out.slice(0, MAX_ROWS);
                return Promise.resolve({ data: out, error: null }).then(resolve, reject);
              } catch (e) { return Promise.reject(e).then(resolve, reject); }
            },
          };
          return q;
        },
      };
    },
  };
}

// ── Fictional rows in the view's shape ──────────────────────────────────────
const C1 = '20000000-0000-0000-0000-000000000001';
const C2 = '20000000-0000-0000-0000-000000000002';
const SAM = '10000000-0000-0000-0000-000000000001';
const GITA = '10000000-0000-0000-0000-000000000002';
// The view's fy: the row's own year, else its month's (gst_change_log_fy).
const fyOf = (fy, month) => {
  if (fy) return fy;
  const m = month?.match(/^(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const start = Number(m[2]) - (Number(m[1]) >= 4 ? 0 : 1);
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const row = (o) => {
  const r = { key: 'g' + o.log_id, seq: o.log_id, log: 'gst_change_log', row_id: null, row_label: null, client_id: C1, period_month: '09/2026',
    financial_year: null, actor_id: GITA, actor_name: 'Gita', actor_source: 'app', actor_basis: 'header', request_id: null, ...o };
  return { ...r, fy: fyOf(r.financial_year, r.period_month) };
};
const FIXTURE = [
  row({ log_id: 1, at: '2026-10-20T05:00:00+00:00', table_name: 'filing_status', op: 'UPDATE', row_label: 'GSTR-3B',
    changed: { arn: { old: null, new: 'AA240926000001' }, status: { old: 'Prepared', new: 'Filed' }, filed_date: { old: null, new: '2026-10-20' } } }),
  row({ log_id: 2, at: '2026-10-20T06:00:00+00:00', table_name: 'itc_summaries', op: 'UPDATE',
    changed: { data: { more: false, changes: [{ path: 'section4A[5.1].igst', old: 1000, new: 1200 }] } } }),
  row({ log_id: 3, at: '2026-10-20T07:00:00+00:00', table_name: 'gstr1_data', op: 'UPDATE', actor_id: null, actor_name: null, actor_source: 'unknown', actor_basis: 'none',
    changed: { raw_json: { summary: true, old: { summary: true, md5: 'aaaa1111', bytes: 120000, keys: 4 }, new: { summary: true, md5: 'bbbb2222', bytes: 121000, keys: 4 }, keys_changed: ['hsn'] } } }),
  row({ log_id: 4, at: '2026-10-20T08:00:00+00:00', table_name: 'bills_not_in_books', op: 'DELETE', row_label: 'ABC TRADERS · INV/9', actor_source: 'extension',
    changed: { supplier_name: 'ABC TRADERS', input_igst: 1800, is_carried_forward: true } }),
  row({ log_id: 5, at: '2026-10-21T04:00:00+00:00', table_name: 'manual_source_allowances', op: 'INSERT', actor_id: SAM, actor_name: 'Sam', row_label: 'filing:GSTR-3B',
    changed: { scope: 'filing:GSTR-3B', reason: 'Portal password wrong since 18 Oct', allowed_by: SAM, allowed_at: '2026-10-21T04:00:00+00:00' } }),
  row({ log_id: 6, at: '2026-10-21T05:00:00+00:00', table_name: 'twob_import_docs', op: 'INSERT', client_id: C2, row_label: 'XYZ · X/1',
    changed: { supplier_name: 'XYZ', taxable_value: 1000, itc_available: true } }),
  row({ log_id: 7, at: '2026-10-21T06:00:00+00:00', table_name: 'gst_cash_ledger_entries', op: 'TRUNCATE', actor_source: 'system', actor_basis: 'none', actor_id: null, actor_name: null, client_id: null, period_month: null,
    changed: { rows: 2 } }),
  row({ log_id: 8, at: '2026-10-21T06:30:00+00:00', table_name: 'builder_units', op: 'UPDATE', period_month: null, row_label: 'A-101',
    changed: { status: { old: 'unsold', new: 'booked' } } }),
  row({ log_id: 9, at: '2026-10-21T07:00:00+00:00', table_name: 'filing_status', op: 'UPDATE', changed: { _error: 'division by zero' } }),
  { key: 'a17', log: 'annual_return_change_log', log_id: 17, seq: -17, at: '2026-10-19T04:30:00+00:00', table_name: 'annual_return_docs', row_id: 'gstr9_t4',
    row_label: 'B2C supplies', client_id: C1, period_month: null, financial_year: '2025-26', fy: '2025-26', op: 'UPDATE', actor_id: GITA, actor_name: 'Gita',
    actor_source: 'app', actor_basis: 'row', changed: { 't4.a.taxable': { old: 1000, new: 1500 } }, request_id: null },
  { key: 'l00000000', log: 'client_liberal_log', log_id: null, seq: -1125899906842700, at: '2026-10-18T04:30:00+00:00', table_name: 'clients', row_id: C1, row_label: null,
    client_id: C1, period_month: null, financial_year: null, fy: null, op: 'UPDATE', actor_id: SAM, actor_name: 'Sam', actor_source: 'app', actor_basis: 'row',
    changed: { liberal_2b_reconciliation: { old: false, new: true } }, request_id: null },
];
const names = { [SAM]: 'Sam', [GITA]: 'Gita' };

// ── 1. The query sent ───────────────────────────────────────────────────────
{
  const log = [];
  await H.loadChangeHistory(standIn(FIXTURE, log), { clientId: C1, month: '09/2026', page: 'filing', actorId: GITA, from: '2026-10-01', to: '2026-10-21' }, null, 50);
  eq(log[0], ['from', 'gst_change_history'], 'reads the view');
  ok(log[1][1].split(',').includes('changed') && log[1][1].split(',').includes('actor_basis') && log[1][1].split(',').includes('seq'), 'selects the columns it shows, and seq');
  ok(log.some((l) => l[0] === 'gte' && l[1] === 'client_id' && l[2] === C1) && log.some((l) => l[0] === 'lte' && l[1] === 'client_id' && l[2] === C1),
    'client filter, leading: a range of one client (so the client index is read, round 2)');
  ok(log.some((l) => l[0] === 'eq' && l[1] === 'period_month' && l[2] === '09/2026'), 'month filter');
  ok(log.some((l) => l[0] === 'or' && l[1] === 'table_name.in.(filing_status),and(table_name.eq.manual_source_allowances,row_label.like."filing:*")'),
    'page filter: its tables, and the manual entries allowed for its returns');
  ok(log.some((l) => l[0] === 'eq' && l[1] === 'actor_id' && l[2] === GITA) && !log.some((l) => l[0] === 'or' && /actor/.test(l[1])),
    'person filter: one indexed column (the view names the Annual Return log\'s people)');
  ok(log.some((l) => l[0] === 'gte' && l[2] === '2026-10-01T00:00:00+05:30'), 'from: the start of the day in India');
  ok(log.some((l) => l[0] === 'lt' && l[2] === '2026-10-22T00:00:00+05:30'), 'to: inclusive, up to the next day in India');
  eq(log.filter((l) => l[0] === 'order'), [['order', 'client_id', true], ['order', 'at', false], ['order', 'seq', false]],
    'newest first by (at, seq), led by the one client: the index order, a stable order');
  eq(log.find((l) => l[0] === 'limit'), ['limit', 51], 'one page and one more row to know if there is more');
  ok(!log.some((l) => l[0] === 'range'), 'no offsets');
}
{
  const log = [];
  await H.loadChangeHistory(standIn(FIXTURE, log), {}, { at: '2026-10-21T05:00:00.123456+00:00', seq: 6 }, 10);
  ok(log.some((l) => l[0] === 'lte' && l[1] === 'at' && l[2] === '2026-10-21T05:00:00.123456+00:00')
    && log.some((l) => l[0] === 'or' && l[1] === 'at.lt."2026-10-21T05:00:00.123456+00:00",seq.lt.6'),
    'the next page: at or before the last row, and below it within the same moment');
  const big = [];
  await H.loadChangeHistory(standIn(FIXTURE, big), {}, null, 5000);
  eq(big.find((l) => l[0] === 'limit'), ['limit', 1000], 'never asks for more than the API sends (1,000)');
}
{
  const log = [];
  await H.loadChangeHistory(standIn(FIXTURE, log), { financialYear: '2025-26', page: 'builder' });
  const ors = log.filter((l) => l[0] === 'or').map((l) => l[1]);
  ok(log.some((l) => l[0] === 'gte' && l[1] === 'fy' && l[2] === '2025-26') && log.some((l) => l[0] === 'lte' && l[1] === 'fy' && l[2] === '2025-26')
    && !ors.some((o) => /financial_year|period_month/.test(o)),
    'financial year: one indexed column, fy (its own year, else its month\'s), never an or over twelve months');
  eq(log.filter((l) => l[0] === 'order').map((l) => l[1]), ['fy', 'at', 'seq'], 'a year with no client: led by the year (round 2: never the whole log)');
  const lead = (f) => { const l = []; return H.loadChangeHistory(standIn(FIXTURE, l), f).then(() => l.filter((x) => x[0] === 'order')[0]?.[1] ?? null); };
  eq([await lead({ month: '09/2026' }), await lead({ actorId: SAM }), await lead({ clientId: C1, financialYear: '2025-26' }), await lead({ from: '2026-10-01' })],
    ['period_month', 'actor_id', 'client_id', 'at'], 'the lead: a month, else a person, the client before a year, nothing for dates alone');
  ok(ors.includes('table_name.like.builder_*'), 'Builder: every builder table');
}
{
  const log = [];
  await H.loadChangeHistory(standIn(FIXTURE, log), { page: 'gstr3b' });
  eq(log.find((l) => l[0] === 'or')?.[1],
    'table_name.in.(gstr3b_adjustments,gstr3b_push_versions),and(table_name.eq.filing_status,row_label.in.(GSTR-3B,"GSTR-3B (Q)")),and(table_name.eq.manual_source_allowances,row_label.like."filing:GSTR-3B*")',
    'GSTR-3B: its pushes and adjustments, its filing rows (the Nil switch, Pushed), its manual allowances');
}

// ── 2. What comes back ──────────────────────────────────────────────────────
{
  const all = await H.loadChangeHistory(standIn(FIXTURE, []), {});
  eq(all.rows.map((r) => r.key), ['g9', 'g8', 'g7', 'g6', 'g5', 'g4', 'g3', 'g2', 'g1', 'a17', 'l00000000'], 'everything, newest first');
  eq(all.next, null, 'no more');
  const p0 = await H.loadChangeHistory(standIn(FIXTURE, []), {}, null, 4);
  const p1 = await H.loadChangeHistory(standIn(FIXTURE, []), {}, p0.next, 4);
  eq([p0.rows.length, !!p0.next, p1.rows[0].key], [4, true, 'g5'], 'pages: four, more, then the next four');
  const month = await H.loadChangeHistory(standIn(FIXTURE, []), { clientId: C1, month: '09/2026' });
  eq(month.rows.map((r) => r.key), ['g9', 'g5', 'g4', 'g3', 'g2', 'g1'], 'one client and month (a builder unit has no month)');
  const fy = await H.loadChangeHistory(standIn(FIXTURE, []), { clientId: C1, financialYear: '2025-26' });
  eq(fy.rows.map((r) => r.key), ['a17'], 'the financial year: the Annual Return figure');
  const sam = await H.loadChangeHistory(standIn(FIXTURE, []), { actorId: SAM });
  eq(sam.rows.map((r) => r.key), ['g5', 'l00000000'], 'one person');
  const gita = await H.loadChangeHistory(standIn(FIXTURE, []), { actorId: GITA });
  ok(gita.rows.some((r) => r.key === 'a17'), 'one person: their Annual Return figures too');
  const day = await H.loadChangeHistory(standIn(FIXTURE, []), { from: '2026-10-21', to: '2026-10-21' });
  eq(day.rows.map((r) => r.key), ['g9', 'g8', 'g7', 'g6', 'g5'], 'one day in India time');
  const allow = await H.loadChangeHistory(standIn(FIXTURE, []), { page: 'allowances' });
  eq(allow.rows.map((r) => r.key), ['g5'], 'the manual-entry page');
  const filing = await H.loadChangeHistory(standIn(FIXTURE, []), { clientId: C1, month: '09/2026', page: 'filing' });
  eq(filing.rows.map((r) => r.key), ['g9', 'g5', 'g1'], 'Filing Status History: its rows and the manual entry allowed for the month');
}
// 2,500 changes in one month, more than the API sends at once.
{
  const many = Array.from({ length: 2500 }, (_, i) => row({ log_id: 10000 + i, at: '2026-10-21T08:00:00.000001+00:00', table_name: 'twob_import_docs', op: 'INSERT',
    client_id: C2, period_month: '09/2026', changed: { supplier_name: 'S' + i, taxable_value: i } }));
  const { rows, capped } = await H.loadAllChangeHistory(standIn(many, []), { clientId: C2, month: '09/2026' }, 5000);
  eq([rows.length, new Set(rows.map((r) => r.key)).size, capped], [2500, 2500, false], 'export: all 2,500 changes of one moment, each once, not cut at 1,000');
  const cut = await H.loadAllChangeHistory(standIn(many, []), { clientId: C2, month: '09/2026' }, 2000);
  eq([cut.rows.length, cut.capped], [2000, true], 'export over its limit: says it was cut');
  const exact = await H.loadAllChangeHistory(standIn(many, []), { clientId: C2, month: '09/2026' }, 2500);
  eq([exact.rows.length, exact.capped], [2500, false], 'export of exactly its limit: complete');
  // On screen: 200 a page; 30 changes saved after the first page.
  const live = many.slice(0, 500);
  const first = await H.loadChangeHistory(standIn(live, []), { clientId: C2 });
  for (let i = 0; i < 30; i++) live.push(row({ log_id: 20000 + i, at: '2026-10-21T09:00:00+00:00', table_name: 'twob_import_docs', op: 'UPDATE', client_id: C2, changed: {} }));
  const shown = [...first.rows];
  for (let next = first.next; next;) {
    const page = await H.loadChangeHistory(standIn(live, []), { clientId: C2 }, next);
    shown.push(...page.rows); next = page.next;
  }
  eq([shown.length, new Set(shown.map((r) => r.key)).size], [500, 500], 'Load more with changes saved meanwhile: no row twice, none skipped');
}
// The default range: the whole log only for a client, a month, a year or dates.
{
  eq(H.withDefaultRange({}, '2026-10-21'), { from: '2026-09-22', defaulted: true }, 'nothing chosen: the last 30 days');
  eq(H.withDefaultRange({ page: 'itc' }, '2026-10-21').from, '2026-09-22', 'a page alone: the last 30 days');
  eq(H.withDefaultRange({ clientId: C1 }, '2026-10-21'), { clientId: C1 }, 'a client: everything');
  eq(H.withDefaultRange({ to: '2026-01-31' }, '2026-10-21'), { to: '2026-01-31' }, 'dates: as chosen');
  eq(H.todayInIndia(new Date('2026-10-21T20:00:00Z')), '2026-10-22', 'today in India');
}

// ── 3. Reading one change ───────────────────────────────────────────────────
{
  const v = H.describeChange(FIXTURE[0], names);
  eq(v.action, 'Changed', 'an update: Changed');
  eq(v.lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`),
    ['ARN: (empty) -> AA240926000001', 'Filed on: (empty) -> 20 Oct 2026', 'Status: Prepared -> Filed'], 'an update: each changed field, old and new');
  eq(H.describeChange(FIXTURE[1]).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`), ['Figures: Table 4A, 5.1, IGST: 1,000 -> 1,200'], 'ITC figures: the cell that changed');
  const g = H.describeChange(FIXTURE[2]).lines[0];
  eq(g.label, 'GSTR-1 data (parts changed: hsn)', 'GSTR-1 document: the parts that changed');
  eq([g.old, g.new], ['document · 117 KB, 4 parts · fingerprint aaaa1111', 'document · 118 KB, 4 parts · fingerprint bbbb2222'], 'GSTR-1 document: size and fingerprint, never the document');
  eq(H.describeChange(FIXTURE[3]).lines.map((l) => [l.label, l.old, l.new]),
    [['IGST', '1,800', ''], ['Carried forward', 'Yes', ''], ['Supplier', 'ABC TRADERS', '']], 'a delete: the old row, fields in name order');
  const a = H.describeChange(FIXTURE[4], names);
  eq([a.action, a.badge], ['Manual entry allowed', 'manual (allowed by Sam: Portal password wrong since 18 Oct)'], 'an allowance: its words and the badge');
  eq(H.allowanceBadge(FIXTURE[4], names), 'manual (allowed by Sam: Portal password wrong since 18 Oct)', 'the badge on its own');
  eq(H.describeChange(FIXTURE[6]).note, 'Every row was removed (2).', 'a truncate');
  ok(/could not be recorded \(division by zero\)/.test(H.describeChange(FIXTURE[8]).note), 'an error row says so');
  eq(H.describeChange(FIXTURE[9]).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`), ['T4, A, Taxable: 1,000 -> 1,500'], 'an Annual Return figure');
  eq(H.describeChange(FIXTURE[10]).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`), ['Liberal 2B Reconciliation: No -> Yes'], 'the Liberal switch');
  eq([H.whoLabel(FIXTURE[0]), H.whoLabel(FIXTURE[2]), H.whoLabel(FIXTURE[3]), H.whoLabel(FIXTURE[6])],
    ['Gita', 'Not recorded', 'Extension, for Gita', 'System'], 'who: the person, with the extension or the system');
  eq([H.whoNote(FIXTURE[0]), H.whoNote({ ...FIXTURE[0], actor_basis: 'row' }), H.whoNote(FIXTURE[2])],
    [null, 'from the saved-by field this change wrote', 'no person recorded'], 'how the person is known');
  // A name from a saved-by field: the extension is the doer, never "for" the person.
  eq(H.whoLabel({ ...FIXTURE[3], actor_basis: 'row' }), 'Extension, saved as Gita', 'extension, a saved-by field: "saved as", not "for"');
  eq(H.whoLabel({ ...FIXTURE[3], actor_id: null, actor_name: null, actor_basis: 'none' }), 'Extension', 'extension, no person: the extension only');

  // Manual entries: the badge on the working that used one, and on its used and revoked rows.
  const ALLOW = '7d1e2f30-0000-4000-8000-000000000001';
  const allowances = { [ALLOW]: { id: ALLOW, reason: 'Portal password wrong since 18 Oct', allowed_by: SAM, scope: 'filing:GSTR-3B' } };
  const filedManual = row({ log_id: 30, at: '2026-10-21T09:00:00+00:00', table_name: 'filing_status', op: 'UPDATE', row_label: 'GSTR-3B',
    changed: { filed_source: { old: null, new: 'manual' }, manual_allowance_id: { old: null, new: ALLOW }, status: { old: 'Prepared', new: 'Filed' } } });
  eq(H.allowanceIdsOf([filedManual]), [ALLOW], 'the allowance a change points at is looked up');
  eq(H.describeChange(filedManual, names, allowances).badge, 'manual (allowed by Sam: Portal password wrong since 18 Oct)', 'a Filed status entered by hand: badged with who allowed it and why');
  eq(H.describeChange(filedManual, names, {}).badge, 'manual', 'not yet looked up: still marked manual');
  const used = row({ log_id: 31, at: '2026-10-21T09:00:00+00:00', table_name: 'manual_source_allowances', op: 'UPDATE', row_id: ALLOW, row_label: 'filing:GSTR-3B',
    changed: { used_at: { old: null, new: '2026-10-21T09:00:00+00:00' }, used_by: { old: null, new: GITA } } });
  eq([H.describeChange(used, names, allowances).action, H.describeChange(used, names, allowances).badge],
    ['Manual entry used', 'manual (allowed by Sam: Portal password wrong since 18 Oct)'], 'the allowance used: badged with its reason');
  const revoked = { ...used, changed: { revoked_at: { old: null, new: '2026-10-22T09:00:00+00:00' }, revoked_by: { old: null, new: SAM } } };
  eq(H.describeChange(revoked, names, allowances).action, 'Manual entry revoked', 'the allowance taken back');
  const openingManual = row({ log_id: 32, at: '2026-10-21T09:00:00+00:00', table_name: 'suspended_reco', op: 'UPDATE',
    changed: { opening_source: { old: 'portal', new: 'manual' }, opening_igst: { old: 0, new: 500 } } });
  eq(H.describeChange(openingManual, names).badge, 'manual', 'an opening balance entered by hand: marked manual');
  eq(H.describeChange(FIXTURE[0], names).badge, null, 'a pulled figure: no badge');
  {
    const AL = { id: ALLOW, reason: 'Portal down', allowed_by: SAM };
    const got = []; const src = { from: (t) => ({ select: (c) => ({ in: (col, ids) => { got.push([t, c, col, ids]); return Promise.resolve({ data: [AL], error: null }); } }) }) };
    const map = await H.loadAllowances(src, [ALLOW]);
    eq([got, map[ALLOW].reason], [[['manual_source_allowances', 'id, reason, allowed_by, scope', 'id', [ALLOW]]], 'Portal down'], 'one read for the allowances on screen');
    eq(await H.loadAllowances(src, []), {}, 'no allowances: no read');
  }

  // An added JSON working reads as its figures, never as raw JSON.
  const itcAdded = row({ log_id: 33, at: '2026-10-21T09:00:00+00:00', table_name: 'itc_summaries', op: 'INSERT',
    changed: { data: { section4A: [{ srNo: '(1)', particular: 'Import of Goods', igst: 0, cgst: 0 }, { srNo: '5.1', particular: 'ITC for the Month', igst: 1000, cgst: 450 }] }, is_locked: false } });
  const itcView = H.describeChange(itcAdded, names);
  eq(itcView.lines.map((l) => `${l.label}: ${l.new}`), ['Figures: Table 4A, 5.1, CGST: 450', 'Figures: Table 4A, 5.1, IGST: 1,000', 'Locked: No'],
    'an ITC Summary added: its figures cell by cell (zero and empty left out)');
  ok(/zero figures are left out/.test(itcView.note ?? ''), 'and says zeros are left out');
  ok(!itcView.lines.some((l) => /[{}[\]"]/.test(l.new)), 'no raw JSON on screen');
  const longText = 'x'.repeat(5000);
  const longRow = row({ log_id: 34, at: '2026-10-21T09:00:00+00:00', table_name: 'filing_status', op: 'UPDATE', changed: { remarks: { old: null, new: longText } } });
  eq([H.describeChange(longRow).lines[0].new.length, H.exportRows([longRow], { clientName: () => '' })[0].New.length], [201, 5000],
    'long text: cut on screen, whole in the Excel export');
  const deepLeaf = row({ log_id: 35, at: '2026-10-21T09:00:00+00:00', table_name: 'itc_summaries', op: 'UPDATE',
    changed: { data: { more: false, changes: [{ path: 'pad.a.a', deep: true, old: { summary: true, md5: 'aaaa1111', bytes: 9000 }, new: { summary: true, md5: 'bbbb2222', bytes: 9000 } }] } } });
  eq(H.describeChange(deepLeaf).lines[0].label, 'Figures: Pad, A, A (nested part)', 'a part nested past 20 levels: one line, fingerprints');
  const partial = row({ log_id: 36, at: '2026-10-21T09:00:00+00:00', table_name: 'filing_status', op: 'UPDATE',
    changed: { _error: 'division by zero', _partial: true, status: { old: 'Prepared', new: 'Filed' } } });
  const pv = H.describeChange(partial);
  eq(pv.lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`), ['Status: Prepared -> Filed'], 'a change recorded in part: its fields still read');
  ok(/Recorded in part/.test(pv.note ?? ''), 'and says so');
  eq([H.tableLabel('bills_not_in_books'), H.tableLabel('builder_bu_events'), H.pageOfTable('builder_units').label, H.pageOfTable('itc_versions').label],
    ['Not in Books', 'Builder bu events', 'Builder', 'ITC Summary'], 'sheet and page names');
  eq([H.columnLabel('opening_override_justification'), H.columnLabel('drc_igst'), H.columnLabel('gstr1_period')],
    ['Override reason', 'DRC IGST', 'GSTR1 period'], 'column names');
  eq(H.formatStamp('2026-10-21T04:30:00Z'), '21 Oct 2026, 10:00', 'times in India');
}

// ── 4. The Excel export ─────────────────────────────────────────────────────
{
  const sheet = H.exportRows(FIXTURE, { clientName: (id) => (id === C1 ? 'SUNRISE TRADERS' : id === C2 ? 'MOONLIGHT FABRICS' : ''), names });
  eq(sheet.length, 3 + 1 + 1 + 3 + 4 + 3 + 1 + 1 + 1 + 1 + 1, 'one row per changed field, one for a change with none');
  eq(sheet[0], { When: '20 Oct 2026, 10:30', Who: 'Gita', 'How recorded': 'App', Client: 'SUNRISE TRADERS', Month: 'Sep 2026', Page: 'Filing Status',
    Sheet: 'Filing Status', Row: 'GSTR-3B', Action: 'Changed', Field: 'ARN', Old: '(empty)', New: 'AA240926000001', Note: '', Request: '' }, 'an export row');
  ok(sheet.some((r) => r.Month === 'FY 2025-26' && r.Page === 'Annual Return'), 'the Annual Return row by financial year');
}

// ── 5. Links and the address bar ────────────────────────────────────────────
{
  eq(H.historyLink('itc', C1, '09/2026'), `/change-history?client=${C1}&month=09%2F2026&page=itc`, 'History on ITC Summary');
  const f = H.filtersFromSearch(new URLSearchParams(`client=${C1}&month=09%2F2026&page=itc&user=${SAM}&from=2026-10-01`));
  eq(f, { clientId: C1, month: '09/2026', page: 'itc', actorId: SAM, from: '2026-10-01' }, 'the address bar back to filters');
  eq(H.filtersFromSearch(new URLSearchParams('page=nope&month=13/2026')), {}, 'an unknown page or month is dropped');
  eq(H.monthsOfFinancialYear('2026-27')[0] + ' ' + H.monthsOfFinancialYear('2026-27')[11], '04/2026 03/2027', 'a financial year runs April to March');
}

// ── 6. On the rows the real triggers wrote ──────────────────────────────────
const file = process.argv[2];
if (file) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(Array.isArray(rows) && rows.length > 1000, `log rows from the SQL tests (${rows.length})`);
  const tables = [...new Set(rows.map((r) => r.table_name))];
  const unknown = tables.filter((t) => !H.pageOfTable(t) && !t.startsWith('t_odd'));
  eq(unknown, [], 'every logged table is on a page of the filter');
  let broken = 0;
  for (const r of rows) {
    try {
      const v = H.describeChange(r, names);
      if (!v.lines.length && !v.note) broken++;
      if (v.lines.some((l) => /\[object Object\]|undefined/.test(l.old + l.new + l.label))) broken++;
    } catch { broken++; }
  }
  eq(broken, 0, 'every logged change reads as lines or a note');
  const one = await H.loadChangeHistory(standIn(rows, []), { clientId: C1, month: '09/2026', page: 'filing' });
  ok(one.rows.length > 0 && one.rows.every((r) => r.client_id === C1 && r.period_month === '09/2026'
    && (r.table_name === 'filing_status' || (r.table_name === 'manual_source_allowances' && /^filing:/.test(r.row_label ?? '')))),
    'Filing Status History for one client and month: only those rows, and the manual entries allowed for its returns');
  const filed = rows.find((r) => r.request_id === 't10-a' && r.op === 'UPDATE');
  ok(!!filed, 'the filing test row is there');
  if (filed) {
    eq(H.describeChange(filed, names).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`),
      ['ARN: (empty) -> AA240926000001', 'Filed on: (empty) -> 20 Oct 2026', 'Status: Prepared -> Filed'], 'the real Filing Status change, read');
    eq([H.whoLabel(filed), filed.row_label], ['Gita', 'GSTR-3B'], 'by the header actor, on the GSTR-3B');
  }
  const allowed = rows.find((r) => r.request_id === 'allow-1');
  if (allowed) eq(H.describeChange(allowed, names).badge, 'manual (allowed by Sam: Portal password wrong since 18 Oct)', 'the real allowance, with its badge');
  const itc = rows.find((r) => r.table_name === 'itc_summaries' && r.op === 'UPDATE' && (r.changed?.data?.changes ?? []).some((c) => c.path === 'section4A[5.1].reasons'));
  ok(!!itc, 'the ITC test row is there');
  if (itc) eq(H.describeChange(itc).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`),
    ['Figures: Table 4A, 5.1, IGST: 1,000 -> 1,200', 'Figures: Table 4A, 5.1, Reasons: (empty) -> Late bill of Sep'], 'the real ITC change, cell by cell');
  const annual = rows.find((r) => r.log === 'annual_return_change_log');
  if (annual) eq(H.describeChange(annual).lines[0].label, 'T4, A, Taxable', 'the real Annual Return row');
  // Round 1: a GSTR-3B push and the Nil switch are on the GSTR-3B page; a deep document and a logger error still read.
  const g3b = await H.loadChangeHistory(standIn(rows, []), { clientId: C1, month: '08/2026', page: 'gstr3b' });
  eq(g3b.rows.map((r) => `${r.table_name}:${r.op}:${r.row_label ?? ''}`).sort(),
    ['filing_status:INSERT:GSTR-3B', 'gstr3b_push_versions:INSERT:1'], 'GSTR-3B History: the push and the Nil switch, not the GSTR-1 row');
  const pushRow = g3b.rows.find((r) => r.table_name === 'gstr3b_push_versions');
  if (pushRow) eq([H.whoLabel(pushRow), H.describeChange(pushRow, names).lines.find((l) => l.label === 'Data sent')?.new?.startsWith('document')],
    ['Extension, for Esha', true], 'the push: by the extension for Esha, the data sent as a fingerprint');
  const deep = rows.find((r) => r.row_id === '45000000-0000-0000-0000-000000000001' && r.op === 'UPDATE'
    && (r.changed?.data?.changes ?? []).some((c) => c.path === 'section4A[5.1].igst' && c.new === 999999));
  ok(!!deep && H.describeChange(deep, names).lines.some((l) => l.label === 'Figures: Table 4A, 5.1, IGST' && l.new === '9,99,999'),
    'a deeply padded ITC Summary: the 5.1 change reads');
  // Round 2: the logger refuses a statement it cannot read, never logs it in part.
  eq(rows.filter((r) => r.changed && (r.changed._partial === true || typeof r.changed._error === 'string')).length, 0,
    'no row the logger could read only in part');
  eq(rows.filter((r) => r.log === 'gst_change_log' && r.fy !== fyOf(r.financial_year, r.period_month)).length, 0,
    'fy on every row: its own year, else its month\'s');
  const fyRows = await H.loadChangeHistory(standIn(rows, []), { financialYear: '2026-27' });
  ok(fyRows.rows.length > 0 && fyRows.rows.every((r) => r.fy === '2026-27'), 'a financial year, no client: only that year\'s rows');
  const pulled = rows.find((r) => r.row_id === '31000000-0000-0000-0000-000000000001' && r.actor_source === 'extension' && r.op === 'UPDATE');
  if (pulled) eq([H.whoLabel(pulled), H.whoNote(pulled)], ['Extension', 'no person recorded'], 'a scheduled pull after Esha\'s save: the extension, no person');
  const sheet = H.exportRows(rows.slice(0, 500), { clientName: () => '' });
  ok(sheet.length >= 500 && sheet.every((r) => typeof r.When === 'string' && r.When.length > 0), 'the export of 500 real changes');
}

console.log(fail ? `${fail} of ${count} checks FAILED` : `${count} of ${count} checks passed`);
process.exit(fail ? 1 : 0);
