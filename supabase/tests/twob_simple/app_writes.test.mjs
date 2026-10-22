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
//       priorPlanLeftOut, amountsDiffer);
// and of the fourth round (21 Oct 2026):
//   F10 every read of the push gate fails closed with the table named, not
//       only the filed figures (the previous month's ITC Summary, filing
//       status, RCM, Not in 2B list, the client; the month's own rows);
//   F4/F8/F12 the words when the next month only counts as filed (a later
//       month is filed), after filing and in Re-run's preview;
//   F7  the warning Filing Status keeps on a filed month's row whose lists
//       were never carried, read from the carry record (fetchCarryGaps,
//       describeCarryGap), after the extension's markFiled too, gone after a
//       Re-run;
//   F2/F6 a prior month's carried Not in Books copy is read-only on 2B
//       Reconciliation, as one from a 2B document (priorNibLockReason);
// and of the fifth round (21 Oct 2026):
//   7   2B Reconciliation's open-month Save from a page loaded before a filed
//       month's correction writes nothing and names the entry; an update
//       sends only the columns changed, while the row holds the loaded
//       figures (findChangedElsewhere, updateOpenMonthRow);
//   2/4/8/9 the words of an empty list, a re-filed reopened month and a
//       month Re-run brought entries into; Re-run with nothing to add clears
//       the warning;
//   3/6 Restore names the own entries it left out; only carried Not in Books
//       copies that follow a 2B document are read-only (fetchNibFollows2B);
//   11  Suspended Reco's reads fail closed with the read named
//       (readSuspendedRecoInputs).
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
  : typeof v === 'object' ? "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"
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
    if (this.op === 'select') return 'SELECT COALESCE(jsonb_agg(x), \\'[]\\') FROM (SELECT ' + this.cols + ' FROM ' + t + where + ') x';
    const body = this.op === 'update'
      ? 'UPDATE ' + t + ' SET ' + Object.entries(this.vals).map(([k, v]) => col(k) + ' = ' + lit(v)).join(', ') + where
      : 'DELETE FROM ' + t + where;
    return 'WITH x AS (' + body + ' RETURNING ' + (this.ret || 'id') + ') SELECT COALESCE(jsonb_agg(x), \\'[]\\') FROM x';
  }
  then(ok, ko) {
    const r = globalThis.__asApp(this.sql());
    const res = r.err ? { data: null, error: { message: r.err } }
      : { data: this.op === 'select' || this.ret ? JSON.parse(r.out) : null, error: null };
    return Promise.resolve(res).then(ok, ko);
  }
}
// rpc(fn, args): the database function called with named arguments, as anon.
const rpc = async (fn, args) => {
  const r = globalThis.__asApp('SELECT to_jsonb(public.' + col(fn) + '(' + Object.entries(args || {}).map(([k, v]) => col(k) + ' => ' + lit(v)).join(', ') + '))');
  return r.err ? { data: null, error: { message: r.err } } : { data: JSON.parse(r.out), error: null };
};
export const supabase = { from: (t) => new Q(t), rpc };
`;

const out = await build({
  stdin: {
    contents: `
export { recordReclaim, updatePendingEntry, deleteOpenMonthRows, ENTRY_GONE_MSG, findChangedElsewhere, updateOpenMonthRow,
  EXPECT_AWAITING_RECLAIM, EXPECT_AWAITING_BOOK_ENTRY, expectBooked,
  CHANGED_ELSEWHERE_MSG, releaseReclaim, decisionIsOwn, labelKey, periodOfLabel, DOC_GONE_MSG } from './src/lib/twobPendingWrites';
