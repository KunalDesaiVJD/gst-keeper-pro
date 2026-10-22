#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's side of the tenth verification round (22 Oct 2026), run against
// the test database as PostgREST runs it (anon, with the request headers
// naming the user):
//   O  2B Reconciliation's Restore names each Reclaim document it leaves
//      evidencing no reclaim (restoreVersion's docsLeft, from the database's
//      docs_left), with the entry whose reclaim it evidenced before; the
//      page's toast shows them. Round 9 said nothing: a version holding the
//      entry in Awaiting reclaim undid the reclaim recorded since, and the
//      document's ITC counted nowhere.
//   M  "Reclaim it again on Import 2B" can be done: Pending items' Link &
//      Reclaim offers the month's Reclaim documents that evidence no
//      reclaim (reclaimCandidateDocs; round 9 offered only Matched and
//      Mismatched ones, and the document's own select, already Reclaim,
//      opens nothing), and the page's reclaim (recordReclaim, sending the
//      treatment it shows, Reclaim) records it; such a document's row says
//      its ITC counts nowhere (reclaimNoEvidenceNote), and, while a reclaim
//      of the month names no document, that one of those may be it
//      (countUnlinkedReclaims).
// The modules are bundled as they are (esbuild) with round7.test.mjs's
// stand-in supabase client (one SQL statement per call, through psql as
// anon naming globalThis.__actor).
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
// GSTK_ROOT=/path/to/other/checkout runs another checkout's modules: on the
// code of before this round the Restore names no document and the page's
// Link & Reclaim never offers one, and the checks fail.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
const as = async (actor, fn) => { const was = globalThis.__actor; globalThis.__actor = actor; try { return await fn(); } finally { globalThis.__actor = was; } };

const r7 = fs.readFileSync(path.join(here, 'round7.test.mjs'), 'utf8');
const FAKE_SUPABASE = eval(r7.match(/const FAKE_SUPABASE = (`[\s\S]*?`);\n/)[1]);

const entry = [
  "export * from './src/lib/import2bGuardedSaves';",
  "export { restoreVersion } from './src/lib/twobPriorMonth';",
  "export { recordReclaim } from './src/lib/twobPendingWrites';",
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

const C = 'a1000000-0000-0000-0000-0000000000c1';
const L = 'a1000000-0000-0000-0000-0000000000c2';
const id = (n) => `a1000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
// C (Strict), Oct-26 open: LANDLORD RENT/2026/10 Matched, its books entry
// R-OCT (numbered otherwise) awaiting a reclaim; OSCAR O-1 Matched.
// L (Liberal): a reclaim typed on 2B Reconciliation (no document named), and
// LIMA L-1, Reclaim, evidencing nothing.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  ('${C}', 'R10 RESTORE LEAVES A DOCUMENT', '24RTENA0000A1Z5', false),
  ('${L}', 'R10 TYPED RECLAIM', '24RTENB0000A1Z5', true);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '10/2026', '2026-10-01', 'LANDLORD', 'RENT/2026/10', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('${id(12)}', '${C}', '10/2026', '2026-10-02', 'OSCAR', 'O-1', '24OSCAR0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('${id(13)}', '${C}', '10/2026', '2026-10-03', 'OSCAR', 'CN-1', '24OSCAR0000A1Z5', 100, 0, 9, 9, 'CREDIT_NOTE', 'MATCHED'),
  ('${id(14)}', '${L}', '10/2026', '2026-10-04', 'LIMA', 'L-1', '24LIMAA0000A1Z5', 1000, 0, 60, 60, 'INVOICE', 'RECLAIM');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '10/2026', '2026-10-01', 'LANDLORD', 'R-OCT', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', NULL, false),
  ('${id(2)}', '${L}', '10/2026', '2026-09-24', 'LIMA', 'TYPED-1', '24LIMAA0000A1Z5', 1000, 0, 60, 60, 'Sep 26', 'Oct 26', false);
SELECT set_config('twob.write', '', false);`);
// The month's documents as Import 2B loads them, and 5.4 CGST.
const docsOf = (c) => JSON.parse(psql(`SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'itc_action', d.itc_action, 'doc_type', d.doc_type,
  'is_amendment', d.is_amendment, 'supplier_invoice_number', d.supplier_invoice_number) ORDER BY d.date), '[]') FROM public.twob_import_docs d WHERE d.client_id = '${c}'`));
const reclaimed54 = (c) => psql(`SELECT COALESCE(sum(t.input_cgst), 0)::numeric(12,2) FROM public.bills_not_in_2b t
  WHERE t.client_id = '${c}' AND t.reclaim_month = 'Oct 26' AND t.reclaim_subtype IS NULL`);

