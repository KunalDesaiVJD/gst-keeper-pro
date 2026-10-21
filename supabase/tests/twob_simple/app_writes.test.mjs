#!/usr/bin/env node
// The app's own writes and words of the second review round (21 Oct 2026),
// run against the test database as PostgREST runs them (SET ROLE anon):
//   Q8  a stale open-month page reclaims a copy a filed month's correction
//       removed meanwhile: nothing is written, and its 2B document stays as
//       it was (src/lib/twobPendingWrites.ts recordReclaim, used by Import
//       2B's Link & Reclaim; the same check for Expense out and book entry);
//   Q12 2B Reconciliation's open-month Save deletes a carried entry holding
//       the month's own reclaim in one Save (deleteOpenMonthRows);
//   Q13 Filing Status says list by list what filing carried, from the carry
//       record (describeFilingCarry), and Re-run's preview does not call a
//       decision carried in from a filed month the next month's own, and says
//       when it only adds into a filed month (describeRerun);
// and of the third round (21 Oct 2026):
//   S4  the GSTR-3B push gate fails closed: a filed month's recorded figures
//       that cannot be read block Push with the reason (pushRecoGate, used by
//       Gstr3bPage; before, the page caught the error and left Push open);
//   S6/F15 a prior month's Post plan sends only the books side (Not in Books
//       entries from 2B documents are left out and named), and a books name
//       with a stray space plans no update (planToPriorChanges,
//       priorPlanLeftOut, amountsDiffer).
// The modules are bundled as they are (esbuild) with a stand-in supabase
// client that sends each query to the test database through psql, as anon.
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
const ANON = `SET ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);`;
globalThis.__asApp = (sql) => {
  try {
    const out = execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', `${ANON} ${sql}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n');
    return { out: out[out.length - 1], err: null };
  } catch (e) {
    return { out: null, err: String(e.stderr || e.message).replace(/^.*ERROR:\s*/s, '').split('\n')[0] };
  }
};

// A stand-in for the supabase client: from(t).select/update/delete with
// eq / in / is filters, sent as one SQL statement through psql as anon.
const FAKE_SUPABASE = `
const lit = (v) => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : "'" + String(v).replace(/'/g, "''") + "'";
const col = (c) => '"' + c.replace(/"/g, '') + '"';
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.vals = null; this.f = []; this.cols = '*'; this.ret = null; }
  select(c) { if (this.op === 'select') this.cols = c || '*'; else this.ret = c || '*'; return this; }
  update(v) { this.op = 'update'; this.vals = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push(col(c) + ' = ' + lit(v)); return this; }
  in(c, a) { this.f.push(col(c) + ' IN (' + (a.length ? a.map(lit).join(', ') : 'NULL') + ')'); return this; }
  is(c, v) { this.f.push(col(c) + ' IS ' + (v === null ? 'NULL' : String(v))); return this; }
  sql() {
    const where = this.f.length ? ' WHERE ' + this.f.join(' AND ') : '';
    const t = 'public.' + col(this.t);
    if (this.op === 'select') return 'SELECT COALESCE(json_agg(x), \\'[]\\') FROM (SELECT ' + this.cols + ' FROM ' + t + where + ') x';
    const body = this.op === 'update'
      ? 'UPDATE ' + t + ' SET ' + Object.entries(this.vals).map(([k, v]) => col(k) + ' = ' + lit(v)).join(', ') + where
      : 'DELETE FROM ' + t + where;
    return 'WITH x AS (' + body + ' RETURNING ' + (this.ret || 'id') + ') SELECT COALESCE(json_agg(x), \\'[]\\') FROM x';
  }
  then(ok, ko) {
    const r = globalThis.__asApp(this.sql());
    const res = r.err ? { data: null, error: { message: r.err } }
      : { data: this.op === 'select' || this.ret ? JSON.parse(r.out) : null, error: null };
    return Promise.resolve(res).then(ok, ko);
  }
}
export const supabase = { from: (t) => new Q(t), rpc: async () => ({ data: null, error: { message: 'no rpc here' } }) };
`;

