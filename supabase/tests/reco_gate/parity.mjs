#!/usr/bin/env node
// The GSTR-3B push gate reads the two reco differences from the database
// (suspended_reco_difference, gst_receivable_reco_difference, migration
// 20261021120000); the reco pages and the old push check compute them in
// TypeScript (src/lib/suspendedRecoCalc.ts, src/lib/gstReceivableRecoCalc.ts).
// This loads the same rows into a local database and into an in-memory
// stand-in for the Supabase client, runs both, and fails on any head that
// differs by more than half a paisa. A change to either formula that is not
// made in the other fails here.
//
//   node supabase/tests/reco_gate/parity.mjs <local database> [fixtures.json]
//
// <local database> must already hold 00_stub.sql and the migrations (run.sh
// makes one). fixtures.json (optional) replaces the built-in cases: the same
// shape as FIXTURES below, plus "cases": [[client_id, period_month], ...].
// Never point it at the live project.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '../../..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const dbName = process.argv[2];
if (!dbName) { console.error('usage: parity.mjs <local database> [fixtures.json]'); process.exit(2); }

// ── Fixtures: every case is pulled ('portal'), as the gate only reads those ──
const C = (n) => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const pulled = { opening_source: 'portal', opening_portal_pulled_at: '2026-10-20T10:00:00Z' };
const FIXTURES = {
  clients: [
    { id: C(1), name: 'REGULAR', regular_sub_type: 'Normal', builder_itc_type: null, commercial_area: null, residential_area: null },
    { id: C(2), name: 'PARTIAL', regular_sub_type: 'Builder', builder_itc_type: 'PARTIAL_ITC', commercial_area: 1250.5, residential_area: 3749.5 },
    { id: C(3), name: 'NOITC', regular_sub_type: 'Builder', builder_itc_type: 'NO_ITC', commercial_area: null, residential_area: null },
    { id: C(4), name: 'EDGES', regular_sub_type: 'Normal', builder_itc_type: null, commercial_area: null, residential_area: null },
    { id: C(5), name: 'PREV NOT FILED', regular_sub_type: 'Normal', builder_itc_type: null, commercial_area: null, residential_area: null },
    // Merged with the prior-month rule (20261021100000, §13): a month changed
    // after filing reads its recorded figures (twob_filed_figures), not its
    // live lists, in the app and in the database alike.
    { id: C(6), name: 'FILED FIGURES', regular_sub_type: 'Normal', builder_itc_type: null, commercial_area: null, residential_area: null },
  ],
  suspended_reco: [
    { client_id: C(1), period_month: '09/2026', opening_cgst: 1500.25, opening_sgst: 1500.25, opening_igst: 12.5, ...pulled },
    { client_id: C(2), period_month: '09/2026', opening_cgst: 0, opening_sgst: 0, opening_igst: 0, ...pulled },
    { client_id: C(3), period_month: '09/2026', opening_cgst: 10, opening_sgst: 10, opening_igst: 0, ...pulled },
    { client_id: C(4), period_month: '09/2026', opening_cgst: 10.004, opening_sgst: -10.01, opening_igst: 9.995, ...pulled },
    { client_id: C(4), period_month: '05/2026', opening_cgst: 3, opening_sgst: 0, opening_igst: 0, opening_source: 'manual' },
    { client_id: C(5), period_month: '10/2026', opening_cgst: 0, opening_sgst: 0, opening_igst: 0, ...pulled },
    { client_id: C(6), period_month: '09/2026', opening_cgst: 200, opening_sgst: 200, opening_igst: 40, ...pulled },
  ],
  gst_receivable_reco: [
    { client_id: C(1), period_month: '09/2026', opening_cgst: 300, opening_sgst: 300, opening_igst: 50, utilized_cgst: 120.5, utilized_sgst: 120.5, utilized_igst: 0,
      drc_cgst: 10, drc_sgst: 0, drc_igst: 0, books_closing_cgst: 2000, books_closing_sgst: 2000, books_closing_igst: 100, ...pulled },
    { client_id: C(2), period_month: '09/2026', opening_cgst: 100, opening_sgst: 100, opening_igst: 0, utilized_cgst: null, utilized_sgst: null, utilized_igst: null,
      drc_cgst: 0, drc_sgst: 0, drc_igst: 0, books_closing_cgst: 500, books_closing_sgst: 500, books_closing_igst: 0, ...pulled },
    { client_id: C(3), period_month: '09/2026', opening_cgst: 0, opening_sgst: 0, opening_igst: 0, utilized_cgst: null, utilized_sgst: null, utilized_igst: null,
      drc_cgst: 0, drc_sgst: 0, drc_igst: 0, books_closing_cgst: 0, books_closing_sgst: 0, books_closing_igst: 0, ...pulled },
    { client_id: C(4), period_month: '09/2026', opening_cgst: 50, opening_sgst: 50, opening_igst: 0, utilized_cgst: 400, utilized_sgst: 0, utilized_igst: 0,
      drc_cgst: 20, drc_sgst: 0, drc_igst: 0, books_closing_cgst: 0, books_closing_sgst: 45, books_closing_igst: 0, ...pulled },
    { client_id: C(5), period_month: '10/2026', opening_cgst: 70, opening_sgst: 70, opening_igst: 0, utilized_cgst: null, utilized_sgst: null, utilized_igst: null,
      drc_cgst: 0, drc_sgst: 0, drc_igst: 0, books_closing_cgst: 70, books_closing_sgst: 70, books_closing_igst: 0, ...pulled },
    { client_id: C(6), period_month: '09/2026', opening_cgst: 100, opening_sgst: 100, opening_igst: 0, utilized_cgst: 50, utilized_sgst: 50, utilized_igst: 0,
      drc_cgst: 0, drc_sgst: 0, drc_igst: 0, books_closing_cgst: 900, books_closing_sgst: 900, books_closing_igst: 30, ...pulled },
  ],
  bills_not_in_2b: [
    // C1 09/2026: reversals (free-text months), reclaims (one EXPENSE_OUT), books.
    { client_id: C(1), period_month: '09/2026', input_igst: 0, input_cgst: 400, input_sgst: 400, reversal_month: 'Sep-26', reclaim_month: null, reclaim_subtype: null },
    { client_id: C(1), period_month: '09/2026', input_igst: 18, input_cgst: 0, input_sgst: 0, reversal_month: ' september 2026 ', reclaim_month: null, reclaim_subtype: null },
    { client_id: C(1), period_month: '09/2026', input_igst: 0, input_cgst: 90, input_sgst: 90, reversal_month: 'Aug-26', reclaim_month: 'Sep-26', reclaim_subtype: null },
    { client_id: C(1), period_month: '09/2026', input_igst: 0, input_cgst: 60, input_sgst: 60, reversal_month: 'Jul-26', reclaim_month: 'SEP 26', reclaim_subtype: 'EXPENSE_OUT' },
    { client_id: C(1), period_month: '09/2026', input_igst: 0, input_cgst: 33.33, input_sgst: 33.33, reversal_month: 'Jun-26', reclaim_month: '', reclaim_subtype: null },
    { client_id: C(1), period_month: '09/2026', input_igst: 5, input_cgst: 0, input_sgst: 0, reversal_month: '', reclaim_month: null, reclaim_subtype: null },
    // C1 08/2026 (the receivable's month before): live reversal and reclaim.
    { client_id: C(1), period_month: '08/2026', input_igst: 0, input_cgst: 75, input_sgst: 75, reversal_month: 'Aug-26', reclaim_month: null, reclaim_subtype: null },
    { client_id: C(1), period_month: '08/2026', input_igst: 0, input_cgst: 25, input_sgst: 25, reversal_month: 'Jun-26', reclaim_month: 'August 2026', reclaim_subtype: null },
    { client_id: C(1), period_month: '08/2026', input_igst: 0, input_cgst: 999, input_sgst: 999, reversal_month: 'May-26', reclaim_month: 'Aug-26', reclaim_subtype: 'EXPENSE_OUT' },
    // C2 08/2026 reversal (Partial ITC (2)).
    { client_id: C(2), period_month: '08/2026', input_igst: 0, input_cgst: 333.33, input_sgst: 333.33, reversal_month: 'aug 2026', reclaim_month: null, reclaim_subtype: null },
    // C6 09/2026 and 08/2026: live lists a GST Manager changed after filing;
    // the recorded figures below are what the gates read.
    { client_id: C(6), period_month: '09/2026', input_igst: 0, input_cgst: 500, input_sgst: 500, reversal_month: 'Sep-26', reclaim_month: null, reclaim_subtype: null },
    { client_id: C(6), period_month: '09/2026', input_igst: 7, input_cgst: 0, input_sgst: 0, reversal_month: 'Aug-26', reclaim_month: 'Sep-26', reclaim_subtype: null },
    { client_id: C(6), period_month: '09/2026', input_igst: 0, input_cgst: 11, input_sgst: 11, reversal_month: 'Aug-26', reclaim_month: 'Sep-26', reclaim_subtype: 'EXPENSE_OUT' },
    { client_id: C(6), period_month: '08/2026', input_igst: 0, input_cgst: 300, input_sgst: 300, reversal_month: 'Aug-26', reclaim_month: null, reclaim_subtype: null },
    { client_id: C(6), period_month: '08/2026', input_igst: 30, input_cgst: 0, input_sgst: 0, reversal_month: 'Jul-26', reclaim_month: 'Aug-26', reclaim_subtype: null },
    // C3 09/2026: NO_ITC books carry reversals the portal never holds.
    { client_id: C(3), period_month: '09/2026', input_igst: 0, input_cgst: 41038.44, input_sgst: 41038.44, reversal_month: 'Aug-26', reclaim_month: null, reclaim_subtype: null },
  ],
  itc_summaries: [
    { client_id: C(1), period_month: '09/2026', data: {
      section4A: [{ srNo: '(1)', igst: 0, cgst: 0, sgst: 0 }, { srNo: '5.5', igst: 1, cgst: 12.5, sgst: '12.5' }],
      section4B: [{ particular: 'header', isHeader: true }, { srNo: '(ii)', particular: 'ITC Reversal for previous months', igst: 0, cgst: 44, sgst: 44 }],
      section4D: [{ srNo: '1.2', igst: 0, cgst: 50, sgst: 70 }],
    } },
    { client_id: C(1), period_month: '08/2026', data: {
      section4A: [
        { srNo: '(1)', igst: 10, cgst: 0, sgst: 0 }, { srNo: '(2)', igst: '5', cgst: 0, sgst: 0 },
        { srNo: '(3)', igst: 999, cgst: 999, sgst: 999 }, { srNo: '(4)', igst: 0, cgst: 1.5, sgst: 1.5 },
        { srNo: '5.1', igst: 100, cgst: 2000, sgst: 2000 }, { srNo: '5.2', igst: 0, cgst: -20, sgst: -20 },
        { srNo: '5.3', igst: 0, cgst: 30, sgst: 30 }, { srNo: '5.5', igst: 0, cgst: 7, sgst: 7 },
      ],
      section4B: [
        { particular: '4(B) ITC Reversed', isHeader: true, cgst: 99999 },
        { particular: '(1) As per rules 38, 42 & 43 of CGST Rules and section 17(5)', igst: 0, cgst: 100, sgst: 100 },
        { particular: '(i) ITC reversal for current month as per 2B RECO', igst: 0, cgst: 12345, sgst: 12345 },
        { particular: 'something', isHeader: 0, igst: 'abc', cgst: '  8 ', sgst: true },
      ],
    } },
    { client_id: C(2), period_month: '08/2026', data: {
      section4A: [
        { srNo: '(1)', igst: 0, cgst: 0, sgst: 0 }, { srNo: '(2)', igst: 0, cgst: 0, sgst: 0 },
        { srNo: '(3)', igst: 0, cgst: 0, sgst: 0 }, { srNo: '(4)', igst: 0, cgst: 0, sgst: 0 },
        { srNo: '5.1', igst: 0, cgst: 1001.37, sgst: 1001.37 },
      ],
      section4B: [
        { particular: 'ii) Previous Month Adjustment', igst: 0, cgst: 12.34, sgst: -12.34 },
        { particular: 'ITC Reversal for previous months, if any', igst: 0, cgst: 50, sgst: 50 },
      ],
    } },
    { client_id: C(3), period_month: '08/2026', data: {
      section4A: [{ srNo: '(1)', igst: 0, cgst: 0, sgst: 0 }, { srNo: '5.1', igst: 0, cgst: 900, sgst: 900 }],
      section4B: [],
    } },
    { client_id: C(4), period_month: '08/2026', data: {
      section4B: [{ particular: 'x', cgst: 500, sgst: 0, igst: 0 }],
    } },
    { client_id: C(5), period_month: '09/2026', data: { section4A: [{ srNo: '5.1', igst: 0, cgst: 1000, sgst: 1000 }], section4B: [] } },
    { client_id: C(6), period_month: '09/2026', data: {
      section4A: [{ srNo: '5.5', igst: 0, cgst: 3, sgst: 3 }],
      section4B: [{ srNo: '(ii)', particular: 'ITC Reversal for previous months', igst: 0, cgst: 20, sgst: 20 }],
      section4D: [{ srNo: '1.2', igst: 0, cgst: 5, sgst: 5 }],
    } },
    { client_id: C(6), period_month: '08/2026', data: {
      section4A: [{ srNo: '(1)', igst: 0, cgst: 0, sgst: 0 }, { srNo: '5.1', igst: 100, cgst: 1500, sgst: 1500 }, { srNo: '5.2', igst: 0, cgst: 0, sgst: 0 }],
      section4B: [{ particular: '(i) ITC reversal for current month as per 2B RECO', igst: 0, cgst: 1, sgst: 1 }],
    } },
  ],
  filing_status: [
    { client_id: C(1), return_type: 'GSTR-3B', period_month: '08/2026', status: 'Filed' },
    { client_id: C(2), return_type: 'GSTR-3B (Q)', period_month: '08/2026', status: 'Filed' },
    { client_id: C(3), return_type: 'GSTR-3B', period_month: '08/2026', status: 'Filed' },
    { client_id: C(4), return_type: 'GSTR-3B', period_month: '08/2026', status: 'Filed' },
    { client_id: C(5), return_type: 'GSTR-3B', period_month: '09/2026', status: 'Pushed' },
    { client_id: C(6), return_type: 'GSTR-3B', period_month: '08/2026', status: 'Filed' },
  ],
  rcm_data: [
    { client_id: C(1), month: 'Aug-26', cgst_2_5: 2.5, cgst_9: 90, sgst_2_5: 2.5, sgst_9: 90, igst_5: 0, igst_18: 18 },
    { client_id: C(1), month: 'Aug-26', cgst_2_5: null, cgst_9: 9, sgst_2_5: null, sgst_9: 9, igst_5: 5, igst_18: null },
  ],
  gstr1_data: [],
  // Recorded at the month's first change after filing (20261021100000); only
  // loaded when that migration is in the database (see below).
  twob_filed_figures: [
    { client_id: C(6), period_month: '09/2026', reversal_igst: 0, reversal_cgst: 420, reversal_sgst: 420, reclaim_igst: 9, reclaim_cgst: 0, reclaim_sgst: 0,
      expense_out_igst: 0, expense_out_cgst: 2, expense_out_sgst: 13 },
    { client_id: C(6), period_month: '08/2026', reversal_igst: 0, reversal_cgst: 250, reversal_sgst: 250, reclaim_igst: 25, reclaim_cgst: 0, reclaim_sgst: 0,
      expense_out_igst: 0, expense_out_cgst: 0, expense_out_sgst: 0 },
  ],
  cases: [[C(1), '09/2026'], [C(2), '09/2026'], [C(3), '09/2026'], [C(4), '09/2026'], [C(4), '05/2026'], [C(5), '10/2026'], [C(6), '09/2026']],
};