export { describeFilingCarry, describeRerun, describePriorPreview, fetchCarryGaps, describeCarryGap, priorNibLockReason,
  PRIOR_NIB_FROM_2B_MSG, PRIOR_NIB_CARRIED_MSG, PRIOR_NIB_UNKNOWN_MSG, fetchNibFollows2B, restoreVersion, rerunCarry } from './src/lib/twobPriorMonth';
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
  const res = await A.recordReclaim({ actorId: '00000000-0000-0000-0000-0000000000a3', clientId: C, period: '09/2026', pendingId: pending, docId: DOC, expectAction: 'MATCHED' });
  check('Q8: the stale page\'s reclaim is not recorded, and says the entry is gone', !res.ok && res.gone && res.message === A.ENTRY_GONE_MSG, JSON.stringify(res));
  check('Q8: the 2B document stays Matched, so its ITC stays in 5.1',
    psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${DOC}'`) === 'MATCHED');
  const exp = await A.updatePendingEntry('bills_not_in_2b', pending, { reclaim_month: 'Sep 26', reclaim_subtype: 'EXPENSE_OUT' }, undefined, { clientId: C, period: '09/2026' },
    A.EXPECT_AWAITING_RECLAIM);
  check('Q8: an Expense out on the gone copy says so too', !exp.ok && exp.gone, JSON.stringify(exp));
  const book = await A.updatePendingEntry('bills_not_in_books', pending, { book_entry_month: 'Sep 26' }, undefined, { clientId: C, period: '09/2026' },
    A.EXPECT_AWAITING_BOOK_ENTRY);
  check('Q8: a book entry on a gone entry says so too', !book.ok && book.gone, JSON.stringify(book));
  // The same reclaim on a copy that is there is recorded, the document with it.
  const C2 = 'a8000000-0000-0000-0000-000000000002';
  const DOC2 = 'a8000000-0000-0000-0000-0000000000d2';
  psql(`SELECT public.t_make_tamnna('${C2}', 'Q8 reclaim');
        SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
        VALUES ('${DOC2}', '${C2}', '09/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 1000, 1000, 'MATCHED');`);
  const pending2 = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C2}' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1'`);
  const ok = await A.recordReclaim({ actorId: '00000000-0000-0000-0000-0000000000a3', clientId: C2, period: '09/2026', pendingId: pending2, docId: DOC2, expectAction: 'MATCHED' });
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

// ── Autopost round 2 (22 Oct 2026): the app's own calls. ──────────────────
{
  // F3/F4: a book entry carried into open Sep from filed Aug: Pending items'
  // Undo (updatePendingEntry) is refused with the words; 2B Reconciliation's
  // delete of the carried row goes through without first undoing a decision
  // that is not Sep's own (deleteOpenMonthRows).
  const C = 'a8000000-0000-0000-0000-0000000000f3';
  psql(`SELECT public.t_make_sorath('${C}', 'R2 filed decision', true)`);
  const row = JSON.parse(psql(`SELECT row_to_json(t) FROM public.bills_not_in_books t WHERE client_id = '${C}' AND period_month = '09/2026' AND supplier_invoice_number = 'N-1'`));
  check('Round 2 F3: the carried copy holds a decision that is not Sep\'s own (the app reads it as the database does)',
    !A.decisionIsOwn('bills_not_in_books', row) && A.periodOfLabel(row.book_entry_month) === '08/2026'
      && A.labelKey('Sep 26') === 2026 * 12 + 8 && A.labelKey('september-2026') === 2026 * 12 + 8 && A.labelKey('26') === null
      && A.decisionIsOwn('bills_not_in_books', { ...row, book_entry_month: 'Sep 26' }), JSON.stringify(row));
  const undo = await A.updatePendingEntry('bills_not_in_books', row.id, { book_entry_month: null }, '00000000-0000-0000-0000-0000000000a3', { clientId: C, period: '09/2026' },
    A.expectBooked(row.book_entry_month));
  check('Round 2 F3: Undo book entry on it is refused, naming the filed month', !undo.ok && !undo.gone
    && undo.message.includes('Aug-26 (filed) booked this entry'), JSON.stringify(undo));
  const del = await A.deleteOpenMonthRows('bills_not_in_books', [row]);
  check('Round 2 F3: 2B Reconciliation\'s delete of the carried row goes through (its filed decision is not undone first)',
    del.error === null && psql(`SELECT count(*) FROM public.bills_not_in_books WHERE id = '${row.id}'`) === '0', del.error);
  check('Round 2 F3: ... Aug still holds its book entry', psql(`SELECT book_entry_month FROM public.bills_not_in_books WHERE client_id = '${C}' AND period_month = '08/2026'`) === 'Aug 26');
}
{
  // F7: a document out of Reclaim through the app's one call.
  const C = 'a8000000-0000-0000-0000-0000000000f7';
  const DOC = 'a8000000-0000-0000-0000-0000000007d1';
  psql(`SELECT public.t_make_tamnna('${C}', 'R2 unreclaim');
        SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
        VALUES ('${DOC}', '${C}', '09/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 1000, 1000, 'MATCHED');`);
  const pending = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1'`);
  const rec = await A.recordReclaim({ actorId: '00000000-0000-0000-0000-0000000000a4', clientId: C, period: '09/2026', pendingId: pending, docId: DOC, expectAction: 'MATCHED' });
  check('Round 2 F7: reclaimed', rec.ok, JSON.stringify(rec));
  const bad = await A.releaseReclaim({ actorId: '00000000-0000-0000-0000-0000000000a4', clientId: C, period: '09/2026', docId: DOC, action: 'BOGUS', expectEntry: pending });
  check('Round 2 F7: a treatment refused: nothing of the call kept (the reclaim stands, the document stays Reclaim)', !bad.ok && !bad.gone
    && psql(`SELECT reclaim_month || ' ' || (SELECT itc_action FROM public.twob_import_docs WHERE id = '${DOC}') FROM public.bills_not_in_2b WHERE id = '${pending}'`) === 'Sep 26 RECLAIM',
    JSON.stringify(bad));
  const ok = await A.releaseReclaim({ actorId: '00000000-0000-0000-0000-0000000000a4', clientId: C, period: '09/2026', docId: DOC, action: 'MATCHED', expectEntry: pending });
  check('Round 2 F7: out of Reclaim: the entry back in Awaiting reclaim and the document Matched, together', ok.ok && ok.was === 'RECLAIM' && ok.released === 1
    && psql(`SELECT COALESCE(reclaim_month, '-') || ' ' || (SELECT itc_action FROM public.twob_import_docs WHERE id = '${DOC}') FROM public.bills_not_in_2b WHERE id = '${pending}'`) === '- MATCHED',
    JSON.stringify(ok));
  const gone = await A.releaseReclaim({ actorId: '00000000-0000-0000-0000-0000000000a4', clientId: C, period: '09/2026', docId: 'a8000000-0000-0000-0000-0000000007ff', action: 'MATCHED', expectEntry: null });
  check('Round 2 F7: a document no longer there: said, nothing written', !gone.ok && gone.gone && gone.message === A.DOC_GONE_MSG, JSON.stringify(gone));
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
    period: '08/2026', nextPeriod: '09/2026', nextFiled: false, nextOwnFiled: false, dryRun: true,
    bills2B: { ...empty, keep: [{ id: 'x', date: '2026-07-05', supplierName: 'GONE', number: 'G-1', tax: 140, message: 'Aug-26 (filed) has reclaimed this entry, so it cannot be removed or its amounts changed' }] },
    billsBooks: empty,
  });
  check('Q13: Re-run keeps a copy holding a carried-in reclaim without calling it Sep-26\'s own decision',
    rerun.lines.length === 1 && !rerun.lines[0].includes('own decision') && rerun.lines[0].includes('a reclaim, Expense out or book entry'), rerun.lines.join(' | '));
  const into = A.describeRerun({
    period: '07/2026', nextPeriod: '08/2026', nextFiled: true, nextOwnFiled: true, dryRun: true,
    bills2B: { ...empty, add: [{ id: 'a', date: '2026-07-10', supplierName: 'JUL OWN', number: 'J-1', tax: 200, message: null }],
      left: [{ id: 'l', date: '2026-07-01', supplierName: 'OLD', number: 'O-1', tax: 20, message: null }] },
    billsBooks: empty,
  });
  check('Q13 (S1): Re-run into a filed month says it only adds, names what it leaves, and to re-run the next month',
    !into.nothingToDo && into.lines[0].includes('Aug-26 is filed: Re-run only adds') && into.lines.some((l) => l.includes('stays (OLD O-1)'))
    && into.lines[into.lines.length - 1] === 'Then re-run Aug-26 to carry them on into Sep-26.', into.lines.join(' | '));
  const preview = A.describePriorPreview({
    ok: true, dryRun: true, refusals: [], laterMonths: [{ period: '08/2026', count: 1 }],
    notes: [{ index: 1, entry: 'V J DESAI 38/2026-27', message: 'Apr-26 holds this entry as its own entry too; that entry and its copies stay as they are', kind: 'stop' }],
    changes: [{ index: 0, table: 'bills_not_in_2b', op: 'insert', entry: 'LATE BILL L-1', action: 'add', id: 'n', later: [{ period: '08/2026', action: 'add', id: 'c' }], booksRow: null, refusal: null, note: null }],
  }, '07/2026');
  check('Q13 (S3, S2): the door\'s preview names the months an added entry reaches, and where a change stops',
    preview.includes('Each added entry is also added to Aug-26.') && preview.includes('Not changed: V J DESAI 38/2026-27: Apr-26 holds this entry as its own entry too')
    && !preview.includes('No later month holds'), preview);
  // Autopost round 1: a filed month's catch-up changes no books row, only
  // the ledger: never "nothing changes" beside a change; applied, past tense;
  // an entry already held is named as linked.
  const catchUp = (dryRun) => ({
    ok: true, dryRun, refusals: [], laterMonths: [{ period: '08/2026', count: 1 }], notes: [],
    changes: [
      { index: 0, table: 'bills_not_in_2b', op: 'insert', entry: 'LATE BOOK LB/1', action: 'add', id: 'n', later: [{ period: '08/2026', action: 'add', id: 'c' }], booksRow: null, refusal: null, note: null, derived: true },
      { index: 1, table: 'bills_not_in_2b', op: 'update', entry: 'TWIN CO TW/1', action: 'link', id: 't', later: [], booksRow: null, refusal: null, note: null, derived: true },
    ],
  });
  const before = A.describePriorPreview(catchUp(true), '07/2026');
  check('Autopost: the filed month\'s catch-up preview names the ledger changes, never "nothing changes"',
    !before.includes('nothing changes') && before.startsWith('Jul-26: the Not in 2B list of the 2B Reconciliation ledger follows the books register: 1 to add, 1 already on the ledger, to be linked to its books row.'), before);
  const after = A.describePriorPreview(catchUp(false), '07/2026');
  check('Autopost: ... applied, in the past tense', after.startsWith('Jul-26: the Not in 2B list of the 2B Reconciliation ledger follows the books register: 1 added, 1 already on the ledger, linked to its books row. Also changed Aug-26 (1).')
    && after.includes('Each added entry was also added to Aug-26.'), after);
}

