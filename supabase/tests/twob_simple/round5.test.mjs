#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's own calls of the fifth verification round (22 Oct 2026), run
// against the test database as PostgREST runs them (anon, with the request
// headers naming the user):
//   I1  a reclaim from a stale tab (recordReclaim with the treatment the page
//       shows) is refused when another user has reclaimed with the document
//       meanwhile: one reclaim per document;
//   I2  Import 2B's treatment Save (saveDocTreatments) writes each document
//       only while it holds the treatment the page loaded; out of Reclaim
//       only through twob_import2b_unreclaim, which refuses a document no
//       longer Reclaim; what is not written is named as changed elsewhere;
//   I3  a books row sends only the columns changed (bookChanges) and only
//       while the row holds every column as loaded (saveBookGuarded, the
//       pairing call saveBookWithPairing and a filed month's applyPriorSave
//       with their expectations): a stale tab never writes its old copy back;
//   I4  Pending items' Expense out and its Undo are written while the entry
//       is in the list as the list reads it, and let a reclaiming document it
//       still names go (data from before this round: round 4 refused them on
//       every try);
//   I5  the next version number is read from the database at Save time.
// The modules are bundled as they are (esbuild) with a stand-in supabase
// client that sends each query to the test database through psql, as anon.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
// GSTK_ROOT=/path/to/other/checkout runs another checkout's modules (the
// checks fail on the code of before this round; a module it lacks is read as
// empty).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

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

const entry = [
  "export * from './src/lib/twobPendingWrites';",
  "export { saveBookWithPairing } from './src/lib/import2bAutopost';",
  "export { applyPriorSave } from './src/lib/twobPriorMonth';",
  "export * from './src/lib/postImport2B';",
  "export * from './src/lib/import2bGuardedSaves';",
].join('\n');
const out = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
      b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
      // A module the checkout lacks (the code of before this round) reads as empty.
      b.onResolve({ filter: /import2bGuardedSaves$/ }, (a) => (fs.existsSync(path.join(root, 'src/lib/import2bGuardedSaves.ts'))
        ? undefined : { path: a.path, namespace: 'empty' }));
      b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export {};', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
    },
  }],
  define: { 'import.meta.env': '{}' },
});
const A = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const run = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: runs`, false, e?.stack ?? e); } };

const C = 'a5100000-0000-0000-0000-0000000000c1';
const P = 'a5100000-0000-0000-0000-0000000000c2';
const id = (n) => `a5100000-0000-0000-0001-${String(n).padStart(12, '0')}`;
const SCOPE = { clientId: C, period: '10/2026' };
const MANAGER = '00000000-0000-0000-0000-0000000000a2';
// SCREEN-like client, Oct-26 open. Not in 2B: B9-1, B9-2, B10-1 and B10-2
// pending (the month's own); 2B documents D-91, D-92, D-101, D-102 Matched,
// the same invoices. Books: BK-1 Not in 2B (its reversal on the ledger).
// P: Jul-26 filed, its books row PR-1 Not Eligible.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'R5 SCREEN', '24RFIVS0000A1Z5'), ('${P}', 'R5 FILED', '24RFIVP0000A1Z5');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '10/2026', '2026-09-02', 'SEP SUPPLIER ONE', 'B9-1', '24SEPON0000A1Z5', 11111.11, 0, 1000, 1000, 'Oct 26', false),
  ('${id(2)}', '${C}', '10/2026', '2026-09-02', 'SEP SUPPLIER ONE', 'B8-1', '24SEPON0000A1Z5', 11111.11, 0, 1000, 1000, 'Oct 26', false),
  ('${id(3)}', '${C}', '10/2026', '2026-10-02', 'OCT SUPPLIER ONE', 'B10-1', '24OCTON0000A1Z5', 10000, 0, 900, 900, 'Oct 26', false),
  ('${id(4)}', '${C}', '10/2026', '2026-10-04', 'OCT SUPPLIER TWO', 'B10-2', '24OCTTW0000A1Z5', 10000, 0, 900, 900, 'Oct 26', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '10/2026', '2026-09-02', 'SEP SUPPLIER ONE', 'D10-9', '24SEPON0000A1Z5', 11111.11, 0, 1000, 1000, 'INVOICE', 'MATCHED'),
  ('${id(12)}', '${C}', '10/2026', '2026-09-03', 'SEP SUPPLIER TWO', 'D10-8', '24SEPTW0000A1Z5', 2000, 0, 180, 180, 'INVOICE', 'MATCHED'),
  ('${id(13)}', '${C}', '10/2026', '2026-10-02', 'OCT SUPPLIER ONE', 'B10-1', '24OCTON0000A1Z5', 10000, 0, 900, 900, 'INVOICE', 'MATCHED'),
  ('${id(14)}', '${C}', '10/2026', '2026-10-04', 'OCT SUPPLIER TWO', 'B10-2', '24OCTTW0000A1Z5', 10000, 0, 900, 900, 'INVOICE', 'MATCHED');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('${id(31)}', '${P}', '07/2026', '2026-07-05', 'PRIOR ONE', 'PR-1', '24PRION0000A1Z5', 1000, 0, 100, 100, 'NOT_ELIGIBLE', 'INVOICE');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked)
VALUES ('${P}', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true);
SELECT set_config('twob.write', '', false);`);
// BK-1 added and typed on Import 2B (its reversal written through).
psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${POSTER}","x-gst-source":"app"}', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type, updated_by)
VALUES ('${id(21)}', '${C}', '10/2026', '2026-10-09', 'BOOKS ONE', 'BK-1', '24BOOKS0000A1Z5', 1000, 0, 1000, 1000, 'NOT_IN_2B', 'INVOICE', '${POSTER}');`);
const row = (table, n) => JSON.parse(psql(`SELECT row_to_json(t) FROM public.${table} t WHERE id = '${id(n)}'`));
const decision = (n) => psql(`SELECT concat_ws('|', COALESCE(reclaim_month, '-'), COALESCE(reclaim_subtype, '-'), COALESCE(reclaimed_via_doc_id::text, '-')) FROM public.bills_not_in_2b WHERE id = '${id(n)}'`);
const docAction = (n) => psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${id(n)}'`);
const reclaim = (actor, pending, doc, shown) => as(actor, () => A.recordReclaim({ actorId: actor, clientId: C, period: '10/2026', pendingId: id(pending), docId: id(doc), expectAction: shown }));

