#!/usr/bin/env node
// Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15):
// the app's side of the eighth verification round (22 Oct 2026), run against
// the test database as PostgREST runs it (anon, with the request headers
// naming the user):
//   L4  2B Reconciliation hears its own Restore live: the Restore
//       (restoreVersion, twob_restore_version_linked) deletes the month's own
//       entries and adds them back with their ids, and links an entry it adds
//       to its Import 2B row (an insert, then an update). The page keeps what
//       it hears while the Restore runs and looks at it again against the
//       month as it reloads it (TwoBReconciliationPage: savingRef / endSave,
//       as a Save does); that burst is the page's own and is shown already
//       (changesShown: a row's earlier changes are shown when its last one
//       is). Round 7 read the delete of an entry added back, and the insert
//       before its link, as someone else's change, and told the superadmin,
//       after their own Restore, that the ledger "was changed elsewhere".
//       Someone else's change after the reload is still news.
// The writes the Restore makes are read from the database itself (an AFTER
// ROW trigger on the two ledger tables, as Supabase Realtime sends them:
// a delete with its row id only), then given to the page's own code.
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql.
// GSTK_ROOT=/path/to/other/checkout runs another checkout's modules: on the
// code of before this round the Restore's own burst reads as news.
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

// The stand-in supabase client of round7.test.mjs (one SQL statement per
// call, through psql as anon naming globalThis.__actor).
const r7 = fs.readFileSync(path.join(here, 'round7.test.mjs'), 'utf8');
const FAKE_SUPABASE = eval(r7.match(/const FAKE_SUPABASE = (`[\s\S]*?`);\n/)[1]);