// ── Round 4: the words when the next month only counts as filed (F4, F8,
// F12), the warning kept on a filed month's row (F7), and the carried Not in
// Books copy read-only (F2, F6). ─────────────────────────────────────────────
{
  const prior = A.describeFilingCarry('GSTR-3B', '07/2026', [
    { list: 'bills_not_in_2b', nextPeriod: '08/2026', outcome: 'next_prior', rows: 0 },
    { list: 'bills_not_in_books', nextPeriod: '08/2026', outcome: 'next_prior', rows: 0 }]);
  check('F4/F12: a next month that only counts as filed is not called filed', prior.tone === 'warning'
    && prior.text.includes('Not in 2B: not carried, because Aug-26 counts as filed: a later month is filed.')
    && !prior.text.includes('is filed already') && prior.text.includes('Re-run carry forward'), prior.text);
  const empty = { add: [], remove: [], keep: [], conflict: [], left: [] };
  const onlyCounts = A.describeRerun({
    period: '07/2026', nextPeriod: '08/2026', nextFiled: true, nextOwnFiled: false, dryRun: true,
    bills2B: { ...empty, add: [{ id: 'a', date: '2026-07-10', supplierName: 'JUL OWN', number: 'J-1', tax: 200, message: null }] }, billsBooks: empty,
  });
  check('F8: Re-run into a month that only counts as filed says so, and to re-run it once it is marked Filed',
    onlyCounts.lines[0].startsWith('Aug-26 counts as filed (a later month is filed): Re-run only adds')
    && onlyCounts.lines[onlyCounts.lines.length - 1] === 'Once Aug-26 is marked Filed itself, re-run it to carry them on into Sep-26.', onlyCounts.lines.join(' | '));
  const again = A.describeFilingCarry('GSTR-3B', '07/2026', [{ list: 'bills_not_in_2b', nextPeriod: '08/2026', outcome: 'done_before', rows: 0, how: 'rerun' }]);
  check('F7: filed again after a Re-run: says Re-run brought the entries before', again.text.includes('not carried again; Re-run carry forward brought its entries into Aug-26 before'), again.text);

  // The extension's markFiled of July, after August was filed: the warning
  // Filing Status keeps on July's row, until a Re-run from July.
  const C = 'a8000000-0000-0000-0000-000000000004';
  psql(`SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'F7 late PDF', '24LATEP0000A1Z5');
        INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
        VALUES ('${C}', '07/2026', '2026-07-05', 'J SUPP', 'J-1', '24JSUPP0000A1Z5', 1000, 90, 90, 'Jul 26');`);
  globalThis.__asApp(`INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES ('${C}', 'GSTR-3B', '07/2026', 'Prepared Pending'), ('${C}', 'GSTR-3B', '08/2026', 'Filed')`);
  const up = globalThis.__asApp(`INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date)
    VALUES ('${C}', 'GSTR-3B', '07/2026', 'Filed', 'AA240726123456X', '2026-08-19')
    ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date`);
  check('F7: the extension\'s markFiled of July goes through', up.err === null, up.err);
  const gaps = await A.fetchCarryGaps('07/2026');
  const mine = gaps.get(C) || [];
  const words = A.describeCarryGap('07/2026', mine);
  check('F7: Filing Status reads that July\'s Not in 2B list was not carried (its empty Not in Books list is not reported, round 5)', mine.length === 1
    && words.startsWith("Jul-26's entries were not carried into the next month when it was marked Filed.")
    && words.includes('Not in 2B: not carried, because Aug-26 is filed already.') && !words.includes('Not in Books') && words.includes('Re-run carry forward'), `${mine.length} ${words}`);
  const rr = globalThis.__asApp(`SELECT public.twob_carry_rerun(public.t_manager(), '${C}', '07/2026', false) IS NOT NULL`);
  check('F7: Re-run from July runs', rr.out === 't', rr.err);
  check('F7: ... and the warning is gone', !(await A.fetchCarryGaps('07/2026')).has(C));

  // Round 5 (S6): only a copy that follows a 2B document is read-only; one
  // of a typed entry, or whose entry is gone, changes through the door.
  const follows = new Set(['c-2b']);
  check('F2/F6 (round 5): a carried Not in Books copy of a filed month is read-only only when it follows a 2B document, with the reason',
    A.priorNibLockReason(true, { id: 'c-2b', source_doc_id: null, is_carried_forward: true }, follows) === A.PRIOR_NIB_CARRIED_MSG
    && A.priorNibLockReason(true, { id: 'c-typed', source_doc_id: null, is_carried_forward: true }, follows) === null
    && A.priorNibLockReason(true, { id: 'c-typed', source_doc_id: null, is_carried_forward: true }, null) === A.PRIOR_NIB_UNKNOWN_MSG
    && A.priorNibLockReason(true, { source_doc_id: 'd', is_carried_forward: true }, follows) === A.PRIOR_NIB_FROM_2B_MSG
    && A.priorNibLockReason(true, { source_doc_id: null, is_carried_forward: false }, null) === null
    && A.priorNibLockReason(false, { source_doc_id: 'd', is_carried_forward: true }, null) === null);
}

