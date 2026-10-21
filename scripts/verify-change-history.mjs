#!/usr/bin/env node
// Checks how the Change history page loads and reads the change log
// (src/lib/changeHistory.ts over the view gst_change_history, migration
// 20261021130000_gst_change_log.sql):
//   - the filters become the query PostgREST is sent (client, month, FY,
//     page, table, person, dates in India time), newest first, one page at a
//     time with "more" when there is more;
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
  const m = expr.match(/^([a-z_]+)\.(eq|in|is|like)\.(.*)$/);
  if (!m) throw new Error('stand-in cannot read ' + expr);
  const [, col, op, raw] = m;
  if (op === 'eq') { const v = unquote(raw); return (r) => String(r[col]) === v && r[col] !== null; }
  if (op === 'is') return (r) => (raw === 'null' ? r[col] === null || r[col] === undefined : String(r[col]) === raw);
  if (op === 'in') { const vals = splitTop(raw.slice(1, -1)).map(unquote); return (r) => vals.includes(r[col]); }
  const re = new RegExp('^' + raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.') + '$');
  return (r) => typeof r[col] === 'string' && re.test(r[col]);
}
function standIn(rows, log) {
  return {
    from(view) {
      log.push(['from', view]);
      return {
        select(cols) {
          log.push(['select', cols]);
          const preds = []; const orders = []; let range = null;
          const q = {
            eq(c, v) { log.push(['eq', c, v]); preds.push((r) => r[c] === v); return q; },
            in(c, v) { log.push(['in', c, v]); preds.push((r) => v.includes(r[c])); return q; },
            gte(c, v) { log.push(['gte', c, v]); preds.push((r) => new Date(r[c]) >= new Date(v)); return q; },
            lt(c, v) { log.push(['lt', c, v]); preds.push((r) => new Date(r[c]) < new Date(v)); return q; },
            or(f) { log.push(['or', f]); const parts = splitTop(f).map(condition); preds.push((r) => parts.some((p) => p(r))); return q; },
            order(c, o) { log.push(['order', c, o.ascending]); orders.push([c, o.ascending]); return q; },
            range(a, b) { log.push(['range', a, b]); range = [a, b]; return q; },
            then(resolve, reject) {
              try {
                let out = rows.filter((r) => preds.every((p) => p(r)));
                out = [...out].sort((x, y) => {
                  for (const [c, asc] of orders) {
                    const a = c === 'at' ? new Date(x[c]).getTime() : x[c]; const b = c === 'at' ? new Date(y[c]).getTime() : y[c];
                    if (a < b) return asc ? -1 : 1;
                    if (a > b) return asc ? 1 : -1;
                  }
                  return 0;
                });
                if (range) out = out.slice(range[0], range[1] + 1);
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
const row = (o) => ({ key: 'g' + o.log_id, log: 'gst_change_log', row_id: null, row_label: null, client_id: C1, period_month: '09/2026',
  financial_year: null, actor_id: GITA, actor_name: 'Gita', actor_source: 'app', actor_basis: 'header', request_id: null, ...o });
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
  { key: 'a17', log: 'annual_return_change_log', log_id: 17, at: '2026-10-19T04:30:00+00:00', table_name: 'annual_return_docs', row_id: 'gstr9_t4',
    row_label: 'B2C supplies', client_id: C1, period_month: null, financial_year: '2025-26', op: 'UPDATE', actor_id: null, actor_name: 'Gita',
    actor_source: 'app', actor_basis: 'row', changed: { 't4.a.taxable': { old: 1000, new: 1500 } }, request_id: null },
  { key: 'l00000000', log: 'client_liberal_log', log_id: null, at: '2026-10-18T04:30:00+00:00', table_name: 'clients', row_id: C1, row_label: null,
    client_id: C1, period_month: null, financial_year: null, op: 'UPDATE', actor_id: SAM, actor_name: 'Sam', actor_source: 'app', actor_basis: 'row',
    changed: { liberal_2b_reconciliation: { old: false, new: true } }, request_id: null },
];
const names = { [SAM]: 'Sam', [GITA]: 'Gita' };

// ── 1. The query sent ───────────────────────────────────────────────────────
{
  const log = [];
  await H.loadChangeHistory(standIn(FIXTURE, log), { clientId: C1, month: '09/2026', page: 'filing', actorId: GITA, actorName: 'Gita', from: '2026-10-01', to: '2026-10-21' }, 0, 50);
  eq(log[0], ['from', 'gst_change_history'], 'reads the view');
  ok(log[1][1].split(',').includes('changed') && log[1][1].split(',').includes('actor_basis'), 'selects the columns it shows');
  ok(log.some((l) => l[0] === 'eq' && l[1] === 'client_id' && l[2] === C1), 'client filter');
  ok(log.some((l) => l[0] === 'eq' && l[1] === 'period_month' && l[2] === '09/2026'), 'month filter');
  ok(log.some((l) => l[0] === 'in' && l[1] === 'table_name' && JSON.stringify(l[2]) === '["filing_status"]'), 'page filter: its tables');
  ok(log.some((l) => l[0] === 'or' && l[1] === `actor_id.eq.${GITA},and(actor_id.is.null,actor_name.eq.Gita)`), 'person filter: by id, or by name where only a name is kept');
  ok(log.some((l) => l[0] === 'gte' && l[2] === '2026-10-01T00:00:00+05:30'), 'from: the start of the day in India');
  ok(log.some((l) => l[0] === 'lt' && l[2] === '2026-10-22T00:00:00+05:30'), 'to: inclusive, up to the next day in India');
  eq(log.filter((l) => l[0] === 'order'), [['order', 'at', false], ['order', 'key', false]], 'newest first, a stable order');
  eq(log.find((l) => l[0] === 'range'), ['range', 0, 50], 'one page and one more row to know if there is more');
}
{
  const log = [];
  await H.loadChangeHistory(standIn(FIXTURE, log), { financialYear: '2025-26', page: 'builder' });
  const ors = log.filter((l) => l[0] === 'or').map((l) => l[1]);
  ok(ors.includes('financial_year.eq.2025-26,period_month.in.(04/2025,05/2025,06/2025,07/2025,08/2025,09/2025,10/2025,11/2025,12/2025,01/2026,02/2026,03/2026)'),
    'financial year: its own rows and its twelve months');
  ok(ors.includes('table_name.like.builder_*'), 'Builder: every builder table');
}

// ── 2. What comes back ──────────────────────────────────────────────────────
{
  const all = await H.loadChangeHistory(standIn(FIXTURE, []), {});
  eq(all.rows.map((r) => r.key), ['g9', 'g8', 'g7', 'g6', 'g5', 'g4', 'g3', 'g2', 'g1', 'a17', 'l00000000'], 'everything, newest first');
  eq(all.hasMore, false, 'no more');
  const p0 = await H.loadChangeHistory(standIn(FIXTURE, []), {}, 0, 4);
  const p1 = await H.loadChangeHistory(standIn(FIXTURE, []), {}, 1, 4);
  eq([p0.rows.length, p0.hasMore, p1.rows[0].key], [4, true, 'g5'], 'pages: four, more, then the next four');
  const month = await H.loadChangeHistory(standIn(FIXTURE, []), { clientId: C1, month: '09/2026' });
  eq(month.rows.map((r) => r.key), ['g9', 'g5', 'g4', 'g3', 'g2', 'g1'], 'one client and month (a builder unit has no month)');
  const fy = await H.loadChangeHistory(standIn(FIXTURE, []), { clientId: C1, financialYear: '2025-26' });
  eq(fy.rows.map((r) => r.key), ['a17'], 'the financial year: the Annual Return figure');
  const gita = await H.loadChangeHistory(standIn(FIXTURE, []), { actorId: SAM, actorName: 'Sam' });
  eq(gita.rows.map((r) => r.key), ['g5', 'l00000000'], 'one person');
  const day = await H.loadChangeHistory(standIn(FIXTURE, []), { from: '2026-10-21', to: '2026-10-21' });
  eq(day.rows.map((r) => r.key), ['g9', 'g8', 'g7', 'g6', 'g5'], 'one day in India time');
  const allow = await H.loadChangeHistory(standIn(FIXTURE, []), { page: 'allowances' });
  eq(allow.rows.map((r) => r.key), ['g5'], 'the manual-entry page');
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
  eq([a.action, a.note], ['Manual entry allowed', 'manual (allowed by Sam: Portal password wrong since 18 Oct)'], 'an allowance: its words and the badge');
  eq(H.allowanceBadge(FIXTURE[4], names), 'manual (allowed by Sam: Portal password wrong since 18 Oct)', 'the badge on its own');
  eq(H.describeChange(FIXTURE[6]).note, 'Every row was removed (2).', 'a truncate');
  ok(/could not be recorded \(division by zero\)/.test(H.describeChange(FIXTURE[8]).note), 'an error row says so');
  eq(H.describeChange(FIXTURE[9]).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`), ['T4, A, Taxable: 1,000 -> 1,500'], 'an Annual Return figure');
  eq(H.describeChange(FIXTURE[10]).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`), ['Liberal 2B Reconciliation: No -> Yes'], 'the Liberal switch');
  eq([H.whoLabel(FIXTURE[0]), H.whoLabel(FIXTURE[2]), H.whoLabel(FIXTURE[3]), H.whoLabel(FIXTURE[6])],
    ['Gita', 'Not recorded', 'Extension, for Gita', 'System'], 'who: the person, with the extension or the system');
  eq([H.whoNote(FIXTURE[0]), H.whoNote({ ...FIXTURE[0], actor_basis: 'row' }), H.whoNote(FIXTURE[2])],
    [null, "from the row's own stamp", 'no person recorded'], 'how the person is known');
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
  const unknown = tables.filter((t) => !H.pageOfTable(t) && t !== 't_odd');
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
  ok(one.rows.length > 0 && one.rows.every((r) => r.client_id === C1 && r.period_month === '09/2026' && r.table_name === 'filing_status'),
    'Filing Status History for one client and month: only those rows');
  const filed = rows.find((r) => r.request_id === 't10-a' && r.op === 'UPDATE');
  ok(!!filed, 'the filing test row is there');
  if (filed) {
    eq(H.describeChange(filed, names).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`),
      ['ARN: (empty) -> AA240926000001', 'Filed on: (empty) -> 20 Oct 2026', 'Status: Prepared -> Filed'], 'the real Filing Status change, read');
    eq([H.whoLabel(filed), filed.row_label], ['Gita', 'GSTR-3B'], 'by the header actor, on the GSTR-3B');
  }
  const allowed = rows.find((r) => r.request_id === 'allow-1');
  if (allowed) eq(H.describeChange(allowed, names).note, 'manual (allowed by Sam: Portal password wrong since 18 Oct)', 'the real allowance, with its badge');
  const itc = rows.find((r) => r.table_name === 'itc_summaries' && r.op === 'UPDATE' && (r.changed?.data?.changes ?? []).some((c) => c.path === 'section4A[5.1].reasons'));
  ok(!!itc, 'the ITC test row is there');
  if (itc) eq(H.describeChange(itc).lines.map((l) => `${l.label}: ${l.old} -> ${l.new}`),
    ['Figures: Table 4A, 5.1, IGST: 1,000 -> 1,200', 'Figures: Table 4A, 5.1, Reasons: (empty) -> Late bill of Sep'], 'the real ITC change, cell by cell');
  const annual = rows.find((r) => r.log === 'annual_return_change_log');
  if (annual) eq(H.describeChange(annual).lines[0].label, 'T4, A, Taxable', 'the real Annual Return row');
  const sheet = H.exportRows(rows.slice(0, 500), { clientName: () => '' });
  ok(sheet.length >= 500 && sheet.every((r) => typeof r.When === 'string' && r.When.length > 0), 'the export of 500 real changes');
}

console.log(fail ? `${fail} of ${count} checks FAILED` : `${count} of ${count} checks passed`);
process.exit(fail ? 1 : 0);
