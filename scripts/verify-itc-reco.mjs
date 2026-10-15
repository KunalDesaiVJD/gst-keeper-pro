#!/usr/bin/env node
// Golden test for the GSTR-2A vs GSTR-2B reconciliation (src/lib/itcReco).
//
//   node scripts/verify-itc-reco.mjs
//
// Builds the pure engine with esbuild (the Supabase client is stubbed: nothing
// here touches a database), feeds it the fictional July 2026 fixture in
// scripts/fixtures/itcRecoFixture.mjs (the shapes the extension saves) and
// checks every reason, both directions, the neighbouring-statement variants,
// value differences, amendments, duplicates, empty inputs, the totals, the
// view model (signed rows, aggregates), the report layout (stat band, document
// list, summary, analysis sheets), the multi-month merge, the view's filters
// (facets, counts, presets, the filter line of an export), the 2A credit notes
// and the Pull plan.
// Prints a pass / fail table; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

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
      export * from './src/lib/itcReco/dates';
      export * from './src/lib/itcReco/sources';
      export * from './src/lib/itcReco/engine';
      export * from './src/lib/itcReco/reasons';
      export * from './src/lib/itcReco/table';
      export { STATUS_ORDER } from './src/lib/itcReco/types';
      export { buildForPeriods, mergeRows } from './src/lib/reportPeriodMerge';
      export { flattenGstr2bDocs } from './src/utils/filedReturnReports';
      export * as V from './src/lib/itcReco/viewModel';
      export * as Fl from './src/lib/itcReco/filters';
      export { planPullJobs, describeJob } from './src/utils/gstr2aVs2bReports';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'error',
  loader: { '.png': 'dataurl' },
  // SheetJS (bundled through allClientsReports) requires Node built-ins at run time.
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const F = await import(pathToFileURL(path.join(root, 'scripts', 'fixtures', 'itcRecoFixture.mjs')).href);

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const near = (a, b) => Math.abs(a - b) < 0.005;
const run = (opts = {}, today = F.TODAY) => R.reconcile2A2B({ period: F.PERIOD, client: F.CLIENT, rows: F.julyRows(opts), today });
const findRowFor = (result, key) => {
  const right = key.startsWith('2B:');
  const num = right ? key.slice(3) : key;
  return result.rows.filter((r) => (right ? !r.left && r.right?.number === num : r.left?.number === num));
};
const show = (r) => r ? `${r.status}/${r.reason}${r.confirmed === false ? ' (not confirmed)' : r.confirmed ? ' (confirmed)' : ''} ${r.detail} | ${r.evidence} | notes ${r.notes.map((n) => n.code).join(',')}` : 'no row';
// The report: columns are found by header (the view and the exporters do the same).
const infoOf = (res, period = F.PERIOD) => ({ client: F.CLIENT, period, left: res.twoA, right: res.twoB });
const DIFF = R.diffHeader('2A', '2B');
const cell = (t, row, header) => row[t.headers.indexOf(header)];
const dataRows = (t) => t.rows.filter((r) => r[1] !== 'TOTAL');
const totalRow = (t) => t.rows[t.rows.length - 1];
const metaOf = (t, label) => t.meta?.find((f) => f.label === label)?.value;

// ── 20: dates ───────────────────────────────────────────────────────────────
check('dates', "parsePortalDate('11-Sep-25') = 2025-09-11", R.parsePortalDate('11-Sep-25') === '2025-09-11', R.parsePortalDate('11-Sep-25'));
check('dates', "parsePortalDate('14-08-2026') = 2026-08-14", R.parsePortalDate('14-08-2026') === '2026-08-14');
check('dates', "parsePortalDate('14/08/2026'), ISO, 'DD-Mon-YYYY'", R.parsePortalDate('14/08/2026') === '2026-08-14' && R.parsePortalDate('2026-08-14') === '2026-08-14' && R.parsePortalDate('11-Sep-2025') === '2025-09-11');
check('dates', 'parsePortalDate rejects 31-02-2026 and junk', R.parsePortalDate('31-02-2026') === null && R.parsePortalDate('abc') === null && R.parsePortalDate(null) === null);
check('dates', "parseSupplierPeriod('072026') = 07/2026", R.parseSupplierPeriod('072026') === '07/2026');
check('dates', "parseSupplierPeriod('Jul-26'), ('07/2026')", R.parseSupplierPeriod('Jul-26') === '07/2026' && R.parseSupplierPeriod('07/2026') === '07/2026' && R.parseSupplierPeriod('132026') === null);
const co = R.cutoffOf2B('07/2026', '2026-08-14');
check('dates', 'cut-off of Jul 2026: sure by 11 Aug, latest 13 Aug', co.sureBy === '2026-08-11' && co.latest === '2026-08-13', JSON.stringify(co));
const co2 = R.cutoffOf2B('12/2026', '2027-01-20');
check('dates', 'cut-off ignores a late 2B (Dec: generated 20 Jan, latest still 13 Jan)', co2.sureBy === '2027-01-11' && co2.latest === '2027-01-13', JSON.stringify(co2));

// ── Identity ────────────────────────────────────────────────────────────────
check('identity', "normDocNo('inv/0012') = normDocNo('INV12')", R.normDocNo('inv/0012') === R.normDocNo('INV12') && R.normDocNo('INV12') === 'INV12');
check('identity', "normDocNo('2026/0012') = normDocNo('2026-12'), not '202612' vs '20260012'", R.normDocNo('2026/0012') === R.normDocNo('2026-12'));
check('identity', 'normDocNo keeps a lone zero', R.normDocNo('A-0') === 'A0');

// ── 1: the 2B tax-key bug ───────────────────────────────────────────────────
const b07summary = F.julyRows().find((r) => r.source === '2B' && r.period === '07/2026').summary;
const flat = R.flattenGstr2bDocs(b07summary);
const fA = flat.find((d) => d.inum === 'A-101');
const fK = flat.find((d) => d.inum === 'K-1101');
check('case 1', 'flattenGstr2bDocs reads cgst/sgst (A-101: 900 / 900)', fA && fA.cgst === 900 && fA.sgst === 900, JSON.stringify(fA));
check('case 1', 'flattenGstr2bDocs reads igst (K-1101: 9090)', fK && fK.igst === 9090, JSON.stringify(fK));
const s2b = R.docsFrom2B(b07summary, '07/2026');
const a101 = s2b.docs.find((d) => d.number === 'A-101');
check('case 1', 'docsFrom2B: A-101 cgst 900 sgst 900', a101 && a101.cgst === 900 && a101.sgst === 900);
const s2a = R.docsFrom2A(F.julyRows().find((r) => r.source === '2A' && r.period === '07/2026').summary, '07/2026');
const k2a = s2a.docs.find((d) => d.number === 'K-1101');
check('case 1', 'docsFrom2A: tax and taxable from itms only (K-1101: 50000 / 9000)', k2a && k2a.taxable === 50000 && k2a.igst === 9000, JSON.stringify(k2a && { t: k2a.taxable, i: k2a.igst }));
check('case 1', "docsFrom2A: 2A's DD-Mon-YY filing date read", s2a.docs.find((d) => d.number === 'A-101')?.supplierFiledOn === '2026-08-10');
check('adapters', '2B sections: unknown section listed, itcrev read as reversal, rejected container read', s2b.meta.sectionsUnknown.join() === 'xyz'
  && s2b.docs.find((d) => d.number === 'U-0201')?.bucket === 'reversal' && s2b.docs.find((d) => d.number === 'D-401')?.bucket === 'rejected');
check('adapters', '2A covers B2B only (sections read from the stored summary)', s2a.meta.sectionsRead.join() === 'B2B');
check('adapters', 'unreadable summaries give null', R.docsFrom2B({}, '07/2026') === null && R.docsFrom2A({ docdata: {} }, '07/2026') === null);

// ── Main scenario: every document ───────────────────────────────────────────
const main = run();
for (const [key, exp] of Object.entries(F.JULY_EXPECTED)) {
  const rows = findRowFor(main.result, key);
  const r = rows[0];
  let ok = rows.length === 1 && r.status === exp.status && r.reason === exp.reason;
  if (ok && 'confirmed' in exp) ok = r.confirmed === exp.confirmed;
  if (ok && exp.evidence) ok = r.evidence.includes(exp.evidence);
  if (ok && exp.detail) ok = r.detail.includes(exp.detail);
  if (ok && exp.notes) ok = exp.notes.every((n) => r.notes.some((x) => x.code === n));
  check('documents', `${key}: ${exp.status} / ${exp.reason}${'confirmed' in exp ? (exp.confirmed ? ' (confirmed)' : ' (not confirmed)') : ''}${exp.notes ? ' + ' + exp.notes.join(', ') : ''}`, ok, `${rows.length} row(s): ${show(r)}`);
}
// Duplicates: same date first, then the nearest taxable value.
const q1 = findRowFor(main.result, 'Q-1');
check('duplicates', 'Q-1 twice on each side: paired by date, both matched', q1.length === 2 && q1.every((r) => r.status === 'matched' && r.left.date === r.right.date), q1.map(show).join(' || '));
const q2 = findRowFor(main.result, 'Q-2');
const q2pair = q2.find((r) => r.right);
const q2alone = q2.find((r) => !r.right);
check('duplicates', 'Q-2 twice in 2A, once in 2B: pairs with the nearest value (900 vs 905)', q2pair && q2pair.left.taxable === 900 && q2pair.reason === 'VALUE_DIFFERENCE', show(q2pair));
check('duplicates', 'Q-2 left over (500): only in 2A', q2alone && q2alone.status === 'only_left' && q2alone.left.taxable === 500, show(q2alone));
check('case 12', 'K-1102 taxable differs by 0.40: matched within 1 rupee', findRowFor(main.result, 'K-1102')[0]?.diff.taxable === 0.4);
check('case 15', 'N-5 in two financial years: not paired', findRowFor(main.result, 'N-5').length === 1 && findRowFor(main.result, '2B:N-5').length === 1);
check('case 14', 'M-1301 paired with its B2BA amendment M-1301A', findRowFor(main.result, 'M-1301')[0]?.right?.number === 'M-1301A' && findRowFor(main.result, 'M-1301')[0]?.viaAmendment);
const cn = findRowFor(main.result, '2B:CN-1')[0];
const cnTable = cn && R.toReportTable({ ...main.result, rows: [cn] }, infoOf(main));
const cnRow = cnTable && cnTable.rows[0];
check('case 19', 'credit note: amounts negative in the table, kept out of the difference', cn && cn.diff.tax === 0
  && cell(cnTable, cnRow, '2B Total Tax') === -180 && cell(cnTable, cnRow, '2B Taxable Value') === -1000 && cell(cnTable, cnRow, DIFF) === '' && cell(cnTable, cnRow, 'Taxable Difference') === '',
  JSON.stringify(cnRow));

// Summary notes.
const notes = main.result.notes.join('\n');
check('notes', 'pending in IMS counted (5 documents)', /^5 documents filed in time are not in this 2B/m.test(notes), notes);
check('notes', 'not compared: 3 documents, sections named', /Not compared: 3 documents \(credit and debit notes, ISD credits, imports of goods\)/.test(notes), notes);
check('notes', '2A older than 15 days: pull it again', /2A pulled 20 Sep 2026; 2B generated 14 Aug 2026/.test(notes), notes);
check('notes', 'unknown 2B sections listed', /Sections in 2B this report does not read: xyz/.test(notes), notes);
check('notes', 'no em dash in any note or reason text', !/—/.test(notes) && !main.result.rows.some((r) => /—/.test(r.detail + r.evidence + r.action)));

