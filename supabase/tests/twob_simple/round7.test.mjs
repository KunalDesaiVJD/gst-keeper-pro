#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's own calls of the seventh verification round (22 Oct 2026), run
// against the test database as PostgREST runs them (anon, with the request
// headers naming the user):
//   F2  Import 2B's Save of a document out of Reclaim sends the reclaim the
//       page shows it evidencing (loadReclaimEvidence, read with the ledger
//       side): a stale tab's Save, after another user took the document out
//       of Reclaim and reclaimed another entry with it, writes nothing and
//       names the document as changed elsewhere; the other user's reclaim
//       stands. Round 6 released it without a word;
//   F1/F4 2B Reconciliation's Restore of a version written before this
//       release (no document named for its reclaim): the reclaim comes back
//       only on the document's terms, said (reclaimsBack), and the RESTORE
//       version the page records is the month as the Restore left it
//       (versionData), not the version restored: an entry back in Awaiting
//       reclaim reads so in the history, and a reclaim linked again to its
//       document carries the link. Round 6 recorded the version restored.
// The modules are bundled as they are (esbuild) with a stand-in supabase
// client that sends each query to the test database through psql, as anon.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
// GSTK_ROOT=/path/to/other/checkout runs another checkout's modules: on the
// code of before this round the page's calls are made as that page made them
// (no reclaim sent with a Save out of Reclaim; the version restored recorded
// as the RESTORE version), and the checks fail.
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
const MANAGER = '00000000-0000-0000-0000-0000000000a2';

const C = 'a7100000-0000-0000-0000-0000000000c1';
const R = 'a7100000-0000-0000-0000-0000000000c2';
const id = (n) => `a7100000-0000-0000-0001-${String(n).padStart(12, '0')}`;
// C, Oct-26 open: D-1 Matched; E1 (Sep's carried copy) and E2 (Oct's own
// entry) awaiting a reclaim, both of which D-1 could evidence.
// R, Oct-26 open: A-1 Matched with its pending entry A-1; B-1 Matched with
// its pending entry B-1.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'R7 STALE TAB', '24RSEVT0000A1Z5'), ('${R}', 'R7 RESTORE', '24RSEVR0000A1Z5');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '10/2026', '2026-10-01', 'FOXTROT', 'D-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('${id(31)}', '${R}', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('${id(32)}', '${R}', '10/2026', '2026-09-21', 'BRAVO', 'B-1', '24BRAVO0000A1Z5', 1000, 0, 50, 50, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '10/2026', '2026-10-01', 'FOXTROT', 'D-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'Sep 26', true),
  ('${id(2)}', '${C}', '10/2026', '2026-10-01', 'FOXTROT', 'D-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('${id(21)}', '${R}', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('${id(22)}', '${R}', '10/2026', '2026-09-21', 'BRAVO', 'B-1', '24BRAVO0000A1Z5', 1000, 0, 50, 50, 'Oct 26', false);
SELECT set_config('twob.write', '', false);`);
const reclaim = (actor, client, entry, doc) => psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${actor}","x-gst-source":"app"}', false);
  SELECT public.twob_import2b_reclaim('${actor}', '${client}', '10/2026', '${entry}', '${doc}', 'MATCHED') ->> 'ok';`).split('\n').pop();
const decision = (n) => psql(`SELECT COALESCE(reclaim_month, '-') || '|' || COALESCE(reclaimed_via_doc_id::text, '-') FROM public.bills_not_in_2b WHERE id = '${id(n)}'`);
const docAction = (n) => psql(`SELECT itc_action FROM public.twob_import_docs WHERE id = '${id(n)}'`);
// The page's ledger-side read of the reclaims its documents evidence, and the
// Save's changes as the page builds them (Import2BTab saveActions). On the
// code of before, the page read none and sent none.
const loadEvidence = async (actor) => (A.loadReclaimEvidence ? as(actor, () => A.loadReclaimEvidence(C)) : new Map());
const saveOut = (actor, evidence, to) => as(actor, () => A.saveDocTreatments({ actorId: actor, clientId: C, period: '10/2026', changes: [
  { id: id(11), from: 'RECLAIM', to, expectEntry: evidence.get(id(11))?.id ?? null }] }));

