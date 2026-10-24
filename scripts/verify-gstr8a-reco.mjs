#!/usr/bin/env node
// Golden test for the GSTR-8A reports (GSTR-9 Table 8A): GSTR-2A vs GSTR-8A,
// GSTR-2B vs GSTR-8A and GSTR-8A vs GSTR-2A vs GSTR-2B with the final ITC.
//
//   node scripts/verify-gstr8a-reco.mjs
//
// Builds src/lib/itcReco (fy8a, reasons8A, threeWay, fyView, eightA) with
// esbuild (Supabase stubbed: nothing here touches a database) and feeds it a
// fictional FY 2025-26 (the shapes the extension saves, from
// scripts/fixtures/itcRecoFixture.mjs): one document per case, both pairs'
// reasons, the three-way judgment and the year's final ITC, the rebuilt 8A,
// a 2B not pulled, the portal 8A Excel reader, the upload check, the report
// tables and the Pull plan. Prints a pass / fail table; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const XLSX = req('xlsx');
const JSZip = req('jszip');

const stub = {
  name: 'stub-supabase',
  setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase = {};', loader: 'js' }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export * from './src/lib/itcReco/fy8a';
      export * from './src/lib/itcReco/reasons8A';
      export * from './src/lib/itcReco/threeWay';
      export * from './src/lib/itcReco/fyView';
      export * from './src/lib/itcReco/eightA';
      export { EIGHT_A_FORMAT } from './src/lib/itcReco/sources';
      export { REASONS } from './src/lib/itcReco/reasons';
      export { diffHeader } from './src/lib/itcReco/viewModel';
      export { planFyPullJobs, has8A, EIGHT_A_PULL_VERSION } from './src/utils/gstr8aReports';
      export { read8APull, isPulled8A, EIGHT_A_PULL_FORMAT } from './src/lib/itcReco/eightAPull';
      export { describeJob } from './src/utils/gstr2aVs2bReports';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'error',
  loader: { '.png': 'dataurl' },
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const F = await import(pathToFileURL(path.join(root, 'scripts', 'fixtures', 'itcRecoFixture.mjs')).href);
const { CLIENT, intra, inter, inv2A, sup2A, inv2B, nt2B, sup2B, summary2B, row } = F;

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const near = (a, b) => Math.abs(a - b) < 0.005;

// ── FY 2025-26, fictional: suppliers A (Gujarat), B (Maharashtra), C (Karnataka) ──
const FY = '2025-26';
const TODAY = '2026-12-20';
const A = '24AAAPA0001A1Z1';
const B = '27AAAPB0002B1Z2';
const C = '29AAAPC0003C1Z3';
const window = R.fyWindow(FY);
const loadMonths = R.fyLoadMonths(FY);
const meta2A = { counterparties: 3, failed: 0, failedCtins: [], sections: ['b2b', 'cdn'], cdnFailed: 0, cdnFailedCtins: [] };

// 2A per month: { b2b: [...], cdn: [...] }
const twoA = Object.fromEntries(window.map((p) => [p, { b2b: [], cdn: [], _meta: meta2A }]));
const addA = (p, ...sups) => twoA[p].b2b.push(...sups);
addA('04/2025', sup2A(A, 'ALPHA', '10-May-25', [inv2A('INV-11', '15-04-2025', intra(1000))], { cfs: 'Y' }));
addA('05/2025', sup2A(A, 'ALPHA', '10-Jun-25', [inv2A('INV-1', '10-05-2025', intra(10000))], { cfs: 'Y' }));
addA('06/2025', sup2A(A, 'ALPHA', '10-Jul-25', [inv2A('INV-2', '02-06-2025', intra(5000))], { cfs: 'Y' }));
addA('07/2025', sup2A(B, 'BETA', '10-Aug-25', [inv2A('INV-3', '15-07-2025', inter(20000), { rchrg: 'Y' })], { cfs: 'Y' }));
addA('08/2025', sup2A(B, 'BETA', '10-Sep-25', [inv2A('INV-4', '01-08-2025', inter(3000))], { cfs: 'Y' }));
addA('09/2025', sup2A(C, 'GAMMA', '10-Oct-25', [inv2A('INV-5', '05-09-2025', inter(2000), { pos: '29' })], { cfs: 'Y' }));
twoA['10/2025'].cdn.push({ ctin: A, trdnm: 'ALPHA', cfs: 'Y', supfildt: '10-Nov-25', nt: [{ ntty: 'C', nt_num: 'CN-1', nt_dt: '20-10-2025', val: 1180, pos: '24', rchrg: 'N', ...intra(1000) }] });
addA('01/2026', sup2A(C, 'GAMMA', '10-Feb-26', [inv2A('INV-6', '10-01-2026', inter(1000))], { cfs: 'Y' }));
addA('02/2026', sup2A(A, 'ALPHA', '11-Mar-26', [inv2A('INV-7', '11-02-2026', intra(2000))], { cfs: 'Y' }));
addA('03/2026', sup2A(A, 'ALPHA', null, [inv2A('INV-8', '03-03-2026', intra(1000))], { cfs: 'N' }));

// 2B per month (April 2025 to December 2026).
const dd = Object.fromEntries(loadMonths.map((p) => [p, {}]));
const push = (p, key, v) => { dd[p][key] = [...(dd[p][key] ?? []), v]; };
push('04/2025', 'b2b', sup2B(A, 'ALPHA', '042025', '10-05-2025', [inv2B('INV-11', '15-04-2025', intra(1000)), inv2B('OLD-1', '28-03-2025', intra(500))]));
push('05/2025', 'b2b', sup2B(A, 'ALPHA', '052025', '10-06-2025', [inv2B('INV-1', '10-05-2025', intra(10000))]));
push('06/2025', 'b2b', sup2B(A, 'ALPHA', '062025', '10-07-2025', [inv2B('INV-2', '02-06-2025', intra(5000))]));
push('07/2025', 'b2b', sup2B(B, 'BETA', '072025', '10-08-2025', [inv2B('INV-3', '15-07-2025', inter(20000), { rev: 'Y' })]));
push('07/2025', 'b2ba', sup2B(A, 'ALPHA', '072025', '10-08-2025', [inv2B('INV-11', '15-04-2025', intra(1200), { oinum: 'INV-11', oidt: '15-04-2025' })]));
dd['08/2025'].rejected = { b2b: [sup2B(B, 'BETA', '082025', '10-09-2025', [inv2B('INV-4', '01-08-2025', inter(3000))])] };
push('09/2025', 'b2b', sup2B(C, 'GAMMA', '092025', '10-10-2025', [inv2B('INV-5', '05-09-2025', inter(2000), { itcavl: 'N', rsn: 'P', pos: '29' })]));
push('10/2025', 'cdnr', sup2B(A, 'ALPHA', '102025', '10-11-2025', [nt2B('CN-1', '20-10-2025', 'C', intra(1000))], 'nt'));
push('11/2025', 'impg', { refdt: '06-11-2025', portcode: 'INMUN1', boenum: '1234567', boedt: '05-11-2025', isamd: 'N', txval: 50000, igst: 9000, cess: 0 });
push('12/2025', 'b2b', sup2B(B, 'BETA', '122025', '10-01-2026', [inv2B('INV-9', '12-12-2025', inter(4000))]));
push('10/2026', 'itcrev', sup2B(B, 'BETA', '062025', '10-07-2025', [inv2B('INV-12', '20-06-2025', inter(500))]));
push('11/2026', 'b2b', sup2B(C, 'GAMMA', '012026', '20-11-2026', [inv2B('INV-6', '10-01-2026', inter(1000))]));

// The portal's 8A (as stored): what the portal holds, INV-2 at other figures, INV-10 that no 2B shows.
const d8 = (section, ctin, number, date, t, more = {}) => ({
  section, ctin, name: null, number, date, family: 'INV', value: t.txval + t.iamt + t.camt + t.samt, pos: '24', reverseCharge: false,
  taxable: t.txval, igst: t.iamt, cgst: t.camt, sgst: t.samt, cess: 0, originalNumber: null, originalDate: null,
  supplierPeriod: null, supplierFiledOn: null, itcAvailable: true, itcReason: null, irn: null, ...more,
});
const stored8A = {
  _format: R.EIGHT_A_FORMAT, origin: 'portal-excel', fy: FY, gstin: CLIENT.gstin, generatedOn: '2026-11-25', fileName: 'GSTR9_8A.xlsx',
  uploadedAt: '2026-12-01T05:00:00Z', uploadedBy: 'Tester', sheetsRead: ['B2B', 'B2BA', 'B2B-CDNR'], unread: [], warnings: [],
  docs: [
    d8('B2B', A, 'INV-1', '2025-05-10', intra(10000)),
    d8('B2B', A, 'INV-2', '2025-06-02', intra(4000)),
    d8('CDNR', A, 'CN-1', '2025-10-20', intra(1000), { family: 'CN' }),
    d8('B2B', B, 'INV-9', '2025-12-12', inter(4000)),
    d8('B2B', C, 'INV-10', '2026-03-25', inter(1500)),
    d8('B2BA', A, 'INV-11', '2025-04-15', intra(1200), { originalNumber: 'INV-11', originalDate: '2025-04-15' }),
  ],
};

const gendt = (p) => `14-${String(Number(p.slice(0, 2)) % 12 + 1).padStart(2, '0')}-${p.slice(0, 2) === '12' ? Number(p.slice(3)) + 1 : p.slice(3)}`;
const rowsOf = ({ with8A = true, drop2B = [], drop2A = [] } = {}) => [
  ...window.filter((p) => !drop2A.includes(p)).map((p) => row('2A', p, twoA[p], { updatedAt: '2026-12-05T05:00:00Z' })),
  ...loadMonths.filter((p) => !drop2B.includes(p) && R.isDue('2B', p, TODAY)).map((p) => row('2B', p, summary2B(p, gendt(p), dd[p]))),
  ...(with8A ? [{ source: '8A', period: R.eightAPeriod(FY), status: 'Uploaded', summary: stored8A, updatedAt: '2026-12-01T05:00:00Z' }] : []),
];
const client = { name: CLIENT.name, gstin: CLIENT.gstin };

// ── Assembly ────────────────────────────────────────────────────────────────
const st = R.assembleFy({ fy: FY, rows: rowsOf(), today: TODAY });
check('assembly', 'window is Apr 2025 to Oct 2026 (19 months)', window.length === 19 && window[0] === '04/2025' && window[18] === '10/2026', window.join(','));
check('assembly', 'every window 2A and 2B pulled: nothing missing, nothing not due', !st.twoA.missing.length && !st.twoB.missing.length && !st.twoB.notDue.length, JSON.stringify([st.twoA.missing, st.twoB.missing, st.twoB.notDue]));
check('assembly', '8A is the portal upload', st.eightA.origin === 'portal' && st.eightA.docs.length === 6, st.eightA.origin);
check('assembly', '2B: the earlier-year document is left out and counted', st.twoB.earlierFy === 1 && !st.twoB.docs.some((d) => d.number === 'OLD-1'), st.twoB.earlierFy);
check('assembly', '2B: the amendment replaces its original', st.twoB.docs.filter((d) => d.number === 'INV-11').length === 1 && st.twoB.docs.find((d) => d.number === 'INV-11').isAmendment && st.twoB.superseded === 1, st.twoB.superseded);
check('assembly', '2B holds the late 2B (Nov 2026) and the reversal entry', st.twoB.docs.some((d) => d.number === 'INV-6' && d.statementPeriod === '11/2026') && st.twoB.docs.some((d) => d.bucket === 'reversal'));
check('assembly', '8A basis is 2B from FY 2023-24, 2A before', R.eightABasis('2025-26') === '2B' && R.eightABasis('2022-23') === '2A');

// ── 2A vs 8A ────────────────────────────────────────────────────────────────
const run2A = R.reconcileFyPair('2A', st, client, TODAY);
const byNum = (rows) => {
  const m = new Map();
  for (const r of rows) m.set((r.left ?? r.right).number, r);
  return m;
};
const a8 = byNum(run2A.result.rows);
const expect2A = {
  'INV-1': ['matched', 'MATCHED_8A'],
  'INV-2': ['differs', 'VALUE_DIFFERENCE'],
  'INV-3': ['only_left', 'RCM_NOT_IN_8A'],
  'INV-4': ['only_left', 'REJECTED_NOT_IN_8A'],
  'INV-5': ['only_left', 'ITC_NA_NOT_IN_8A'],
  'INV-6': ['only_left', 'AFTER_8A_WINDOW'],
  'INV-7': ['only_left', 'NOT_IN_ANY_2B'],
  'INV-8': ['only_left', 'NOT_FILED_BY_SUPPLIER'],
  'CN-1': ['matched', 'MATCHED_8A'],
  'INV-9': ['only_right', 'ONLY_8A_UNEXPLAINED'],
  'INV-10': ['only_right', 'ONLY_8A_UNEXPLAINED'],
  'INV-11': ['differs', 'AMENDED'],
};
for (const [n, [status, reason]] of Object.entries(expect2A)) {
  const r = a8.get(n);
  check('2A vs 8A', `${n}: ${status} / ${reason}`, r && r.status === status && r.reason === reason, r ? `${r.status} / ${r.reason}` : 'missing');
}
check('2A vs 8A', 'not in any 2B is confirmed once every 2B of the year is pulled', a8.get('INV-7')?.confirmed === true);
check('2A vs 8A', 'the difference is 8A minus 2A, signed', near(a8.get('INV-2').diff.tax, -180), a8.get('INV-2')?.diff.tax);
check('2A vs 8A', 'the notes say which 8A was compared', run2A.result.notes[0].startsWith("8A: the portal's Table 8A document details"), run2A.result.notes[0]);

// ── 2B vs 8A ────────────────────────────────────────────────────────────────
const run2B = R.reconcileFyPair('2B', st, client, TODAY);
const b8 = byNum(run2B.result.rows);
const expect2B = {
  'INV-1': ['matched', 'MATCHED_8A'],
  'INV-2': ['differs', 'VALUE_DIFFERENCE'],
  'INV-3': ['only_left', 'RCM_NOT_IN_8A'],
  'INV-4': ['only_left', 'REJECTED_NOT_IN_8A'],
  'INV-5': ['only_left', 'ITC_NA_NOT_IN_8A'],
  'INV-6': ['only_left', 'AFTER_8A_WINDOW'],
  'CN-1': ['matched', 'MATCHED_8A'],
  '1234567': ['not_compared', 'NOT_IN_8A_SECTION'],
  'INV-9': ['matched', 'MATCHED_8A'],
  'INV-10': ['only_right', 'ONLY_8A_UNEXPLAINED'],
  'INV-11': ['matched', 'AMENDED'],
  'INV-12': ['only_left', 'REVERSAL_NOT_IN_8A'],
};
for (const [n, [status, reason]] of Object.entries(expect2B)) {
  const r = b8.get(n);
  check('2B vs 8A', `${n}: ${status} / ${reason}`, r && r.status === status && r.reason === reason, r ? `${r.status} / ${r.reason}` : 'missing');
}
check('2B vs 8A', '2A-only documents do not appear', !b8.has('INV-7') && !b8.has('INV-8'));
check('2B vs 8A', 'a credit note counts negative', near(b8.get('CN-1').left.igst + b8.get('CN-1').left.cgst, 90) && R.amountsOf(b8.get('CN-1').left).tax === -180);

// ── Three-way and the final ITC ─────────────────────────────────────────────
const three = R.reconcileThreeWay(st);
const t3 = new Map(three.rows.map((r) => [(r.b ?? r.e ?? r.a).number, r]));
const expect3 = {
  'INV-1': ['in_all', 'eligible', 1800],
  'INV-2': ['in_all_differs', 'eligible', 900],
  'INV-3': ['not_in_8a', 'rcm', 0],
  'INV-4': ['not_in_8a', 'rejected', 0],
  'INV-5': ['not_in_8a', 'itc_na', 0],
  'INV-6': ['not_in_8a', 'time_barred', 0],
  'INV-7': ['only_2a', 'not_in_2b', 0],
  'INV-8': ['only_2a', 'not_filed', 0],
  'CN-1': ['in_all', 'eligible', -180],
  '1234567': ['outside_8a', 'eligible_outside_8a', 9000],
  'INV-9': ['not_in_2a', 'eligible', 720],
  'INV-10': ['only_8a', 'to_confirm', 0],
  'INV-11': ['in_all_differs', 'eligible', 216],
  'INV-12': ['only_2b', 'reverse_37a', -90],
};
for (const [n, [status, verdict, tax]] of Object.entries(expect3)) {
  const r = t3.get(n);
  check('three-way', `${n}: ${status} / ${verdict} / final ${tax}`, r && r.status === status && r.verdict === verdict && near(r.final.tax, tax), r ? `${r.status} / ${r.verdict} / ${r.final.tax}` : 'missing');
}
check('three-way', 'one row per document of the year (14)', three.rows.length === 14, three.rows.length);
const lines = R.judgement(three, st, { igst: 1400, cgst: 1073, sgst: 1073, cess: 0 });
const L = (k) => lines.find((l) => l.key === k);
check('final ITC', 'A eligible B2B = 3456', near(L('A').amounts.tax, 3456), L('A').amounts.tax);
check('final ITC', 'B outside 8A = 9000 (imports)', near(L('B').amounts.tax, 9000), L('B').amounts.tax);
check('final ITC', 'C Rule 37A reversal = -90', near(L('C').amounts.tax, -90), L('C').amounts.tax);
check('final ITC', 'D final ITC = 12366 = A + B + C', near(L('D').amounts.tax, 12366) && L('D').kind === 'total', L('D').amounts.tax);
check('final ITC', 'D head by head: IGST 9630, CGST 1368, SGST 1368', near(L('D').amounts.igst, 9630) && near(L('D').amounts.cgst, 1368) && near(L('D').amounts.sgst, 1368), JSON.stringify(L('D').amounts));
check('final ITC', 'reverse charge apart: 3600', near(L('rcm').amounts.tax, 3600), L('rcm').amounts.tax);
check('final ITC', 'to confirm: INV-10, 270', near(L('to_confirm').amounts.tax, 270) && L('to_confirm').docs === 1);
check('final ITC', 'not available lines: rejected 540, ITC NA 360, time-barred 180, not in 2B 360, not filed 180',
  near(L('rejected').amounts.tax, 540) && near(L('itc_na').amounts.tax, 360) && near(L('time_barred').amounts.tax, 180) && near(L('not_in_2b').amounts.tax, 360) && near(L('not_filed').amounts.tax, 180));
check('final ITC', '8A (portal file) = 3546; A minus 8A = -90', near(L('8a').amounts.tax, 3546) && near(L('A_minus_8a').amounts.tax, -90), `${L('8a').amounts.tax} / ${L('A_minus_8a').amounts.tax}`);
check('final ITC', "the portal's computed 8A line is shown when pulled", near(L('8a_portal').amounts.tax, 3546));

const t3Table = R.threeWayReportTable(three, st, { client, portal8A: null });
const finalCol = t3Table.headers.indexOf('Final Total ITC');
const totalRow = t3Table.rows[t3Table.rows.length - 1];
check('three-way table', 'TOTAL of the Final Total ITC column = final ITC', near(totalRow[finalCol], 12366), totalRow[finalCol]);
check('three-way table', 'column groups span every header', t3Table.columnGroups.reduce((s, g) => s + g.span, 0) === t3Table.headers.length && t3Table.headerLabels.length === t3Table.headers.length && t3Table.columnWidths.length === t3Table.headers.length);
check('three-way table', 'every row as wide as the headers', t3Table.rows.every((r) => r.length === t3Table.headers.length));
check('three-way table', 'a Final ITC sheet, By supplier and Notes', ['Final ITC', 'By supplier', 'Notes and evidence'].every((n) => t3Table.extraSheets.some((s) => s.name === n)));
check('three-way table', 'summary TOTAL counts every document', t3Table.summary.rows[t3Table.summary.rows.length - 1][3] === 14);
check('three-way table', 'KPI final ITC', t3Table.kpis.find((k) => k.label.startsWith('Final ITC')).value === 12366);

// ── Pair tables ─────────────────────────────────────────────────────────────
const p2A = R.fyPairTable(run2A, client, 'GSTR-2A vs GSTR-8A Reconciliation');
check('pair tables', '2A vs 8A keeps Status, Reason and the difference header', ['Status', 'Reason', R.diffHeader('2A', '8A')].every((h) => p2A.headers.includes(h)), p2A.headers.join('|'));
check('pair tables', 'named by the year', p2A.meta.find((m) => m.label === 'Period').value === `FY ${FY}` && p2A.fileNameBase.endsWith(`FY_${FY}`) && p2A.reco.fy === FY);
check('pair tables', 'rows sit under their document month', p2A.reco.rows.find((r) => r.number.startsWith('INV-5')).period === '09/2025');
check('pair tables', 'notes are not prefixed by a month', p2A.summary.notes.every((n) => !/^Mar 2026:/.test(n)));
check('pair tables', 'the merge hook rebuilds the year', p2A.merge([p2A], ['03/2026']).reco.fy === FY);

// ── 8A rebuilt from the year's 2B ───────────────────────────────────────────
const stR = R.assembleFy({ fy: FY, rows: rowsOf({ with8A: false }), today: TODAY });
check('rebuilt 8A', 'origin rebuilt, basis 2B', stR.eightA.origin === 'rebuilt' && stR.eightA.basis === '2B');
const rb = new Set(stR.eightA.docs.map((d) => d.number));
check('rebuilt 8A', 'holds ITC-available B2B family of the window only', ['INV-1', 'INV-2', 'CN-1', 'INV-9', 'INV-11'].every((n) => rb.has(n)) && ['INV-3', 'INV-4', 'INV-5', 'INV-6', 'INV-12', '1234567', 'INV-10'].every((n) => !rb.has(n)), [...rb].join(','));
const runR = R.reconcileFyPair('2B', stR, client, TODAY);
check('rebuilt 8A', '2B vs rebuilt 8A: INV-2 matches (same source)', byNum(runR.result.rows).get('INV-2').status === 'matched');
check('rebuilt 8A', 'the notes say it is rebuilt', runR.result.notes[0].startsWith('8A: not pulled or uploaded, so rebuilt'));

// ── A 2B not pulled ─────────────────────────────────────────────────────────
const stM = R.assembleFy({ fy: FY, rows: rowsOf({ drop2B: ['02/2026'] }), today: TODAY });
check('2B not pulled', 'Feb 2026 2B is missing', stM.twoB.missing.join() === '02/2026', stM.twoB.missing.join());
const a8M = byNum(R.reconcileFyPair('2A', stM, client, TODAY).result.rows);
check('2B not pulled', '2A vs 8A: INV-7 not confirmed, 2B not pulled', a8M.get('INV-7').reason === 'TWO_B_NOT_PULLED' && a8M.get('INV-7').confirmed === false, a8M.get('INV-7').reason);
const t3M = new Map(R.reconcileThreeWay(stM).rows.map((r) => [(r.b ?? r.e ?? r.a).number, r]));
check('2B not pulled', 'three-way: INV-7 to confirm, never refused', t3M.get('INV-7').verdict === 'to_confirm', t3M.get('INV-7').verdict);
let threw = '';
try { R.reconcileFyPair('2A', R.assembleFy({ fy: FY, rows: [], today: TODAY }), client, TODAY); } catch (e) { threw = e.message; }
check('2B not pulled', 'nothing pulled: a plain message naming Pull', /No GSTR-2A of FY 2025-26/.test(threw) && /Pull/.test(threw), threw);

// ── 8A variants: a statement not pulled, a document 8A lacks or holds without ITC ──
const runs = [run2A, run2B, runR];
const variant = (docs, generatedOn, more = {}) => R.assembleFy({
  fy: FY, today: TODAY,
  rows: [...rowsOf({ with8A: false, ...more }), { source: '8A', period: '03/2026', status: 'Uploaded', summary: { ...stored8A, generatedOn, docs }, updatedAt: '2026-12-01T05:00:00Z' }],
});
const no1 = stored8A.docs.filter((d) => d.number !== 'INV-1');
const v1 = variant(no1, '2026-11-25');
const v1a = byNum(R.reconcileFyPair('2A', v1, client, TODAY).result.rows);
const v1b = byNum(R.reconcileFyPair('2B', v1, client, TODAY).result.rows);
check('8A variants', '2A vs 8A: in a 2B with ITC, not in 8A', v1a.get('INV-1').reason === 'IN_2B_NOT_IN_8A', v1a.get('INV-1').reason);
check('8A variants', '2B vs 8A: not in 8A, no reason found', v1b.get('INV-1').reason === 'ONLY_LEFT_8A_UNEXPLAINED', v1b.get('INV-1').reason);
const v2 = variant(no1, '2025-06-01');
const v2b = byNum(R.reconcileFyPair('2B', v2, client, TODAY).result.rows);
check('8A variants', '2B vs 8A: the 8A is older than that 2B', v2b.get('INV-1').reason === 'EIGHT_A_BEFORE', v2b.get('INV-1').reason);
const v3 = variant([...stored8A.docs, d8('B2B', B, 'INV-4', '2025-08-01', inter(3000))], '2026-11-25');
const v3b = byNum(R.reconcileFyPair('2B', v3, client, TODAY).result.rows);
check('8A variants', '2B vs 8A: 8A holds what the 2B rejected: ITC differs', v3b.get('INV-4').status === 'itc_differs' && v3b.get('INV-4').reason === 'EIGHT_A_HOLDS_NO_ITC', `${v3b.get('INV-4').status} ${v3b.get('INV-4').reason}`);
const v4 = variant(stored8A.docs, '2026-11-25', { drop2A: ['12/2025'], drop2B: ['03/2026'] });
const v4run = R.reconcileFyPair('2A', v4, client, TODAY);
const v4a = byNum(v4run.result.rows);
const v4bRun = R.reconcileFyPair('2B', v4, client, TODAY);
const v4b = byNum(v4bRun.result.rows);
check('8A variants', '2A vs 8A: the 2A of its month is not pulled', v4a.get('INV-9').reason === 'EIGHT_A_2A_NOT_PULLED' && v4a.get('INV-9').confirmed === false, v4a.get('INV-9').reason);
check('8A variants', '2B vs 8A: the 2B that holds it is not pulled', v4b.get('INV-10').reason === 'EIGHT_A_2B_NOT_PULLED', v4b.get('INV-10').reason);
runs.push(R.reconcileFyPair('2A', v1, client, TODAY), R.reconcileFyPair('2B', v1, client, TODAY), R.reconcileFyPair('2B', v2, client, TODAY), R.reconcileFyPair('2B', v3, client, TODAY), v4run, v4bRun);
const seen8 = new Set(runs.flatMap((r) => r.result.rows.map((x) => x.reason)));
const used = [...new Set([...R.RULES_2A_8A, ...R.RULES_2B_8A].map((r) => r.code))].filter((c) => !['STALE_2A', 'TWO_A_INCOMPLETE', 'DATE_DIFFERS', 'EIGHT_A_BEFORE'].includes(c) || seen8.has(c));
check('coverage', 'every 8A rule code came out at least once (bar the 2A pull ones)', used.every((c) => seen8.has(c)), 'missing: ' + used.filter((c) => !seen8.has(c)).join(', '));

// ── The year still open ─────────────────────────────────────────────────────
const stO = R.assembleFy({ fy: FY, rows: rowsOf().filter((r) => r.source !== '2B' || R.isDue('2B', r.period, '2026-06-20')), today: '2026-06-20' });
check('open year', '2Bs of Jun to Oct 2026 not due (May 2026 is out on 14 Jun)', stO.twoB.notDue.join() === ['06/2026', '07/2026', '08/2026', '09/2026', '10/2026'].join(), stO.twoB.notDue.join());
const t3O = new Map(R.reconcileThreeWay(stO).rows.map((r) => [(r.b ?? r.e ?? r.a).number, r]));
check('open year', 'INV-7 to confirm while later 2Bs are not out', t3O.get('INV-7').verdict === 'to_confirm', t3O.get('INV-7').verdict);

// ── The portal 8A file ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Goods and Services Tax - GSTR-9 Table 8A document details'], [],
  ['Financial Year', '', '2025-26'], ['GSTIN', '', CLIENT.gstin], ['Legal Name', '', CLIENT.name], ['Date of generation', '', '25/11/2026'],
]), 'Read me');
const head1 = ['GSTIN of supplier', 'Trade/Legal name', 'Invoice details', '', '', '', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value (₹)', 'Tax Amount', '', '', '', 'GSTR-1/IFF/GSTR-5 Period', 'GSTR-1/IFF/GSTR-5 Filing Date', 'ITC Availability', 'Reason'];
const head2 = ['', '', 'Invoice number', 'Invoice type', 'Invoice Date', 'Invoice Value(₹)', '', '', '', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)', '', '', '', ''];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head1, head2,
  [A, 'ALPHA', 'INV-1', 'Regular', '10/05/2025', 11800, '24-Gujarat', 'No', 10000, 0, 900, 900, 0, "May'25", '10/06/2025', 'Yes', ''],
  [B, 'BETA', 'INV-9', 'Regular', '12/12/2025', 4720, '27-Maharashtra', 'No', 4000, 720, 0, 0, 0, "Dec'25", '10/01/2026', 'Yes', ''],
]), 'B2B');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['GSTIN of supplier', 'Trade/Legal name', 'Original invoice number', 'Original invoice date', 'Invoice number', 'Invoice Date', 'Invoice Value(₹)', 'Taxable Value (₹)', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)'],
  [A, 'ALPHA', 'INV-11', '15/04/2025', 'INV-11', '15/04/2025', 1416, 1200, 0, 108, 108, 0],
]), 'B2BA');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['GSTIN of supplier', 'Trade/Legal name', 'Note number', 'Note type', 'Note date', 'Note Value(₹)', 'Taxable Value (₹)', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)'],
  [A, 'ALPHA', 'CN-1', 'Credit Note', '20/10/2025', -1180, -1000, 0, -90, -90, 0],
]), 'CDNR');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['GSTIN of ECO', 'Trade name'], ['24AAAAE0000E1Z1', 'ECO']]), 'ECO');
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const parsed = R.parse8AFile(new Uint8Array(buf), 'test8a.xlsx');
const ps = parsed.stored;
check('8A file', 'reads the header: FY, GSTIN, date of generation', ps.fy === FY && ps.gstin === CLIENT.gstin && ps.generatedOn === '2026-11-25', JSON.stringify([ps.fy, ps.gstin, ps.generatedOn]));
check('8A file', 'reads B2B, B2BA (no band: original from its columns) and CDNR', ps.docs.length === 4 && ps.sheetsRead.join() === 'B2B,B2BA,CDNR', `${ps.docs.length} ${ps.sheetsRead.join()}`);
const amd = ps.docs.find((d) => d.section === 'B2BA');
check('8A file', 'the amendment keeps its original', amd && amd.originalNumber === 'INV-11' && amd.originalDate === '2025-04-15' && near(amd.cgst, 108), JSON.stringify(amd));
const cn = ps.docs.find((d) => d.section === 'CDNR');
check('8A file', 'a credit note printed with minus amounts is the note, positive', cn && cn.family === 'CN' && near(cn.taxable, 1000) && near(cn.cgst, 90), JSON.stringify(cn));
check('8A file', 'period and filing date read', ps.docs[0].supplierPeriod === '05/2025' && ps.docs[0].supplierFiledOn === '2025-06-10' && ps.docs[0].pos === '24', JSON.stringify(ps.docs[0]));
check('8A file', 'a sheet not read is named', ps.unread.includes('ECO'), ps.unread.join());
const ok8A = R.check8AUpload(parsed, { gstin: CLIENT.gstin, fy: FY }, { at: '2026-12-01T05:00:00Z', name: 'Tester' });
check('8A upload', 'accepted for its own client and year', ok8A._format === R.EIGHT_A_FORMAT && ok8A.fy === FY && ok8A.uploadedBy === 'Tester');
let wrong = '';
try { R.check8AUpload(parsed, { gstin: '24ZZZZZ9999Z1Z9', fy: FY }, { at: '', name: null }); } catch (e) { wrong = e.message; }
check('8A upload', 'another GSTIN is refused', /is for GSTIN/.test(wrong), wrong);
wrong = '';
try { R.check8AUpload(parsed, { gstin: CLIENT.gstin, fy: '2024-25' }, { at: '', name: null }); } catch (e) { wrong = e.message; }
check('8A upload', 'another year is refused', /is for FY 2025-26, not FY 2024-25/.test(wrong), wrong);
const stU = R.assembleFy({ fy: FY, rows: [...rowsOf({ with8A: false }), { source: '8A', period: '03/2026', status: 'Uploaded', summary: ok8A, updatedAt: '2026-12-01T05:00:00Z' }], today: TODAY });
check('8A upload', 'an uploaded file is read back as the portal 8A', stU.eightA.origin === 'portal' && stU.eightA.docs.length === 4);
check('8A file', 'a JSON in the 2B layout is read too', R.parse8AFile(new TextEncoder().encode(JSON.stringify(summary2B('05/2025', '14-06-2025', dd['05/2025']))), 'x.json').stored.docs.length === 1);

