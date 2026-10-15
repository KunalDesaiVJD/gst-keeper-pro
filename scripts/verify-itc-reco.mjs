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
// table shape, the Excel sheets, the multi-month merge and the Pull plan.
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
      export { reportToWorkbook } from './src/utils/allClientsReports';
      export { planPullJobs, describeJob } from './src/utils/gstr2aVs2bReports';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'error',
  loader: { '.png': 'dataurl' },
  // SheetJS (for the Excel check) requires Node built-ins at run time.
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
check('case 19', 'credit note: amounts negative in the table, kept out of the difference', cn && cn.diff.tax === 0
  && R.docRow(cn, '2A', '2B')[22] === -180 && R.docRow(cn, '2A', '2B')[23] === '', JSON.stringify(cn && R.docRow(cn, '2A', '2B').slice(11, 24)));

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
  check('findings', 'several months: a month without a 2B shows its reason, the others are built', m.rows.some((r) => r[1] === 'TOTAL (07/2026)') && m.summary.notes.some((n) => n === '04/2026: Not built: The portal had no GSTR-2B for Apr 2026.'), JSON.stringify(m.summary.notes));
  check('findings', 'several months: the subtitle keeps client and GSTIN, each month its own pull dates in the notes', m.subtitle === 'Client: Fictional Fabrics Pvt Ltd   |   GSTIN: 24ABCDE1234F1Z5   |   2 periods combined'
    && m.summary.notes.includes('07/2026: As of: 2A pulled 20 Sep 2026; 2B generated 14 Aug 2026.'), m.subtitle);
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
const table = R.toReportTable(main.result, { title: 'GSTR-2A vs GSTR-2B Reconciliation', client: F.CLIENT, period: F.PERIOD, left: main.twoA, right: main.twoB });
const docTotal = table.rows[table.rows.length - 1];
const sumTotal = table.summary.rows[table.summary.rows.length - 1];
const lines = table.summary.rows.slice(0, -1);
const col = (rows, c) => rows.reduce((s, r) => s + (typeof r[c] === 'number' ? r[c] : 0), 0);
const sumCols = [[3, 11], [4, 12], [5, 21], [6, 22], [7, 23]]; // summary column ↔ document column
check('totals', 'summary lines add up to the summary TOTAL', [2, 3, 4, 5, 6, 7].every((c) => near(col(lines, c), sumTotal[c])), JSON.stringify(sumTotal));
check('totals', 'summary TOTAL = document TOTAL (taxable, tax, difference)', sumCols.every(([s, d]) => near(sumTotal[s], docTotal[d])), JSON.stringify([sumTotal.slice(3, 8), [11, 12, 21, 22, 23].map((c) => docTotal[c])]));
check('totals', 'documents counted once each', sumTotal[2] === main.result.rows.length);
const all2B = s2b.docs.reduce((s, d) => s + R.docSign(d) * R.docTax(d), 0);
check('totals', '2B tax TOTAL = signed sum of every 2B document', near(docTotal[22], all2B), `${docTotal[22]} vs ${all2B}`);
const all2A = s2a.docs.reduce((s, d) => s + R.docSign(d) * R.docTax(d), 0);
check('totals', '2A tax TOTAL = signed sum of every 2A document', near(docTotal[21], all2A), `${docTotal[21]} vs ${all2A}`);
const compared = main.result.rows.filter((r) => r.status !== 'not_compared');
const diffCompared = compared.reduce((s, r) => s + R.signedTax(r.right) - R.signedTax(r.left), 0);
check('totals', 'difference TOTAL = 2B minus 2A over the compared documents', near(docTotal[23], diffCompared), `${docTotal[23]} vs ${diffCompared}`);
check('totals', 'heads add up to the total tax on every row', table.rows.slice(0, -1).every((r) => near((+r[13] || 0) + (+r[15] || 0) + (+r[17] || 0) + (+r[19] || 0), +r[21] || 0) && near((+r[14] || 0) + (+r[16] || 0) + (+r[18] || 0) + (+r[20] || 0), +r[22] || 0)));

