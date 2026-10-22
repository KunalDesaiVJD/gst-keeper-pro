#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's own calls of the third verification round (22 Oct 2026), run
// against the test database as PostgREST runs them (anon, with the request
// headers naming the user):
//   M2  a Pending items button acts only on the (client, month) it was shown
//       for: an Oct-26 entry shown under Sep-26 (a read of the other month
//       landing late) reads as gone and is never stamped with Sep's label
//       (updatePendingEntry, scoped);
//   L1  "Bring the reconciliation up to date" and a filed month's save write
//       only what their confirm showed (catchUpMonth with the preview's
//       digest; previewAndApplyPriorSave, with a change landing while its
//       confirm is open);
//   L4  the e-mail pop-up names, for each document not on the ledger, its
//       own reason: no date or supplier, a filed month, or a month out of
//       step (loadBillsNotInBooks, unpostedSentence);
//   L5  the out-of-step line names links and put-backs apart, and the
//       catch-up's confirm lists rows still on the ledger as last saved
//       apart from rows not on it (outOfStepLine, catchUpSkippedLines);
//   L6  an employee without Import 2B & post: the page asks, before each
//       save, exactly what the database lets through (docChangeTouchesLedger,
//       bookSaveTouchesLedger, against the database's own verdict for that
//       user on the same saves), and the note says which saves change the
//       ledger.
// The modules are bundled as they are (esbuild) with a stand-in supabase
// client that sends each query to the test database through psql, as anon.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '../../..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const db = process.env.TWOB_TEST_DB;
if (!db) { console.error('TWOB_TEST_DB is not set (run through run.sh)'); process.exit(2); }

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });
const psql = (sql) => execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const POSTER = '00000000-0000-0000-0000-0000000000a4';
const EMPLOYEE = '00000000-0000-0000-0000-0000000000a3';
const MANAGER = '00000000-0000-0000-0000-0000000000a2';
globalThis.__actor = POSTER;
const asAnon = (sql, actor) => `SET ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"${actor}","x-gst-source":"app"}', false); ${sql}`;
globalThis.__asApp = (sql) => {
  try {
    const out = execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', asAnon(sql, globalThis.__actor)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n');
    return { out: out[out.length - 1], err: null };
  } catch (e) {
    return { out: null, err: String(e.stderr || e.message).replace(/^.*ERROR:\s*/s, '').split('\n')[0] };
  }
};
/** The database's verdict on one save by `actor`, undone after: null when it went through, else its error. */
const verdict = (sql, actor) => {
  try {
    execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', `BEGIN; ${asAnon(sql, actor)}; ROLLBACK;`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return null;
  } catch (e) {
    return String(e.stderr || e.message).replace(/^.*ERROR:\s*/s, '').split('\n')[0];
  }
};

// A stand-in for the supabase client: select (with filters, order, range,
// maybeSingle), insert, update, delete and rpc, one SQL statement each,
// through psql as anon naming globalThis.__actor.
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
const rpc = async (fn, args) => {
  const r = globalThis.__asApp('SELECT to_jsonb(public.' + col(fn) + '(' + Object.entries(args || {}).map(([k, v]) => col(k) + ' => ' + lit(v)).join(', ') + '))');
  return r.err ? { data: null, error: { message: r.err } } : { data: JSON.parse(r.out), error: null };
};
export const supabase = { from: (t) => new Q(t), rpc };
`;

const out = await build({
  stdin: {
    contents: `
export { updatePendingEntry, ENTRY_GONE_MSG } from './src/lib/twobPendingWrites';
export { catchUpMonth, catchUpSkippedLines, outOfStepLine, fetchStep, docChangeTouchesLedger, bookSaveTouchesLedger, LEDGER_SAVES_NOTE } from './src/lib/import2bAutopost';
export { previewAndApplyPriorSave } from './src/lib/twobPriorMonth';
export { loadBillsNotInBooks, unpostedSentence } from './src/lib/billsNotInBooksMail';
`,
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
const A = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const run = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: runs`, false, e?.stack ?? e); } };