// ── Variants: neighbouring statements ───────────────────────────────────────
const noAug = run({ b08: false });
const b201 = findRowFor(noAug.result, 'B-201')[0];
check('case 3', '2B of Aug not pulled: B-201 EXPECTED_NEXT_2B, not confirmed', b201?.reason === 'EXPECTED_NEXT_2B' && b201.confirmed === false && b201.evidence === '2B of Aug 2026 not pulled', show(b201));
check('case 3', 'note: 2B of Aug 2026 not pulled, 2 documents expected there', /2B of Aug 2026 not pulled\. 2 documents filed after the cut-off are expected there, not confirmed\. Pull it to confirm\./.test(noAug.result.notes.join('\n')), noAug.result.notes.join(' | '));
check('case 7', '2B of Aug not pulled: F-601 (filed on the 12th) becomes IMS_PENDING with the 12th/13th detail', findRowFor(noAug.result, 'F-601')[0]?.reason === 'IMS_PENDING' && /12th or 13th/.test(findRowFor(noAug.result, 'F-601')[0]?.detail));
check('case 14', '2B of Aug not pulled: M-1302 is a value difference', findRowFor(noAug.result, 'M-1302')[0]?.reason === 'VALUE_DIFFERENCE');
const ng = run({ b08: 'not_generated' });
check('case 3', '2B of Aug not generated on the portal when last pulled', findRowFor(ng.result, 'B-201')[0]?.evidence === '2B of Aug 2026 not generated on the portal when last pulled', show(findRowFor(ng.result, 'B-201')[0]));
check('case 3', 'a 2B not generated is temporary: the note still says to pull it', /2B of Aug 2026 not generated on the portal when last pulled\..*Pull it to confirm\./.test(ng.result.notes.join('\n')), ng.result.notes.join(' | '));
const early = run({ b08: false, b09: false }, '2026-09-01');
check('case 3', 'before 14 Sep: 2B of Aug not generated yet', findRowFor(early.result, 'B-201')[0]?.evidence === '2B of Aug 2026 not generated yet (due 14 Sep 2026)', show(findRowFor(early.result, 'B-201')[0]));
check('case 6', '2B of Sep not pulled: E-501 falls back to IMS_PENDING', findRowFor(early.result, 'E-501')[0]?.reason === 'IMS_PENDING');
const noJun = run({ a06: false });
const h801 = findRowFor(noJun.result, '2B:H-801')[0];
check('case 9', '2A of Jun not pulled: EARLIER_PERIOD not confirmed', h801?.reason === 'EARLIER_PERIOD' && h801.confirmed === false && h801.evidence === '2A of Jun 2026 not pulled', show(h801));
check('case 9', 'note: 2A of Jun 2026 not pulled, 3 documents (late and in time)', /2A of Jun 2026 not pulled: 3 documents for Jun 2026 are not confirmed\./.test(noJun.result.notes.join('\n')), noJun.result.notes.join(' | '));
const stale = run({ twoAOpts: { updatedAt: '2026-08-09T05:00:00Z' } });
check('case 10', '2A pulled 9 Aug, supplier filed 11 Aug: STALE_2A', findRowFor(stale.result, '2B:J-901')[0]?.reason === 'STALE_2A', show(findRowFor(stale.result, '2B:J-901')[0]));
check('case 10', 'note: 2A pulled before the 2B was generated', /2A pulled 9 Aug 2026; 2B generated 14 Aug 2026/.test(stale.result.notes.join('\n')));
const failed = run({ meta2A: { counterparties: 19, failed: 1, failedCtins: [F.S.kappa] } });
check('case 11', 'supplier missing and 1 supplier failed: TWO_A_INCOMPLETE', findRowFor(failed.result, '2B:W-1001')[0]?.reason === 'TWO_A_INCOMPLETE', show(findRowFor(failed.result, '2B:W-1001')[0]));
check('case 11', 'note: the 2A pull failed for 1 supplier', /The 2A pull failed for 1 supplier: pull 2A again\./.test(failed.result.notes.join('\n')));
check('case 11', 'a supplier in the 2A is never TWO_A_INCOMPLETE (N-5)', findRowFor(failed.result, '2B:N-5')[0]?.reason === 'ONLY_2B_UNEXPLAINED');
const failedOther = run({ meta2A: { counterparties: 19, failed: 1, failedCtins: [F.S.delta] } });
check('case 11', 'failedCtins names another supplier: W-1001 (kappa) is not blamed on the failed pull', findRowFor(failedOther.result, '2B:W-1001')[0]?.reason === 'ONLY_2B_UNEXPLAINED', show(findRowFor(failedOther.result, '2B:W-1001')[0]));
const late37A = run({ twoAOpts: { updatedAt: '2027-10-05T05:00:00Z' } }, '2027-10-15');
const u1901late = findRowFor(late37A.result, 'U-1901')[0];
check('rule 37A', 'cfs3b N in a 2A pulled after 30 Sep of the next year: RULE_37A', u1901late?.notes.some((n) => n.code === 'RULE_37A') && !u1901late.notes.some((n) => n.code === 'SUPPLIER_3B_PENDING'), show(u1901late));
check('rule 37A', 'before that: only "not filed yet (as of the 2A pull)", no Rule 37A', findRowFor(main.result, 'U-1901')[0]?.notes.every((n) => n.code !== 'RULE_37A')
  && /not filed as of the 2A pull \(20 Sep 2026\)/.test(findRowFor(main.result, 'U-1901')[0]?.notes.map((n) => n.text).join()), show(findRowFor(main.result, 'U-1901')[0]));

// ── Findings of the review (one scenario each) ─────────────────────────────
const A = (ctin, name, filed, invs, extra) => F.sup2A(ctin, name, filed, invs, extra);
const meta0 = { counterparties: 0, failed: 0, failedCtins: [] };
const recoOf = (period, rows, today) => R.reconcile2A2B({ period, client: F.CLIENT, rows, today });
const one = (res, num, right = false) => res.result.rows.find((r) => (right ? !r.left && r.right?.number === num : r.left?.number === num));