// ── Pull plan ───────────────────────────────────────────────────────────────
const plan1 = R.planFyPullJobs({ fys: [FY], rows: rowsOf({ drop2B: ['02/2026'], drop2A: ['05/2025'] }), calcPulled: new Set(), today: TODAY, extVersion: '0.17.0' });
check('pull plan', 'asks only what is missing, in one combined job', plan1.jobs.length === 1 && plan1.jobs[0].mode === 'gstr2a2b_pull' && plan1.jobs[0].periods.join() === '05/2025,02/2026'
  && plan1.jobs[0].want['05/2025'].join() === '2A' && plan1.jobs[0].want['02/2026'].join() === '2B', JSON.stringify(plan1));
const plan2 = R.planFyPullJobs({ fys: [FY], rows: rowsOf(), calcPulled: new Set(), today: TODAY, extVersion: '0.17.0' });
check('pull plan', 'nothing missing: the GSTR-9 system figures', plan2.jobs[0]?.mode === 'gstr9_pull' && plan2.jobs[0].periods.join() === '03/2026', JSON.stringify(plan2));
check('pull plan', 'describeJob names a GSTR-9 job', /GSTR-9 system figures/.test(R.describeJob(plan2.jobs[0])), R.describeJob(plan2.jobs[0]));
const plan3 = R.planFyPullJobs({ fys: [FY], rows: rowsOf(), calcPulled: new Set([FY]), today: TODAY, extVersion: '0.12.0' });
check('pull plan', 'everything pulled, old extension: 2A and 2B of the last six months again, one type per job', plan3.jobs.length === 2 && plan3.jobs[0].mode === 'gstr2a_pull' && plan3.jobs[0].periods.length === 6, JSON.stringify(plan3));