// ── I1: two tabs, one document (finding: B8-1 and B9-1 both reclaimed with D10-9). ──
await run('I1', async () => {
  const b = await reclaim(SUPER, 1, 11, 'MATCHED');
  check('I1: tab B (superadmin) reclaims B9-1 with D10-9', b.ok && decision(1) === `Oct 26|-|${id(11)}`, JSON.stringify(b));
  const a = await reclaim(POSTER, 2, 11, 'MATCHED');
  check('I1: tab A, still showing D10-9 Matched, reclaims B8-1 with it: refused, saying D10-9 changed elsewhere',
    !a.ok && a.gone && /changed elsewhere since the page showed it: it is Reclaim now, not Matched/.test(a.message), JSON.stringify(a));
  check('I1: ... one entry reclaimed with D10-9 (its 1,000/1,000 once in 5.4, not 2,000/2,000), B8-1 still awaiting',
    psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE reclaimed_via_doc_id = '${id(11)}'`) === '1' && decision(2) === '-|-|-', decision(2));
});

// ── I2: the treatment Save (finding: a stale Save made the reclaimed D10-9 Mismatched). ──
await run('I2', async () => {
  // Tab A loaded D10-9 and D10-8 Matched; D10-9 has since been reclaimed with (I1).
  const stale = await as(POSTER, () => A.saveDocTreatments({ actorId: POSTER, clientId: C, period: '10/2026', changes: [
    { id: id(11), from: 'MATCHED', to: 'MISMATCHED' }, { id: id(12), from: 'MATCHED', to: 'INELIGIBLE' }] }));
  check('I2: tab A\'s Save writes D10-8 (as loaded) and not D10-9 (changed elsewhere), naming it',
    stale.error === null && stale.saved.join() === id(12) && stale.changed.join() === id(11), JSON.stringify(stale));
  check('I2: ... D10-9 stays Reclaim with its reclaim (5.1 does not count it again); D10-8 Ineligible',
    docAction(11) === 'RECLAIM' && decision(1) === `Oct 26|-|${id(11)}` && docAction(12) === 'INELIGIBLE', `${docAction(11)} ${decision(1)}`);
  const fresh = await as(POSTER, () => A.saveDocTreatments({ actorId: POSTER, clientId: C, period: '10/2026', changes: [
    { id: id(11), from: 'RECLAIM', to: 'MATCHED' }] }));
  check('I2: reloaded, out of Reclaim saves through the one call, the entry back in Awaiting reclaim',
    fresh.error === null && fresh.saved.join() === id(11) && docAction(11) === 'MATCHED' && decision(1) === '-|-|-', JSON.stringify(fresh));
  // Someone makes D10-9 Ineligible; a tab still showing it Reclaim takes it out of Reclaim.
  psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${SUPER}","x-gst-source":"app"}', false);
        UPDATE public.twob_import_docs SET itc_action = 'INELIGIBLE' WHERE id = '${id(11)}';`);
  const staleOut = await as(POSTER, () => A.saveDocTreatments({ actorId: POSTER, clientId: C, period: '10/2026', changes: [
    { id: id(11), from: 'RECLAIM', to: 'MATCHED' }] }));
  check('I2: a stale out of Reclaim for a document no longer Reclaim writes nothing and names it; the Ineligible stays',
    staleOut.error === null && staleOut.saved.length === 0 && staleOut.changed.join() === id(11) && docAction(11) === 'INELIGIBLE', JSON.stringify(staleOut));
});