const C = 'a3000000-0000-0000-0000-0000000000c1';
const F = 'a3000000-0000-0000-0000-0000000000c2';
const id = (n) => `a3000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
// SCREEN-like client: Sep-26 and Oct-26 open. Written as the app of before
// (twob.write 'system': no write-through), so Sep is out of step where noted.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'R3 SCREEN', '24RTHRE0000A1Z5'), ('${F}', 'R3 FILED', '24RTHRF0000A1Z5');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '09/2026', '2026-09-03', 'SEP OWN', 'S-1', '24SEPOW0000A1Z5', 1000, 0, 90, 90, 'Sep 26', false),
  ('${id(2)}', '${C}', '10/2026', '2026-10-03', 'OCT OWN', 'O-1', '24OCTOW0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
INSERT INTO public.bills_not_in_books (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward) VALUES
  ('${id(3)}', '${C}', '10/2026', '2026-10-04', 'OCT NIB', 'ON-1', '24OCTNI0000A1Z5', 1000, 180, 0, 0, 'Oct 26', false);
-- Sep-26 Import 2B: D9-7 Not in Books, dated, never posted (out of step);
-- D9-8 Not in Books without a date (never posts); B9-6 an unposted books row
-- identical to S-1 (the step links it); B9-3 without a date, never posted;
-- B9-5 without a date, posted before (its entry stays as last saved).
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '09/2026', '2026-09-07', 'SEP NIB SEVEN', 'D9-7', '24SEPNS0000A1Z5', 2000, 360, 'INVOICE', 'NOT_IN_BOOKS'),
  ('${id(12)}', '${C}', '09/2026', NULL, 'SEP NIB EIGHT', 'D9-8', '24SEPNE0000A1Z5', 1000, 180, 'INVOICE', 'NOT_IN_BOOKS');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('${id(21)}', '${C}', '09/2026', '2026-09-03', 'SEP OWN', 'S-1', '24SEPOW0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('${id(22)}', '${C}', '09/2026', NULL, 'SEP NO DATE', 'B9-3', '24SEPND0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('${id(23)}', '${C}', '09/2026', NULL, 'SEP LAST SAVED', 'B9-5', '24SEPLS0000A1Z5', 3000, 270, 270, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
  ('${id(24)}', '${C}', '09/2026', '2026-09-02', 'SEP LAST SAVED', 'B9-5', '24SEPLS0000A1Z5', 3000, 0, 270, 270, 'Sep 26', false, '${id(23)}');
-- R3 FILED: Jul-26 filed, a Not in Books document never posted (follows the filed 2B).
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('${id(31)}', '${F}', '07/2026', '2026-07-07', 'JUL NIB', 'DJ-1', '24JULNI0000A1Z5', 2000, 360, 'INVOICE', 'NOT_IN_BOOKS');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('${id(32)}', '${F}', '07/2026', '2026-07-10', 'JUL BOOK', 'BJ-1', '24JULBO0000A1Z5', 10000, 900, 900, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
  ('${id(33)}', '${F}', '07/2026', '2026-07-10', 'JUL BOOK', 'BJ-1', '24JULBO0000A1Z5', 10000, 0, 900, 900, 'Jul 26', false, '${id(32)}');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
  ('${F}', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true);`);

// ── M2: a Pending items button acts only on its own (client, month). ─────────
await run('M2', async () => {
  globalThis.__actor = POSTER;
  const res = await A.updatePendingEntry('bills_not_in_2b', id(2), { reclaim_month: 'Sep 26', reclaim_subtype: 'EXPENSE_OUT' }, POSTER,
    { clientId: C, period: '09/2026' });
  check('M2: Expense out from Sep-26 on an Oct-26 entry (shown under Sep by a late read) reads as gone', !res.ok && res.gone && res.message === A.ENTRY_GONE_MSG,
    JSON.stringify(res));
  check('M2: ... and the Oct-26 entry is not stamped with Sep\'s label (no month\'s 4D(1.2) would count it)',
    psql(`SELECT COALESCE(reclaim_month, '-') || '|' || COALESCE(reclaim_subtype, '-') FROM public.bills_not_in_2b WHERE id = '${id(2)}'`) === '-|-');
  const book = await A.updatePendingEntry('bills_not_in_books', id(3), { book_entry_month: 'Sep 26' }, POSTER, { clientId: C, period: '09/2026' });
  check('M2: a book entry from Sep-26 on an Oct-26 Not in Books entry reads as gone, nothing written', !book.ok && book.gone
    && psql(`SELECT COALESCE(book_entry_month, '-') FROM public.bills_not_in_books WHERE id = '${id(3)}'`) === '-', JSON.stringify(book));
  const own = await A.updatePendingEntry('bills_not_in_2b', id(2), { reclaim_month: 'Oct 26', reclaim_subtype: 'EXPENSE_OUT' }, POSTER,
    { clientId: C, period: '10/2026' });
  check('M2: ... from its own month it is written', own.ok
    && psql(`SELECT reclaim_month || '|' || reclaim_subtype FROM public.bills_not_in_2b WHERE id = '${id(2)}'`) === 'Oct 26|EXPENSE_OUT', JSON.stringify(own));
  psql(`UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL WHERE id = '${id(2)}'`);
});