// ── Round 5 (21 Oct 2026). ────────────────────────────────────────────────
// 7 (high): a 2B Reconciliation page of open September, loaded before a GST
// Manager corrects T-1 in filed July to 800, saves a reclaim on T-1's copy:
// the Save writes nothing (the pre-check names the entry), and the update
// itself, conditional on the loaded figures, writes nothing either; a page
// loaded after the correction records the reclaim and sends only that column.
{
  const C = 'a8000000-0000-0000-0000-000000000051';
  psql(`SELECT public.t_make_tamnna('${C}', 'R5 stale save'); UPDATE public.clients SET liberal_2b_reconciliation = true WHERE id = '${C}'`);
  const loadSep = () => JSON.parse(psql(`SELECT row_to_json(t) FROM public.bills_not_in_2b t WHERE client_id = '${C}' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1'`));
  const stale = loadSep();
  const t1 = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1'`);
  const fix = globalThis.__asApp(`SELECT public.twob_prior_books_apply(public.t_manager(), '${C}', '07/2026', '[{"table":"bills_not_in_2b","op":"update","id":"${t1}","values":{"input_cgst":800,"input_sgst":800}}]'::jsonb, false) ->> 'ok'`);
  check('7: the GST Manager corrects T-1 in filed July to 800 (August and September with it)', fix.out === 'true', fix.err);
  const edited = { ...stale, reclaim_month: 'Sep 26' };
  const named = await A.findChangedElsewhere('bills_not_in_2b', [stale]);
  check('7: the stale page\'s Save is stopped before writing, naming the entry', named.length === 1 && named[0] === `TAMNNA SUPPLIER T-1 ${A.CHANGED_ELSEWHERE_MSG}`, JSON.stringify(named));
  const upd = await A.updateOpenMonthRow('bills_not_in_2b', stale, edited, '00000000-0000-0000-0000-0000000000a3');
  check('7: the update itself, from the stale row, writes nothing and says so', !upd.ok && upd.gone && upd.message.startsWith('TAMNNA SUPPLIER T-1 was changed elsewhere'), JSON.stringify(upd));
  check('7: September\'s T-1 keeps the correction (800) and no reclaim',
    psql(`SELECT input_cgst || '/' || input_sgst || '/' || COALESCE(reclaim_month, '-') FROM public.bills_not_in_2b WHERE id = '${stale.id}'`) === '800.00/800.00/-');
  const fresh = loadSep();
  check('7: a page loaded after the correction finds nothing changed elsewhere', (await A.findChangedElsewhere('bills_not_in_2b', [fresh])).length === 0);
  const ok = await A.updateOpenMonthRow('bills_not_in_2b', fresh, { ...fresh, reclaim_month: 'Sep 26' }, '00000000-0000-0000-0000-0000000000a3');
  check('7: ... and its reclaim is recorded, the amounts left as the correction left them', ok.ok
    && psql(`SELECT input_cgst || '/' || input_sgst || '/' || reclaim_month FROM public.bills_not_in_2b WHERE id = '${fresh.id}'`) === '800.00/800.00/Sep 26', JSON.stringify(ok));
  const goneRow = { ...fresh, id: '00000000-0000-0000-0000-00000000dead' };
  check('7: a row removed elsewhere is named too', (await A.findChangedElsewhere('bills_not_in_2b', [goneRow])).length === 1);
}