// ── I3: books rows (findings: a stale tab's cell save undid another user's treatment; a filed month's correction). ──
await run('I3', async () => {
  const loaded = row('books_register', 21);
  const next = { ...A.bookExpect(loaded), supplier_name: 'BOOKS ONE LTD' };
  check('I3: a cell save sends only the column changed', JSON.stringify(A.bookChanges(loaded, next)) === '{"supplier_name":"BOOKS ONE LTD"}',
    JSON.stringify(A.bookChanges?.(loaded, next)));
  const other = await as(SUPER, () => A.saveBookGuarded({ actorId: SUPER, bookId: id(21), loaded, values: { book_treatment: 'NOT_ELIGIBLE' } }));
  check('I3: tab A makes BK-1 Not Eligible (its reversal leaves the ledger)', other.ok
    && psql(`SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '${id(21)}'`) === '0', JSON.stringify(other));
  const stale = await as(POSTER, () => A.saveBookGuarded({ actorId: POSTER, bookId: id(21), loaded, values: { supplier_name: 'BOOKS ONE LTD' } }));
  check('I3: tab B, still showing BK-1 Not in 2B, corrects its supplier name: nothing saved, said as changed elsewhere',
    !stale.ok && A.isBookChangedError(stale.message), JSON.stringify(stale));
  check('I3: ... BK-1 stays Not Eligible, its reversal off the ledger and out of 4B(2)(i)',
    psql(`SELECT book_treatment || '|' || supplier_name || '|' || (SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '${id(21)}') FROM public.books_register WHERE id = '${id(21)}'`)
      === 'NOT_ELIGIBLE|BOOKS ONE|0');
  let err = null;
  try {
    await as(POSTER, () => A.saveBookWithPairing({ actorId: POSTER, bookId: id(21), values: { book_treatment: 'MISMATCHED', matched_2b_id: id(13) },
      pairDocId: id(13), expect: A.bookExpect(loaded) }));
  } catch (e) { err = e.message; }
  check('I3: the pairing call from the stale copy is refused the same way, nothing saved (D10-1 stays Matched, unpaired)',
    !!err && A.isBookChangedError(err) && docAction(13) === 'MATCHED' && psql(`SELECT COALESCE(matched_book_id::text, '-') FROM public.twob_import_docs WHERE id = '${id(13)}'`) === '-', err);
  const reloaded = row('books_register', 21);
  const ok = await as(POSTER, () => A.saveBookGuarded({ actorId: POSTER, bookId: id(21), loaded: reloaded, values: { supplier_name: 'BOOKS ONE LTD' } }));
  check('I3: reloaded, the correction saves, and the row as saved comes back (the page shows it)',
    ok.ok && ok.row?.supplier_name === 'BOOKS ONE LTD' && ok.row?.book_treatment === 'NOT_ELIGIBLE', JSON.stringify(ok));
  // A filed month: the GST Manager corrects PR-1's tax; the superadmin's tab
  // still shows 100 and corrects the GSTIN through the door.
  const ploaded = row('books_register', 31);
  await as(MANAGER, () => A.applyPriorSave(MANAGER, P, '07/2026', [{ table: 'books_register', op: 'update', id: id(31), values: { input_cgst: 90, input_sgst: 90 } }], false));
  let perr = null;
  try {
    await as(SUPER, () => A.applyPriorSave(SUPER, P, '07/2026', [{ table: 'books_register', op: 'update', id: id(31), values: { supplier_gstin: '24PRION0000A1Z9' } }],
      true, false, null, { [id(31)]: A.bookExpect(ploaded) }));
  } catch (e) { perr = e.message; }
  check('I3: the stale tab\'s filed-month save is refused at its preview, said as changed elsewhere',
    !!perr && A.isBookChangedError(perr), perr);
  check('I3: ... the GST Manager\'s 90/90 in filed Jul-26 stands', psql(`SELECT input_cgst::numeric(12,2) || '|' || supplier_gstin FROM public.books_register WHERE id = '${id(31)}'`) === '90.00|24PRION0000A1Z5');
});