// ── L5: the line and the catch-up confirm's words. ───────────────────────────
await run('L5', async () => {
  globalThis.__actor = POSTER;
  const step = await A.fetchStep(C, '09/2026');
  const line = A.outOfStepLine(step, false)?.text || '';
  check('L5: the line names the link apart ("1 to link"), never as "to add"', step?.bills2B.link === 1 && step?.bills2B.add === 0
    && line.includes('Not in 2B 1 to link') && !line.includes('Not in 2B 1 to add'), line);
  const preview = await A.catchUpMonth(POSTER, C, '09/2026', true);
  const lines = A.catchUpSkippedLines(preview);
  check('L5: the confirm lists B9-5 as on the ledger as last saved, still counted',
    lines.some((l) => l.startsWith('On the 2B Reconciliation ledger as last saved, 1 row (B9-5): missing date')), JSON.stringify(lines));
  check('L5: ... and B9-3 and D9-8 as not on the ledger, apart',
    lines.some((l) => l.startsWith('Not on the 2B Reconciliation ledger') && l.includes('B9-3') && !l.includes('B9-5'))
      && lines.some((l) => l.startsWith('Not on the 2B Reconciliation ledger') && l.includes('D9-8')), JSON.stringify(lines));
});

// ── L4: the e-mail pop-up's reason per document. ─────────────────────────────
await run('L4', async () => {
  globalThis.__actor = POSTER;
  const { rows } = await A.loadBillsNotInBooks(C, '09/2026', { filed: false });
  const d97 = rows.find((r) => r.docNo === 'D9-7');
  const d98 = rows.find((r) => r.docNo === 'D9-8');
  check('L4: D9-7 (dated, in an open month out of step) is not on the ledger because the month is out of step',
    d97?.unposted && d97.unpostedWhy === 'out-of-step', JSON.stringify(d97));
  check('L4: D9-8 (no date in the 2B file) for that reason', d98?.unposted && d98.unpostedWhy === 'no-date-supplier', JSON.stringify(d98));
  const sentence = A.unpostedSentence(rows) || '';
  check('L4: the pop-up says each reason, pointing a month out of step to "Bring the reconciliation up to date"',
    sentence.includes('1 document without a date or supplier in the 2B file') && sentence.includes('1 document of a month out of step')
      && sentence.includes('"Bring the reconciliation up to date"') && !sentence.includes('or a filed month'), sentence);
  const filed = await A.loadBillsNotInBooks(F, '07/2026', { filed: true });
  check('L4: a filed month\'s document is named as one', filed.rows.find((r) => r.docNo === 'DJ-1')?.unpostedWhy === 'filed'
    && (A.unpostedSentence(filed.rows) || '').includes('of a filed month'), JSON.stringify(filed.rows));
});

