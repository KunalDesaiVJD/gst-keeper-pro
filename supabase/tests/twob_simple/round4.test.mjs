#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's own calls of the fourth verification round (22 Oct 2026), run
// against the test database as PostgREST runs them (anon, with the request
// headers naming the user):
//   H1  2B Reconciliation's Save writes nothing over a decision recorded
//       elsewhere meanwhile: the check before it compares every column a row
//       holds, its reclaim, Expense out, book entry, reclaiming document and
//       link with the figures (checkRowsUnchanged / findChangedElsewhere);
//       each update and delete is made only while the row holds all of it
//       (updateOpenMonthRow, deleteOpenMonthRows); the Save decides its
//       delete confirm and the decisions it undoes from the rows read back;
//       a Save stopped before its first write says it wrote nothing
//       (writeOpenMonthSave: OpenMonthSaveError.wrote), so the page keeps the
//       edits;
//   H2  a Pending items decision (Expense out, its Undo, a book entry, its
//       Undo) is written only while the entry still holds what the list
//       showed (updatePendingEntry with the decision shown): a reclaim
//       recorded in another tab is never written over;
//   M1  an employee without Import 2B & post saves, through the page's own
//       call (saveBookWithPairing), a books row the matcher pairs with a
//       Matched document (nothing on the ledger changes), and is refused a
//       pairing that would take a Not in Books entry off the ledger.
// The modules are bundled as they are (esbuild) with a stand-in supabase
// client that sends each query to the test database through psql, as anon.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
// GSTK_ROOT=/path/to/other/checkout runs another checkout's modules (the
// checks fail on the code of before this round).
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
const SUPER = '00000000-0000-0000-0000-0000000000a1';
const EMPLOYEE = '00000000-0000-0000-0000-0000000000a3';
const POSTER = '00000000-0000-0000-0000-0000000000a4';
globalThis.__actor = SUPER;
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
/** Runs fn as `actor` (the stand-in client names globalThis.__actor). */
const as = async (actor, fn) => { const was = globalThis.__actor; globalThis.__actor = actor; try { return await fn(); } finally { globalThis.__actor = was; } };

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
export * from './src/lib/twobPendingWrites';
export { saveBookWithPairing } from './src/lib/import2bAutopost';
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