// ── I4: Pending items over an entry still naming a document (data of before). ──
await run('I4', async () => {
  // As written before this round: 2B Reconciliation cleared B10-1's reclaim
  // and expensed B10-2's out, leaving the reclaiming documents named.
  psql(`DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_twob_zz_reclaim_via') THEN
            ALTER TABLE public.bills_not_in_2b DISABLE TRIGGER trg_twob_zz_reclaim_via;
          END IF;
        END $$;
        SELECT set_config('twob.write', 'system', false);
        UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = '${id(13)}' WHERE id = '${id(3)}';
        UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaim_subtype = 'EXPENSE_OUT', reclaimed_via_doc_id = '${id(14)}' WHERE id = '${id(4)}';
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_twob_zz_reclaim_via') THEN
            ALTER TABLE public.bills_not_in_2b ENABLE TRIGGER trg_twob_zz_reclaim_via;
          END IF;
        END $$;`);
  // The page's own patches (before this round: the reclaim and Expense out columns only).
  const expPatch = A.expenseOutPatch ? A.expenseOutPatch('Oct 26') : { reclaim_month: 'Oct 26', reclaim_subtype: 'EXPENSE_OUT' };
  const undoPatch = A.UNDO_EXPENSE_OUT_PATCH ?? { reclaim_month: null, reclaim_subtype: null };
  const exp = await as(POSTER, () => A.updatePendingEntry('bills_not_in_2b', id(3), expPatch, POSTER, SCOPE, A.EXPECT_AWAITING_RECLAIM));
  check('I4: Expense out of B10-1, listed under Awaiting reclaim, is written (round 4 refused it on every try as changed elsewhere)',
    exp.ok && decision(3) === 'Oct 26|EXPENSE_OUT|-', JSON.stringify(exp) + ' ' + decision(3));
  const undo = await as(POSTER, () => A.updatePendingEntry('bills_not_in_2b', id(4), undoPatch, POSTER, SCOPE, A.expectExpensedOut('Oct 26')));
  check('I4: Undo of B10-2\'s Expense out, listed under Expensed out, is written, and the document goes with it',
    undo.ok && decision(4) === '-|-|-', JSON.stringify(undo) + ' ' + decision(4));
  const again = await as(SUPER, () => A.updatePendingEntry('bills_not_in_2b', id(4), undoPatch, SUPER, SCOPE, A.expectExpensedOut('Oct 26')));
  check('I4: a second Undo from a stale Expensed out list is still refused as changed elsewhere',
    !again.ok && again.gone && again.message === A.ENTRY_CHANGED_MSG, JSON.stringify(again));
});

// ── I5: the next version number, from the database. ────────────────────────
await run('I5', async () => {
  // Import 2B's saves above took versions (their write-through's snapshot);
  // a 2B Reconciliation page loaded before them holds none.
  psql(`SELECT public.twob_import2b_flush_version('${POSTER}', '${C}', '10/2026')`);
  const top = Number(psql(`SELECT COALESCE(max(version_number), 0) FROM public.twob_versions WHERE client_id = '${C}' AND period_month = '10/2026'`));
  const nextN = await A.nextVersionNumber(C, '10/2026');
  check('I5: the next version number is read from the database (one past the snapshots taken meanwhile), not from the page\'s list',
    top >= 1 && nextN === top + 1, `top ${top}, next ${nextN}`);
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round5: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round5: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