// 2 / 9 / 4 / 8: the words of the carry record's new outcomes, and the
// Re-run that has nothing to add still clearing the warning (Filing Status
// records it; here through rerunCarry as the page calls it).
{
  const refiled = A.describeFilingCarry('GSTR-3B', '07/2026', [{ list: 'bills_not_in_2b', nextPeriod: '08/2026', outcome: 'refiled', rows: 0, how: 'carried' }]);
  check('4/10: filed again after a reopen: says nothing is carried again and August may lack the entries added since, and names Re-run', refiled.tone === 'warning'
    && refiled.text.includes('Not in 2B: not carried again. Jul-26 was reopened as Filed by mistake after its entries were carried into Aug-26')
    && refiled.text.includes('Aug-26 may lack the entries added since') && refiled.text.includes('Re-run carry forward'), refiled.text);
  const pending = A.describeCarryGap('08/2026', [{ list: 'bills_not_in_2b', nextPeriod: '09/2026', outcome: 'rerun_pending', rows: 0, how: 'carried' }]);
  check('8: a filed month given entries by a Re-run says to re-run it into the next month', pending.startsWith('Aug-26 holds entries Re-run carry forward brought in after it was filed')
    && pending.includes('Not in 2B: Re-run carry forward brought entries of Jul-26 into Aug-26 after it was filed; re-run Aug-26 to carry them on into Sep-26.'), pending);
  const empty = A.describeFilingCarry('GSTR-3B', '07/2026', [
    { list: 'bills_not_in_2b', nextPeriod: '08/2026', outcome: 'carried', rows: 0 }, { list: 'bills_not_in_books', nextPeriod: '08/2026', outcome: 'carried', rows: 0 }]);
  check('2: an empty month is not worded as not carried', empty.tone === 'success' && empty.text.includes('Not in 2B: nothing to carry.') && !empty.text.includes('not carried'), empty.text);

  // The AMBER GUM shape: June filed by markFiled after July; Re-run has nothing to add.
  const C = 'a8000000-0000-0000-0000-000000000052';
  psql(`SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'R5 nothing to add', '24NOTHI0000A1Z5');
        INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
          ('${C}', '06/2026', '2026-06-04', 'AMBER SUP', 'AG-1', '24AMBER0000A1Z5', 1000, 90, 90, 'Jun 26', false),
          ('${C}', '07/2026', '2026-06-04', 'AMBER SUP', 'AG-1', '24AMBER0000A1Z5', 1000, 90, 90, 'Jun 26', true);`);
  globalThis.__asApp(`INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES ('${C}', 'GSTR-3B', '07/2026', 'Filed'), ('${C}', 'GSTR-3B', '06/2026', 'Prepared Pending')`);
  globalThis.__asApp(`INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES ('${C}', 'GSTR-3B', '06/2026', 'Filed', 'AA2406260000009')
    ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn`);
  check('9: June shows the warning (Not in 2B only)', ((await A.fetchCarryGaps('06/2026')).get(C) || []).length === 1);
  const prev = await A.rerunCarry('00000000-0000-0000-0000-0000000000a2', C, '06/2026', true);
  check('9: Re-run\'s preview has nothing to do', A.describeRerun(prev).nothingToDo, JSON.stringify(prev));
  await A.rerunCarry('00000000-0000-0000-0000-0000000000a2', C, '06/2026', false);
  check('9: applied with nothing to do (as Filing Status now does when the row is warned), the warning goes', !(await A.fetchCarryGaps('06/2026')).has(C));
}