// ── L1: the confirm writes only what it showed. ──────────────────────────────
await run('L1', async () => {
  globalThis.__actor = POSTER;
  const preview = await A.catchUpMonth(POSTER, C, '09/2026', true);
  check('L1: the preview carries its digest', typeof preview.digest === 'string' && preview.digest.length === 32, JSON.stringify(preview));
  // Meanwhile the own entry S-1 (the one the preview links its books row to)
  // is corrected on 2B Reconciliation: no longer the same document, the
  // books row would now be added beside it, which the confirm never said.
  psql(`UPDATE public.bills_not_in_2b SET input_cgst = 95, input_sgst = 95 WHERE id = '${id(1)}'`);
  let err = null;
  try { await A.catchUpMonth(POSTER, C, '09/2026', false, preview.digest); } catch (e) { err = e.message; }
  check('L1: the confirm accepted after the month changed writes nothing and says why', (err || '').includes('changed while the confirm was open'), err);
  check('L1: ... D9-7 is still not on the ledger', psql(`SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = '${id(11)}'`) === '0');
  const again = await A.catchUpMonth(POSTER, C, '09/2026', true);
  const done = await A.catchUpMonth(POSTER, C, '09/2026', false, again.digest);
  check('L1: previewed again and confirmed, it is written', done.written === again.written && done.written > 0
    && psql(`SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = '${id(11)}'`) === '1', JSON.stringify(done));

  // A filed month's save: a change lands while the confirm is open.
  globalThis.__actor = MANAGER;
  const messages = [];
  // BJ-1's entry left behind its books row (the app of before), so the
  // filed month is out of step on its Not in 2B side.
  psql(`SELECT set_config('twob.write', 'system', false);
    UPDATE public.bills_not_in_2b SET input_cgst = 950, input_sgst = 950 WHERE id = '${id(33)}';`);
  const outcome2 = await A.previewAndApplyPriorSave({
    actorId: MANAGER, clientId: F, period: '07/2026', changes: [], wholeMonth: true, title: 'Bring up to date',
    confirm: async () => {
      psql(`SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
          taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
        VALUES ('${id(34)}', '${F}', '07/2026', '2026-07-12', 'JUL TWO', 'BJ-2', '24JULTW0000A1Z5', 500, 45, 45, 'NOT_IN_2B', 'INVOICE');`);
      return true;
    },
    notify: { error: (m) => messages.push(m), info: (m) => messages.push(m) },
  });
  check('L1 filed: the confirm accepted after the month changed saves nothing, and says why',
    !outcome2.applied && messages.some((m) => m.includes('changed while the confirm was open')), JSON.stringify({ outcome2, messages }));
  check('L1 filed: ... BJ-1 is not changed and BJ-2 not added behind the confirm',
    psql(`SELECT input_cgst || '|' || (SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '${id(34)}') FROM public.bills_not_in_2b WHERE id = '${id(33)}'`) === '950.00|0');
  const outcome3 = await A.previewAndApplyPriorSave({
    actorId: MANAGER, clientId: F, period: '07/2026', changes: [], wholeMonth: true, title: 'Bring up to date',
    confirm: async () => true, notify: { error: (m) => messages.push(m), info: (m) => messages.push(m) },
  });
  check('L1 filed: previewed again and confirmed, it is saved', outcome3.applied
    && psql(`SELECT input_cgst || '|' || (SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '${id(34)}') FROM public.bills_not_in_2b WHERE id = '${id(33)}'`) === '900.00|1',
    JSON.stringify({ outcome3, messages }));
});

