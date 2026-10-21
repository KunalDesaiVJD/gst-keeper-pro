#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the database's write-through writes exactly what Post wrote, on the same
// data. Two twin clients get the same Import 2B saves, as the app sends
// them (anon, with the request headers):
//   A  as now: each save writes through by itself (the triggers);
//   B  as before: the same saves with the write-through switched off (written
//      as this release's own functions write, twob.write 'system'), then
//      Post as it was: the app's own planImport2BPost and
//      postImport2BToLedger (src/lib/postImport2B.ts), bundled as they are
//      with a stand-in supabase client that sends each query to this
//      database through psql, as anon.
// After every save kind the two months' ledgers must hold the same entries
// (supplier, number, date, GSTIN, amounts, months, decisions, links), and
// the database's plan (twob__autopost_plan) must name what
// planImport2BPost names, row for row, on a month out of step. Save kinds:
// an import of every kind of document and books row; a bulk treatment
// change; books edits (amounts, date cleared, type, treatment); a
// re-import's figures; counted figures; a books row deleted; Delete 2B;
// Clear Data; a month out of step brought up to date.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const db = process.env.TWOB_TEST_DB;
if (!db) { console.error('TWOB_TEST_DB is not set (run through run.sh)'); process.exit(2); }

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });
const psql = (sql) => execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ACTOR = '00000000-0000-0000-0000-0000000000a2';
const asApp = (sql, legacy) => `SET ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"${ACTOR}","x-gst-source":"app"}', false);
${legacy ? "SELECT set_config('twob.write', 'system', false);" : ''} ${sql}`;
const run = (sql, legacy = false) => {
  try {
    const out = execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', asApp(sql, legacy)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n');
    return { out: out[out.length - 1], err: null };
  } catch (e) {
    return { out: null, err: String(e.stderr || e.message).replace(/^.*ERROR:\s*/s, '').split('\n')[0] };
  }
};
globalThis.__asApp = (sql) => run(sql, globalThis.__legacy === true);

// A stand-in for the supabase client, enough for postImport2B.ts: select with
// filters, order and range, insert, update, delete; one SQL statement each,
// through psql as anon (with twob.write 'system' while globalThis.__legacy).
const FAKE_SUPABASE = `
const lit = (v) => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"
  : "'" + String(v).replace(/'/g, "''") + "'";
const col = (c) => '"' + c.replace(/"/g, '') + '"';
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.vals = null; this.f = []; this.cols = '*'; this.ret = null; this.ord = []; this.lim = null; this.off = null; this.one = false; this.head = false; }
  select(c, o) { if (this.op === 'select') { this.cols = c || '*'; this.head = !!(o && o.head); } else this.ret = c || '*'; return this; }
  insert(v) { this.op = 'insert'; this.vals = Array.isArray(v) ? v : [v]; return this; }
  update(v) { this.op = 'update'; this.vals = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push(col(c) + ' = ' + lit(v)); return this; }
  neq(c, v) { this.f.push(col(c) + ' <> ' + lit(v)); return this; }
  in(c, a) { this.f.push(col(c) + ' IN (' + (a.length ? a.map(lit).join(', ') : 'NULL') + ')'); return this; }
  is(c, v) { this.f.push(col(c) + ' IS ' + (v === null ? 'NULL' : String(v))); return this; }
  not(c, op, v) { if (op !== 'is') throw new Error('fake: not ' + op); this.f.push(col(c) + ' IS NOT ' + (v === null ? 'NULL' : String(v))); return this; }
  order(c, o) { this.ord.push(col(c) + (o && o.ascending === false ? ' DESC' : '')); return this; }
  range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  sql() {
    const where = this.f.length ? ' WHERE ' + this.f.join(' AND ') : '';
    const t = 'public.' + col(this.t);
    if (this.op === 'select') {
      const tail = (this.ord.length ? ' ORDER BY ' + this.ord.join(', ') : '') + (this.lim !== null ? ' LIMIT ' + this.lim : '') + (this.off ? ' OFFSET ' + this.off : '');
      if (this.head) return 'SELECT count(*) FROM ' + t + where;
      return 'SELECT COALESCE(jsonb_agg(x), \\'[]\\') FROM (SELECT ' + this.cols + ' FROM ' + t + where + tail + ') x';
    }
    if (this.op === 'insert') {
      const keys = [...new Set(this.vals.flatMap((r) => Object.keys(r)))];
      return 'WITH x AS (INSERT INTO ' + t + ' (' + keys.map(col).join(', ') + ') SELECT ' + keys.map(col).join(', ')
        + ' FROM jsonb_populate_recordset(NULL::' + t + ', ' + lit(this.vals) + ') RETURNING ' + (this.ret || 'id') + ') SELECT COALESCE(jsonb_agg(x), \\'[]\\') FROM x';
    }
    const body = this.op === 'update'
      ? 'UPDATE ' + t + ' SET ' + Object.entries(this.vals).map(([k, v]) => col(k) + ' = ' + lit(v)).join(', ') + where
      : 'DELETE FROM ' + t + where;
    return 'WITH x AS (' + body + ' RETURNING ' + (this.ret || 'id') + ') SELECT COALESCE(jsonb_agg(x), \\'[]\\') FROM x';
  }
  then(ok, ko) {
    const r = globalThis.__asApp(this.sql());
    let res;
    if (r.err) res = { data: null, error: { message: r.err } };
    else if (this.head) res = { data: null, count: Number(r.out), error: null };
    else {
      const rows = JSON.parse(r.out);
      res = { data: this.op === 'select' || this.ret ? (this.one ? rows[0] ?? null : rows) : null, error: null };
    }
    return Promise.resolve(res).then(ok, ko);
  }
}
export const supabase = { from: (t) => new Q(t), rpc: async () => ({ data: null, error: { message: 'no rpc here' } }) };
`;

