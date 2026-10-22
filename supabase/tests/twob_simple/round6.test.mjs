#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's own calls of the sixth verification round (22 Oct 2026), run
// against the test database as PostgREST runs them (anon, with the request
// headers naming the user):
//   M   two saves of one books row from one page, the second begun before
//       the first landed (Tab past the SGST that CGST fills; typing in a
//       second cell meanwhile): through the page's queue (queueBookSave,
//       with the page's own landed / shown-again bookkeeping) both edits are
//       saved and nothing is said to be changed elsewhere; a row really
//       changed elsewhere is still refused, once, and the save queued behind
//       it dropped; round 5 refused the second save as "another tab or
//       another user" and lost its typing;
//   H1  Restore (restoreVersion, the page's call) names the entries whose
//       reclaim did not come back (their 2B document no longer Reclaim), and
//       they come back in Awaiting reclaim.
// The modules are bundled as they are (esbuild) with a stand-in supabase
// client that sends each query to the test database through psql, as anon.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
// GSTK_ROOT=/path/to/other/checkout runs another checkout's modules: on the
// code of before this round the page's two saves are sent as it sent them
// (each guarded by the row as loaded when its cell was left), and the checks
// fail.
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
  "export * from './src/lib/import2bGuardedSaves';",
  "export { restoreVersion } from './src/lib/twobPriorMonth';",
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
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
    },
  }],
  define: { 'import.meta.env': '{}' },
});
const A = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const run = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: runs`, false, e?.stack ?? e); } };

const C = 'a6100000-0000-0000-0000-0000000000c1';
const id = (n) => `a6100000-0000-0000-0001-${String(n).padStart(12, '0')}`;
// SCREEN-like client, Oct-26 open. Books: B10-1 Not in 2B, 1,000 / 1,000
// (its reversal on the ledger), B10-2 likewise; 2B: A-1 Matched, and its
// pending entry A-1 for the Restore.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'R6 SCREEN', '24RSIXS0000A1Z5');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '10/2026', '2026-10-01', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '10/2026', '2026-10-01', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
SELECT set_config('twob.write', '', false);`);
psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${POSTER}","x-gst-source":"app"}', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type, updated_by) VALUES
  ('${id(21)}', '${C}', '10/2026', '2026-10-02', 'OCT SUPPLIER ONE', 'B10-1', '24OCTON0000A1Z5', 10000, 0, 1000, 1000, 'NOT_IN_2B', 'INVOICE', '${POSTER}'),
  ('${id(22)}', '${C}', '10/2026', '2026-10-03', 'OCT SUPPLIER TWO', 'B10-2', '24OCTTW0000A1Z5', 10000, 0, 1000, 1000, 'NOT_IN_2B', 'INVOICE', '${POSTER}'),
  ('${id(23)}', '${C}', '10/2026', '2026-10-04', 'OCT SUPPLIER THREE', 'B10-3', '24OCTTH0000A1Z5', 10000, 0, 1000, 1000, 'NOT_IN_2B', 'INVOICE', '${POSTER}');`);
const dbRow = (n) => JSON.parse(psql(`SELECT row_to_json(t) FROM public.books_register t WHERE id = '${id(n)}'`));
const figures = (n) => psql(`SELECT b.input_cgst::numeric(12,2) || '/' || b.input_sgst::numeric(12,2) || ' ledger '
  || COALESCE((SELECT string_agg(t.input_cgst::numeric(12,2) || '/' || t.input_sgst::numeric(12,2), ',') FROM public.bills_not_in_2b t WHERE t.source_book_id = b.id), '-')
  FROM public.books_register b WHERE b.id = '${id(n)}'`);
// The page's save columns of a row as on screen (Import2BTab bookValues).
const valuesOf = (b) => ({
  date: b.date || null, supplier_name: b.supplier_name, supplier_invoice_number: b.supplier_invoice_number, supplier_gstin: b.supplier_gstin,
  taxable_value: b.taxable_value, input_igst: b.input_igst, input_cgst: b.input_cgst, input_sgst: b.input_sgst,
  doc_type: b.doc_type === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'INVOICE',
});

// One page (the poster's tab): its refs as Import2BTab holds them, its toasts.
function makePage() {
  const st = { loaded: { current: new Map() }, saves: { current: new Map() }, shownAgain: { current: new Map() }, clock: { current: 0 },
    queue: { current: A.RowQueue ? new A.RowQueue() : null } };
  const toasts = [];
  const load = (n) => st.loaded.current.set(id(n), dbRow(n));
  // bookRefused: said, the row shown again as it is now (restoreBook).
  const refused = (rowId, message) => {
    toasts.push(message);
    if (A.bookShownAgain) A.bookShownAgain(st, rowId);
    st.loaded.current.set(rowId, JSON.parse(psql(`SELECT row_to_json(t) FROM public.books_register t WHERE id = '${rowId}'`)));
  };
  // saveBookRowNow, open month, no pairing move: the changed columns against
  // the row it starts from, guarded by it; landed (bookSaved) or refused.
  const saveNow = async (loaded, row) => {
    const values = A.bookChanges(loaded, valuesOf(row));
    if (Object.keys(values).length === 0) return true;
    const res = await as(POSTER, () => A.saveBookGuarded({ actorId: POSTER, bookId: row.id, loaded, values }));
    if (!res.ok || !res.row) { refused(row.id, res.message); return false; }
    if (A.bookLanded) A.bookLanded(st, res.row); else st.loaded.current.set(res.row.id, res.row);
    return true;
  };
  // A cell left (the blur): saveBookRow with the row as on screen.
  const blur = (n, screen) => {
    if (A.queueBookSave) {
      return A.queueBookSave(st, {
        id: id(n), next: valuesOf(screen), save: saveNow,
        refuse: async (base) => { refused(id(n), base ? A.bookChangedMsg(base) : 'not loaded'); },
      });
    }
    // The code of before this round: the save sent at once, guarded by the row as loaded then.
    const loaded = st.loaded.current.get(id(n));
    return saveNow(loaded, { ...loaded, ...screen });
  };
  return { st, toasts, load, blur };
}

// ── M: two saves of one books row from one page. ──────────────────────────
await run('M', async () => {
  // (a) CGST 1000 -> 900, which the page copies into SGST; Tab, Tab: two
  // saves of the same figures, the second begun before the first landed.
  const p = makePage();
  p.load(21);
  const screen = { ...dbRow(21), input_cgst: 900, input_sgst: 900 };
  const [s1, s2] = await Promise.all([p.blur(21, screen), p.blur(21, screen)]);
  check('M: (a) CGST copied into SGST, Tab, Tab: both saves go through', s1 === true && s2 === true, `${s1} ${s2} ${p.toasts.join(' | ')}`);
  check('M: (a) ... nothing said to be changed elsewhere (round 5: "another tab or another user")', p.toasts.length === 0, p.toasts.join(' | '));
  check('M: (a) ... the books row and its ledger entry at 900/900', figures(21) === '900.00/900.00 ledger 900.00/900.00', figures(21));
  // (b) CGST 900 (copied), Tab, 950 typed in SGST before the first save
  // landed, Tab: the 950 is saved (round 5 lost it).
  const q = makePage();
  q.load(22);
  const base = dbRow(22);
  const first = q.blur(22, { ...base, input_cgst: 900, input_sgst: 900 });
  const second = q.blur(22, { ...base, input_cgst: 900, input_sgst: 950 });
  const r = [await first, await second];
  check('M: (b) a second cell typed in before the first save landed: both saves go through', r[0] === true && r[1] === true, `${r} ${q.toasts.join(' | ')}`);
  check('M: (b) ... the typed 950 is saved, on the books row and its ledger entry', figures(22) === '900.00/950.00 ledger 900.00/950.00', figures(22));
  check('M: (b) ... nothing said to be changed elsewhere', q.toasts.length === 0, q.toasts.join(' | '));
  // (c) The row really changed elsewhere before the first save: refused
  // once (said), and the save queued behind it dropped; nothing written.
  const w = makePage();
  w.load(23);
  const wbase = dbRow(23);
  psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${SUPER}","x-gst-source":"app"}', false);
    UPDATE public.books_register SET book_treatment = 'NOT_ELIGIBLE' WHERE id = '${id(23)}';`);
  const c1 = w.blur(23, { ...wbase, supplier_name: 'OCT SUPPLIER THREE LTD' });
  const c2 = w.blur(23, { ...wbase, supplier_name: 'OCT SUPPLIER THREE LTD', supplier_invoice_number: 'B10-3A' });
  const cr = [await c1, await c2];
  check('M: (c) a row changed elsewhere meanwhile: the first save refused, the one queued behind it dropped',
    cr[0] === false && cr[1] === false && w.toasts.length === 1 && A.isBookChangedError(w.toasts[0]), `${cr} ${w.toasts.join(' | ')}`);
  check('M: (c) ... nothing of either written: the other user\'s Not Eligible stands',
    psql(`SELECT supplier_name || '|' || supplier_invoice_number || '|' || book_treatment FROM public.books_register WHERE id = '${id(23)}'`) === 'OCT SUPPLIER THREE|B10-3|NOT_ELIGIBLE');
});