const out = await build({
  stdin: {
    contents: `
export { recordReclaim, updatePendingEntry, deleteOpenMonthRows, ENTRY_GONE_MSG } from './src/lib/twobPendingWrites';
export { describeFilingCarry, describeRerun, describePriorPreview } from './src/lib/twobPriorMonth';
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

// ── Q8 (high): a stale Sep-26 page reclaims T-1's copy after the GST Manager
// removed T-1 in filed July (which removed September's copy too). ─────────
{
  const C = 'a8000000-0000-0000-0000-000000000001';
  const DOC = 'a8000000-0000-0000-0000-0000000000d1';
  psql(`SELECT public.t_make_tamnna('${C}', 'Q8 stale reclaim');
        SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
        VALUES ('${DOC}', '${C}', '09/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 1000, 1000, 'MATCHED');`);
  const pending = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1'`);
  const t1 = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1'`);
  const removed = globalThis.__asApp(`SELECT public.twob_prior_books_apply(public.t_manager(), '${C}', '07/2026', '[{"table":"bills_not_in_2b","op":"delete","id":"${t1}"}]'::jsonb, false) ->> 'ok'`);
  check('Q8: the GST Manager removes T-1 in filed July (and September\'s copy with it)', removed.out === 'true', removed.err);
  const res = await A.recordReclaim({ pendingId: pending, docId: DOC, label: 'Sep 26', userId: '00000000-0000-0000-0000-0000000000a3' });
  check('Q8: the stale page\'s reclaim is not recorded, and says the entry is gone', !res.ok && res.gone && res.message === A.ENTRY_GONE_MSG, JSON.stringify(res));
  check('Q8: the 2B document stays Matched, so its ITC stays in 5.1',
    psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${DOC}'`) === 'MATCHED');
  const exp = await A.updatePendingEntry('bills_not_in_2b', pending, { reclaim_month: 'Sep 26', reclaim_subtype: 'EXPENSE_OUT' }, undefined);
  check('Q8: an Expense out on the gone copy says so too', !exp.ok && exp.gone, JSON.stringify(exp));
  const book = await A.updatePendingEntry('bills_not_in_books', pending, { book_entry_month: 'Sep 26' }, undefined);
  check('Q8: a book entry on a gone entry says so too', !book.ok && book.gone, JSON.stringify(book));
  // The same reclaim on a copy that is there is recorded, the document with it.
  const C2 = 'a8000000-0000-0000-0000-000000000002';
  const DOC2 = 'a8000000-0000-0000-0000-0000000000d2';
  psql(`SELECT public.t_make_tamnna('${C2}', 'Q8 reclaim');
        SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
        VALUES ('${DOC2}', '${C2}', '09/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 1000, 1000, 'MATCHED');`);
  const pending2 = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C2}' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1'`);
  const ok = await A.recordReclaim({ pendingId: pending2, docId: DOC2, label: 'Sep 26', userId: '00000000-0000-0000-0000-0000000000a3' });
  check('Q8: a reclaim of a copy that is there is recorded', ok.ok, JSON.stringify(ok));
  check('Q8: ... the entry reclaimed and the document Reclaim',
    psql(`SELECT reclaim_month || ' ' || (SELECT itc_action FROM public.twob_import_docs WHERE id = '${DOC2}') FROM public.bills_not_in_2b WHERE id = '${pending2}'`) === 'Sep 26 RECLAIM');
}

// ── Q12 (low): 2B Reconciliation's open-month Save deletes a carried entry
// holding September's own reclaim, in one Save. ──────────────────────────
{
  const C = 'a8000000-0000-0000-0000-000000000003';
  psql(`SELECT public.t_make_tamnna('${C}', 'Q12 open delete')`);
  const row = JSON.parse(psql(`SELECT row_to_json(t) FROM public.bills_not_in_2b t WHERE client_id = '${C}' AND period_month = '09/2026' AND supplier_invoice_number = 'T-2'`));
  const plain = globalThis.__asApp(`DELETE FROM public.bills_not_in_2b WHERE id = '${row.id}'`);
  check('Q12: a plain delete of it is refused by the database (an old page would lose the reclaim)', plain.err && plain.err.includes('undo that reclaim first'), plain.err);
  const res = await A.deleteOpenMonthRows('bills_not_in_2b', [row]);
  check('Q12: the Save undoes the reclaim and deletes the entry', res.error === null, res.error);
  check('Q12: ... the entry is gone', psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE id = '${row.id}'`) === '0');
}

// ── Q13 (low): the words after filing, and Re-run's preview. ────────────
{
  const both = A.describeFilingCarry('GSTR-3B', '10/2026', [
    { list: 'bills_not_in_2b', nextPeriod: '11/2026', outcome: 'carried', rows: 3 },
    { list: 'bills_not_in_books', nextPeriod: '11/2026', outcome: 'carried', rows: 1 }]);
  check('Q13: both lists carried: says so with the counts', both.tone === 'success' && both.text.includes('Not in 2B: 3 entries carried into Nov-26')
    && both.text.includes('Not in Books: 1 entry carried into Nov-26'), both.text);
  const one = A.describeFilingCarry('GSTR-3B', '10/2026', [
    { list: 'bills_not_in_2b', nextPeriod: '11/2026', outcome: 'next_held', rows: 0 },
    { list: 'bills_not_in_books', nextPeriod: '11/2026', outcome: 'carried', rows: 2 }]);
  check('Q13: Not in 2B held, Not in Books carried: says which, and names Re-run (ORVIX)',
    one.tone === 'warning' && one.text.includes('Not in Books: 2 entries carried into Nov-26') && one.text.includes('Not in 2B: not carried, because Nov-26 already held carried entries')
    && one.text.includes('Re-run carry forward'), one.text);
  const filed = A.describeFilingCarry('GSTR-3B', '07/2026', [
    { list: 'bills_not_in_2b', nextPeriod: '08/2026', outcome: 'next_filed', rows: 0 },
    { list: 'bills_not_in_books', nextPeriod: '08/2026', outcome: 'next_filed', rows: 0 }]);
  check('Q13 (S1): a next month filed already takes nothing, and the words say so and name Re-run', filed.tone === 'warning'
    && filed.text.includes('Not in 2B: not carried, because Aug-26 is filed already') && filed.text.includes('Re-run carry forward'), filed.text);
  const again = A.describeFilingCarry('GSTR-3B', '07/2026', [{ list: 'bills_not_in_2b', nextPeriod: '08/2026', outcome: 'done_before', rows: 0 }]);
  check('Q13 (S1): filed again: not carried again', again.tone === 'warning' && again.text.includes('not carried again; it was carried when Jul-26 was first filed'), again.text);
  const none = A.describeFilingCarry('GSTR-3B', '07/2026', null);
  check('Q13: a carry record that cannot be read is not reported as a carry', none.tone === 'warning' && none.text.includes('Could not read what was carried'), none.text);
  const empty = { add: [], remove: [], keep: [], conflict: [], left: [] };
  const rerun = A.describeRerun({
    period: '08/2026', nextPeriod: '09/2026', nextFiled: false, dryRun: true,
    bills2B: { ...empty, keep: [{ id: 'x', date: '2026-07-05', supplierName: 'GONE', number: 'G-1', tax: 140, message: 'Aug-26 (filed) has reclaimed this entry, so it cannot be removed or its amounts changed' }] },
    billsBooks: empty,
  });
  check('Q13: Re-run keeps a copy holding a carried-in reclaim without calling it Sep-26\'s own decision',
    rerun.lines.length === 1 && !rerun.lines[0].includes('own decision') && rerun.lines[0].includes('a reclaim, Expense out or book entry'), rerun.lines.join(' | '));
  const into = A.describeRerun({
    period: '07/2026', nextPeriod: '08/2026', nextFiled: true, dryRun: true,
    bills2B: { ...empty, add: [{ id: 'a', date: '2026-07-10', supplierName: 'JUL OWN', number: 'J-1', tax: 200, message: null }],
      left: [{ id: 'l', date: '2026-07-01', supplierName: 'OLD', number: 'O-1', tax: 20, message: null }] },
    billsBooks: empty,
  });
  check('Q13 (S1): Re-run into a filed month says it only adds, names what it leaves, and to re-run the next month',
    !into.nothingToDo && into.lines[0].includes('Aug-26 is filed: Re-run only adds') && into.lines.some((l) => l.includes('stays (OLD O-1)'))
    && into.lines[into.lines.length - 1] === 'Then re-run Aug-26 to carry them on into Sep-26.', into.lines.join(' | '));
  const preview = A.describePriorPreview({
    ok: true, dryRun: true, refusals: [], laterMonths: [{ period: '08/2026', count: 1 }],
    notes: [{ index: 1, entry: 'V J DESAI 38/2026-27', message: 'Apr-26 holds this entry as its own entry, so Apr-26 and the months after it are left as they are', kind: 'stop' }],
    changes: [{ index: 0, table: 'bills_not_in_2b', op: 'insert', entry: 'LATE BILL L-1', action: 'add', id: 'n', later: [{ period: '08/2026', action: 'add', id: 'c' }], booksRow: null, refusal: null, note: null }],
  }, '07/2026');
  check('Q13 (S3, S2): the door\'s preview names the months an added entry reaches, and where a change stops',
    preview.includes('Each added entry is also added to Aug-26.') && preview.includes('Left as they are: V J DESAI 38/2026-27: Apr-26 holds this entry as its own entry')
    && !preview.includes('No later month holds'), preview);
}

// ── S4, S6 and F15: the push gate and the Post plan, on stand-in data. ──────
const MEM_SUPABASE = `
class Q {
  constructor(t) { this.t = t; this.f = []; this.rng = null; this.lim = null; this.one = false; this.cols = null; }
  select(c) { this.cols = c && c.trim() !== '*' ? c.split(',').map((x) => x.trim()).filter(Boolean) : null; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { this.f.push((r) => (r[c] ?? null) !== v); return this; }
  order() { return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  then(ok, ko) {
    if ((globalThis.__failTables || []).includes(this.t)) return Promise.resolve({ data: null, error: { message: 'fetch failed' } }).then(ok, ko);
    let rows = ((globalThis.__mem || {})[this.t] || []).filter((r) => this.f.every((fn) => fn(r)));
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    rows = rows.map((r) => (this.cols ? Object.fromEntries(this.cols.map((k) => [k, r[k] ?? null])) : { ...r }));
    return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null }).then(ok, ko);
  }
}
export const supabase = { from: (t) => new Q(t), rpc: async () => ({ data: null, error: { message: 'no rpc here' } }) };
`;
const memOut = await build({
  stdin: {
    contents: `
export { runPushRecoCheck, pushRecoBlocks } from './src/lib/pushRecoGate';
export { planImport2BPost, planToPriorChanges, priorPlanLeftOut } from './src/lib/postImport2B';
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
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: MEM_SUPABASE, loader: 'js' }));
    },
  }],
  define: { 'import.meta.env': '{}' },
});
const B = await import('data:text/javascript;base64,' + Buffer.from(memOut.outputFiles[0].text).toString('base64'));
{
  // Sep-26: opening 1,000 a head, one pending reversal of Jul 26 (1,000 a head): the difference is 0.
  globalThis.__mem = {
    suspended_reco: [{ client_id: 'c', period_month: '09/2026', opening_cgst: 1000, opening_sgst: 1000, opening_igst: 0, portal_cgst: 0, portal_sgst: 0, portal_igst: 0 }],
    bills_not_in_2b: [{ client_id: 'c', period_month: '09/2026', input_cgst: 1000, input_sgst: 1000, input_igst: 0, reversal_month: 'Jul 26', reclaim_month: null }],
  };
  globalThis.__failTables = [];
  const okCheck = await B.runPushRecoCheck('c', '09/2026');
  check('S4: with every read answering, the check runs and does not block', okCheck.error === null && !B.pushRecoBlocks(okCheck, false).blocks,
    JSON.stringify(okCheck));
  globalThis.__failTables = ['twob_filed_figures'];
  const failed = await B.runPushRecoCheck('c', '09/2026');
  const blocks = B.pushRecoBlocks(failed, false);
  check('S4: a filed-figures read that fails blocks Push, with the reason', blocks.blocks && blocks.errorBlocks && /filed figures/.test(failed.error || ''),
    JSON.stringify({ failed, blocks }));
  check('S4: ... for a NO-ITC promoter too (its Suspended Reco waiver does not waive a check that could not run)', B.pushRecoBlocks(failed, true).blocks);
  globalThis.__failTables = [];
}
{
  // A filed July: a books row with a stray space in the supplier name, posted
  // before (ledger trimmed); a 2B document Not in Books never posted.
  globalThis.__mem = {
    books_register: [{ id: 'b1', client_id: 'c', period_month: '07/2026', book_treatment: 'NOT_IN_2B', doc_type: 'INVOICE', date: '2026-07-05',
      supplier_name: ' LAKSHMI ENGINEERING', supplier_invoice_number: 'L-5', supplier_gstin: '24LAKSH0000A1Z5', taxable_value: 1000, input_igst: 0, input_cgst: 90, input_sgst: 90 }],
    bills_not_in_2b: [{ id: 'l1', client_id: 'c', period_month: '07/2026', source_book_id: 'b1', date: '2026-07-05',
      supplier_name: 'LAKSHMI ENGINEERING', supplier_invoice_number: 'L-5', supplier_gstin: '24LAKSH0000A1Z5', taxable_value: 1000, input_igst: 0, input_cgst: 90, input_sgst: 90 }],
    twob_import_docs: [{ id: 'd1', client_id: 'c', period_month: '07/2026', itc_action: 'NOT_IN_BOOKS', doc_type: 'INVOICE', is_amendment: false, date: '2026-07-07',
      supplier_name: 'JAY INFRASTRUCTURE', supplier_invoice_number: '16/2026-27', supplier_gstin: '24JAYIN0000A1Z5', taxable_value: 1000, input_igst: 0, input_cgst: 90, input_sgst: 90, cess: 0 }],
    bills_not_in_books: [],
  };
  const plan = await B.planImport2BPost('c', '07/2026');
  check('F15: a books name with a stray space plans no update (Post writes it trimmed)', plan.updateBills2B.length === 0, JSON.stringify(plan.updateBills2B));
  const changes = B.planToPriorChanges(plan, '07/2026');
  check('S6: a prior month\'s Post sends no Not in Books change from a 2B document', plan.insertBillsBooks.length === 1
    && changes.every((c) => c.table !== 'bills_not_in_books'), JSON.stringify(changes));
  const left = B.priorPlanLeftOut(plan);
  check('S6: ... and names what it leaves out', !!left && left.startsWith('Not posted: 1 Not in Books entry from this month\'s 2B documents (1 to add: JAY INFRASTRUCTURE 16/2026-27)'), left);
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   app: ${r.name}`);
  else { failed += 1; console.log(`FAIL app: ${r.name}${r.info ? `\n     ${r.info}` : ''}`); }
}
console.log(`app: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