await run('O', async () => {
  // A version taken while R-OCT awaited a reclaim (as this release's Save
  // records it); R-OCT then reclaimed with RENT/2026/10 on Import 2B; the
  // version restored by the superadmin.
  const version = JSON.parse(psql(`SELECT jsonb_agg(to_jsonb(t) - 'adopted_from') FROM public.bills_not_in_2b t WHERE t.client_id = '${C}'`));
  const rec = await as(POSTER, () => A.recordReclaim({ actorId: POSTER, clientId: C, period: '10/2026', pendingId: id(1), docId: id(11), expectAction: 'MATCHED' }));
  check('O: (R-OCT reclaimed with RENT/2026/10 after the version; 5.4 4500)', rec.ok && reclaimed54(C) === '4500.00', JSON.stringify(rec));
  const res = await as(SUPER, () => A.restoreVersion(SUPER, C, '10/2026', version, []));
  check('O: the Restore brings R-OCT back as the version holds it (Awaiting reclaim) and names RENT/2026/10, left Reclaim evidencing nothing, with R-OCT (round 9: nothing said)',
    Array.isArray(res.docsLeft) && res.docsLeft.length === 1
      && res.docsLeft[0] === 'LANDLORD RENT/2026/10 (stays Reclaim and evidences no reclaim now, so its ITC counts nowhere; before this Restore it evidenced the reclaim of LANDLORD R-OCT)'
      && res.reclaimsBack.length === 0 && reclaimed54(C) === '0.00', JSON.stringify(res.docsLeft));
});

await run('M', async () => {
  // Pending items' Link & Reclaim on R-OCT, as the page opens it.
  const evidence = await A.loadReclaimEvidence(C);
  const offered = A.reclaimCandidateDocs(docsOf(C), evidence, {}).map((d) => d.supplier_invoice_number);
  check('M: Link & Reclaim offers RENT/2026/10 (Reclaim, evidencing nothing) beside the Matched O-1, never a credit note (round 9: only Matched and Mismatched)',
    offered.join(',') === 'RENT/2026/10,O-1', offered.join(','));
  check('M: ... not while a change of it is staged (it is offered again once saved)',
    !A.reclaimCandidateDocs(docsOf(C), evidence, { [id(11)]: 'MATCHED' }).some((d) => d.id === id(11)));
  const unlinked = await A.countUnlinkedReclaims(C, '10/2026');
  check('M: its row says its ITC counts nowhere, and what to do (no reclaim of the month names no document)',
    unlinked === 0 && A.reclaimNoEvidenceNote(unlinked, true)
      === 'Reclaim, but evidences no reclaim, so its ITC counts nowhere: Link & Reclaim an entry with it (Pending items), or take it out of Reclaim',
    `${unlinked} ${A.reclaimNoEvidenceNote(unlinked, true)}`);
  // The page's reclaim, sending the treatment it shows (Reclaim).
  const doc = docsOf(C).find((d) => d.id === id(11));
  const rec = await as(POSTER, () => A.recordReclaim({ actorId: POSTER, clientId: C, period: '10/2026', pendingId: id(1), docId: id(11), expectAction: doc.itc_action }));
  check('M: R-OCT reclaimed with it again: recorded, the document left as it is (was Reclaim), 5.4 4500 once',
    rec.ok && rec.was === 'RECLAIM' && reclaimed54(C) === '4500.00', JSON.stringify(rec));
  const after = A.reclaimCandidateDocs(docsOf(C), await A.loadReclaimEvidence(C), {}).map((d) => d.supplier_invoice_number);
  check('M: ... and, evidencing R-OCT\'s reclaim now, it is offered no more', after.join(',') === 'O-1', after.join(','));
  // A Liberal client's month with a reclaim typed on 2B Reconciliation (no
  // document named): a Reclaim document no entry names may be its own.
  const typed = await A.countUnlinkedReclaims(L, '10/2026');
  check('M: where a reclaim of the month names no document, the row says that one may be this one',
    typed === 1 && A.reclaimNoEvidenceNote(typed, true)
      === 'Reclaim, but no entry names it as its reclaim\'s evidence: unless the one reclaim of this month recorded without its 2B document is this one, its ITC counts nowhere: Link & Reclaim an entry with it (Pending items), or take it out of Reclaim',
    `${typed} ${A.reclaimNoEvidenceNote(typed, true)}`);
  check('M: ... and in a filed month, or when that could not be read, says only what is so',
    A.reclaimNoEvidenceNote(null, false) === 'Reclaim, but no entry names it as its reclaim\'s evidence: unless a reclaim of this month recorded without its 2B document is this one, its ITC counts nowhere',
    A.reclaimNoEvidenceNote(null, false));
});

psql(`SELECT set_config('twob.write', 'system', false); DELETE FROM public.clients WHERE id IN ('${C}', '${L}');`);
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round10: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round10: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