// 3 and 6: the restore names what it left out; the screen reads which
// carried Not in Books copies follow a 2B document.
{
  const C = 'a8000000-0000-0000-0000-000000000053';
  psql(`SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES ('${C}', 'R5 restore words', '24RESTW0000A1Z5', true);
        INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
        VALUES ('${C}', '09/2026', '2026-07-20', 'SUP', 'X-9', '24SUPPL0000A1Z5', 500, 50, 50, 'Jul 26', true);`);
  const res = await A.restoreVersion('00000000-0000-0000-0000-0000000000a1', C, '09/2026',
    [{ date: '2026-07-20', supplier_name: 'SUP', supplier_invoice_number: 'X-9', supplier_gstin: '24SUPPL0000A1Z5', taxable_value: 500, input_igst: 0, input_cgst: 50, input_sgst: 50, reversal_month: 'Sep 26', is_carried_forward: false }], []);
  check('3: the restore says which own entry it left out (the month holds it as a carried entry)', res.own2B === 0 && res.leftOut.join() === 'SUP X-9', JSON.stringify(res));

  const F = 'a8000000-0000-0000-0000-000000000054';
  const DOC = 'a8000000-0000-0000-0000-0000000000f1';
  psql(`SELECT set_config('twob.write', 'system', false);
        INSERT INTO public.clients (id, name, gstin) VALUES ('${F}', 'R5 follows 2B', '24FOLLO0000A1Z5');
        INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, itc_action)
        VALUES ('${DOC}', '${F}', '07/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'NOT_IN_BOOKS');
        INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward, source_doc_id) VALUES
          ('${F}', '07/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'Jul 26', false, '${DOC}'),
          ('${F}', '08/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'Jul 26', true, NULL),
          ('${F}', '08/2026', '2026-03-02', 'ORPHAN SUP', 'O-1', '24ORPHA0000A1Z5', 300, 27, 27, 'Mar 26', true, NULL);`);
  const set = await A.fetchNibFollows2B(F, '08/2026');
  const d7 = psql(`SELECT id FROM public.bills_not_in_books WHERE client_id = '${F}' AND period_month = '08/2026' AND supplier_invoice_number = 'D-7'`);
  const o1 = psql(`SELECT id FROM public.bills_not_in_books WHERE client_id = '${F}' AND period_month = '08/2026' AND supplier_invoice_number = 'O-1'`);
  check('6: the screen reads that August\'s D-7 copy follows a 2B document and the orphan O-1 does not',
    set.has(d7) && !set.has(o1) && A.priorNibLockReason(true, { id: o1, source_doc_id: null, is_carried_forward: true }, set) === null
    && A.priorNibLockReason(true, { id: d7, source_doc_id: null, is_carried_forward: true }, set) === A.PRIOR_NIB_CARRIED_MSG, JSON.stringify([...set]));
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
export { outOfStepLine, describeCatchUp, stepFromPlan, priorStepLeftOut } from './src/lib/import2bAutopost';
export { readSuspendedRecoInputs } from './src/lib/suspendedRecoCalc';
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
  // F10: Sep-26 Receivable Reco (opening 1,000 a head), filed Aug-26 with 4C
  // 5,000 a head and books closing 6,000: every read answering, total 0. Any
  // one read failing blocks Push with that read named, never an invented
  // difference (before: receivable -10,000 and error null).
  const itc = (c51) => ({ section4A: [{ srNo: '(1)', cgst: 0, sgst: 0, igst: 0 }, { srNo: '(2)', cgst: 0, sgst: 0, igst: 0 }, { srNo: '(3)', cgst: 0, sgst: 0, igst: 0 },
    { srNo: '(4)', cgst: 0, sgst: 0, igst: 0 }, { srNo: '5.1', cgst: c51, sgst: c51, igst: 0 }, { srNo: '5.2', cgst: 0, sgst: 0, igst: 0 }, { srNo: '5.3', cgst: 0, sgst: 0, igst: 0 },
    { srNo: '5.4', cgst: 0, sgst: 0, igst: 0 }, { srNo: '5.5', cgst: 0, sgst: 0, igst: 0 }], section4B: [], section4D: [] });
  globalThis.__mem = {
    clients: [{ id: 'c', builder_itc_type: null }],
    gst_receivable_reco: [{ client_id: 'c', period_month: '09/2026', opening_cgst: 1000, opening_sgst: 1000, opening_igst: 0, books_closing_cgst: 6000, books_closing_sgst: 6000,
      books_closing_igst: 0, utilized_cgst: 0, utilized_sgst: 0, utilized_igst: 0, drc_cgst: 0, drc_sgst: 0, drc_igst: 0 }],
    itc_summaries: [{ client_id: 'c', period_month: '08/2026', data: itc(5000) }],
    filing_status: [{ client_id: 'c', period_month: '08/2026', return_type: 'GSTR-3B', status: 'Filed' }],
    suspended_reco: [], bills_not_in_2b: [], rcm_data: [], gstr1_data: [], twob_filed_figures: [],
  };
  globalThis.__failTables = [];
  const ok = await B.runPushRecoCheck('c', '09/2026');
  check('F10: with every read answering, the receivable check is 0 and does not block', ok.error === null && ok.receivable?.total === 0 && !B.pushRecoBlocks(ok, false).blocks,
    JSON.stringify(ok));
  for (const [table, words] of [['itc_summaries', 'ITC Summary (itc_summaries) of 08/2026'], ['filing_status', 'filing status (filing_status) of 08/2026'],
    ['rcm_data', 'RCM figures (rcm_data) of 08/2026'], ['bills_not_in_2b', 'Not in 2B list (bills_not_in_2b)'], ['clients', 'the client'],
    ['gst_receivable_reco', 'GST Receivable Reco of 09/2026'], ['suspended_reco', 'Suspended Reco (suspended_reco) of 09/2026']]) {
    globalThis.__failTables = [table];
    const r = await B.runPushRecoCheck('c', '09/2026');
    const b = B.pushRecoBlocks(r, false);
    check(`F10: a failing ${table} read blocks Push with the read named`, b.blocks && b.errorBlocks && (r.error || '').includes(`Could not read ${words.startsWith('the ') ? '' : 'the '}${words}`),
      JSON.stringify({ r, b }));
  }
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
  check('S6: ... and names what it leaves out (in the filed month\'s catch-up confirm, never "not on the ledger")',
    !!left && left.startsWith('This filed month\'s Not in Books list differs from its 2B documents for 1 entry (1 not on it: JAY INFRASTRUCTURE 16/2026-27)')
    && !left.includes('Not on the ledger'), left);
  // Autopost round 1: the filed month's standing line leaves its Not in
  // Books side out (nothing on the page can change it, so the line would
  // never go); an open month's line names both sides.
  const nibOnly = { ...plan, insertBills2B: [], updateBills2B: [], retractBills2B: [] };
  check('Autopost: a filed month out of step on its Not in Books side only shows no line', B.outOfStepLine(B.stepFromPlan(nibOnly, true), true) === null,
    JSON.stringify(B.outOfStepLine(B.stepFromPlan(nibOnly, true), true)));
  check('Autopost: ... an open month shows it', (B.outOfStepLine(B.stepFromPlan(nibOnly), false)?.text || '').includes('Not in Books 1 to add'));
  // Round 2: the filed month's catch-up confirm names its Not in Books side
  // from the database's step as Post's plan named it.
  check('Autopost round 2: the step names the filed month\'s Not in Books side as the plan did',
    B.priorStepLeftOut(B.stepFromPlan(plan, true)) === left, B.priorStepLeftOut(B.stepFromPlan(plan, true)));
  const n2b = { ...nibOnly, insertBills2B: [{ row: plan.insertBillsBooks[0].row }] };
  const line = B.outOfStepLine(B.stepFromPlan(n2b, true), true);
  check('Autopost: a filed month out of step on its Not in 2B side: the line names that side only, with the action',
    !!line && line.actionable && line.text.includes('Not in 2B list') && line.text.endsWith('1 to add.') && !line.text.includes('Not in Books'), JSON.stringify(line));
  const done = B.describeCatchUp({ dryRun: false, written: 2, bills2B: { add: 1, link: 0, change: 0, remove: 0 }, billsBooks: { add: 0, link: 1, change: 0, remove: 0 },
    skipped: [], refusals: [], undoHint: null, version: 3 }, true);
  check('Autopost: after a catch-up the toast says what was done, past tense, a link named as one (round 3: not "added")',
    done === 'Not in 2B: 1 added. Not in Books: 1 linked (the one linked: an entry already on the ledger as one of its own, linked to its 2B document instead of being added again).', done);
  const preview = B.describeCatchUp({ dryRun: true, written: 1, bills2B: { add: 1, link: 0, change: 0, remove: 0 }, billsBooks: { add: 0, link: 0, change: 0, remove: 0 },
    skipped: [], refusals: [], undoHint: null, version: null });
  check('Autopost: ... the preview says what it will do', preview === 'Not in 2B: 1 to add.', preview);
}