const out = await build({
  stdin: {
    contents: `export { planImport2BPost, postImport2BToLedger, isPostPlanEmpty } from './src/lib/postImport2B';
export { outOfStepLine } from './src/lib/import2bAutopost';`,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
      b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
    },
  }],
  define: { 'import.meta.env': '{}' },
});
const P = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// ── The twins ────────────────────────────────────────────────────────────────
// Ids: '<twin><suffix>': the same suffix is the same row in both clients.
const A = 'ae000000-0000-0000-0000-0000000000a1';
const B = 'be000000-0000-0000-0000-0000000000b1';
const M = '09/2026';
const id = (twin, n) => `${twin}e000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('${A}', 'PARITY A', '24PARIA0000A1Z5'), ('${B}', 'PARITY B', '24PARIB0000A1Z5');`);

const docRow = (twin, n, o) => ({
  id: id(twin, n), client_id: twin === 'a' ? A : B, period_month: M, date: '2026-09-10', supplier_name: 'SUPPLIER', supplier_gstin: '24AAAAA0000A1Z5',
  taxable_value: 0, input_igst: 0, input_cgst: 0, input_sgst: 0, cess: 0, doc_type: 'INVOICE', is_amendment: false, original_doc_type: null,
  base_taxable_value: null, base_input_igst: null, base_input_cgst: null, base_input_sgst: null, base_cess: null,
  ims_reduce_required: null, declared_igst: null, declared_cgst: null, declared_sgst: null, declared_cess: null,
  reverse_charge: false, itc_action: 'MATCHED', full_2b: true, updated_by: ACTOR, ...o,
});
const bookRow = (twin, n, o) => ({
  id: id(twin, n), client_id: twin === 'a' ? A : B, period_month: M, date: '2026-09-15', supplier_name: 'VENDOR', supplier_gstin: '24VVVVV0000A1Z5',
  supplier_invoice_number: `B/${n}`, taxable_value: 1000, input_igst: 0, input_cgst: 90, input_sgst: 90, book_treatment: 'NOT_IN_2B',
  doc_type: 'INVOICE', updated_by: ACTOR, ...o,
});
const DOCS = [
  [101, { supplier_invoice_number: 'INV/1', itc_action: 'NOT_IN_BOOKS', taxable_value: 1000, input_igst: 180 }],
  [102, { supplier_invoice_number: 'DN/1', doc_type: 'DEBIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 500, input_cgst: 45, input_sgst: 45 }],
  [103, { supplier_invoice_number: 'CN/1', doc_type: 'CREDIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 200, input_igst: 36 }],
  [104, { supplier_invoice_number: 'CN/2', doc_type: 'CREDIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 200, input_igst: 36, ims_reduce_required: 'YES', declared_igst: 10 }],
  [105, { supplier_invoice_number: 'CN/0A', doc_type: 'CREDIT_NOTE', is_amendment: true, original_doc_type: 'CREDIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 150, input_igst: 27, base_taxable_value: 100, base_input_igst: 18, base_input_cgst: 0, base_input_sgst: 0, base_cess: 0 }],
  [106, { supplier_invoice_number: 'DN/9A', doc_type: 'DEBIT_NOTE', is_amendment: true, original_doc_type: 'CREDIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18, base_taxable_value: 100, base_input_igst: 18, base_input_cgst: 0, base_input_sgst: 0, base_cess: 0 }],
  [107, { supplier_invoice_number: 'INV/7A', is_amendment: true, itc_action: 'NOT_IN_BOOKS', taxable_value: 700, input_igst: 126, base_taxable_value: 700, base_input_igst: 126, base_input_cgst: 0, base_input_sgst: 0, base_cess: 0 }],
  [108, { supplier_invoice_number: 'INV/8A', is_amendment: true, itc_action: 'HELD', taxable_value: 800, input_igst: 144 }],
  [109, { supplier_invoice_number: 'INV/9', itc_action: 'MATCHED', taxable_value: 900, input_igst: 162 }],
  [110, { supplier_invoice_number: 'R/1', supplier_name: 'RCM SUPPLIER', reverse_charge: true, itc_action: 'NOT_IN_BOOKS', taxable_value: 300, input_igst: 54 }],
  [111, { supplier_invoice_number: 'NODATE/1', date: null, itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18 }],
  [112, { supplier_invoice_number: 'NONAME/1', supplier_name: '   ', itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18 }],
  [113, { supplier_invoice_number: 'SPACE/1', supplier_name: '  SPACED SUPPLIER \t', itc_action: 'NOT_IN_BOOKS', taxable_value: 123.45, input_igst: 22.22 }],
  [114, { supplier_invoice_number: 'INV/14', itc_action: 'MATCHED', taxable_value: 1400, input_igst: 252 }],
];
const BOOKS = [
  [201, {}],
  [202, { doc_type: 'DEBIT_NOTE' }],
  [203, { input_cgst: -90, input_sgst: -90, taxable_value: -1000 }],
  [204, { date: null }],
  [205, { supplier_name: '  ' }],
  [206, { book_treatment: 'MISMATCHED' }],
  [207, { book_treatment: 'NOT_ELIGIBLE' }],
  [208, { supplier_name: '  SPACED VENDOR ', taxable_value: 1000.004 }],
  [209, { supplier_gstin: null, supplier_invoice_number: null }],
];
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insertSql = (table, rows) => {
  const keys = Object.keys(rows[0]);
  return `INSERT INTO public.${table} (${keys.join(', ')}) VALUES ${rows.map((r) => `(${keys.map((k) => lit(r[k])).join(', ')})`).join(', ')};`;
};

// The same save on both twins: A written through; B as before, then Post.
const both = async (label, sqlFor) => {
  const ra = run(sqlFor('a', A));
  globalThis.__legacy = true;
  const rb = run(sqlFor('b', B), true);
  globalThis.__legacy = false;
  if (ra.err || rb.err) { check(`${label}: the save runs on both twins`, false, ra.err || rb.err); return; }
  const plan = await P.planImport2BPost(B, M);
  await P.postImport2BToLedger(B, M, ACTOR, plan);
  compare(label);
};
// What a ledger row holds, with its source as the suffix shared by the twins.
const LEDGER_COLS = (link) => `COALESCE(substr(${link}::text, 2), '-'), date, supplier_name, COALESCE(supplier_invoice_number, ''), COALESCE(supplier_gstin, ''),
  taxable_value, input_igst, input_cgst, input_sgst, is_carried_forward, COALESCE(is_locked, false)`;
const ledgerOf = (client) => psql(`SELECT COALESCE(string_agg(r, E'\\n' ORDER BY r), '') FROM (
  SELECT concat_ws('|', 'N2B', ${LEDGER_COLS('source_book_id')}, COALESCE(reversal_month, ''), COALESCE(reclaim_month, ''), COALESCE(reclaim_subtype, '')) AS r
    FROM public.bills_not_in_2b WHERE client_id = '${client}' AND period_month = '${M}'
  UNION ALL
  SELECT concat_ws('|', 'NIB', ${LEDGER_COLS('source_doc_id')}, COALESCE(bill_in_2b_month, ''), COALESCE(book_entry_month, ''))
    FROM public.bills_not_in_books WHERE client_id = '${client}' AND period_month = '${M}') x`);
function compare(label) {
  const a = ledgerOf(A);
  const b = ledgerOf(B);
  const diff = [...a.split('\n').filter((l) => !b.split('\n').includes(l)).map((l) => `A only: ${l}`),
    ...b.split('\n').filter((l) => !a.split('\n').includes(l)).map((l) => `B only: ${l}`)];
  check(`${label}: the write-through leaves the ledger as Post did (${a ? a.split('\n').length : 0} entries)`, a === b, diff.join(' ; '));
}

// 1. An import, and the books register filled in.
await both('1 import', (t) => insertSql('twob_import_docs', DOCS.map(([n, o]) => docRow(t, n, o)))
  + insertSql('books_register', BOOKS.map(([n, o]) => bookRow(t, n, o))));
check('1 import: entries were written (not an empty comparison)', Number(psql(`SELECT count(*) FROM public.bills_not_in_books WHERE client_id = '${A}'`)) === 8
  && Number(psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '${A}'`)) === 3,
  psql(`SELECT (SELECT count(*) FROM public.bills_not_in_books WHERE client_id = '${A}') || ',' || (SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '${A}')`));
// 2. A bulk treatment change (Save of staged rows), both ways.
await both('2 bulk treatment', (t) => `UPDATE public.twob_import_docs SET itc_action = 'MATCHED', updated_by = '${ACTOR}' WHERE id IN ('${id(t, 101)}', '${id(t, 103)}', '${id(t, 113)}');
  UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id IN ('${id(t, 109)}', '${id(t, 114)}');`);
// 3. Books edits, one save each.
await both('3a books amounts', (t) => `UPDATE public.books_register SET input_cgst = 99, input_sgst = 99, taxable_value = 1100 WHERE id = '${id(t, 201)}';`);
await both('3b books date cleared (kept as posted)', (t) => `UPDATE public.books_register SET date = NULL, input_cgst = 50 WHERE id = '${id(t, 201)}';`);
await both('3c books type to debit note', (t) => `UPDATE public.books_register SET doc_type = 'DEBIT_NOTE' WHERE id = '${id(t, 208)}';`);
await both('3d books type back, minus fixed, date given', (t) => `UPDATE public.books_register SET doc_type = 'INVOICE' WHERE id = '${id(t, 208)}';
  UPDATE public.books_register SET input_cgst = 90, input_sgst = 90, taxable_value = 1000 WHERE id = '${id(t, 203)}';
  UPDATE public.books_register SET date = '2026-09-20' WHERE id = '${id(t, 204)}';
  UPDATE public.books_register SET date = '2026-09-21' WHERE id = '${id(t, 201)}';`);
await both('3e books treatment', (t) => `UPDATE public.books_register SET book_treatment = 'NOT_IN_2B' WHERE id = '${id(t, 206)}';
  UPDATE public.books_register SET book_treatment = 'NOT_ELIGIBLE' WHERE id = '${id(t, 209)}';`);
// 4. A re-import's figures, one document a statement.
await both('4 re-import figures', (t) => `UPDATE public.twob_import_docs SET taxable_value = 1150, input_igst = 207 WHERE id = '${id(t, 109)}';
  UPDATE public.twob_import_docs SET input_igst = 40 WHERE id = '${id(t, 104)}';
  UPDATE public.twob_import_docs SET date = '2026-09-11' WHERE id = '${id(t, 111)}';`);
// 5. Counted figures for amendments.
await both('5 counted figures', (t) => `UPDATE public.twob_import_docs SET base_taxable_value = 110, base_input_igst = 20 WHERE id = '${id(t, 105)}';
  UPDATE public.twob_import_docs SET base_taxable_value = 600, base_input_igst = 100 WHERE id = '${id(t, 107)}';
  UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = '${id(t, 108)}';`);
// 5b. A books row paired with a 2B document (A: the one call,
// twob_import2b_save_book; B: the document and the row as the page wrote
// them before, then Post).
await both('5b pairing in one call', (t, client) => (t === 'a'
  ? `SELECT public.twob_import2b_save_book(public.t_manager(), '${id(t, 201)}', '{"book_treatment":"MISMATCHED","matched_2b_id":"${id(t, 101)}"}'::jsonb, NULL, '${id(t, 101)}');`
  : `UPDATE public.twob_import_docs SET matched_book_id = '${id(t, 201)}', itc_action = 'MISMATCHED' WHERE id = '${id(t, 101)}' AND client_id = '${client}';
     UPDATE public.books_register SET book_treatment = 'MISMATCHED', matched_2b_id = '${id(t, 101)}' WHERE id = '${id(t, 201)}';`));
// 5c. A reclaim (A: the one call, twob_import2b_reclaim; B: the entry and
// the document as the page wrote them before, then Post): a Not in Books
// document reclaims a pending Not in 2B entry.
await both('5c reclaim in one call', (t, client) => {
  const entry = psql(`SELECT id FROM public.bills_not_in_2b WHERE source_book_id = '${id(t, 204)}'`);
  return t === 'a'
    ? `SELECT public.twob_import2b_reclaim(public.t_manager(), '${client}', '${M}', '${entry}', '${id(t, 114)}');`
    : `UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26', reclaimed_via_doc_id = '${id(t, 114)}' WHERE id = '${entry}';
       UPDATE public.twob_import_docs SET itc_action = 'RECLAIM' WHERE id = '${id(t, 114)}';`;
});
check('5c reclaim in one call: the entry was there to reclaim', psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '${id('a', 204)}' AND reclaim_month = 'Sep 26'`) === '1');

// 6. A books row deleted (B: Import 2B's delete took back its entry, then Post).
{
  const ra = run(`DELETE FROM public.books_register WHERE id = '${id('a', 202)}' OR id = '${id('a', 205)}' OR id = '${id('a', 206)}';`);
  globalThis.__legacy = true;
  const rb = run(`DELETE FROM public.bills_not_in_2b WHERE source_book_id IN ('${id('b', 202)}', '${id('b', 205)}', '${id('b', 206)}') AND NOT COALESCE(is_locked, false) AND reclaim_month IS NULL;
    DELETE FROM public.books_register WHERE id IN ('${id('b', 202)}', '${id('b', 205)}', '${id('b', 206)}');`, true);
  const plan = await P.planImport2BPost(B, M);
  await P.postImport2BToLedger(B, M, ACTOR, plan);
  globalThis.__legacy = false;
  check('6 books delete: the save runs on both twins', !ra.err && !rb.err, ra.err || rb.err);
  compare('6 books delete');
}
// 7. Delete 2B (A: the one call; B: Import 2B's delete as it was, then Post).
{
  psql(`SELECT set_config('twob.write', 'system', false);
    UPDATE public.bills_not_in_books SET is_locked = true WHERE source_doc_id IN ('${id('a', 102)}', '${id('b', 102)}');
    INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, input_igst, reversal_month, reclaim_month, reclaimed_via_doc_id) VALUES
      ('${A}', '${M}', '2026-08-30', 'OLD', 'O/1', 252, 'Aug 26', 'Sep 26', '${id('a', 114)}'),
      ('${B}', '${M}', '2026-08-30', 'OLD', 'O/1', 252, 'Aug 26', 'Sep 26', '${id('b', 114)}');`);
  const ra = run(`SELECT public.twob_import2b_delete_2b(public.t_manager(), '${A}', '${M}');`);
  globalThis.__legacy = true;
  const ids = psql(`SELECT string_agg(quote_literal(id), ',') FROM public.twob_import_docs WHERE client_id = '${B}' AND period_month = '${M}'`);
  const rb = run(`UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL WHERE reclaimed_via_doc_id IN (${ids});
    DELETE FROM public.bills_not_in_books WHERE source_doc_id IN (${ids}) AND is_locked IS NOT TRUE AND is_carried_forward IS NOT TRUE;
    DELETE FROM public.twob_import_docs d WHERE d.id IN (${ids}) AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_books l WHERE l.source_doc_id = d.id);`, true);
  const plan = await P.planImport2BPost(B, M);
  await P.postImport2BToLedger(B, M, ACTOR, plan);
  globalThis.__legacy = false;
  check('7 Delete 2B: the save runs on both twins', !ra.err && !rb.err, ra.err || rb.err);
  compare('7 Delete 2B');
}
// 8. Clear Data (A: the one call; B: the dialog as it was, then Post).
{
  const months = "ARRAY['04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026','11/2026','12/2026','01/2027','02/2027','03/2027']";
  const ra = run(`SELECT public.twob_clear_year(public.t_manager(), '${A}', ${months});`);
  globalThis.__legacy = true;
  const rb = run(`UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL
      WHERE client_id = '${B}' AND period_month = ANY (${months}) AND is_carried_forward AND (reclaim_month IS NOT NULL OR reclaim_subtype IS NOT NULL);
    UPDATE public.bills_not_in_books SET book_entry_month = NULL WHERE client_id = '${B}' AND period_month = ANY (${months}) AND is_carried_forward AND book_entry_month IS NOT NULL;
    DELETE FROM public.bills_not_in_2b WHERE client_id = '${B}' AND period_month = ANY (${months});
    DELETE FROM public.bills_not_in_books WHERE client_id = '${B}' AND period_month = ANY (${months});`, true);
  const plan = await P.planImport2BPost(B, M);
  await P.postImport2BToLedger(B, M, ACTOR, plan);
  globalThis.__legacy = false;
  check('8 Clear Data: the save runs on both twins', !ra.err && !rb.err, ra.err || rb.err);
  compare('8 Clear Data');
}

// 9. A month out of step: the database's plan names what planImport2BPost
// names, row for row; the catch-up then leaves it as Post would.
{
  const C = 'ce000000-0000-0000-0000-0000000000c1';
  const D = 'de000000-0000-0000-0000-0000000000d1';
  const rows = (twin, client) => {
    const d = DOCS.map(([n, o]) => ({ ...docRow(twin, n, o), client_id: client }));
    const b = BOOKS.map(([n, o]) => ({ ...bookRow(twin, n, o), client_id: client }));
    return insertSql('twob_import_docs', d) + insertSql('books_register', b);
  };
  // Written before the write-through: the ledger holds stale and missing entries.
  psql(`SELECT set_config('twob.write', 'system', false);
    INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'PARITY C', '24PARIC0000A1Z5'), ('${D}', 'PARITY D', '24PARID0000A1Z5');
    ${rows('c', C)} ${rows('d', D)}
    INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, bill_in_2b_month, source_doc_id) VALUES
      ('${C}', '${M}', '2026-09-10', 'SUPPLIER', 'INV/9', '24AAAAA0000A1Z5', 900, 162, 'Sep 26', '${id('c', 109)}'),
      ('${D}', '${M}', '2026-09-10', 'SUPPLIER', 'INV/9', '24AAAAA0000A1Z5', 900, 162, 'Sep 26', '${id('d', 109)}'),
      ('${C}', '${M}', '2026-09-10', 'SUPPLIER', 'INV/1', '24AAAAA0000A1Z5', 999, 170, 'Sep 26', '${id('c', 101)}'),
      ('${D}', '${M}', '2026-09-10', 'SUPPLIER', 'INV/1', '24AAAAA0000A1Z5', 999, 170, 'Sep 26', '${id('d', 101)}');
    INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, source_book_id) VALUES
      ('${C}', '${M}', '2026-09-15', 'VENDOR', 'B/202', '24VVVVV0000A1Z5', 1000, 90, 90, 'Sep 26', '${id('c', 202)}'),
      ('${D}', '${M}', '2026-09-15', 'VENDOR', 'B/202', '24VVVVV0000A1Z5', 1000, 90, 90, 'Sep 26', '${id('d', 202)}');`);
  const tsPlan = await P.planImport2BPost(C, M);
  const ts = [
    ...tsPlan.insertBills2B.map(({ row }) => `N2B insert ${row.id.slice(1)}`),
    ...tsPlan.updateBills2B.map(({ row }) => `N2B update ${row.id.slice(1)}`),
    ...tsPlan.retractBills2B.map(({ ledgerId }) => `N2B retract ${psql(`SELECT substr(source_book_id::text, 2) FROM public.bills_not_in_2b WHERE id = '${ledgerId}'`)}`),
    ...tsPlan.skippedBooks.map(({ row, reason }) => `N2B skip ${row.id.slice(1)} ${reason}`),
    ...tsPlan.insertBillsBooks.map(({ row }) => `NIB insert ${row.id.slice(1)}`),
    ...tsPlan.updateBillsBooks.map(({ row }) => `NIB update ${row.id.slice(1)}`),
    ...tsPlan.retractBillsBooks.map(({ ledgerId }) => `NIB retract ${psql(`SELECT substr(source_doc_id::text, 2) FROM public.bills_not_in_books WHERE id = '${ledgerId}'`)}`),
    ...tsPlan.skippedDocs.map(({ row, reason }) => `NIB skip ${row.id.slice(1)} ${reason}`),
  ].sort();
  const sql = psql(`SELECT string_agg(CASE p.list WHEN 'bills_not_in_2b' THEN 'N2B' ELSE 'NIB' END || ' ' || p.op || ' ' || substr(p.source_id::text, 2)
                      || CASE WHEN p.op = 'skip' THEN ' ' || p.reason ELSE '' END, E'\\n' ORDER BY 1)
                      FROM public.twob__autopost_plan('${C}', '${M}', NULL, NULL) p`).split('\n').sort();
  check(`9 out of step: the database's plan names what planImport2BPost names (${ts.length} rows)`,
    JSON.stringify(ts) === JSON.stringify(sql) && ts.length > 10, `ts=${JSON.stringify(ts)} sql=${JSON.stringify(sql)}`);
  check('9 out of step: the page says so', !!P.outOfStepLine(tsPlan, false));
  const preview = JSON.parse(run(`SELECT public.twob_import2b_catch_up(public.t_manager(), '${C}', '${M}', true)`).out);
  check('9 out of step: the catch-up preview counts what the plan holds',
    preview.bills_not_in_2b.add + preview.bills_not_in_2b.link === tsPlan.insertBills2B.length
      && preview.bills_not_in_2b.change === tsPlan.updateBills2B.length && preview.bills_not_in_2b.remove === tsPlan.retractBills2B.length
      && preview.bills_not_in_books.add + preview.bills_not_in_books.link === tsPlan.insertBillsBooks.length
      && preview.bills_not_in_books.change === tsPlan.updateBillsBooks.length && preview.bills_not_in_books.remove === tsPlan.retractBillsBooks.length,
    JSON.stringify(preview));
  const done = run(`SELECT public.twob_import2b_catch_up(public.t_manager(), '${C}', '${M}', false) ->> 'written'`);
  globalThis.__legacy = true;
  const dPlan = await P.planImport2BPost(D, M);
  await P.postImport2BToLedger(D, M, ACTOR, dPlan);
  globalThis.__legacy = false;
  check('9 out of step: brought up to date', !done.err && Number(done.out) > 0, done.err || done.out);
  const c = ledgerOf(C);
  const d = ledgerOf(D);
  check('9 out of step: the ledger left as Post leaves it', c === d, `C=${c}\nD=${d}`);
  const after = await P.planImport2BPost(C, M);
  check('9 out of step: then in step (planImport2BPost plans nothing, the line goes)', P.isPostPlanEmpty(after) && !P.outOfStepLine(after, false),
    JSON.stringify({ i: after.insertBillsBooks.length, u: after.updateBillsBooks.length, r: after.retractBillsBooks.length }));
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} autopost: ${r.name}${r.ok ? '' : `  [${r.info}]`}`);
}
console.log(`autopost: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