const fx = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : FIXTURES;

// ── Load the rows into the local database, triggers off for the load (live
//    rows carry overrides by people this database does not know) ─────────────
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const psql = (args) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', dbName, ...args], { encoding: 'utf8' });
// twob_filed_figures exists once 20261021100000 is applied (the prior-month
// rule, merged with this on 21 Oct 2026). Without it there are no recorded
// figures on either side, and the rows below are left out of both.
const hasFiled = psql(['-At', '-c', "SELECT to_regclass('public.twob_filed_figures') IS NOT NULL"]).trim() === 't';
if (!hasFiled) fx.twob_filed_figures = [];
const TABLES = ['clients', 'suspended_reco', 'gst_receivable_reco', 'bills_not_in_2b', 'itc_summaries', 'filing_status', 'rcm_data', 'twob_filed_figures'];
let sql = "SET session_replication_role = replica;\nSET client_min_messages = warning;\n";
for (const t of TABLES) {
  for (const row of fx[t] || []) {
    const cols = Object.keys(row);
    sql += `INSERT INTO public.${t} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});\n`;
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reco-parity-'));
fs.writeFileSync(path.join(tmp, 'load.sql'), sql);
psql(['-f', path.join(tmp, 'load.sql')]);

// ── The app's calculations, against the same rows in memory ───────────────
// PostgREST returns numeric as a JSON number; a select returns only the
// columns it names; filters as the libs use them.
const FAKE = `
class Q {
  constructor(t) { this.t = t; this.f = []; this.cols = null; this.one = false; }
  select(c) { this.cols = c && c.trim() !== '*' ? c.split(',').map((x) => x.trim()).filter(Boolean) : null; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  not(c, op, v) { if (op !== 'is') throw new Error('fake: not ' + op); this.f.push((r) => (r[c] ?? null) !== v); return this; }
  order() { return this; }
  maybeSingle() { this.one = true; return this; }
  then(res, rej) {
    try {
      const rows = (globalThis.__db[this.t] || []).filter((r) => this.f.every((fn) => fn(r)))
        .map((r) => this.cols ? Object.fromEntries(this.cols.map((c) => [c, r[c] === undefined ? null : r[c]])) : { ...r });
      if (this.one && rows.length > 1) return Promise.resolve({ data: null, error: { message: 'more than one row' } }).then(res, rej);
      return Promise.resolve({ data: this.one ? (rows[0] ?? null) : rows, error: null }).then(res, rej);
    } catch (e) { return Promise.reject(e).then(res, rej); }
  }
}
export const supabase = { from: (t) => new Q(t) };
`;
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, `export { computeSuspendedRecoDiff } from '@/lib/suspendedRecoCalc';\nexport { computeGstReceivableRecoDiff } from '@/lib/gstReceivableRecoCalc';\n`);
const out = path.join(tmp, 'bundle.mjs');
await build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [{ name: 'alias', setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'fake-supabase', namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: FAKE, loader: 'js' }));
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(root, 'src', a.path.slice(2));
      for (const ext of ['.ts', '.tsx', '/index.ts', '.js']) if (fs.existsSync(base + ext)) return { path: base + ext };
      return { path: base };
    });
  } }],
});
globalThis.__db = Object.fromEntries(TABLES.concat('gstr1_data').map((t) => [t, (fx[t] || []).map((r) => ({ ...r }))]));
const { computeSuspendedRecoDiff, computeGstReceivableRecoDiff } = await import(pathToFileURL(out).href);