{
  // 11 (low): Suspended Reco's reads fail closed with the read named (the page
  // then refuses Save, Upload, Not Applicable and Override), never zeros.
  globalThis.__mem = {
    suspended_reco: [{ client_id: 'c', period_month: '09/2026', opening_cgst: 1000, opening_sgst: 1000, opening_igst: 0, opening_source: 'csv' }],
    bills_not_in_2b: [], itc_summaries: [],
  };
  globalThis.__failTables = [];
  const ok = await B.readSuspendedRecoInputs('c', '09/2026');
  check('11: with every read answering, the opening uploaded from the CSV is read', ok.suspended?.opening_source === 'csv' && Number(ok.suspended?.opening_cgst) === 1000, JSON.stringify(ok));
  for (const [table, words] of [['suspended_reco', 'the Suspended Reco (suspended_reco) of 09/2026'], ['bills_not_in_2b', 'the Not in 2B list (bills_not_in_2b) of 09/2026'],
    ['itc_summaries', 'the ITC Summary (itc_summaries) of 09/2026']]) {
    globalThis.__failTables = [table];
    let err = null;
    try { await B.readSuspendedRecoInputs('c', '09/2026'); } catch (e) { err = e.message; }
    check(`11: a failing ${table} read stops the load with the read named`, (err || '').startsWith(`Could not read ${words}`), err);
  }
  globalThis.__failTables = [];
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   app: ${r.name}`);
  else { failed += 1; console.log(`FAIL app: ${r.name}${r.info ? `\n     ${r.info}` : ''}`); }
}
console.log(`app: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