// ── L6: an employee without Import 2B & post: the page asks what the database lets through. ──
await run('L6', async () => {
  const E = 'a3000000-0000-0000-0000-0000000000c3';
  psql(`SELECT set_config('twob.write', 'system', false);
    INSERT INTO public.clients (id, name, gstin) VALUES ('${E}', 'R3 EMPLOYEE', '24RTHRE0000A1Z6');
    INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, doc_type, itc_action) VALUES
      ('${id(41)}', '${E}', '09/2026', '2026-09-05', 'EMP MATCHED', 'E-1', '24EMPMA0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED'),
      ('${id(42)}', '${E}', '09/2026', NULL, 'EMP NO DATE', 'E-2', '24EMPND0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED'),
      ('${id(43)}', '${E}', '09/2026', '2026-09-06', 'EMP NIB', 'E-3', '24EMPNB0000A1Z5', 1000, 180, 'INVOICE', 'NOT_IN_BOOKS'),
      ('${id(44)}', '${E}', '09/2026', NULL, 'EMP NIB NO DATE', 'E-4', '24EMPNN0000A1Z5', 1000, 180, 'INVOICE', 'NOT_IN_BOOKS'),
      ('${id(45)}', '${E}', '09/2026', '2026-09-07', 'EMP INELIGIBLE', 'E-5', '24EMPIN0000A1Z5', 1000, 180, 'INVOICE', 'INELIGIBLE');
    INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward, source_doc_id) VALUES
      ('${E}', '09/2026', '2026-09-06', 'EMP NIB', 'E-3', '24EMPNB0000A1Z5', 1000, 180, 0, 0, 'Sep 26', false, '${id(43)}');
    INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
      ('${id(51)}', '${E}', '09/2026', '2026-09-08', 'EMP MISMATCHED', 'EB-1', '24EMPBM0000A1Z5', 1000, 90, 90, 'MISMATCHED', 'INVOICE'),
      ('${id(52)}', '${E}', '09/2026', '2026-09-08', 'EMP NOT ELIGIBLE', 'EB-2', '24EMPBN0000A1Z5', 1000, 90, 90, 'NOT_ELIGIBLE', 'INVOICE'),
      ('${id(53)}', '${E}', '09/2026', NULL, 'EMP NO DATE', 'EB-3', '24EMPBD0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
      ('${id(54)}', '${E}', '09/2026', '2026-09-09', 'EMP POSTED', 'EB-4', '24EMPBP0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
      ('${id(55)}', '${E}', '09/2026', '2026-09-09', 'EMP RETURN', 'EB-5', '24EMPBR0000A1Z5', 1000, 90, 90, 'NOT_ELIGIBLE', 'DEBIT_NOTE');
    INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
      ('${E}', '09/2026', '2026-09-09', 'EMP POSTED', 'EB-4', '24EMPBP0000A1Z5', 1000, 0, 90, 90, 'Sep 26', false, '${id(54)}');`);
  const doc = (n) => JSON.parse(psql(`SELECT row_to_json(d) FROM public.twob_import_docs d WHERE id = '${id(n)}'`));
  const book = (n) => JSON.parse(psql(`SELECT row_to_json(b) FROM public.books_register b WHERE id = '${id(n)}'`));
  const hasDocEntry = (n) => psql(`SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = '${id(n)}'`) !== '0';
  const hasBookEntry = (n) => psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '${id(n)}'`) !== '0';
  const NEEDS = 'needs the Import 2B & post permission';
  const docCases = [
    [41, 'INELIGIBLE'], [41, 'NOT_IN_BOOKS'], [42, 'NOT_IN_BOOKS'], [43, 'MATCHED'], [43, 'INELIGIBLE'], [44, 'MATCHED'], [45, 'ITC_OF_OTHERS'], [45, 'MISMATCHED'],
  ];
  for (const [n, to] of docCases) {
    const d = doc(n);
    const page = A.docChangeTouchesLedger(d, d.itc_action, to, hasDocEntry(n));
    const v = verdict(`UPDATE public.twob_import_docs SET itc_action = '${to}' WHERE id = '${id(n)}'`, EMPLOYEE);
    const dbRefuses = !!v && v.includes(NEEDS);
    check(`L6: ${d.supplier_invoice_number} ${d.itc_action} -> ${to}: the page ${page ? 'asks for the permission' : 'saves it'}, as the database ${dbRefuses ? 'refuses' : 'lets it through'}`,
      page === dbRefuses && (!v || dbRefuses), JSON.stringify({ page, v }));
  }
  const bookCases = [
    [51, { input_cgst: 95, input_sgst: 95 }], [52, { book_treatment: 'NOT_IN_2B' }], [53, { supplier_name: 'EMP NO DATE CO' }],
    [53, { date: '2026-09-10' }], [54, { input_cgst: 95, input_sgst: 95 }], [55, { book_treatment: 'NOT_IN_2B' }], [52, { taxable_value: 1200 }],
  ];
  for (const [n, patch] of bookCases) {
    const b = book(n);
    const after = { ...b, ...patch };
    const page = A.bookSaveTouchesLedger(after, hasBookEntry(n));
    const set = Object.entries(patch).map(([k, val]) => `${k} = ${typeof val === 'number' ? val : `'${val}'`}`).join(', ');
    const v = verdict(`UPDATE public.books_register SET ${set} WHERE id = '${id(n)}'`, EMPLOYEE);
    const dbRefuses = !!v && v.includes(NEEDS);
    check(`L6: books ${b.supplier_invoice_number} ${JSON.stringify(patch)}: the page ${page ? 'asks for the permission' : 'saves it'}, as the database ${dbRefuses ? 'refuses' : 'lets it through'}`,
      page === dbRefuses && (!v || dbRefuses), JSON.stringify({ page, v }));
  }
  check('L6: the note says which saves change the ledger (not that every save does)',
    A.LEDGER_SAVES_NOTE.includes('Not in Books') && A.LEDGER_SAVES_NOTE.includes('Not in 2B with a date and supplier')
      && A.LEDGER_SAVES_NOTE.includes('You can still save the rest as before') && !/^Every save/.test(A.LEDGER_SAVES_NOTE), A.LEDGER_SAVES_NOTE);
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round3: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round3: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