// ── Compare ────────────────────────────────────────────────────────────────
const sqlDiff = (fn, c, p) => {
  const s = psql(['-At', '-c', `SELECT public.${fn}('${c}', '${p}')`]).trim();
  return s ? JSON.parse(s) : null;
};
const HEADS = ['cgst', 'sgst', 'igst', 'total'];
let fail = 0, checked = 0;
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.005;
for (const [c, p] of fx.cases) {
  const ts = await computeSuspendedRecoDiff(c, p);
  const db = sqlDiff('suspended_reco_difference', c, p);
  const bad = HEADS.filter((h) => !near(ts[h], db[h]));
  checked++;
  if (bad.length) { fail++; console.log(`FAIL suspended ${c} ${p}: app ${JSON.stringify(ts)} db ${JSON.stringify(HEADS.map((h) => db[h]))}`); }
  else if (!process.argv[3]) console.log(`ok   suspended  ${p} ${c.slice(-2)} total ${ts.total}`);
  const tr = await computeGstReceivableRecoDiff(c, p);
  const dr = sqlDiff('gst_receivable_reco_difference', c, p);
  if (tr === null || dr === null) {
    checked++;
    if ((tr === null) !== (dr === null)) { fail++; console.log(`FAIL receivable ${c} ${p}: app ${JSON.stringify(tr)} db ${JSON.stringify(dr)}`); }
    else if (!process.argv[3]) console.log(`ok   receivable ${p} ${c.slice(-2)} none before 06/2026`);
    continue;
  }
  checked++;
  const badR = HEADS.filter((h) => !near(tr[h], dr[h]));
  if (badR.length) { fail++; console.log(`FAIL receivable ${c} ${p}: app ${JSON.stringify(tr)} db ${JSON.stringify(HEADS.map((h) => dr[h]))}`); }
  else if (!process.argv[3]) console.log(`ok   receivable ${p} ${c.slice(-2)} total ${tr.total}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `parity: ${fail} of ${checked} differ` : `parity: ${checked} of ${checked} agree${hasFiled ? ` (with ${(fx.twob_filed_figures || []).length} recorded filed figures)` : ''}`);
process.exit(fail ? 1 : 0);