// ── H1: Restore names the reclaims that did not come back. ────────────────
await run('H1', async () => {
  psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${POSTER}","x-gst-source":"app"}', false);
    SELECT public.twob_import2b_reclaim('${POSTER}', '${C}', '10/2026', '${id(1)}', '${id(11)}', 'MATCHED');`);
  // The month's own entries as a version holds them (the books rows' reversals with them).
  const version = JSON.parse(psql(`SELECT jsonb_agg(to_jsonb(t) - 'adopted_from') FROM public.bills_not_in_2b t WHERE t.client_id = '${C}'`));
  psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${POSTER}","x-gst-source":"app"}', false);
    SELECT public.twob_import2b_unreclaim('${POSTER}', '${C}', '10/2026', '${id(11)}', 'MATCHED', '${id(1)}');`);
  const res = await as(SUPER, () => A.restoreVersion(SUPER, C, '10/2026', version, []));
  check('H1: Restore of a version taken while A-1 was reclaimed, its document Matched since: named in what did not come back',
    Array.isArray(res.reclaimsBack) && res.reclaimsBack.length === 1 && res.reclaimsBack[0] === 'ALPHA A-1 (its 2B document is Matched now, not Reclaim)',
    JSON.stringify(res));
  check('H1: ... A-1 back in Awaiting reclaim (5.4 does not count the Matched document again)',
    psql(`SELECT COALESCE(reclaim_month, '-') || '|' || COALESCE(reclaimed_via_doc_id::text, '-') FROM public.bills_not_in_2b WHERE id = '${id(1)}'`) === '-|-');
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round6: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round6: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