// A late 2B generation date (an IMS recompute) does not move the cut-off.
{
  const rows = [
    F.row('2A', '07/2026', { b2b: [A(F.S.alpha, 'ALPHA', '15-Aug-26', [F.inv2A('Z-1', '20-07-2026', F.intra(1000))])], _meta: meta0 }, { updatedAt: '2026-08-18T05:00:00Z' }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '18-08-2026', { b2b: [] })),
  ];
  const z = one(recoOf('07/2026', rows, '2026-08-18'), 'Z-1');
  check('findings', 'gendt 18 Aug: a document filed 15 Aug is expected in the Aug 2B, not "pending in IMS"', z?.reason === 'EXPECTED_NEXT_2B' && z.refPeriod === '08/2026' && !/12th or 13th/.test(z.detail), show(z));
}
// ITC reversal (Rule 37A) section: its own reason, negative, kept out of the Pull plan.
{
  const rows = [
    F.row('2A', '10/2026', { b2b: [], _meta: meta0 }),
    F.row('2B', '10/2026', F.summary2B('10/2026', '14-11-2026', { b2b: [], itcrev: [F.sup2B(F.S.alpha, 'ALPHA', '022026', '11-03-2026', [F.inv2B('R-1', '10-02-2026', F.inter(5000))])] })),
  ];
  const res = recoOf('10/2026', rows, '2026-11-20');
  const r1 = one(res, 'R-1', true);
  check('findings', 'reversal entry: ITC_REVERSAL, never "claim it", tax negative', r1?.reason === 'ITC_REVERSAL' && !/^Claim/.test(r1.action || R.REASONS[r1.reason].action) && r1.diff.tax === -900 && R.signedTax(r1.right) === -900, show(r1));
  const b = R.statementFromRow(rows[1], '2B', '10/2026');
  const plan = R.planPullJobs({ periods: ['10/2026'], rows, today: '2026-11-20', extVersion: '0.13.0' });
  check('findings', 'reversal entry: its month is not an earlier 2A to pull', R.earlierPeriodsOf(b, '10/2026').length === 0 && !plan.jobs[0].periods.includes('02/2026'), JSON.stringify(plan));
}
// A quarterly (QRMP) 2B: the 2A of the quarter's months, no "filed late".
const qRows = [
  F.row('2B', '07/2026', {}, { status: 'NOT GENERATED / NOT FOUND (no GSTR-2B tile)' }),
  F.row('2B', '08/2026', {}, { status: 'NOT GENERATED / NOT FOUND' }),
  F.row('2B', '09/2026', F.summary2B('09/2026', '14-10-2026', { b2b: [
    F.sup2B(F.S.alpha, 'ALPHA', '072026', '10-08-2026', [F.inv2B('A-7', '20-07-2026', F.intra(700))]),
    F.sup2B(F.S.alpha, 'ALPHA', '082026', '10-09-2026', [F.inv2B('A-8', '20-08-2026', F.intra(800))]),
    F.sup2B(F.S.alpha, 'ALPHA', '092026', '10-10-2026', [F.inv2B('A-9', '20-09-2026', F.intra(900))]),
  ] })),
  F.row('2A', '07/2026', { b2b: [A(F.S.alpha, 'ALPHA', '10-Aug-26', [F.inv2A('A-7', '20-07-2026', F.intra(700))])], _meta: meta0 }, { updatedAt: '2026-10-15T05:00:00Z' }),
  F.row('2A', '09/2026', { b2b: [A(F.S.alpha, 'ALPHA', '10-Oct-26', [F.inv2A('A-9', '20-09-2026', F.intra(900))]), A(F.S.beta, 'BETA', '20-Oct-26', [F.inv2A('B-10', '25-09-2026', F.intra(100))])], _meta: meta0 }, { updatedAt: '2026-10-21T05:00:00Z' }),
];
const qRes = recoOf('09/2026', qRows, '2026-10-21');
{
  const a7 = one(qRes, 'A-7');
  const a8 = one(qRes, 'A-8', true);
  const b10 = one(qRes, 'B-10');
  check('findings', 'quarterly 2B: A-7 (Jul) matched against the 2A of Jul', a7?.status === 'matched' && a7.right, show(a7));
  check('findings', 'quarterly 2B: A-8 (Aug, its 2A not pulled) is QUARTERLY_2B, not "filed late"', a8?.reason === 'QUARTERLY_2B' && a8.confirmed === false, show(a8));
  check('findings', 'quarterly 2B: no row says the supplier filed late', !qRes.result.rows.some((r) => r.reason === 'EARLIER_PERIOD'));
  check('findings', 'quarterly 2B: filed after the cut-off, expected in the next quarter\'s 2B (Dec)', b10?.reason === 'EXPECTED_NEXT_2B' && b10.refPeriod === '12/2026', show(b10));
  check('findings', 'quarterly 2B: the notes say so and name the 2A to pull', qRes.result.notes.some((n) => /^Quarterly \(QRMP\) 2B/.test(n) && /Aug 2026 not pulled/.test(n)) && !qRes.result.notes.some((n) => /2B of Oct 2026/.test(n)), qRes.result.notes.join(' | '));
  const qPlan = R.planPullJobs({ periods: ['09/2026'], rows: qRows, today: '2026-10-21', extVersion: '0.13.0' });
  check('findings', 'quarterly 2B: Pull asks the 2A of Aug, not the 2B of Oct', JSON.stringify(qPlan.jobs[0].want) === '{"08/2026":["2A"]}', JSON.stringify(qPlan));
}
// One month that cannot be built does not sink the others.
{
  const good = R.toReportTable(main.result, { client: F.CLIENT, period: '07/2026', left: main.twoA, right: main.twoB });
  const fake = { needs: 'client+month', build: async ({ month }) => { if (month === '04/2026') throw new Error('The portal had no GSTR-2B for Apr 2026.'); return { ...good }; } };
  const m = await R.buildForPeriods(fake, ['04/2026', '07/2026'], F.CLIENT.id);
  check('findings', 'several months: a month without a 2B shows its reason, the others are built', dataRows(m).length === main.result.rows.length && dataRows(m).every((r) => r[1] === 'Jul 2026')
    && m.rows.filter((r) => r[1] === 'TOTAL').length === 1 && m.summary.notes.some((n) => n === 'Apr 2026: Not built: The portal had no GSTR-2B for Apr 2026.') && metaOf(m, 'Not built') === 'Apr 2026', JSON.stringify(m.summary.notes));
  check('findings', 'several months: the subtitle keeps client and GSTIN, the month built its own pull dates', m.subtitle === 'Client: Fictional Fabrics Pvt Ltd   |   GSTIN: 24ABCDE1234F1Z5   |   Jul 2026   |   2A pulled 20 Sep 2026   |   2B generated 14 Aug 2026'
    && metaOf(m, '2A pulled') === '20 Sep 2026' && metaOf(m, '2B generated') === '14 Aug 2026' && m.fileNameBase.endsWith('_04-2026_2months'), `${m.subtitle} | ${JSON.stringify(m.meta)} | ${m.fileNameBase}`);
  let err = '';
  try { await R.buildForPeriods({ needs: 'client+month', build: async ({ month }) => { throw new Error(`none for ${month}`); } }, ['04/2026', '05/2026'], F.CLIENT.id); } catch (e) { err = e.message; }
  check('findings', 'several months, none built: one error naming each', err === '04/2026: none for 04/2026  05/2026: none for 05/2026', err);
}
// Document numbers keep the boundary between runs of digits; passes 2 and 3 need the same supplier period.
{
  check('findings', "normDocNo('1/23') is not normDocNo('12/3')", R.normDocNo('1/23') !== R.normDocNo('12/3'));
  const rows = [
    F.row('2A', '07/2026', { b2b: [A(F.S.alpha, 'ALPHA', '20-Aug-26', [F.inv2A('1/23', '25-07-2026', F.intra(1000)), F.inv2A('INV-5', '05-07-2026', F.intra(500))])], _meta: meta0 }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', { b2b: [F.sup2B(F.S.alpha, 'ALPHA', '062026', '20-07-2026', [F.inv2B('12/3', '28-06-2026', F.intra(1000)), F.inv2B('INV5', '05-07-2026', F.intra(500))])] })),
  ];
  const res = recoOf('07/2026', rows, F.TODAY);
  check('findings', "'1/23' (2A) and '12/3' (2B, for Jun) stay apart with their own reasons", one(res, '1/23')?.status === 'only_left' && one(res, '12/3', true)?.reason === 'EARLIER_PERIOD', res.result.rows.map(show).join(' || '));
  check('findings', "'INV-5' (2A, Jul) and 'INV5' (2B, for Jun) are not paired by the normalised pass", one(res, 'INV-5')?.status === 'only_left' && one(res, 'INV5', true)?.status === 'only_right');
}
// Paired through an amendment, same figures: AMENDED, not "same number, different date".
{
  const rows = [
    F.row('2A', '07/2026', { b2b: [A(F.S.alpha, 'ALPHA', '05-Aug-26', [F.inv2A('G-1', '05-07-2026', F.intra(1000))])], _meta: meta0 }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', { b2b: [], b2ba: [F.sup2B(F.S.alpha, 'ALPHA', '072026', '05-08-2026', [F.inv2B('G-1R', '06-07-2026', F.intra(1000), { oinum: 'G-1', oidt: '05-07-2026' })])] })),
  ];
  const g = one(recoOf('07/2026', rows, F.TODAY), 'G-1');
  check('findings', 'amendment with equal figures: AMENDED', g?.reason === 'AMENDED' && g.right?.number === 'G-1R', show(g));
}
// cfs Y without a filing date is filed: not "saved by the supplier".
{
  const rows = [
    F.row('2A', '07/2026', { b2b: [A(F.S.alpha, 'ALPHA', null, [F.inv2A('Y-1', '05-07-2026', F.intra(1000))], { cfs: 'Y' })], _meta: meta0 }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', { b2b: [] })),
  ];
  const y = one(recoOf('07/2026', rows, F.TODAY), 'Y-1');
  check('findings', "cfs Y, no date: not NOT_FILED_BY_SUPPLIER; 'filing date not shown'", y && y.reason !== 'NOT_FILED_BY_SUPPLIER' && /filing date not shown/.test(y.detail), show(y));
}
// An old extension's empty 2A (no _meta) is suspect: said so, and pulled again.
{
  const rows = [
    F.row('2A', '07/2026', { b2b: [] }, { status: 'NO DATA / NOT FOUND' }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', { b2b: [F.sup2B(F.S.alpha, 'ALPHA', '072026', '05-08-2026', [F.inv2B('E-1', '05-07-2026', F.intra(1000))])] })),
    F.row('2B', '08/2026', F.summary2B('08/2026', '14-09-2026', { b2b: [] })),
  ];
  const res = recoOf('07/2026', rows, F.TODAY);
  check('findings', 'old empty 2A: TWO_A_INCOMPLETE and a note to pull it again', one(res, 'E-1', true)?.reason === 'TWO_A_INCOMPLETE' && res.result.notes.some((n) => /before 0\.13\.0/.test(n)), show(one(res, 'E-1', true)));
  const plan = R.planPullJobs({ periods: ['07/2026'], rows, today: '2026-09-25', extVersion: '0.13.0' });
  check('findings', 'old empty 2A: Pull asks for it again', JSON.stringify(plan.jobs[0].want) === '{"07/2026":["2A"]}' && !plan.note, JSON.stringify(plan));
}
// The 2B's buckets beat a claim action.
{
  const rows = [
    F.row('2A', '08/2026', { b2b: [], _meta: meta0 }, { updatedAt: '2026-09-20T05:00:00Z' }),
    F.row('2B', '08/2026', F.summary2B('08/2026', '14-09-2026', { b2b: [
      F.sup2B(F.S.beta, 'BETA', '032024', '20-08-2026', [F.inv2B('C-1', '10-03-2024', F.intra(1000), { itcavl: 'N', rsn: 'C' })]),
    ] }, { docRejdata: { b2b: [F.sup2B(F.S.gamma, 'GAMMA', '072026', '05-08-2026', [F.inv2B('J-1', '20-07-2026', F.intra(1000), { imsStatus: 'R' })])] } })),
  ];
  const res = recoOf('08/2026', rows, F.TODAY);
  const j1 = one(res, 'J-1', true);
  const c1 = one(res, 'C-1', true);
  check('findings', 'rejected in IMS, only in 2B: IMS_REJECTED, "No ITC"', j1?.reason === 'IMS_REJECTED' && /^No ITC/.test(j1.action || R.REASONS.IMS_REJECTED.action), show(j1));
  check('findings', 'ITC not available (rsn C), for an earlier year: no claim action', c1 && !/^Claim/.test(c1.action) && /time limit has passed/.test(c1.action), show(c1) + ' | ' + c1?.action);
  check('findings', 'rejected and ITC-not-available documents ask for no earlier 2A (Jul)', !R.earlierPeriodsOf(R.statementFromRow(rows[1], '2B', '08/2026'), '08/2026').includes('07/2026'));
  const julRows = [
    F.row('2A', '07/2026', { b2b: [A(F.S.gamma, 'GAMMA', '05-Aug-26', [F.inv2A('J-1', '20-07-2026', F.intra(1000))])], _meta: meta0 }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', { b2b: [] })),
    rows[1],
  ];
  const jl = one(recoOf('07/2026', julRows, F.TODAY), 'J-1');
  check('findings', "2A-only, in a later 2B's rejected section: IMS_REJECTED, not 'accepted later'", jl?.reason === 'IMS_REJECTED' && jl.refPeriod === '08/2026', show(jl));
}
// Rejected at equal figures: "ITC differs"; the action starts with changing the IMS action.
{
  const d401 = one(main, 'D-401');
  check('findings', "D-401 rejected, same figures: status 'ITC differs', IMS action first", R.statusLabel(d401.status, '2A', '2B') === 'ITC differs' && /change the action to Accept in IMS/.test(R.REASONS.IMS_REJECTED.action), show(d401));
}
// A monthly supplier filing on the 12th: either 2B is checked before "no reason".
{
  const rows = [
    F.row('2A', '07/2026', { b2b: [A(F.S.alpha, 'ALPHA', '12-Sep-26', [F.inv2A('Y-2', '25-07-2026', F.intra(1000))])], _meta: meta0 }),
    F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', { b2b: [] })),
    F.row('2B', '08/2026', F.summary2B('08/2026', '14-09-2026', { b2b: [] })),
  ];
  const y2 = one(recoOf('07/2026', rows, '2026-10-20'), 'Y-2');
  check('findings', 'filed 12 Sep, not in the Aug 2B: expected in the Sep 2B (not "no reason")', y2?.reason === 'EXPECTED_NEXT_2B' && y2.refPeriod === '09/2026' && /not in the 2B of Aug 2026/.test(y2.detail), show(y2));
}
// The PDF prints no "Also note" column: the notes count the flags.
check('findings', 'flags counted in the notes (ITC not available, reverse charge)', main.result.notes.some((n) => /^Also note \(ITC not available: place of supply\): 2 documents/.test(n)) && main.result.notes.some((n) => /^Also note \(Reverse charge\): 1 document \(R-1601\)/.test(n)), main.result.notes.join(' | '));
// Pull: a 2B not generated waits; a stale 2A is refreshed meanwhile; the 2B is asked again once nothing else is missing.
{
  const a08 = F.row('2A', '08/2026', { b2b: [], _meta: meta0 }, { updatedAt: '2026-10-10T05:00:00Z' });
  const p1 = R.planPullJobs({ periods: ['07/2026', '08/2026'], rows: [...F.julyRows({ b08: 'not_generated' }), a08], today: F.TODAY, extVersion: '0.13.0' });
  check('findings', 'Pull: the stale Jul 2A is asked; the Aug 2B the portal did not generate is not asked again yet', JSON.stringify(p1.jobs[0].want) === '{"07/2026":["2A"]}', JSON.stringify(p1));
  const a08b = F.row('2A', '08/2026', { b2b: [], _meta: meta0 }, { updatedAt: '2026-09-24T05:00:00Z' });
  const p2 = R.planPullJobs({ periods: ['07/2026', '08/2026'], rows: [...F.julyRows({ b08: 'not_generated' }), a08b], today: '2026-09-25', extVersion: '0.13.0' });
  check('findings', 'Pull: nothing else missing, so the Aug 2B is asked again', JSON.stringify(p2.jobs[0].want) === '{"07/2026":["2A","2B"],"08/2026":["2A","2B"]}' && /again/.test(p2.note || ''), JSON.stringify(p2));
  const p3 = R.planPullJobs({ periods: ['07/2026'], rows: F.julyRows({ b08: 'not_generated' }), today: '2026-09-25', extVersion: '0.13.0' });
  check('findings', "Pull: next month's 2B not generated is re-checked on a refresh", JSON.stringify(p3.jobs[0].want) === '{"07/2026":["2A","2B"],"08/2026":["2B"]}' && /not generated/.test(p3.note || ''), JSON.stringify(p3));
}

// Every reason code of the 2A vs 2B set came out at least once.
const seen = new Set();
for (const res of [main, noAug, ng, early, noJun, stale, failed, late37A, qRes]) for (const r of res.result.rows) { seen.add(r.reason); r.notes.forEach((n) => seen.add(n.code)); }
const allCodes = Object.keys(R.REASONS);
const missing = allCodes.filter((c) => !seen.has(c));
check('coverage', `every reason and note code produced (${allCodes.length})`, missing.length === 0, 'missing: ' + missing.join(', '));

// ── Missing statements and empty inputs ────────────────────────────────────
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const rowsNo2B = F.julyRows().filter((r) => !(r.source === '2B' && r.period === '07/2026'));
const m1 = throws(() => R.reconcile2A2B({ period: F.PERIOD, client: F.CLIENT, rows: rowsNo2B, today: F.TODAY }));
check('missing', '2B of Jul not pulled: one message naming it, with Pull', m1 && /GSTR-2B of Jul 2026 is not pulled for Fictional Fabrics/.test(m1) && /Use Pull on this report/.test(m1), m1);
const rowsNg = [...rowsNo2B, F.row('2B', '07/2026', {}, { status: 'NOT GENERATED / NOT FOUND' })];
const m2 = throws(() => R.reconcile2A2B({ period: F.PERIOD, client: F.CLIENT, rows: rowsNg, today: F.TODAY }));
check('missing', '2B not generated: the QRMP message, no Pull', m2 && /quarterly \(QRMP\) taxpayer/.test(m2) && !/Use Pull/.test(m2), m2);
const m3 = throws(() => R.reconcile2A2B({ period: F.PERIOD, client: F.CLIENT, rows: [], today: F.TODAY }));
check('missing', 'nothing pulled: both named', m3 && /GSTR-2A of Jul 2026 is not pulled/.test(m3) && /GSTR-2B of Jul 2026 is not pulled/.test(m3), m3);
const emptyRows = [F.row('2A', '07/2026', { b2b: [] }, { status: 'NO DATA / NOT FOUND' }), F.row('2B', '07/2026', F.summary2B('07/2026', '14-08-2026', {}))];
const empty = R.reconcile2A2B({ period: F.PERIOD, client: F.CLIENT, rows: emptyRows, today: F.TODAY });
const emptyTable = R.toReportTable(empty.result, { client: F.CLIENT, period: F.PERIOD, left: empty.twoA, right: empty.twoB });
check('empty', 'empty 2A and 2B: no rows, a zero TOTAL in both parts', empty.result.rows.length === 0 && emptyTable.rows.length === 1 && emptyTable.rows[0][1] === 'TOTAL'
  && emptyTable.summary.rows.length === 1 && emptyTable.summary.rows[0][2] === 0);

// ── 21: totals ──────────────────────────────────────────────────────────────
const table = R.toReportTable(main.result, { title: 'GSTR-2A vs GSTR-2B Reconciliation', ...infoOf(main) });
const docTotal = totalRow(table);
const sumTotal = table.summary.rows[table.summary.rows.length - 1];
const lines = table.summary.rows.slice(0, -1);
const col = (rows, c) => rows.reduce((s, r) => s + (typeof r[c] === 'number' ? r[c] : 0), 0);
// The summary and the document list name these columns alike.
const AMOUNT_HEADS = ['2A Taxable Value', '2B Taxable Value', '2A Total Tax', '2B Total Tax', DIFF];
const sh = (h) => table.summary.headers.indexOf(h);
check('totals', 'summary lines add up to the summary TOTAL', [2, 3, 4, 5, 6, 7].every((c) => near(col(lines, c), sumTotal[c])), JSON.stringify(sumTotal));
check('totals', 'summary TOTAL = document TOTAL (taxable, tax, difference)', AMOUNT_HEADS.every((h) => sh(h) >= 0 && near(sumTotal[sh(h)], cell(table, docTotal, h))),
  JSON.stringify(AMOUNT_HEADS.map((h) => [sumTotal[sh(h)], cell(table, docTotal, h)])));
check('totals', 'documents counted once each', sumTotal[2] === main.result.rows.length);
const all2B = s2b.docs.reduce((s, d) => s + R.docSign(d) * R.docTax(d), 0);
check('totals', '2B tax TOTAL = signed sum of every 2B document', near(cell(table, docTotal, '2B Total Tax'), all2B), `${cell(table, docTotal, '2B Total Tax')} vs ${all2B}`);
const all2A = s2a.docs.reduce((s, d) => s + R.docSign(d) * R.docTax(d), 0);
check('totals', '2A tax TOTAL = signed sum of every 2A document', near(cell(table, docTotal, '2A Total Tax'), all2A), `${cell(table, docTotal, '2A Total Tax')} vs ${all2A}`);
const compared = main.result.rows.filter((r) => r.status !== 'not_compared');
const diffCompared = compared.reduce((s, r) => s + R.signedTax(r.right) - R.signedTax(r.left), 0);
check('totals', 'difference TOTAL = 2B minus 2A over the compared documents', near(cell(table, docTotal, DIFF), diffCompared), `${cell(table, docTotal, DIFF)} vs ${diffCompared}`);
const headsOf = (r, s) => ['IGST', 'CGST', 'SGST', 'Cess'].reduce((a, h) => a + (+cell(table, r, `${s} ${h}`) || 0), 0);
check('totals', 'heads add up to the total tax on every row', dataRows(table).every((r) => ['2A', '2B'].every((s) => near(headsOf(r, s), +cell(table, r, `${s} Total Tax`) || 0))));

// ── 22: table shape ─────────────────────────────────────────────────────────
const HEADERS = [
  'Sr.', 'Month', 'Supplier GSTIN', 'Supplier Name', 'Doc Type', 'Doc No.', 'Doc Date', 'Section',
  '2A Taxable Value', '2A IGST', '2A CGST', '2A SGST', '2A Cess', '2A Total Tax', '2A Filed On',
  '2B Taxable Value', '2B IGST', '2B CGST', '2B SGST', '2B Cess', '2B Total Tax', 'ITC in 2B',
  'Taxable Difference', DIFF,
  'Status', 'Reason', 'What to do', 'Evidence', 'Reverse Charge', 'Also note',
];
check('table', '30 document columns, every row the same length', table.headers.length === 30 && table.rows.every((r) => r.length === 30) && table.columnWidths.length === 30);
check('table', 'the document columns, in order (Status, Reason and the difference by their exact names)', table.headers.join('|') === HEADERS.join('|'), table.headers.join('|'));
check('table', 'summary rows the length of its headers', table.summary.rows.every((r) => r.length === table.summary.headers.length) && table.summary.columnWidths.length === table.summary.headers.length);
check('table', "last row of each part is ['', 'TOTAL', …]", docTotal[0] === '' && docTotal[1] === 'TOTAL' && sumTotal[1] === 'TOTAL');
const pdfMm = (ws) => ws.reduce((s, w) => s + Math.max(w * 2, 14), 0);
check('table', 'PDF columns fit 265 mm (documents and summary)', pdfMm(table.pdfColumns.map((i) => table.columnWidths[i])) <= 265 && pdfMm(table.summary.columnWidths) <= 265,
  `${pdfMm(table.pdfColumns.map((i) => table.columnWidths[i]))} / ${pdfMm(table.summary.columnWidths)}`);
check('table', 'PDF prints Month (it carries TOTAL), supplier, number, date, both taxes, the difference, Status and Reason',
  table.pdfColumns.map((i) => table.headers[i]).join('|') === ['Month', 'Supplier Name', 'Doc No.', 'Doc Date', '2A Total Tax', '2B Total Tax', DIFF, 'Status', 'Reason'].join('|') && table.pdfColumns[0] === 1,
  table.pdfColumns.map((i) => table.headers[i]).join('|'));
check('table', "no reason label contains the word 'total'", !Object.values(R.REASONS).some((x) => /total/i.test(x.label)));
check('table', 'only the TOTAL rows hold an exact TOTAL cell', table.rows.filter((r) => r.some((c) => String(c).toUpperCase() === 'TOTAL')).length === 1);
const ORDER = ['Only in 2A', 'Only in 2B', 'Figures differ', 'ITC differs', 'Not compared', 'Matched'];
check('table', 'rows sorted: Only in 2A, Only in 2B, Figures differ, ITC differs, Not compared, Matched', (() => {
  const idx = dataRows(table).map((r) => ORDER.indexOf(cell(table, r, 'Status')));
  return idx.every((v, i) => v >= 0 && (i === 0 || v >= idx[i - 1]));
})());
check('table', 'within a status: by supplier name (imports last), then date; Sr. runs 1, 2, 3…', (() => {
  const rs = dataRows(table);
  const key = (r) => (cell(table, r, 'Supplier Name') || '￿').toLowerCase();
  return rs.every((r, i) => cell(table, r, 'Sr.') === i + 1 && (i === 0 || cell(table, rs[i - 1], 'Status') !== cell(table, r, 'Status') || key(rs[i - 1]).localeCompare(key(r), 'en') <= 0));
})());
check('table', 'subtitle short: client, GSTIN, month, pull dates', table.subtitle === 'Client: Fictional Fabrics Pvt Ltd   |   GSTIN: 24ABCDE1234F1Z5   |   Jul 2026   |   2A pulled 20 Sep 2026   |   2B generated 14 Aug 2026', table.subtitle);
check('table', 'a not-confirmed row says so in the Reason cell (the PDF has no Evidence column)', dataRows(table).some((r) => /\(not confirmed\)$/.test(String(cell(table, r, 'Reason')))));
check('table', 'amounts blank where a side is absent, the difference blank when not compared; dates DD-MM-YYYY', dataRows(table).every((r) => {
  const st = cell(table, r, 'Status');
  const blank = (s) => ['Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'].every((h) => cell(table, r, `${s} ${h}`) === '');
  const filled = (s) => ['Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'].every((h) => typeof cell(table, r, `${s} ${h}`) === 'number');
  const sides = st === 'Only in 2A' ? filled('2A') && blank('2B') : st === 'Only in 2B' ? blank('2A') && filled('2B') : st === 'Not compared' ? (blank('2A') || blank('2B')) : filled('2A') && filled('2B');
  const diffOk = st === 'Not compared' ? cell(table, r, DIFF) === '' && cell(table, r, 'Taxable Difference') === '' : typeof cell(table, r, DIFF) === 'number';
  const dateOk = ['Doc Date', '2A Filed On'].every((h) => cell(table, r, h) === '' || /^\d{2}-\d{2}-\d{4}$/.test(cell(table, r, h)));
  return sides && diffOk && dateOk;
}));

// ── View model: signed rows and the aggregates ──────────────────────────────
const view = R.V.toViewData(main.result, infoOf(main));
const vrow = (num, right = false) => view.rows.find((r) => (right ? !r.left && r.right?.number === num : r.left?.number === num));
const kpi = (t, label) => t.kpis.find((k) => k.label === label)?.value;
check('view', 'one view row per reconciled row; ids period|index, unique', view.rows.length === main.result.rows.length && new Set(view.rows.map((r) => r.id)).size === view.rows.length
  && view.rows.every((r, i) => r.id === `07/2026|${i}` && r.period === '07/2026') && view.periods.join() === '07/2026' && view.tolerance === 1);
const vcn = vrow('CN-1', true);
check('view', 'credit note negative in toViewData (CN-1: taxable −1,000, tax −180), no difference (not compared)', vcn && vcn.right.taxable === -1000 && vcn.right.tax === -180 && vcn.right.cgst === -90 && vcn.right.sgst === -90
  && vcn.right.docValue < 0 && vcn.diff === null && vcn.absTaxDiff === 0 && vcn.family === 'CN' && vcn.docType === 'Credit note' && vcn.section === 'CDNR', JSON.stringify(vcn?.right));
const vrev = vrow('U-0201', true);
check('view', 'ITC reversal entry negative, ITC state "reversal" (U-0201)', vrev && vrev.right.tax === -180 && vrev.right.itc === 'reversal' && vrev.diff?.tax === -180, JSON.stringify(vrev?.right));
const vd401 = vrow('D-401');
const vs1701 = vrow('S-1701');
check('view', 'ITC state from the 2B (rejected, not available with its reason, available); none for the 2A', vd401?.right.itc === 'rejected' && vs1701?.right.itc === 'not_available' && vs1701.right.itcReason === 'P'
  && vrow('A-101')?.right.itc === 'available' && vrow('A-101').left.itc === null
  && cell(table, dataRows(table).find((r) => cell(table, r, 'Doc No.') === 'S-1701'), 'ITC in 2B') === 'No (place of supply)');
const vq2 = view.rows.find((r) => r.left && r.right?.number === 'Q-2');
const oddRow = main.result.rows.find((r) => r.left?.number === 'A-101');
const odd = R.V.toViewData({ ...main.result, rows: [{ ...oddRow, right: { ...oddRow.right, cgst: 1234.5, sgst: 1234.5 } }] }, infoOf(main)).rows[0];
check('view', 'rate: snapped to the band within 0.5 (Q-2 2B: 162 on 905 = 17.90 → 18), else 2 decimals (24.69); null without a taxable value (ISD-1)',
  vrow('A-101')?.left.rate === 18 && vq2?.right.rate === 18 && odd.right.rate === 24.69 && vrow('ISD-1', true)?.right.rate === null && vrow('K-1101')?.left.rate === 18,
  JSON.stringify([vq2?.right.rate, odd.right.rate, vrow('ISD-1', true)?.right.rate]));
const vc301 = vrow('C-301');
const vr1601 = vrow('R-1601');
check('view', 'reason text, action, evidence and notes as the cells say', vc301?.reasonText.endsWith('(not confirmed)') && vc301.reasonLabel === R.REASONS.IMS_PENDING.label && vc301.statusLabel === 'Only in 2A'
  && vrow('B-201')?.evidence === 'Found in the 2B of Aug 2026' && vrow('B-201').refPeriod === '08/2026' && vrow('B-201').action === findRowFor(main.result, 'B-201')[0].action && /^Do not claim it this month/.test(vrow('B-201').action)
  && vc301.action === (findRowFor(main.result, 'C-301')[0].action || R.REASONS.IMS_PENDING.action)
  && vr1601?.notes.some((n) => n.code === 'RCM' && n.label === 'Reverse charge' && n.text) && vr1601.reverseCharge === true
  && vrow('M-1301')?.number === 'M-1301 / M-1301A' && vrow('M-1301').viaAmendment && vrow('M-1301').isAmendment && vrow('P-1501')?.dateDiffers, show(main.result.rows.find((r) => r.left?.number === 'C-301')));
const lt = R.V.sideTotals(view.rows, 'left');
const rt = R.V.sideTotals(view.rows, 'right');
const netAll = view.rows.reduce((s, r) => s + (r.diff ? r.diff.tax : 0), 0);
check('view', 'sideTotals: documents only where that side exists, tax = the signed sums of 2A and 2B', lt.docs === main.result.rows.filter((r) => r.left).length && rt.docs === main.result.rows.filter((r) => r.right).length
  && near(lt.tax, all2A) && near(rt.tax, all2B) && near(lt.igst + lt.cgst + lt.sgst + lt.cess, lt.tax), JSON.stringify([lt, rt]));
const sumOf = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
for (const [name, xs, count] of [['bySupplier', R.V.bySupplier(view.rows), 'rows'], ['byPeriod', R.V.byPeriod(view.rows, view.periods), 'rows'], ['byReason', R.V.byReason(view.rows), 'count']]) {
  check('view', `${name} totals = sideTotals (documents, taxable, tax, difference)`, sumOf(xs, count) === view.rows.length
    && near(sumOf(xs, 'leftTaxable'), lt.taxable) && near(sumOf(xs, 'rightTaxable'), rt.taxable) && near(sumOf(xs, 'leftTax'), lt.tax) && near(sumOf(xs, 'rightTax'), rt.tax) && near(sumOf(xs, 'diff'), netAll)
    && (name === 'byReason' || (sumOf(xs, 'leftDocs') === lt.docs && sumOf(xs, 'rightDocs') === rt.docs)), JSON.stringify({ n: sumOf(xs, count), lt: sumOf(xs, 'leftTax'), rt: sumOf(xs, 'rightTax'), d: sumOf(xs, 'diff') }));
}
const sups = R.V.bySupplier(view.rows);
const counts = R.V.statusCounts(view.rows);
const reasonsBy = R.V.byReason(view.rows);
check('view', 'statusCounts add up; byReason in the status order, then the most documents; bySupplier by the largest difference',
  Object.values(counts).reduce((a, b) => a + b, 0) === view.rows.length && counts.matched === view.rows.filter((r) => r.status === 'matched').length
  && reasonsBy.every((l, i) => i === 0 || R.STATUS_ORDER.indexOf(reasonsBy[i - 1].status) < R.STATUS_ORDER.indexOf(l.status) || (reasonsBy[i - 1].status === l.status && reasonsBy[i - 1].count >= l.count))
  && sups.every((s, i) => i === 0 || Math.abs(sups[i - 1].diff) >= Math.abs(s.diff)));
const bySection = R.V.groupBy(view.rows, (r) => r.section, (r) => r.section);
check('view', 'groupBy (by section): every row once, counts by status', sumOf(bySection, 'rows') === view.rows.length && bySection.every((g) => Object.values(g.counts).reduce((a, b) => a + b, 0) === g.rows)
  && near(sumOf(bySection, 'diff'), netAll));
check('view', 'stat band = sums over the document rows', (() => {
  const st = (s) => dataRows(table).filter((r) => cell(table, r, 'Status') === s).length;
  return kpi(table, 'Documents') === dataRows(table).length && kpi(table, 'Matched') === st('Matched') && kpi(table, 'Only in 2A') === st('Only in 2A') && kpi(table, 'Only in 2B') === st('Only in 2B')
    && kpi(table, 'Figures differ') === st('Figures differ') + st('ITC differs') && kpi(table, 'Not compared') === st('Not compared')
    && ['Matched', 'Only in 2A', 'Only in 2B', 'Figures differ', 'Not compared'].reduce((a, k) => a + kpi(table, k), 0) === kpi(table, 'Documents')
    && near(kpi(table, '2A tax'), cell(table, docTotal, '2A Total Tax')) && near(kpi(table, '2B tax'), cell(table, docTotal, '2B Total Tax'))
    && near(kpi(table, 'Net difference (2B minus 2A)'), cell(table, docTotal, DIFF));
})(), JSON.stringify(table.kpis));
check('view', 'stat band tones: matched good, one side only warn, differences bad, not compared muted; Matched carries its %', (() => {
  const tone = (l) => table.kpis.find((k) => k.label === l)?.tone;
  return tone('Matched') === 'good' && tone('Only in 2A') === 'warn' && tone('Only in 2B') === 'warn' && tone('Figures differ') === 'bad' && tone('Not compared') === 'muted'
    && tone('Net difference (2B minus 2A)') === 'bad' && /%$/.test(table.kpis.find((k) => k.label === 'Matched').note);
})(), JSON.stringify(table.kpis));
const onlyA = view.rows.filter((r) => r.status === 'only_left');
const ft = R.V.recoReportTable({ ...view, rows: onlyA }, { filterNote: 'Status: Only in 2A' });
check('view', 'a filtered view exports its own rows, stat band and summary, with the filter in the strip', dataRows(ft).length === onlyA.length && kpi(ft, 'Documents') === onlyA.length && kpi(ft, 'Only in 2A') === onlyA.length
  && ft.summary.rows.slice(0, -1).every((r) => r[0] === 'Only in 2A') && ft.meta.some((f) => f.label === 'Filter' && f.value === 'Status: Only in 2A') && ft.title === table.title);

// ── Layout: every sheet well formed ─────────────────────────────────────────
const sheetsOf = (t) => [
  { name: t.sheetName, ...t }, { name: 'Summary', ...t.summary },
  ...(t.extraSheets ?? []),
];
const shapeProblems = (t) => {
  const out = [];
  const names = new Set();
  for (const s of sheetsOf(t)) {
    const n = s.headers.length;
    const tag = s.name;
    if (new Set(s.headers).size !== n) out.push(`${tag}: headers not unique`);
    if (s.headerLabels && s.headerLabels.length !== n) out.push(`${tag}: ${s.headerLabels.length} labels for ${n} headers`);
    if (s.columnWidths.length !== n) out.push(`${tag}: ${s.columnWidths.length} widths`);
    if (s.columnGroups && s.columnGroups.reduce((a, g) => a + g.span, 0) !== n) out.push(`${tag}: column groups span ${s.columnGroups.reduce((a, g) => a + g.span, 0)}`);
    if (s.rowTones && s.rowTones.length !== s.rows.length) out.push(`${tag}: ${s.rowTones.length} tones for ${s.rows.length} rows`);
    if (s.rowKinds && s.rowKinds.length !== s.rows.length) out.push(`${tag}: ${s.rowKinds.length} kinds for ${s.rows.length} rows`);
    if (s.rows.some((r) => r.length !== n)) out.push(`${tag}: a row of the wrong length`);
    if (s.pdfColumns && s.pdfColumns.some((i) => i < 0 || i >= n)) out.push(`${tag}: pdfColumns out of range`);
    if (s.toneColumn !== undefined && (s.toneColumn < -1 || s.toneColumn >= n)) out.push(`${tag}: toneColumn out of range`);
    if (s.rowTones && s.toneColumn === -1) out.push(`${tag}: tones without a column`);
    if (!s.name || s.name.length > 31 || names.has(s.name.toLowerCase())) out.push(`${tag}: sheet name`);
    names.add(String(s.name).toLowerCase());
  }
  return out;
};
// TOTAL rows: every column holding figures in the data rows is summed (Sr. aside).
const totalProblems = (t) => {
  const out = [];
  for (const s of sheetsOf(t)) {
    if (!s.rowKinds || s.rowKinds[s.rowKinds.length - 1] !== 'total') continue;
    const data = s.rows.filter((_, i) => s.rowKinds[i] === 'data');
    const tot = s.rows[s.rows.length - 1];
    if (!tot.some((c) => c === 'TOTAL')) out.push(`${s.name}: no TOTAL label`);
    s.headers.forEach((h, c) => {
      if (h === 'Sr.' || !data.some((r) => typeof r[c] === 'number')) return;
      const sum = data.reduce((a, r) => a + (typeof r[c] === 'number' ? r[c] : 0), 0);
      if (typeof tot[c] !== 'number' || !near(tot[c], sum)) out.push(`${s.name} / ${h}: TOTAL ${tot[c]} vs ${sum}`);
    });
  }
  return out;
};
check('layout', 'headers unique; labels, widths, groups, tones and kinds fit their headers and rows (every sheet)', shapeProblems(table).length === 0, shapeProblems(table).join('; '));
check('layout', 'every TOTAL row sums its columns (documents, summary, by supplier, by document type)', totalProblems(table).length === 0, totalProblems(table).join('; '));
check('layout', 'sheets: Documents, the summary by reason, By supplier, By document type, Notes and evidence (Excel only); no By month for one month',
  table.sheetName === 'Documents' && table.summary.title === 'Summary by reason' && table.extraSheets.map((x) => x.name).join() === 'By supplier,By document type,Notes and evidence'
  && table.extraSheets.filter((x) => x.pdf === false).map((x) => x.name).join() === 'Notes and evidence', table.extraSheets.map((x) => `${x.name}${x.pdf === false ? ' (no PDF)' : ''}`).join());
check('layout', 'document list grouped: Document, GSTR-2A, GSTR-2B, Difference (2B minus 2A), Reconciliation, under short labels',
  table.columnGroups.map((g) => `${g.label}:${g.span}`).join() === 'Document:8,GSTR-2A:7,GSTR-2B:7,Difference (2B minus 2A):2,Reconciliation:6'
  && table.headerLabels[8] === 'Taxable value' && table.headerLabels[13] === 'Total tax' && table.headerLabels[23] === 'Total tax', JSON.stringify(table.columnGroups));
const TONE_OF = { Matched: 'good', 'Only in 2A': 'warn', 'Only in 2B': 'warn', 'Figures differ': 'bad', 'ITC differs': 'bad', 'Not compared': 'muted' };
check('layout', 'tones follow the status, on the Status column; four columns frozen', dataRows(table).every((r, i) => table.rowTones[i] === TONE_OF[cell(table, r, 'Status')])
  && table.rowTones[table.rowTones.length - 1] === null && table.headers[table.toneColumn] === 'Status' && table.freezeColumns === 4
  && table.summary.rowTones.slice(0, -1).every((tn, i) => tn === TONE_OF[table.summary.rows[i][0]]));
check('layout', 'identification strip: client, GSTIN, period, pull dates; the stat band has nine figures', table.meta.map((f) => `${f.label}=${f.value}`).join('|')
  === 'Client=Fictional Fabrics Pvt Ltd|GSTIN=24ABCDE1234F1Z5|Period=Jul 2026|2A pulled=20 Sep 2026|2B generated=14 Aug 2026' && table.kpis.length === 9, JSON.stringify(table.meta));
const supSheet = table.extraSheets.find((x) => x.name === 'By supplier');
const supLine = (name) => supSheet.rows.find((r) => r[1] === name);
check('layout', 'By supplier: a status word and tint by the worst row (LAMBDA differs, ALPHA matched), the largest difference first, TOTAL', cell(supSheet, supLine('LAMBDA CHEMICALS'), 'Status') === 'Figures differ'
  && supSheet.rowTones[supSheet.rows.indexOf(supLine('LAMBDA CHEMICALS'))] === 'bad' && cell(supSheet, supLine('ALPHA TRADERS'), 'Status') === 'Matched'
  && supSheet.rows.length === sups.length + 1 && supSheet.rows[supSheet.rows.length - 1][1] === 'TOTAL' && supSheet.toneColumn === 2,
  JSON.stringify([supLine('LAMBDA CHEMICALS'), supLine('ALPHA TRADERS')]));
const typeSheet = table.extraSheets.find((x) => x.name === 'By document type');
check('layout', 'By document type: invoices first, then the amended, the notes, ISD and imports; every row counted once', typeSheet.rows.slice(0, -1).map((r) => r[0]).join('|') === 'Invoice|Invoice (amended)|Credit note|ISD credit|Bill of entry'
  && cell(typeSheet, totalRow(typeSheet), 'Rows') === view.rows.length, typeSheet.rows.map((r) => r[0]).join('|'));
const notesSheet = table.extraSheets.find((x) => x.name === 'Notes and evidence');
check('layout', 'Notes and evidence: one line per row with a flag or a reason not confirmed', notesSheet.rows.length === view.rows.filter((r) => r.notes.length || r.confirmed === false).length && notesSheet.rows.length > 0 && notesSheet.pdf === false);

// ── 23: several months ──────────────────────────────────────────────────────
const fake = { needs: 'client+month', build: async ({ month }) => R.toReportTable(main.result, infoOf(main, month)) };
const merged = await R.buildForPeriods(fake, ['06/2026', '07/2026'], F.CLIENT.id);
const n1 = main.result.rows.length;
check('merge', 'two months: a Month column holding both, no period bands, one TOTAL summing both', merged.headers[1] === 'Month' && dataRows(merged).length === 2 * n1
  && dataRows(merged).filter((r) => r[1] === 'Jun 2026').length === n1 && dataRows(merged).filter((r) => r[1] === 'Jul 2026').length === n1
  && merged.rows.filter((r) => r[1] === 'TOTAL').length === 1 && !merged.rows.some((r) => /^— .+ —$/.test(String(r[0])))
  && AMOUNT_HEADS.every((h) => near(cell(merged, totalRow(merged), h), 2 * cell(table, docTotal, h))));
check('merge', 'periods [06/2026, 07/2026]; row ids unique across months; rows in month order, Sr. running on', merged.reco.periods.join() === '06/2026,07/2026'
  && new Set(merged.reco.rows.map((r) => r.id)).size === 2 * n1 && dataRows(merged)[0][1] === 'Jun 2026' && dataRows(merged).every((r, i) => r[0] === i + 1));
check('merge', 'summary recomputed across both months: each line twice the month\'s, one TOTAL', merged.summary.rows.length === table.summary.rows.length
  && merged.summary.rows.filter((r) => r[1] === 'TOTAL').length === 1 && !merged.summary.rows.some((r) => /^— .+ —$/.test(String(r[0])))
  && table.summary.rows.every((r) => { const m = merged.summary.rows.find((x) => x[0] === r[0] && x[1] === r[1]); return m && m[2] === 2 * r[2] && [3, 4, 5, 6, 7].every((c) => r[c] === '' ? m[c] === '' : near(m[c], 2 * r[c])); }));
check('merge', 'stat band recomputed across both months', kpi(merged, 'Documents') === 2 * n1 && kpi(merged, 'Matched') === 2 * kpi(table, 'Matched')
  && near(kpi(merged, 'Net difference (2B minus 2A)'), 2 * kpi(table, 'Net difference (2B minus 2A)')) && near(kpi(merged, '2B tax'), 2 * kpi(table, '2B tax')));
check('merge', 'notes prefixed with their month; pdfColumns kept', merged.summary.notes.length === 2 * table.summary.notes.length && merged.summary.notes.every((n) => /^(Jun|Jul) 2026: /.test(n))
  && JSON.stringify(merged.pdfColumns) === JSON.stringify(table.pdfColumns), merged.summary.notes.slice(0, 3).join(' | '));
const byMonth = merged.extraSheets.find((x) => x.name === 'By month');
check('merge', 'By month: a line per month with its own pull dates, and a TOTAL', byMonth && byMonth.rows.map((r) => r[0]).join() === 'Jun 2026,Jul 2026,TOTAL'
  && cell(byMonth, byMonth.rows[0], 'Rows') === n1 && cell(byMonth, byMonth.rows[0], '2A Pulled On') === '20-09-2026' && cell(byMonth, byMonth.rows[1], '2B Generated On') === '14-08-2026'
  && cell(byMonth, byMonth.rows[2], 'Rows') === 2 * n1, JSON.stringify(byMonth?.rows));
check('merge', 'every sheet of the merged report well formed and its TOTAL rows summed', shapeProblems(merged).length === 0 && totalProblems(merged).length === 0
  && merged.extraSheets.map((x) => x.name).join() === 'By supplier,By month,By document type,Notes and evidence', [...shapeProblems(merged), ...totalProblems(merged)].join('; '));
check('merge', 'strip and file name: the span of months', metaOf(merged, 'Period') === 'Jun 2026 to Jul 2026 (2 months)' && merged.fileNameBase === 'GSTR2A_vs_GSTR2B_Reco_Fictional_Fabrics_Pvt_Ltd_06-2026_2months'
  && merged.subtitle === 'Client: Fictional Fabrics Pvt Ltd   |   GSTIN: 24ABCDE1234F1Z5   |   Jun 2026 to Jul 2026 (2 months)', `${merged.subtitle} | ${merged.fileNameBase}`);
{
  const fake3 = { needs: 'client+month', build: async ({ month }) => { if (month === '08/2026') throw new Error('GSTR-2B of Aug 2026 is not pulled.'); return R.toReportTable(main.result, infoOf(main, month)); } };
  const m3 = await R.buildForPeriods(fake3, ['06/2026', '07/2026', '08/2026'], F.CLIENT.id);
  check('merge', 'a month that failed: named in the notes (in its place) and the strip; the others merged', m3.summary.notes[m3.summary.notes.length - 1] === 'Aug 2026: Not built: GSTR-2B of Aug 2026 is not pulled.'
    && metaOf(m3, 'Not built') === 'Aug 2026' && m3.reco.failed.map((f) => f.period).join() === '08/2026' && m3.reco.periods.join() === '06/2026,07/2026'
    && dataRows(m3).length === 2 * n1 && m3.fileNameBase.endsWith('_06-2026_3months'), JSON.stringify(m3.summary.notes.slice(-2)));
  const direct = R.V.mergeViewData([R.V.toViewData(main.result, infoOf(main, '07/2026')), R.V.toViewData(main.result, infoOf(main, '06/2026'))], [{ period: '05/2026', reason: 'x' }]);
  check('merge', 'mergeViewData: months in order whatever the order given, failed months kept apart', direct.periods.join() === '06/2026,07/2026' && direct.rows[0].period === '06/2026'
    && direct.failed[0].period === '05/2026' && direct.statements.map((s) => s.period).join() === '06/2026,07/2026' && direct.notes[0].period === '06/2026');
}
check('merge', 'mergeRows is the shared row merge', R.mergeRows([[['a', 'TOTAL']]], ['07/2026'], 2)[1][1] === 'TOTAL (07/2026)');

// ── The view's filters (src/lib/itcReco/filters.ts) ───────────────────────
{
  const Fl = R.Fl;
  const E = Fl.EMPTY_FILTERS;
  const rows = view.rows;
  const num = (xs) => xs.map((r) => r.number).join(',');
  const sup = (name) => Fl.supplierKey(rows.find((r) => r.supplierName === name));
  const where = (pred) => rows.filter(pred);
  check('filters', 'nothing set: every row (the same array), not filtering; each facet counts every row once', Fl.applyFilters(rows, E) === rows && !Fl.isFiltering(E)
    && Fl.FACETS.filter((f) => f !== 'flag').every((f) => [...Fl.facetCounts(rows, E, f).values()].reduce((a, b) => a + b, 0) === rows.length));
  const or = Fl.applyFilters(rows, { ...E, status: ['only_left', 'only_right'] });
  check('filters', 'OR within a facet: Only in 2A or Only in 2B', or.length === where((r) => r.status === 'only_left' || r.status === 'only_right').length && or.length === 19
    && or.every((r) => r.status === 'only_left' || r.status === 'only_right'), or.length);
  const and = Fl.applyFilters(rows, { ...E, status: ['only_left'], supplier: [sup('ZETA LOGISTICS'), sup('ETA ENGINEERING')] });
  check('filters', 'AND across facets: Only in 2A and (ZETA or ETA)', num(and) === 'F-602,F-601,G-702,G-701', num(and));
  const flags = Fl.applyFilters(rows, { ...E, flag: ['ITC_NA_POS', 'RCM'] });
  const flagsMatched = Fl.applyFilters(rows, { ...E, flag: ['ITC_NA_POS', 'RCM'], status: ['matched'] });
  check('filters', 'flags: OR within (place of supply or reverse charge), AND with status', num(flags) === 'T-1801,R-1601,S-1701' && num(flagsMatched) === 'R-1601,S-1701', `${num(flags)} | ${num(flagsMatched)}`);
  const imports = Fl.applyFilters(rows, { ...E, supplier: [Fl.supplierKey(rows.find((r) => r.number === 'BE-1'))] });
  check('filters', 'an import without a GSTIN is its own supplier, named "Imports (no GSTIN)"', num(imports) === 'BE-1' && Fl.facetLabel('supplier', '~', view) === 'Imports (no GSTIN)');

  // Faceted counts: a facet ignores its own selection and honours every other filter.
  const f1 = { ...E, status: ['matched'], supplier: [sup('RHO RESINS')] };
  const c1 = Fl.allFacetCounts(rows, f1);
  check('filters', 'counts: status ignores the status filter (RHO: 3 matched), supplier ignores the supplier filter (matched per supplier)',
    c1.status.get('matched') === 3 && [...c1.status.keys()].join() === 'matched'
    && c1.supplier.get(sup('UPSILON YARNS')) === 2 && c1.supplier.get(sup('RHO RESINS')) === 3 && c1.supplier.get(sup('ALPHA TRADERS')) === 1
    && c1.section.get('B2B') === 3 && c1.itc.get('not_available') === 3, JSON.stringify(Object.fromEntries(Object.entries(c1).map(([k, m]) => [k, Object.fromEntries(m)]))));
  // Brute force: every facet value's count equals the rows the filter would leave with that value alone ticked in that facet.
  const busy = { ...E, status: ['only_left', 'only_right', 'matched'], section: ['B2B'], docType: ['INV'], minDiff: null, dateFrom: '2026-06-01', search: 'a' };
  const all = Fl.allFacetCounts(rows, busy);
  const wrong = [];
  for (const facet of Fl.FACETS) {
    for (const o of Fl.facetOptions(view, facet)) {
      const others = Fl.applyFilters(rows, { ...busy, [facet]: [] });
      const want = others.filter((r) => Fl.valuesOf(r, facet).includes(o.value)).length;
      const got = all[facet].get(o.value) ?? 0;
      if (got !== want) wrong.push(`${facet}=${o.value}: ${got} vs ${want}`);
      if (facet !== 'flag' && got !== Fl.applyFilters(rows, { ...busy, [facet]: [o.value] }).length) wrong.push(`${facet}=${o.value}: not the rows ticking it would show`);
    }
    if (JSON.stringify([...Fl.facetCounts(rows, busy, facet)]) !== JSON.stringify([...all[facet]])) wrong.push(`${facet}: facetCounts differs from allFacetCounts`);
  }
  check('filters', 'counts, every facet and value, under a busy filter: the rows ticking that value alone would show', wrong.length === 0, wrong.slice(0, 6).join('; '));

  // The other filters.
  const big = Fl.applyFilters(rows, { ...E, minDiff: 500 });
  check('filters', 'tax difference at least ₹500 (not compared rows have none)', num(big) === 'B-201,E-501,T-1801,V-2101,C-301,W-1001,J-901,H-802', num(big));
  const tol = Fl.applyFilters(rows, { ...E, aboveTolerance: view.tolerance });
  check('filters', 'above the tolerance: figures differ by more than ₹1 on value or tax; matched, not compared and the date-only row are out',
    tol.length === where((r) => r.diff && (Math.abs(r.diff.tax) > 1 || Math.abs(r.diff.taxable) > 1)).length
    && tol.every((r) => r.status !== 'matched' && r.status !== 'not_compared') && !tol.some((r) => r.number === 'P-1501') && tol.some((r) => r.number === 'B-201'), num(tol));
  const july = Fl.applyFilters(rows, { ...E, dateFrom: '2026-07-01', dateTo: '2026-07-31' });
  check('filters', 'document date from / to, inclusive (N-5 of 2025, U-0201 of Feb, X-2201 of Aug and the June ones out)', july.length === where((r) => r.date >= '2026-07-01' && r.date <= '2026-07-31').length
    && !july.some((r) => ['N-5', 'U-0201', 'X-2201', 'H-801', 'P-1501'].includes(r.number)) && july.some((r) => r.number === 'Q-1'), num(july));
  check('filters', 'search: every word must appear (name, number, GSTIN, reason, evidence), any case',
    num(Fl.applyFilters(rows, { ...E, search: 'zeta' })) === 'F-602,F-601' && num(Fl.applyFilters(rows, { ...E, search: '  Zeta   602 ' })) === 'F-602'
    && num(Fl.applyFilters(rows, { ...E, search: '29aaapk' })) === 'K-1101,K-1102' && Fl.applyFilters(rows, { ...E, search: 'found in the 2b of aug 2026' }).some((r) => r.number === 'B-201')
    && Fl.applyFilters(rows, { ...E, search: 'm-1301a' }).length === 1);

  // Words: chips and the export's filter line.
  const fD = { ...E, status: ['only_right', 'only_left'], supplier: [sup('THETA THREADS')], itc: ['none'], reverseCharge: ['no'], minDiff: 100, dateFrom: '2026-06-01', search: ' theta ' };
  const d = Fl.describeFilters(fD, view);
  check('filters', 'describeFilters: facets in the bar\'s order, values in the facet\'s order, the supplier with its GSTIN, then the bounds and the search',
    d === 'Status: Only in 2A, Only in 2B; Supplier: THETA THREADS (24AAAPH0008H1Z8); ITC in 2B: Not in 2B; Reverse charge: No; Tax difference at least ₹100.00; Document date from 01-06-2026; Search: "theta"'
    && Fl.describeFilters(E, view) === '', d);
  const six = ['ALPHA TRADERS', 'BETA STEEL', 'GAMMA PAPERS', 'DELTA DYES', 'EPSILON PACKAGING', 'ZETA LOGISTICS'].map(sup);
  const d6 = Fl.describeFilters({ ...E, supplier: six, dateFrom: '2026-07-01', dateTo: '2026-07-31', aboveTolerance: 1 }, view);
  check('filters', 'describeFilters: a long list is cut ("and 2 more"); a date range; the tolerance', d6 === 'Supplier: ALPHA TRADERS (24AAAPA0001A1Z1), BETA STEEL (27AAAPB0002B1Z2), DELTA DYES (24AAAPD0004D1Z4), EPSILON PACKAGING (24AAAPE0005E1Z5) and 2 more; Differences above ₹1.00; Document date 01-07-2026 to 31-07-2026', d6);
  const chips = Fl.filterChips(fD, view);
  const noSup = Fl.removeChip(fD, chips.find((c) => c.kind === 'supplier'));
  check('filters', 'chips: one per value (in the order ticked) and per bound; removing one leaves the rest', chips.length === 8 && chips[0].label === 'Status: Only in 2B' && chips.some((c) => c.label === 'Supplier: THETA THREADS')
    && noSup.supplier.length === 0 && noSup.status.length === 2 && Fl.removeChip(fD, chips.find((c) => c.kind === 'search')).search === '' && Fl.removeChip(fD, chips.find((c) => c.kind === 'minDiff')).minDiff === null,
    chips.map((c) => c.label).join(' | '));
  check('filters', 'options: reasons grouped by status in the status order; document types invoice first; ITC "Not in 2B" last',
    Fl.facetOptions(view, 'reason')[0].group === 'Only in 2A' && Fl.facetOptions(view, 'reason').at(-1).group === 'Matched'
    && Fl.facetOptions(view, 'docType').map((o) => o.label).join() === 'Invoice,Invoice (amended),Credit note,ISD credit,Bill of entry'
    && Fl.facetOptions(view, 'itc').map((o) => o.label).join() === 'Available,Not available,Rejected in IMS,ITC reversal (Rule 37A),Not in 2B'
    && Fl.facetOptions(view, 'rate').map((o) => o.value).join() === '18,none', Fl.facetOptions(view, 'docType').map((o) => o.label).join());

  // Presets.
  const P = (k) => Fl.presetFilters(k, view.tolerance);
  check('filters', 'presets: Needs action = everything but matched and not compared; Differences only = above the tolerance; Matched; All = nothing set',
    Fl.applyFilters(rows, P('needs_action')).length === where((r) => r.status !== 'matched' && r.status !== 'not_compared').length
    && Fl.applyFilters(rows, P('differences')).length === tol.length && Fl.applyFilters(rows, P('matched')).length === where((r) => r.status === 'matched').length
    && Fl.applyFilters(rows, P('all')) === rows);
  check('filters', 'activePreset recognises each preset exactly, and none once anything else is set', ['needs_action', 'differences', 'matched', 'all'].every((k) => Fl.activePreset(P(k), view.tolerance) === k)
    && Fl.activePreset({ ...P('needs_action'), search: 'x' }, view.tolerance) === null && Fl.activePreset({ ...E, status: ['only_left'] }, view.tolerance) === null
    && Fl.activePreset({ ...E, status: [...P('needs_action').status].reverse() }, view.tolerance) === 'needs_action');

  // Sorting the list.
  const tblNums = dataRows(table).map((r) => cell(table, r, 'Doc No.')).join(',');
  const byDiff = Fl.sortRows(rows, { key: 'diffTax', dir: 'desc' });
  const byDiffAsc = Fl.sortRows(rows, { key: 'diffTax', dir: 'asc' });
  const vals = (xs) => xs.filter((r) => r.diff).map((r) => r.diff.tax);
  check('filters', 'sortRows: no sort = the Excel\'s order; figures either way with not compared rows last; text A to Z', num(Fl.sortRows(rows, null)) === tblNums
    && vals(byDiff).every((v, i, a) => i === 0 || a[i - 1] >= v) && byDiff.slice(-3).every((r) => !r.diff)
    && vals(byDiffAsc).every((v, i, a) => i === 0 || a[i - 1] <= v) && byDiffAsc.slice(-3).every((r) => !r.diff)
    && Fl.sortRows(rows, { key: 'supplier', dir: 'asc' })[0].supplierName === 'ALPHA TRADERS' && Fl.sortRows(rows, { key: 'supplier', dir: 'asc' }).at(-1).number === 'BE-1');

  // A filtered export carries its own rows and names the filter.
  const fx = { ...E, status: ['only_left'], supplier: [sup('ZETA LOGISTICS')] };
  const tx = R.V.recoReportTable({ ...view, rows: Fl.applyFilters(rows, fx) }, { filterNote: Fl.describeFilters(fx, view) });
  check('filters', 'an export of the filtered rows: its own documents and figures, the filter in the strip', dataRows(tx).length === 2 && kpi(tx, 'Documents') === 2
    && tx.meta.find((f) => f.label === 'Filter')?.value === 'Status: Only in 2A; Supplier: ZETA LOGISTICS (24AAAPF0006F1Z6)', JSON.stringify(tx.meta));

  // Several months: the month facet.
  const mv = merged.reco;
  check('filters', 'several months: a month facet with both, in order; a month picked leaves its rows; "Month: Jul 2026"',
    Fl.facetOptions(mv, 'period').map((o) => o.label).join() === 'Jun 2026,Jul 2026'
    && Fl.applyFilters(mv.rows, { ...E, period: ['07/2026'] }).length === n1 && Fl.describeFilters({ ...E, period: ['07/2026'] }, mv) === 'Month: Jul 2026'
    && Fl.facetCounts(mv.rows, { ...E, period: ['07/2026'], status: ['matched'] }, 'period').get('06/2026') === where((r) => r.status === 'matched').length);
}

// ── 2A credit and debit notes (extension 0.14.0: summary.cdn) ──────────────
{
  const note2A = { ctin: F.S.alpha, trdnm: 'ALPHA', cfs: 'Y', supfildt: '10-Aug-26', flprdr1: 'Jul-26', nt: [{ ntty: 'C', nt_num: 'CN-7', nt_dt: '25-07-2026', val: 1180, pos: '24', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 18, txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 } }] }] };
  const twoA = (sections) => ({
    b2b: [A(F.S.alpha, 'ALPHA', '10-Aug-26', [F.inv2A('A-7', '05-07-2026', F.intra(1000))])],
    ...(sections.includes('cdn') ? { cdn: [note2A] } : {}),
    _meta: { ...meta0, counterparties: 1, sections },
  });
  const twoB = F.summary2B('07/2026', '14-08-2026', {
    b2b: [F.sup2B(F.S.alpha, 'ALPHA', '072026', '10-08-2026', [F.inv2B('A-7', '05-07-2026', F.intra(1000))])],
    cdnr: [F.sup2B(F.S.alpha, 'ALPHA', '072026', '10-08-2026', [F.nt2B('CN-7', '25-07-2026', 'C', F.intra(1000))], 'nt')],
  });
  const rowsFor = (sections) => [F.row('2A', '07/2026', twoA(sections)), F.row('2B', '07/2026', twoB), F.row('2B', '08/2026', F.summary2B('08/2026', '14-09-2026', { b2b: [] }))];
  const noteRow = (t) => dataRows(t).find((r) => cell(t, r, 'Doc No.') === 'CN-7');
  const withCdn = recoOf('07/2026', rowsFor(['b2b', 'cdn']), F.TODAY);
  const t1 = R.toReportTable(withCdn.result, infoOf(withCdn));
  const v1 = t1.reco.rows.find((r) => r.right?.number === 'CN-7');
  const c1 = noteRow(t1);
  check('cdn', "2A with notes (_meta.sections ['b2b','cdn']): the 2B credit note matches the 2A's, both negative", v1?.status === 'matched' && v1.left?.family === 'CN' && v1.left.tax === -180 && v1.right.tax === -180 && v1.diff?.tax === 0
    && cell(t1, c1, 'Status') === 'Matched' && cell(t1, c1, 'Section') === 'CDNR' && cell(t1, c1, 'Doc Type') === 'Credit note' && cell(t1, c1, '2A Total Tax') === -180 && cell(t1, c1, '2B Total Tax') === -180
    && cell(t1, c1, DIFF) === 0 && kpi(t1, 'Not compared') === 0 && kpi(t1, 'Matched') === 2, JSON.stringify(v1 && { s: v1.status, r: v1.reason, l: v1.left, rr: v1.right }));
  const without = recoOf('07/2026', rowsFor(['b2b']), F.TODAY);
  const t2 = R.toReportTable(without.result, infoOf(without));
  const v2 = t2.reco.rows.find((r) => r.right?.number === 'CN-7');
  const c2 = noteRow(t2);
  check('cdn', "2A without notes (_meta.sections ['b2b']): the 2B credit note stays not compared, out of the difference", v2?.status === 'not_compared' && v2.reason === 'NOT_COMPARED_SECTION' && !v2.left && v2.diff === null
    && cell(t2, c2, 'Status') === 'Not compared' && cell(t2, c2, DIFF) === '' && cell(t2, c2, '2B Total Tax') === -180 && kpi(t2, 'Not compared') === 1 && near(kpi(t2, 'Net difference (2B minus 2A)'), 0),
    JSON.stringify(v2 && { s: v2.status, r: v2.reason }));

  // A credit note reaching an invoice rule is told to reduce ITC, never to
  // claim it, and gets no s.16(4) wording (review finding, 0.14.0).
  const lateCn = F.summary2B('07/2026', '14-08-2026', {
    b2b: [F.sup2B(F.S.alpha, 'ALPHA', '072026', '10-08-2026', [F.inv2B('A-7', '05-07-2026', F.intra(1000))])],
    cdnr: [F.sup2B(F.S.alpha, 'ALPHA', '062026', '20-07-2026', [F.nt2B('CN-6', '28-06-2025', 'C', F.intra(500))], 'nt')],
  });
  const lateRows = [F.row('2A', '07/2026', twoA(['b2b', 'cdn'])), F.row('2B', '07/2026', lateCn), F.row('2B', '08/2026', F.summary2B('08/2026', '14-09-2026', { b2b: [] }))];
  const late = recoOf('07/2026', lateRows, F.TODAY);
  const cn6 = late.result.rows.find((r) => r.right?.number === 'CN-6');
  check('cdn', 'a 2B credit note for an earlier month: "reduce the ITC", no claim and no s.16(4), no earlier-year note',
    cn6?.status === 'only_right' && /^Reduce the ITC for this credit note/.test(cn6.action) && !/claim|16\(4\)/i.test(cn6.action)
    && !cn6.notes.some((n) => n.code === 'EARLIER_YEAR_DOC'), JSON.stringify(cn6 && { s: cn6.status, r: cn6.reason, a: cn6.action, n: cn6.notes }));
}

// ── N-way matcher ───────────────────────────────────────────────────────────
const mk = (source, number, date) => ({ ...s2b.docs.find((d) => d.number === 'A-101'), source, number, date, ref: `${source}${number}` });
const groups = R.matchSources([
  { key: '2A', label: '2A', docs: [mk('2A', 'X-1', '2026-07-01'), mk('2A', 'X-2', '2026-07-02')], covers: () => true },
  { key: '2B', label: '2B', docs: [mk('2B', 'X-1', '2026-07-01')], covers: () => true },
  { key: '8A', label: '8A', docs: [mk('8A', 'x/1', '2026-07-01'), mk('8A', 'X-2', '2026-07-02'), mk('8A', 'X-3', '2026-07-03')], covers: () => true },
]);
check('n-way', 'three sources: X-1 in all three, X-2 in 2A and 8A, X-3 in 8A only', groups.length === 3
  && groups.some((g) => g.docs['2A'] && g.docs['2B'] && g.docs['8A']) && groups.some((g) => g.docs['2A'] && !g.docs['2B'] && g.docs['8A']) && groups.some((g) => !g.docs['2A'] && g.docs['8A']));
check('n-way', '8A rule sets declared (empty) for the next reports', Array.isArray(R.RULES_2A_8A) && Array.isArray(R.RULES_8A_2B));

// ── Pull plan ───────────────────────────────────────────────────────────────
// 25 Sep: the July 2A (pulled 20 Sep) is fresh; on 15 Oct it is stale and asked again (see [findings]).
const p1 = R.planPullJobs({ periods: ['07/2026'], rows: F.julyRows(), today: '2026-09-25', extVersion: '0.13.0' });
check('pull', 'everything pulled: refresh 2A and 2B of the month in one combined job', p1.jobs.length === 1 && p1.jobs[0].mode === 'gstr2a2b_pull' && JSON.stringify(p1.jobs[0].want) === '{"07/2026":["2A","2B"]}' && /again/.test(p1.note || ''), JSON.stringify(p1));
const p2 = R.planPullJobs({ periods: ['07/2026'], rows: F.julyRows({ b08: false, a06: false }), today: '2026-09-25', extVersion: '0.13.0' });
check('pull', '0.13.0: only what is missing (2A of Jun, 2B of Aug), one job', p2.jobs.length === 1 && p2.jobs[0].periods.join() === '06/2026,08/2026' && JSON.stringify(p2.jobs[0].want) === '{"06/2026":["2A"],"08/2026":["2B"]}', JSON.stringify(p2));
const p3 = R.planPullJobs({ periods: ['07/2026'], rows: F.julyRows({ b08: false, a06: false }), today: '2026-09-25', extVersion: '0.12.0' });
check('pull', '0.12.0: one return type per click (2A of Jun, then 2B of Aug)', p3.jobs.length === 2 && p3.jobs[0].mode === 'gstr2a_pull' && p3.jobs[0].periods.join() === '06/2026' && p3.jobs[1].mode === 'gstr2b_pull' && p3.jobs[1].periods.join() === '08/2026', JSON.stringify(p3));
const p4 = R.planPullJobs({ periods: ['07/2026'], rows: [], today: F.TODAY, extVersion: null });
check('pull', 'no extension version known: single-mode jobs; nothing pulled asks for 2A and 2B of Jul and 2B of Aug', p4.jobs.map((j) => `${j.mode}:${j.periods.join('+')}`).join() === 'gstr2a_pull:07/2026,gstr2b_pull:07/2026+08/2026', JSON.stringify(p4));
const p5 = R.planPullJobs({ periods: ['09/2026'], rows: [], today: F.TODAY, extVersion: '0.13.0' });
check('pull', '2B not due yet: Sep 2026 asks 2A and 2B of Sep only (Oct not due before 14 Nov)', JSON.stringify(p5.jobs[0].want) === '{"09/2026":["2A","2B"]}', JSON.stringify(p5));
check('pull', 'describeJob names what is fetched', R.describeJob(p2.jobs[0]) === 'GSTR-2A of Jun 2026; GSTR-2B of Aug 2026', R.describeJob(p2.jobs[0]));

// ── Report ──────────────────────────────────────────────────────────────────
if (process.argv.includes('--show')) {
  // The fictional July as a reader sees it: summary, notes, then each document's status, reason and action.
  console.log(table.title + '\n' + table.subtitle + '\n');
  for (const r of table.summary.rows) console.log(r.slice(0, 8).join(' | '));
  console.log('\n' + table.summary.notes.map((n) => '* ' + n).join('\n') + '\n');
  for (const r of table.rows) console.log(['Status', 'Doc No.', 'Reason', 'What to do', 'Evidence', 'Also note'].map((h) => cell(table, r, h)).filter(Boolean).join(' | '));
}
let fails = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n[${group}]`); }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.info}`}`);
  if (!r.ok) fails++;
}
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