// ── 22: table shape ─────────────────────────────────────────────────────────
check('table', '27 document columns, every row the same length', table.headers.length === 27 && table.rows.every((r) => r.length === 27) && table.columnWidths.length === 27);
check('table', 'summary rows the length of its headers', table.summary.rows.every((r) => r.length === table.summary.headers.length) && table.summary.columnWidths.length === table.summary.headers.length);
check('table', "last row of each part is ['', 'TOTAL', …]", docTotal[0] === '' && docTotal[1] === 'TOTAL' && sumTotal[1] === 'TOTAL');
const pdfMm = (ws) => ws.reduce((s, w) => s + Math.max(w * 2, 14), 0);
check('table', 'PDF columns fit 265 mm (documents and summary)', pdfMm(table.pdfColumns.map((i) => table.columnWidths[i])) <= 265 && pdfMm(table.summary.columnWidths) <= 265,
  `${pdfMm(table.pdfColumns.map((i) => table.columnWidths[i]))} / ${pdfMm(table.summary.columnWidths)}`);
check('table', 'PDF keeps Status and Reason first, TOTAL in its column 1', table.pdfColumns[0] === 0 && table.pdfColumns[1] === 1);
check('table', "no reason label contains the word 'total'", !Object.values(R.REASONS).some((x) => /total/i.test(x.label)));
check('table', 'only the TOTAL rows hold an exact TOTAL cell', table.rows.filter((r) => r.some((c) => String(c).toUpperCase() === 'TOTAL')).length === 1);
check('table', 'rows sorted: Only in 2A, Only in 2B, Figures differ, ITC differs, Not compared, Matched', (() => {
  const order = ['Only in 2A', 'Only in 2B', 'Figures differ', 'ITC differs', 'Not compared', 'Matched'];
  const idx = table.rows.slice(0, -1).map((r) => order.indexOf(r[0]));
  return idx.every((v, i) => v >= 0 && (i === 0 || v >= idx[i - 1]));
})());
check('table', 'subtitle short: client, GSTIN, month, pull dates', table.subtitle === 'Client: Fictional Fabrics Pvt Ltd   |   GSTIN: 24ABCDE1234F1Z5   |   Jul 2026   |   2A pulled 20 Sep 2026   |   2B generated 14 Aug 2026', table.subtitle);
check('table', 'a not-confirmed row says so in the Reason cell (the PDF has no Evidence column)', table.rows.some((r) => /\(not confirmed\)$/.test(String(r[1]))));
const wb = R.reportToWorkbook(table);
check('excel', 'workbook sheets: Summary, Documents', wb.SheetNames.join() === 'Summary,Documents', wb.SheetNames.join());
check('excel', 'a report without a summary keeps one sheet "Report"', R.reportToWorkbook({ ...table, summary: undefined }).SheetNames.join() === 'Report');

// ── 23: several months ──────────────────────────────────────────────────────
const fake = { needs: 'client+month', build: async ({ month }) => R.toReportTable(main.result, { client: F.CLIENT, period: month, left: main.twoA, right: main.twoB }) };
const merged = await R.buildForPeriods(fake, ['06/2026', '07/2026'], F.CLIENT.id);
check('merge', 'rows carry the period headings and TOTAL (07/2026)', merged.rows.some((r) => r[0] === '— 07/2026 —') && merged.rows.some((r) => r[1] === 'TOTAL (07/2026)') && merged.rows.some((r) => r[1] === 'TOTAL (06/2026)'));
check('merge', 'summary carries the period headings and TOTAL (07/2026)', merged.summary.rows.some((r) => r[0] === '— 07/2026 —') && merged.summary.rows.some((r) => r[1] === 'TOTAL (07/2026)'));
check('merge', 'notes prefixed with their period; pdfColumns kept', merged.summary.notes.every((n) => /^0[67]\/2026: /.test(n)) && merged.pdfColumns === table.pdfColumns);
check('merge', 'mergeRows is the shared row merge', R.mergeRows([[['a', 'TOTAL']]], ['07/2026'], 2)[1][1] === 'TOTAL (07/2026)');

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
  for (const r of table.rows) console.log([r[0], r[7], r[1], r[2], r[3], r[26]].filter(Boolean).join(' | '));
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