const entry = [
  "export { changesShown, changeShown } from './src/lib/twobLiveSync';",
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

const C = 'a8100000-0000-0000-0000-0000000000c1';
const id = (n) => `a8100000-0000-0000-0001-${String(n).padStart(12, '0')}`;
// Oct-26 open: A-1 Matched with its pending entry A-1, reclaimed with it
// below; books row R-1 (Not in 2B), whose entry Import 2B posts.
psql(`SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('${C}', 'R8 RESTORE HEARD', '24REIGH0000A1Z5');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('${id(11)}', '${C}', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('${id(1)}', '${C}', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
SELECT set_config('twob.write', '', false);`);
psql(asAnon(`SELECT public.twob_import2b_reclaim('${POSTER}', '${C}', '10/2026', '${id(1)}', '${id(11)}', 'MATCHED');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('${id(21)}', '${C}', '10/2026', '2026-10-03', 'ROMEO', 'R-1', '24ROMEO0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_2B', 'INVOICE');`, POSTER));
// What Supabase Realtime sends the page: each row write to the two ledger
// tables, a delete with its row id only.
psql(`CREATE TABLE public.t8_heard (seq bigserial PRIMARY KEY, tbl text, op text, rec jsonb, old jsonb);
GRANT ALL ON public.t8_heard TO anon; GRANT USAGE ON SEQUENCE public.t8_heard_seq_seq TO anon;
CREATE FUNCTION public.t8_heard_fn() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.t8_heard (tbl, op, rec, old) VALUES (TG_TABLE_NAME, TG_OP, '{}'::jsonb, jsonb_build_object('id', OLD.id));
  ELSE
    INSERT INTO public.t8_heard (tbl, op, rec, old) VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(NEW),
      CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('id', OLD.id) ELSE '{}'::jsonb END);
  END IF;
  RETURN NULL;
END $f$;
CREATE TRIGGER zzzz_t8_heard AFTER INSERT OR UPDATE OR DELETE ON public.bills_not_in_2b FOR EACH ROW EXECUTE FUNCTION public.t8_heard_fn();
CREATE TRIGGER zzzz_t8_heard AFTER INSERT OR UPDATE OR DELETE ON public.bills_not_in_books FOR EACH ROW EXECUTE FUNCTION public.t8_heard_fn();`);
const heard = () => JSON.parse(psql(`SELECT COALESCE(jsonb_agg(jsonb_build_object('eventType', op, 'new', rec, 'old', old) ORDER BY seq), '[]') FROM public.t8_heard`));
// The month as the page loads it (fetchBillsData): its rows by id.
const loaded = () => new Map(JSON.parse(psql(`SELECT COALESCE(jsonb_agg(t), '[]') FROM (
    SELECT to_jsonb(b) AS t FROM public.bills_not_in_2b b WHERE b.client_id = '${C}' AND b.period_month = '10/2026'
    UNION ALL SELECT to_jsonb(b) FROM public.bills_not_in_books b WHERE b.client_id = '${C}' AND b.period_month = '10/2026') x`))
  .map((r) => [r.id, r]));
const view = { clientId: C, period: '10/2026' };

await run('L4', async () => {
  // A version of the month as the Save of this release records it (each
  // entry with its id, its reclaim's document and its Import 2B link), and
  // R-1's entry as a version of before holds it under another id (no link):
  // the Restore adds it, then links it to R-1 (an insert, then an update).
  const v = JSON.parse(psql(`SELECT jsonb_agg(to_jsonb(t) - 'adopted_from' ORDER BY t.id) FROM public.bills_not_in_2b t WHERE t.client_id = '${C}'`));
  const r1 = v.find((r) => r.supplier_invoice_number === 'R-1');
  const version = [...v.filter((r) => r !== r1), { ...r1, id: id(31), source_book_id: null }];
  check('L4: (the month: A-1 reclaimed with its document, R-1 posted by its books row)',
    v.length === 2 && v.some((r) => r.reclaimed_via_doc_id === id(11)) && r1?.source_book_id === id(21), JSON.stringify(v));
  psql('TRUNCATE public.t8_heard');
  const res = await (async () => { globalThis.__actor = SUPER; return A.restoreVersion(SUPER, C, '10/2026', version, []); })();
  const burst = heard();
  const rows = loaded();
  check('L4: the Restore writes: the entries deleted, added back with their ids, one linked after it is added',
    res && burst.filter((c) => c.eventType === 'DELETE').length === 2 && burst.filter((c) => c.eventType === 'INSERT').length === 2
      && burst.some((c) => c.eventType === 'UPDATE' && c.new.id === id(31) && c.new.source_book_id === id(21))
      && rows.has(id(1)) && rows.has(id(31)) && rows.get(id(31)).source_book_id === id(21), JSON.stringify(burst.map((c) => [c.eventType, c.new?.id ?? c.old?.id])));
  check('L4: what the page heard of its own Restore, looked at against the month as it reloads it, is shown already: no "changed elsewhere", no second reload (round 7: news)',
    A.changesShown(burst, view, rows) === true);
  check('L4: ... each part of it on its own: the delete of an entry added back is not (only with the rest of the burst)',
    A.changeShown(burst.find((c) => c.eventType === 'DELETE' && c.old.id === id(1)), view, rows) === false);
  // Someone else's change after the reload is still news, alone or heard
  // with the Restore's burst.
  psql(asAnon(`UPDATE public.bills_not_in_2b SET supplier_name = 'ROMEO TRADERS' WHERE id = '${id(31)}';`, POSTER));
  const after = heard().slice(burst.length);
  check('L4: another user\'s change after the reload is news, alone',
    after.length === 1 && A.changesShown(after, view, rows) === false, JSON.stringify(after));
  check('L4: ... and heard together with the Restore\'s own burst', A.changesShown([...burst, ...after], view, rows) === false);
});

psql(`DROP TRIGGER IF EXISTS zzzz_t8_heard ON public.bills_not_in_2b; DROP TRIGGER IF EXISTS zzzz_t8_heard ON public.bills_not_in_books;
DROP FUNCTION IF EXISTS public.t8_heard_fn(); DROP TABLE IF EXISTS public.t8_heard;
DELETE FROM public.clients WHERE id = '${C}';`);
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} round8: ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
  if (!r.ok) failed += 1;
}
console.log(`round8: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