// ── The 8A pulled by the extension (0.18.0, gstk-8a-pull-v1) ─────────────────
const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const pulled = (files, extra = {}) => ({ _format: R.EIGHT_A_PULL_FORMAT, fp: '032026', gstin: CLIENT.gstin, fy: FY, pulledAt: '2026-12-02T05:00:00Z', files, json: [], read: 'test', ...extra });
const pX = await R.read8APull(pulled([{ name: 'GSTR9_8A.xlsx', dataUrl: dataUrl(XLSX_MIME, new Uint8Array(buf)), via: 'page', at: '' }]), { gstin: CLIENT.gstin, fy: FY });
check('8A pulled', 'the Excel the portal gave is read with the Upload reader', pX.stored && pX.stored.docs.length === 4 && pX.stored.via === 'pull' && pX.stored.fy === FY && pX.stored.uploadedAt === '2026-12-02T05:00:00Z', JSON.stringify(pX.problems));
const zip = new JSZip();
zip.file('8A_part1.xlsx', new Uint8Array(buf));
zip.file('8A_part2.xlsx', new Uint8Array(buf));
zip.file('readme.txt', 'x');
const zbytes = await zip.generateAsync({ type: 'uint8array' });
const pZ = await R.read8APull(pulled([{ name: '8A.zip', dataUrl: dataUrl('application/zip', zbytes), via: 'download', at: '' }]), { gstin: CLIENT.gstin, fy: FY });
check('8A pulled', 'a ZIP of Excel parts: every part read, a document in two parts counted once', pZ.stored && pZ.stored.docs.length === 4 && /8A_part1\.xlsx, 8A_part2\.xlsx/.test(pZ.stored.fileName), JSON.stringify([pZ.stored?.docs.length, pZ.stored?.fileName, pZ.problems]));
const pJ = await R.read8APull(pulled([], { json: [{ url: '/returns2/auth/api/gstr9/x', body: { status: 1, data: summary2B('05/2025', '14-06-2025', dd['05/2025']) } }] }), { gstin: CLIENT.gstin, fy: FY });
check('8A pulled', 'a JSON with documents the page loaded is read too', pJ.stored && pJ.stored.docs.length === 1, JSON.stringify(pJ.problems));
const pW = await R.read8APull(pulled([{ name: 'x.xlsx', dataUrl: dataUrl(XLSX_MIME, new Uint8Array(buf)), via: 'page', at: '' }]), { gstin: '24ZZZZZ9999Z1Z9', fy: FY });
check('8A pulled', "another GSTIN's file is refused (the 8A is rebuilt)", pW.stored === null && /is for GSTIN/.test(pW.problems.join()), JSON.stringify(pW));
const pE = await R.read8APull(pulled([], { empty: true }), { gstin: CLIENT.gstin, fy: FY });
check('8A pulled', 'the portal saying there is none: an empty 8A', pE.stored && pE.stored.docs.length === 0);
const pBad = await R.read8APull(pulled([{ name: 'bad.zip', dataUrl: dataUrl('application/zip', await (() => { const z = new JSZip(); z.file('a.txt', 'x'); return z.generateAsync({ type: 'uint8array' }); })()), via: 'page', at: '' }]), { gstin: CLIENT.gstin, fy: FY });
check('8A pulled', 'a file with nothing readable: refused with the reason', pBad.stored === null && /holds no Excel or JSON/.test(pBad.problems.join()), JSON.stringify(pBad));
const stP = R.assembleFy({ fy: FY, rows: [...rowsOf({ with8A: false }), { source: '8A', period: '03/2026', status: 'Pulled', summary: pX.stored, updatedAt: '2026-12-02T05:00:00Z' }], today: TODAY });
check('8A pulled', 'read back as the portal 8A, said to be pulled', stP.eightA.origin === 'portal' && stP.eightA.docs.length === 4 && /pulled from the portal/.test(R.reconcileThreeWay(stP).notes[0]), R.reconcileThreeWay(stP).notes[0]);
const stQ = R.assembleFy({ fy: FY, rows: [...rowsOf({ with8A: false }), { source: '8A', period: '03/2026', status: 'REQUESTED: the portal said: "request accepted"', summary: {}, updatedAt: '2026-12-02T05:00:00Z' }], today: TODAY });
check('8A pulled', 'a pull the portal is still preparing: rebuilt, and the notes say so', stQ.eightA.origin === 'rebuilt' && R.reconcileThreeWay(stQ).notes.some((n) => /^The portal's 8A: REQUESTED/.test(n)), JSON.stringify(R.reconcileThreeWay(stQ).notes.slice(0, 3)));
check('8A pulled', 'has8A: an upload, a pulled file or an empty pull; not a failed or requested one',
  R.has8A({ source: '8A', summary: ok8A }) && R.has8A({ source: '8A', summary: pulled([{ name: 'x', dataUrl: 'data:x;base64,UEsDB', via: 'page', at: '' }]) }) && R.has8A({ source: '8A', summary: pulled([], { empty: true }) })
  && !R.has8A({ source: '8A', summary: {} }) && !R.has8A(undefined));

// ── Pull plan with the 8A pull ─────────────────────────────────────────────
const p8a = R.planFyPullJobs({ fys: [FY], rows: rowsOf({ with8A: false }), calcPulled: new Set(), eightAHave: new Set(), today: TODAY, extVersion: '0.18.0' });
check('pull plan 8A', 'everything else pulled, no 8A: the 8A first, then the GSTR-9 system figures', p8a.jobs.map((j) => j.mode).join() === 'gstr9_8a_pull,gstr9_pull' && p8a.jobs[0].periods.join() === '03/2026', JSON.stringify(p8a));
check('pull plan 8A', 'describeJob names the 8A job', /Table 8A document details of the year ending Mar 2026/.test(R.describeJob(p8a.jobs[0])), R.describeJob(p8a.jobs[0]));
const p8b = R.planFyPullJobs({ fys: [FY], rows: rowsOf({ with8A: false, drop2B: ['02/2026'] }), calcPulled: new Set(), eightAHave: new Set(), today: TODAY, extVersion: '0.18.0' });
check('pull plan 8A', 'a 2B missing: that first, the 8A after', p8b.jobs.map((j) => j.mode).join() === 'gstr2a2b_pull,gstr9_8a_pull' && p8b.jobs[0].periods.join() === '02/2026', JSON.stringify(p8b));
const p8c = R.planFyPullJobs({ fys: [FY], rows: rowsOf({ with8A: false }), calcPulled: new Set(), eightAHave: new Set(), today: TODAY, extVersion: '0.17.0' });
check('pull plan 8A', 'extension 0.17.0: the plan as before, with a note to update or upload', JSON.stringify(p8c.jobs) === JSON.stringify(plan2.jobs) && /Extension 0\.18\.0 pulls the 8A/.test(p8c.note), JSON.stringify(p8c));
const p8d = R.planFyPullJobs({ fys: [FY], rows: rowsOf(), calcPulled: new Set(), eightAHave: new Set([FY]), today: TODAY, extVersion: '0.18.0' });
check('pull plan 8A', 'the 8A saved: the plan as before', JSON.stringify(p8d) === JSON.stringify(plan2), JSON.stringify(p8d));
const p8e = R.planFyPullJobs({ fys: [FY], rows: rowsOf({ with8A: false }), calcPulled: new Set(), eightAHave: new Set(), today: '2026-03-20', extVersion: '0.18.0' });
check('pull plan 8A', 'the year not ended: no 8A asked', !p8e.jobs.some((j) => j.mode === 'gstr9_8a_pull'), JSON.stringify(p8e));

// ── Catalogue ───────────────────────────────────────────────────────────────
const codes = ['RCM_NOT_IN_8A', 'REJECTED_NOT_IN_8A', 'ITC_NA_NOT_IN_8A', 'REVERSAL_NOT_IN_8A', 'AFTER_8A_WINDOW', 'NOT_IN_ANY_2B', 'TWO_B_NOT_PULLED', 'EIGHT_A_BEFORE', 'IN_2B_NOT_IN_8A', 'NOT_IN_8A_SECTION', 'ONLY_LEFT_8A_UNEXPLAINED', 'EIGHT_A_2A_NOT_PULLED', 'EIGHT_A_2B_NOT_PULLED', 'ONLY_8A_UNEXPLAINED', 'EIGHT_A_HOLDS_NO_ITC', 'MATCHED_8A'];
check('catalogue', 'every 8A reason has a label and an action, no "total" in a label', codes.every((c) => R.REASONS[c]?.label && R.REASONS[c]?.action && !/total/i.test(R.REASONS[c].label)));
check('catalogue', 'rule sets are filled', R.RULES_2A_8A.length > 5 && R.RULES_2B_8A.length > 5);

// ── Report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