const C = 'a4100000-0000-0000-0000-0000000000c1';
const id = (n) => `a4100000-0000-0000-0001-${String(n).padStart(12, '0')}`;
const SCOPE = { clientId: C, period: '10/2026' };
// SCREEN-like client, Oct-26 open (Liberal: 2B Reconciliation edits it).
// Not in 2B: B9-1 and B9-2 carried in from Sep-26 (no decision yet), B10-1,
// B10-4, B10-5, B10-6 the month's own; 2B documents D10-1, D10-5, D10-6 and
// D10-9 Matched, the same invoices as B10-1, B10-5, B10-6 and B9-1 (each can
// evidence its reclaim). Not in Books: N-1 awaiting a book entry.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES ('${C}', 'R4 SCREEN', '24RFOUS0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '10/2026', '2026-09-02', 'SEP SUPPLIER ONE', 'B9-1', '24SEPON0000A1Z5', 11111.11, 0, 1000, 1000, 'Sep 26', true),
  ('${id(2)}', '${C}', '10/2026', '2026-09-03', 'SEP SUPPLIER TWO', 'B9-2', '24SEPTW0000A1Z5', 2000, 0, 180, 180, 'Sep 26', true),
  ('${id(3)}', '${C}', '10/2026', '2026-10-02', 'OCT SUPPLIER ONE', 'B10-1', '24OCTON0000A1Z5', 10000, 0, 900, 900, 'Oct 26', false),
  ('${id(4)}', '${C}', '10/2026', '2026-10-04', 'OCT SUPPLIER FOUR', 'B10-4', '24OCTFO0000A1Z5', 10000, 0, 900, 900, 'Oct 26', false),
  ('${id(5)}', '${C}', '10/2026', '2026-10-05', 'OCT SUPPLIER FIVE', 'B10-5', '24OCTFI0000A1Z5', 5000, 0, 450, 450, 'Oct 26', false),
  ('${id(6)}', '${C}', '10/2026', '2026-10-06', 'OCT SUPPLIER SIX', 'B10-6', '24OCTSI0000A1Z5', 6000, 0, 540, 540, 'Oct 26', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '10/2026', '2026-10-02', 'OCT SUPPLIER ONE', 'B10-1', '24OCTON0000A1Z5', 10000, 0, 900, 900, 'INVOICE', 'MATCHED'),
  ('${id(15)}', '${C}', '10/2026', '2026-10-05', 'OCT SUPPLIER FIVE', 'B10-5', '24OCTFI0000A1Z5', 5000, 0, 450, 450, 'INVOICE', 'MATCHED'),
  ('${id(16)}', '${C}', '10/2026', '2026-10-06', 'OCT SUPPLIER SIX', 'B10-6', '24OCTSI0000A1Z5', 6000, 0, 540, 540, 'INVOICE', 'MATCHED'),
  ('${id(19)}', '${C}', '10/2026', '2026-09-02', 'SEP SUPPLIER ONE', 'B9-1', '24SEPON0000A1Z5', 11111.11, 0, 1000, 1000, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_books (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward) VALUES
  ('${id(21)}', '${C}', '10/2026', '2026-10-07', 'NIB SUPPLIER', 'N-1', '24NIBSU0000A1Z5', 1000, 180, 0, 0, 'Oct 26', false);`);
const row = (table, n) => JSON.parse(psql(`SELECT row_to_json(t) FROM public.${table} t WHERE id = '${id(n)}'`));
const decision = (n) => psql(`SELECT concat_ws('|', COALESCE(reclaim_month, '-'), COALESCE(reclaim_subtype, '-'), COALESCE(reclaimed_via_doc_id::text, '-')) FROM public.bills_not_in_2b WHERE id = '${id(n)}'`);
const docAction = (n) => psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${id(n)}'`);
const reclaim = (pending, doc) => as(POSTER, () => A.recordReclaim({ actorId: POSTER, clientId: C, period: '10/2026', pendingId: id(pending), docId: id(doc),
  expectAction: psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${id(doc)}'`) }));

// ── H1 (a): Expense out staged on 2B Reconciliation, a reclaim recorded on
// Import 2B meanwhile, then the Save. ──────────────────────────────────────
await run('H1a', async () => {
  const loaded = row('bills_not_in_2b', 1);
  const edited = { ...loaded, reclaim_month: 'Oct 26', reclaim_subtype: 'EXPENSE_OUT' };
  const r = await reclaim(1, 19);
  check('H1a: the poster reclaims B9-1 on Import 2B with D10-9 meanwhile', r.ok && decision(1) === `Oct 26|-|${id(19)}` && docAction(19) === 'RECLAIM', JSON.stringify(r));
  const named = await A.findChangedElsewhere('bills_not_in_2b', [loaded]);
  check('H1a: the Save\'s check names B9-1 as changed elsewhere (its reclaim, not its figures, changed)',
    named.length === 1 && named[0].startsWith('SEP SUPPLIER ONE B9-1 was changed elsewhere'), JSON.stringify(named));
  const upd = await as(SUPER, () => A.updateOpenMonthRow('bills_not_in_2b', loaded, edited, SUPER));
  check('H1a: the update itself, from the copy loaded before the reclaim, writes nothing', !upd.ok && upd.gone, JSON.stringify(upd));
  check('H1a: ... the reclaim stays as recorded and D10-9 Reclaim (5.4 keeps its ITC; nothing lands in 4D(1.2))',
    decision(1) === `Oct 26|-|${id(19)}` && docAction(19) === 'RECLAIM', decision(1));
});

// ── H1 (b): a pending delete on 2B Reconciliation, the entry reclaimed on
// Import 2B meanwhile, then the Save. ──────────────────────────────────────
await run('H1b', async () => {
  const loaded = row('bills_not_in_2b', 3);
  const r = await reclaim(3, 11);
  check('H1b: the poster reclaims B10-1 with D10-1 meanwhile', r.ok && docAction(11) === 'RECLAIM', JSON.stringify(r));
  const del = await as(SUPER, () => A.deleteOpenMonthRows('bills_not_in_2b', [loaded]));
  check('H1b: the pending delete, from the copy loaded before the reclaim, deletes nothing and says the entry changed',
    !!del.error && del.error.startsWith('OCT SUPPLIER ONE B10-1 was changed elsewhere') && del.stale === true && del.wrote === false, JSON.stringify(del));
  check('H1b: ... B10-1 stays with its reclaim, D10-1 Reclaim with an entry to reclaim',
    psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE id = '${id(3)}'`) === '1' && decision(3) === `Oct 26|-|${id(11)}`);
  const fresh = row('bills_not_in_2b', 3);
  const cur = await A.checkRowsUnchanged('bills_not_in_2b', [fresh]);
  check('H1b: read again, the Save decides from the row as it is now (it holds the reclaim: the delete confirm names it)',
    cur.stale.length === 0 && A.holdsDecision(cur.current.get(id(3))) && !A.holdsDecision(loaded), JSON.stringify([...cur.current.values()]));
});

// ── H1 (c): a pending delete of the carried B9-2 and an edit of B10-4; B9-2
// expensed out on Import 2B meanwhile; the Save stops before writing
// anything, so the page keeps the edits. ──────────────────────────────────
await run('H1c', async () => {
  const del = row('bills_not_in_2b', 2);
  const loaded4 = row('bills_not_in_2b', 4);
  const edited4 = { ...loaded4, taxable_value: 12000 };
  const exp = await as(POSTER, () => A.updatePendingEntry('bills_not_in_2b', id(2), { reclaim_month: 'Oct 26', reclaim_subtype: 'EXPENSE_OUT' }, POSTER,
    SCOPE, A.EXPECT_AWAITING_RECLAIM));
  check('H1c: the poster expenses B9-2 out meanwhile', exp.ok && decision(2) === 'Oct 26|EXPENSE_OUT|-', JSON.stringify(exp));
  const checked = await A.checkRowsUnchanged('bills_not_in_2b', [del, loaded4]);
  check('H1c: the Save\'s check names B9-2 (its Expense out is new), not B10-4, and reads B9-2 as it is now',
    checked.stale.length === 1 && checked.stale[0].startsWith('SEP SUPPLIER TWO B9-2') && checked.current.get(id(2))?.reclaim_subtype === 'EXPENSE_OUT',
    JSON.stringify(checked.stale));
  // Had the Expense out landed after that check: the guarded writes stop at
  // the delete, before anything is written.
  let err = null;
  try {
    await as(SUPER, () => A.writeOpenMonthSave({ clientId: C, userId: SUPER,
      deletes: { bills_not_in_2b: [del], bills_not_in_books: [] }, inserts: { bills_not_in_2b: [], bills_not_in_books: [] },
      updates: { bills_not_in_2b: [{ loaded: loaded4, edited: edited4 }], bills_not_in_books: [] } }));
  } catch (e) { err = e; }
  check('H1c: the Save stops at B9-2 saying it changed elsewhere and that nothing was written (the page keeps the edits)',
    err instanceof A.OpenMonthSaveError && err.stale === true && err.wrote === false && err.message.startsWith('SEP SUPPLIER TWO B9-2 was changed elsewhere'),
    err && JSON.stringify({ m: err.message, stale: err.stale, wrote: err.wrote }));
  check('H1c: ... B9-2 keeps its Expense out, B10-4 its taxable value',
    decision(2) === 'Oct 26|EXPENSE_OUT|-' && psql(`SELECT taxable_value FROM public.bills_not_in_2b WHERE id = '${id(4)}'`) === '10000.00');
  // A Save stopped after a write says so (the page then shows the month as it is now).
  const stale6 = row('bills_not_in_2b', 6);
  psql(`UPDATE public.bills_not_in_2b SET supplier_gstin = '24OCTSX0000A1Z5' WHERE id = '${id(6)}'`);
  let err2 = null;
  try {
    await as(SUPER, () => A.writeOpenMonthSave({ clientId: C, userId: SUPER,
      deletes: { bills_not_in_2b: [], bills_not_in_books: [] }, inserts: { bills_not_in_2b: [], bills_not_in_books: [] },
      updates: { bills_not_in_2b: [{ loaded: loaded4, edited: edited4 }, { loaded: stale6, edited: { ...stale6, taxable_value: 7000 } }], bills_not_in_books: [] } }));
  } catch (e) { err2 = e; }
  check('H1c: stopped after B10-4 was written, it says something was written',
    err2 instanceof A.OpenMonthSaveError && err2.stale === true && err2.wrote === true
      && psql(`SELECT taxable_value FROM public.bills_not_in_2b WHERE id = '${id(4)}'`) === '12000.00'
      && psql(`SELECT taxable_value FROM public.bills_not_in_2b WHERE id = '${id(6)}'`) === '6000.00', err2 && err2.message);
  psql(`UPDATE public.bills_not_in_2b SET supplier_gstin = '24OCTSI0000A1Z5' WHERE id = '${id(6)}'`);
});

// ── H2: Pending items in two Import 2B tabs. ────────────────────────────────
await run('H2', async () => {
  // Tab A (superadmin) lists B10-5 under Awaiting reclaim; tab B (poster)
  // reclaims it with D10-5; tab A clicks Expense out.
  const r = await reclaim(5, 15);
  check('H2: tab B reclaims B10-5 with D10-5', r.ok && decision(5) === `Oct 26|-|${id(15)}`, JSON.stringify(r));
  const exp = await as(SUPER, () => A.updatePendingEntry('bills_not_in_2b', id(5), { reclaim_month: 'Oct 26', reclaim_subtype: 'EXPENSE_OUT' }, SUPER,
    SCOPE, A.EXPECT_AWAITING_RECLAIM));
  check('H2: tab A\'s Expense out from its stale Awaiting reclaim list is refused, saying the entry changed elsewhere',
    !exp.ok && exp.gone && exp.message === A.ENTRY_CHANGED_MSG, JSON.stringify(exp));
  check('H2: ... the reclaim stays and D10-5 Reclaim (its ITC in 5.4, not 4D(1.2))', decision(5) === `Oct 26|-|${id(15)}` && docAction(15) === 'RECLAIM', decision(5));
  // B10-6 expensed out, listed so in tab A; tab B undoes it and reclaims it
  // with D10-6; tab A clicks Undo on its stale Expensed out list.
  psql(`UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaim_subtype = 'EXPENSE_OUT' WHERE id = '${id(6)}'`);
  const undoB = await as(POSTER, () => A.updatePendingEntry('bills_not_in_2b', id(6), { reclaim_month: null, reclaim_subtype: null }, POSTER, SCOPE,
    A.expectExpensedOut('Oct 26')));
  const r6 = await reclaim(6, 16);
  check('H2: tab B undoes B10-6\'s Expense out and reclaims it with D10-6', undoB.ok && r6.ok && decision(6) === `Oct 26|-|${id(16)}`, JSON.stringify([undoB, r6]));
  const undoA = await as(SUPER, () => A.updatePendingEntry('bills_not_in_2b', id(6), { reclaim_month: null, reclaim_subtype: null }, SUPER, SCOPE,
    A.expectExpensedOut('Oct 26')));
  check('H2: tab A\'s Undo from its stale Expensed out list is refused; the reclaim is not cleared (nor left half-cleared)',
    !undoA.ok && undoA.gone && undoA.message === A.ENTRY_CHANGED_MSG && decision(6) === `Oct 26|-|${id(16)}`, JSON.stringify(undoA));
  // N-1: tab B books it; tab A, still listing it as awaiting, books it too.
  const bookB = await as(POSTER, () => A.updatePendingEntry('bills_not_in_books', id(21), { book_entry_month: 'Oct 26' }, POSTER, SCOPE, A.EXPECT_AWAITING_BOOK_ENTRY));
  const bookA = await as(SUPER, () => A.updatePendingEntry('bills_not_in_books', id(21), { book_entry_month: 'Oct 26' }, SUPER, SCOPE, A.EXPECT_AWAITING_BOOK_ENTRY));
  check('H2: a book entry is recorded once; a stale Awaiting book entry list\'s second one is refused as changed elsewhere',
    bookB.ok && !bookA.ok && bookA.gone && bookA.message === A.ENTRY_CHANGED_MSG, JSON.stringify([bookB, bookA]));
  const undoBook = await as(SUPER, () => A.updatePendingEntry('bills_not_in_books', id(21), { book_entry_month: null }, SUPER, SCOPE, A.expectBooked('Sep 26')));
  check('H2: an Undo book entry for a label the entry no longer holds is refused; the one it holds undoes',
    !undoBook.ok && undoBook.gone
      && (await as(SUPER, () => A.updatePendingEntry('bills_not_in_books', id(21), { book_entry_month: null }, SUPER, SCOPE, A.expectBooked('Oct 26')))).ok
      && psql(`SELECT COALESCE(book_entry_month, '-') FROM public.bills_not_in_books WHERE id = '${id(21)}'`) === '-', JSON.stringify(undoBook));
  const gone = await as(SUPER, () => A.updatePendingEntry('bills_not_in_2b', id(5), { reclaim_month: 'Sep 26', reclaim_subtype: 'EXPENSE_OUT' }, SUPER,
    { clientId: C, period: '09/2026' }, A.EXPECT_AWAITING_RECLAIM));
  check('H2: an entry not in the month shown still reads as gone (round 3)', !gone.ok && gone.gone && gone.message === A.ENTRY_GONE_MSG, JSON.stringify(gone));
});

// ── M1: the employee's pairing through the page's own call. ─────────────────
await run('M1', async () => {
  const E = 'a4100000-0000-0000-0000-0000000000c2';
  psql(`SELECT set_config('twob.write', 'system', false);
    INSERT INTO public.clients (id, name, gstin) VALUES ('${E}', 'R4 PAIRS', '24RFOUP0000A1Z6');
    INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, doc_type, itc_action) VALUES
      ('${id(31)}', '${E}', '10/2026', '2026-10-05', 'PAIRS SUPPLIER', 'INV-77', '24PAIRS0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED'),
      ('${id(32)}', '${E}', '10/2026', '2026-10-06', 'NIB PAIRS', 'NP-1', '24NIBPA0000A1Z5', 1000, 180, 'INVOICE', 'NOT_IN_BOOKS');
    INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward, source_doc_id) VALUES
      ('${E}', '10/2026', '2026-10-06', 'NIB PAIRS', 'NP-1', '24NIBPA0000A1Z5', 1000, 180, 0, 0, 'Oct 26', false, '${id(32)}');
    INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type) VALUES
      ('${id(41)}', '${E}', '10/2026', NULL, '', NULL, NULL, 0, 0, 0, 0, 'NOT_IN_2B', 'INVOICE'),
      ('${id(42)}', '${E}', '10/2026', '2026-10-06', 'NIB PAIRS', 'NP-1', '24NIBPA0000A1Z5', 1000, 170, 0, 0, 'NOT_IN_2B', 'INVOICE');`);
  let err = null;
  try {
    await as(EMPLOYEE, () => A.saveBookWithPairing({ actorId: EMPLOYEE, bookId: id(41), pairDocId: id(31), releaseDocId: null,
      values: { date: '2026-10-05', supplier_name: 'PAIRS SUPPLIER', supplier_invoice_number: 'INV-77', supplier_gstin: '24PAIRS0000A1Z5', input_igst: 150,
        book_treatment: 'MISMATCHED', matched_2b_id: id(31) } }));
  } catch (e) { err = e.message; }
  check('M1: the employee\'s books row typed as INV-77 at another figure is saved, paired Mismatched (the page\'s own call)',
    err === null && psql(`SELECT b.book_treatment || '|' || d.itc_action || '|' || (d.matched_book_id = b.id) FROM public.books_register b, public.twob_import_docs d
      WHERE b.id = '${id(41)}' AND d.id = '${id(31)}'`) === 'MISMATCHED|MISMATCHED|true', err);
  check('M1: ... nothing reached the ledger', psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '${E}'`) === '0'
    && psql(`SELECT count(*) FROM public.bills_not_in_books WHERE client_id = '${E}'`) === '1');
  let err2 = null;
  try {
    await as(EMPLOYEE, () => A.saveBookWithPairing({ actorId: EMPLOYEE, bookId: id(42), pairDocId: id(32), releaseDocId: null,
      values: { book_treatment: 'MISMATCHED', matched_2b_id: id(32) } }));
  } catch (e) { err2 = e.message; }
  check('M1: pairing the Not in Books document that has an entry is refused for the employee, nothing kept',
    (err2 || '').includes('needs the Import 2B & post permission')
      && psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${id(32)}'`) === 'NOT_IN_BOOKS'
      && psql(`SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = '${id(32)}'`) === '1', err2);
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round4: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round4: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