// ── F2: a stale tab's Save out of Reclaim. ────────────────────────────────
await run('F2', async () => {
  check('F2: tab A (the GST Manager) reclaims E1 (Sep\'s copy) with D-1', reclaim(MANAGER, C, id(1), id(11)) === 'true');
  const shownA = await loadEvidence(MANAGER);
  check('F2: ... tab A\'s page shows D-1 the evidence of the reclaim of E1', shownA.get(id(11))?.id === id(1), JSON.stringify([...shownA]));
  if (A.reclaimEvidenceName && shownA.get(id(11))) {
    check('F2: ... named on the row as "FOXTROT D-1 (reversed Sep 26, reclaimed Oct 26)"',
      A.reclaimEvidenceName(shownA.get(id(11))) === 'FOXTROT D-1 (reversed Sep 26, reclaimed Oct 26)', A.reclaimEvidenceName(shownA.get(id(11))));
  }
  const shownB = await loadEvidence(POSTER);
  const outB = await saveOut(POSTER, shownB, 'MATCHED');
  check('F2: tab B (the poster) takes D-1 out of Reclaim (E1 was the wrong entry)', outB.error === null && outB.saved.join() === id(11)
    && decision(1) === '-|-' && docAction(11) === 'MATCHED', JSON.stringify(outB));
  check('F2: ... then reclaims E2 with D-1', reclaim(POSTER, C, id(2), id(11)) === 'true' && decision(2) === `Oct 26|${id(11)}`);
  const stale = await saveOut(MANAGER, shownA, 'INELIGIBLE');
  check('F2: tab A, not reloaded, saves D-1 Ineligible: nothing written, D-1 named as changed elsewhere (round 6: saved, E2\'s reclaim released)',
    stale.error === null && stale.saved.length === 0 && stale.changed.join() === id(11), JSON.stringify(stale));
  check('F2: ... tab B\'s reclaim of E2 stands, D-1 Reclaim', decision(2) === `Oct 26|${id(11)}` && docAction(11) === 'RECLAIM',
    `${decision(2)} ${docAction(11)}`);
  const reloaded = await loadEvidence(MANAGER);
  const fresh = await saveOut(MANAGER, reloaded, 'INELIGIBLE');
  check('F2: reloaded (showing E2), tab A\'s Save goes through, E2 back in Awaiting reclaim with it',
    fresh.error === null && fresh.saved.join() === id(11) && decision(2) === '-|-' && docAction(11) === 'INELIGIBLE', JSON.stringify(fresh));
});

// ── F1/F4: Restore of a version of before, and the RESTORE version recorded. ──
await run('F1/F4', async () => {
  check('F1: A-1 and B-1 reclaimed with their documents', reclaim(POSTER, R, id(21), id(31)) === 'true' && reclaim(POSTER, R, id(22), id(32)) === 'true');
  // The month as a version of before holds it (2B Reconciliation's Save of
  // before, Post's): no document named for a reclaim, no Import 2B link.
  const version = JSON.parse(psql(`SELECT jsonb_agg((to_jsonb(t) - 'adopted_from' - 'source_book_id' - 'reclaimed_via_doc_id') ORDER BY t.id)
    FROM public.bills_not_in_2b t WHERE t.client_id = '${R}'`));
  // A-1's document taken out of Reclaim since (Matched); B-1's entry taken
  // away (a Restore of a month without it), its document left Reclaim.
  // (Import 2B's Save of it, as this code's page or the page of before sends it.)
  psql(`SET ROLE anon; SELECT set_config('request.headers', '{"x-gst-actor":"${POSTER}","x-gst-source":"app"}', false);
    DO $$ BEGIN
      IF to_regprocedure('public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text, uuid)') IS NOT NULL THEN
        PERFORM public.twob_import2b_unreclaim('${POSTER}', '${R}', '10/2026', '${id(31)}', 'MATCHED', '${id(21)}');
      ELSE
        EXECUTE 'SELECT public.twob_import2b_unreclaim($1, $2, ''10/2026'', $3, ''MATCHED'')' USING '${POSTER}'::uuid, '${R}'::uuid, '${id(31)}'::uuid;
      END IF;
    END $$;`);
  await as(SUPER, () => A.restoreVersion(SUPER, R, '10/2026', version.filter((r) => r.id === id(21)), []));
  const res = await as(SUPER, () => A.restoreVersion(SUPER, R, '10/2026', version, []));
  check('F1: the Restore names A-1 as back in Awaiting reclaim, its document being Matched now (round 6: nothing said)',
    Array.isArray(res.reclaimsBack) && res.reclaimsBack.join(' | ') === 'ALPHA A-1 (its 2B document is Matched now, not Reclaim)', JSON.stringify(res.reclaimsBack));
  check('F1: ... A-1 in Awaiting reclaim; B-1 reclaimed again with its document B-1, found as the same document',
    decision(21) === '-|-' && decision(22) === `Oct 26|${id(32)}`, `${decision(21)} ${decision(22)}`);
  // What the page records as the RESTORE version (TwoBReconciliationPage:
  // version_data: restored.versionData; round 6: the version restored).
  const recorded = res.versionData ?? { billsNotIn2B: version.map((r) => ({ ...r, reclaimMonth: r.reclaim_month, reclaimedViaDocId: r.reclaimed_via_doc_id ?? null })) };
  const rec = (n) => (recorded.billsNotIn2B || []).find((r) => r.id === id(n)) || {};
  check('F4: the RESTORE version records A-1 as the Restore left it: in Awaiting reclaim (round 6: reclaimed Oct 26)',
    (rec(21).reclaimMonth || '') === '' && (rec(21).reclaimedViaDocId ?? null) === null, JSON.stringify(rec(21)));
  check('F4: ... and B-1 reclaimed with its document named (so a Restore of it holds B-1 to its document)',
    rec(22).reclaimMonth === 'Oct 26' && rec(22).reclaimedViaDocId === id(32), JSON.stringify(rec(22)));
  check('F4: ... the whole month, in the version\'s shape (both entries, Not in Books empty)',
    (recorded.billsNotIn2B || []).length === 2 && Array.isArray(recorded.billsNotInBooks) && recorded.billsNotInBooks.length === 0
      && rec(22).supplierName === 'BRAVO' && rec(22).inputCgst === 50 && rec(22).isCarriedForward === false, JSON.stringify(recorded));
});

psql(`DELETE FROM public.clients WHERE id IN ('${C}', '${R}')`);
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round7: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round7: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
