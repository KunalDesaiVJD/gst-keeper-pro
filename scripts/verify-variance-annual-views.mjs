#!/usr/bin/env node
// Checks how the variance view (VarianceComparisonView) and the annual trend
// view (AnnualTrendView) read their reports before the table kit draws them:
// src/components/reports/views/varianceRules.ts and annualTrendRules.ts, on
// fictional tables shaped exactly like the fourteen builders' (GSTR-3B vs
// GSTR-1 / 2A / 2B, liability declared vs paid, RCM, the four PAN roll-ups,
// and the four one-client-across-the-year reports), alone and merged over two
// months with the app's own mergeTables.
//
//   node scripts/verify-variance-annual-views.mjs
//
// Covers: which column is the delta (never a cess or a total payable); a
// mismatch is a variance beyond 0.50 either way, as a filter on the delta
// column the kit applies; whether the rows add up to the report's TOTAL (a
// list: a TOTAL recomputed under a filter) or are unlike measures (a
// statement: none); the kit's summable override; the quarter of a month; a
// month not pulled read from any cell; the headline figure. Prints pass / fail;
// exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const alias = {
  name: 'alias',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export * from './src/components/reports/views/tableKit/tableModel';
      export * from './src/components/reports/views/varianceRules';
      export * from './src/components/reports/views/annualTrendRules';
      export { mergeTables } from './src/lib/reportPeriodMerge';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [alias], logLevel: 'error',
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const view = (patch = {}) => ({ ...M.EMPTY_VIEW, filters: {}, ...patch });
const T = (title, headers, rows, extra = {}) => ({ title, subtitle: 'Client: FICTIONAL TRADERS   |   GSTIN: 24ABCDE1234F1Z5   |   Period: Jun 2026', headers, rows, fileNameBase: title.replace(/\W+/g, '_'), columnWidths: headers.map(() => 14), ...extra });
const shapeOf = (t) => {
  const s = M.readShape(t);
  const model = M.buildModel({ ...t, rowKinds: s.rowKinds });
  return { s, model, delta: M.deltaColumn(model) };
};

// ── The variance reports, shaped as their builders shape them ─────────────
const perHead = (title, a, b, vals) => T(title, ['Tax Head', a, b, 'Variance'], [
  ...vals.map(([h, x, y]) => [h, x, y, y - x]),
  ['Total', vals.reduce((s, v) => s + v[1], 0), vals.reduce((s, v) => s + v[2], 0), vals.reduce((s, v) => s + v[2] - v[1], 0)],
]);
const itc2b = perHead('GSTR 3B vs GSTR 2B ITC Report', 'As per GSTR-2B (B2B, ITC-eligible)', 'As per GSTR-3B (Table 4A, gross ITC available)', [['IGST', 1000, 1000.3], ['CGST', 500, 650], ['SGST', 500, 499.5]]);
const g1tax = T('GSTR 3B vs GSTR 1 Tax Report', ['Component', 'As per GSTR-1 (Total Liability, as filed)', 'As per GSTR-3B (Table 3.1, as filed)', 'Variance'], [
  ['Taxable Value', 100000, 100000, 0], ['IGST', 18000, 18000, 0], ['CGST', 0, 120, 120], ['SGST', 0, 120, 120], ['Total Tax', 18000, 18240, 240],
]);
const g1cmp = T('GSTR 3B vs GSTR 1 Comparison Report', ['GSTR-1 Section', 'Description', 'Maps to GSTR-3B Table', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'], [
  ['B2B', 'B2B Invoices', '3.1(a)', 80000, 14400, 0, 0, 0],
  ['B2CS', 'B2C (Small)', '3.1(a)', 20000, 0, 1800, 1800, 0],
  ['CDNR', 'Credit/Debit Notes (Registered)', '3.1(a) (net)', 1000, 180, 0, 0, 0],
  ['EXP', 'Exports', '3.1(b)', 5000, 0, 0, 0, 12],
  ['', '', '', '', '', '', '', ''],
  ['', 'GSTR-3B Table 3.1(a) — Outward taxable supplies, as filed', '', 100000, 14400, 1800, 1800, ''],
  ['', 'GSTR-3B Table 3.1(b) — Zero rated supplies, as filed', '', 5000, 0, 0, 0, ''],
]);
const declared = T('Difference in Liability Declared and Paid', ['Tax Head', 'Amount'], [
  ['IGST', 18000], ['CGST', 120], ['SGST', 120], ['Total', 18240], ['', ''],
  ['As-filed payment (aggregate — the portal\'s own summary API doesn\'t split this by tax head)', ''],
  ['Cash paid', 5000], ['ITC utilised', 13240], ['Total payable (as filed)', 18240],
]);
const rcm = perHead('Reverse Charge Liability Declared and ITC Claimed Thereon', 'RCM Liability Declared (3.1d)', 'RCM ITC Claimed (4A(3))', [['IGST', 0, 0], ['CGST', 90, 90], ['SGST', 90, 90]]);
const panSub = 'PAN: ABCDE1234F   |   3 GSTIN(s), 2 pulled for this period   |   Period: Jun 2026   |   Both sides as filed on the portal for each entity.';
const panOut = T('Output Liability as per GSTR 1 and GSTR 3B (PAN-Based)', ['Entity (GSTIN)', 'GSTIN', 'GSTR-1 Output Tax', 'GSTR-3B Output Liability', 'Variance'], [
  ['ALPHA TRADERS', '24ABCDE1234F1Z5', 18000, 18240, 240], ['BETA TRADERS', '27ABCDE1234F1Z1', 5000, 5000, 0], ['GAMMA TRADERS', '29ABCDE1234F1Z9', 'NOT PULLED', '', ''],
  ['TOTAL — PAN ABCDE1234F', '', 23000, 23240, 240],
], { subtitle: panSub });
const panItc = T('Liability as per GSTR 1 and ITC Claimed as per GSTR 3B (PAN-Based)', ['Entity (GSTIN)', 'GSTIN', 'GSTR-1 Output Liability', 'GSTR-3B ITC Claimed (Table 4A)', 'Liability − ITC'], [
  ['ALPHA TRADERS', '24ABCDE1234F1Z5', 18000, 12000, 6000], ['BETA TRADERS', '27ABCDE1234F1Z1', 5000, 5000, 0],
  ['TOTAL — PAN ABCDE1234F', '', 23000, 17000, 6000],
], { subtitle: panSub });
// A partial pull: GAMMA has its 2A, not its 2B, so the TOTAL's 2B − 2A is not the sum of the rows'.
const pan2a2b = T('GSTR 2A/2B Multiple Company Report', ['Entity (GSTIN)', 'GSTIN', '2A Doc Count', '2A Total (Value + Tax)', '2B Doc Count', '2B Total (Value + Tax)', '2B − 2A'], [
  ['ALPHA TRADERS', '24ABCDE1234F1Z5', 12, 118000, 11, 117000, -1000], ['BETA TRADERS', '27ABCDE1234F1Z1', 3, 5900, 3, 5900, 0],
  ['GAMMA TRADERS', '29ABCDE1234F1Z9', 4, 2360, 'NOT PULLED', '', ''],
  ['TOTAL — PAN ABCDE1234F', '', '', 126260, '', 122900, -3360],
], { subtitle: panSub });
const panNet = T('Net Output Liability Report (PAN-Based)', ['Entity (GSTIN)', 'GSTIN', 'Total Liability', 'Net ITC Available', 'Total Payable (as filed)'], [
  ['ALPHA TRADERS', '24ABCDE1234F1Z5', 18240, 12000, 6240], ['BETA TRADERS', '27ABCDE1234F1Z1', 5000, 0, 5000],
  ['TOTAL — PAN ABCDE1234F', '', 23240, 12000, 11240],
], { subtitle: panSub });

{
  const g = 'delta column';
  const d = (t) => shapeOf(t).delta;
  check(g, 'GSTR-3B vs 2B: Variance, worded a mismatch', d(itc2b)?.col === 3 && d(itc2b)?.wording === 'mismatch', JSON.stringify(d(itc2b)));
  check(g, 'GSTR-3B vs GSTR-1 tax: Variance', d(g1tax)?.col === 3);
  check(g, 'GSTR-3B vs GSTR-1 comparison: none (Cess is a figure, not a difference)', d(g1cmp) === null, JSON.stringify(d(g1cmp)));
  check(g, 'liability declared vs paid: none', d(declared) === null, JSON.stringify(d(declared)));
  check(g, 'RCM: Variance', d(rcm)?.col === 3);
  check(g, 'PAN output liability: Variance', d(panOut)?.col === 4);
  check(g, 'PAN liability vs ITC: "Liability − ITC", worded a difference', d(panItc)?.col === 4 && d(panItc)?.wording === 'difference', JSON.stringify(d(panItc)));
  check(g, 'PAN 2A/2B: "2B − 2A"', d(pan2a2b)?.col === 6, JSON.stringify(d(pan2a2b)));
  check(g, 'PAN net output liability: none (a payable is not a mismatch)', d(panNet) === null, JSON.stringify(d(panNet)));
}

{
  const g = 'list or statement';
  const per = shapeOf(itc2b);
  check(g, 'per-head table adds up: a list, every figure summable', !per.s.statement && per.s.summable.join() === '1,2,3', JSON.stringify(per.s.summable));
  check(g, '… its Total is the grand TOTAL pinned', per.model.grandTotal?.i === 3, per.model.grandTotal?.i);
  const tax = shapeOf(g1tax);
  check(g, 'GSTR-1 tax (taxable value above the tax heads): a statement, nothing summed', tax.s.statement && tax.s.summable.length === 0);
  check(g, '… "Total Tax" a row like the others, drawn bold', tax.s.rowKinds[4] === 'data' && M.isTotalLabelRow(g1tax.rows[4]));
  const cmp = shapeOf(g1cmp);
  check(g, 'GSTR-1 sections above the GSTR-3B rows: a statement', cmp.s.statement && cmp.s.rowKinds[4] === 'blank');
  const dec = shapeOf(declared);
  check(g, 'declared above paid: a statement, the lone label a heading', dec.s.statement && dec.s.rowKinds[5] === 'section' && dec.s.rowKinds[3] === 'data', JSON.stringify(dec.s.rowKinds));
  const out = shapeOf(panOut);
  check(g, 'PAN roll-up adds up (a NOT PULLED entity counts nil)', !out.s.statement && out.s.summable.join() === '2,3,4', JSON.stringify(out.s.summable));
  const p2 = shapeOf(pan2a2b);
  check(g, 'PAN 2A/2B with a partial pull: the two totals add up, the difference does not', !p2.s.statement && p2.s.summable.join() === '3,5', JSON.stringify(p2.s.summable));
  const merged = M.mergeTables([itc2b, perHead('GSTR 3B vs GSTR 2B ITC Report', 'As per GSTR-2B (B2B, ITC-eligible)', 'As per GSTR-3B (Table 4A, gross ITC available)', [['IGST', 10, 10], ['CGST', 5, 5], ['SGST', 5, 7]])], ['06/2026', '07/2026']);
  const mg = shapeOf(merged);
  check(g, 'two months merged: each TOTAL adds up its month, a list', !mg.s.statement && mg.s.summable.join() === '1,2,3' && mg.model.merged, JSON.stringify(mg.s));
  const mt = shapeOf(M.mergeTables([g1tax, g1tax], ['06/2026', '07/2026']));
  check(g, 'a statement merged stays a statement', mt.s.statement && mt.model.merged);
}

{
  const g = 'mismatches only';
  const { s, model, delta } = shapeOf(itc2b);
  const f = M.MISMATCH_FILTER;
  const shown = M.applyFilters(model, view({ filters: { [delta.col]: f } }));
  check(g, 'a variance of 150 is a mismatch; 0.30 and -0.50 are rounding', shown.map((r) => r.cells[0]).join() === 'CGST', shown.map((r) => r.cells[0]).join());
  check(g, 'isMismatch agrees with the filter', model.data.filter((r) => M.isMismatch(r.cells[3])).map((r) => r.cells[0]).join() === 'CGST');
  check(g, 'just past the tolerance is a mismatch', M.isMismatch(0.51) && !M.isMismatch(0.5) && !M.isMismatch(-0.5) && M.isMismatch(-0.51) && !M.isMismatch('NOT PULLED'));
  check(g, 'the chip says what it keeps', M.describeFilter(model, delta.col, f) === 'Variance not nil (more than 0.50 either way)', M.describeFilter(model, delta.col, f));
  check(g, 'a plain "not nil" is unchanged (only a true nil left out)', M.applyFilters(model, view({ filters: { [delta.col]: { type: 'number', min: null, max: null, nonZero: true } } })).length === 3);
  const v = M.buildView(model, view({ filters: { [delta.col]: f } }));
  check(g, 'a list under the filter: the TOTAL recomputed over the mismatched rows', v.footer?.type === 'sum' && v.footer.sums.get(3) === 150 && s.summable.includes(3), JSON.stringify(v.footer && [...v.footer.sums]));
  const exp = M.viewToReportTable({ ...itc2b, rowKinds: s.rowKinds }, model, view({ filters: { [delta.col]: f } }), new Set());
  check(g, 'the export names the filter', /Variance not nil \(more than 0\.50 either way\)/.test(exp.subtitle), exp.subtitle);
  const pan = shapeOf(panOut);
  const panShown = M.applyFilters(pan.model, view({ filters: { [pan.delta.col]: f } }));
  check(g, 'PAN: a NOT PULLED entity is never called a mismatch', panShown.map((r) => r.cells[0]).join() === 'ALPHA TRADERS', panShown.map((r) => r.cells[0]).join());
}

{
  const g = 'statement: no sums';
  const { s, model, delta } = shapeOf(g1tax);
  const m = M.withSummable(model, s.summable);
  const v = M.buildView(m, view({ filters: { [delta.col]: M.MISMATCH_FILTER } }));
  check(g, 'filtered: Total Tax kept as a mismatched row, no TOTAL (filtered) adding taxable value to tax', v.rows.map((r) => r.cells[0]).join() === 'CGST,SGST,Total Tax' && v.footer === null, JSON.stringify([v.rows.map((r) => r.cells[0]), v.footer]));
  const grouped = M.buildView(M.withSummable(shapeOf(g1cmp).model, []), view({ groupBy: 2 }));
  check(g, 'grouped by the GSTR-3B table: groups without subtotals', grouped.groups?.length === 4 && grouped.groups.every((x) => x.sums.size === 0), JSON.stringify(grouped.groups?.map((x) => [x.key, x.sums.size])));
  const exp = M.viewToReportTable({ ...g1tax, rowKinds: s.rowKinds }, m, view({ filters: { [delta.col]: M.MISMATCH_FILTER } }), new Set());
  check(g, 'the export prints the rows shown and no TOTAL', exp.rows.length === 3 && !exp.rowKinds.includes('total'), JSON.stringify(exp.rowKinds));
  const sum = M.withSummable(model, [0, 3]);
  check(g, 'withSummable keeps only figure columns', sum.summable.join() === '3' && sum.columns[3].summable && !sum.columns[1].summable);
}

{
  const g = 'PAN banner and subtitle';
  check(g, 'PAN and entity count read', JSON.stringify(M.parsePanBanner(panSub)) === JSON.stringify({ pan: 'ABCDE1234F', declaredEntityCount: 3 }));
  const sp = M.splitSubtitle(panSub, false, /^PAN:/i);
  check(g, 'identification parts apart from the note', sp.parts.join(' | ') === '3 GSTIN(s), 2 pulled for this period | Period: Jun 2026' && sp.notes.length === 1, JSON.stringify(sp));
  const spm = M.splitSubtitle('Client: X   |   Period: Jun 2026   |   2 periods combined', true);
  check(g, 'a merge drops the first month', spm.parts.join(' | ') === 'Client: X | 2 periods combined', JSON.stringify(spm));
}

// ── The annual reports ────────────────────────────────────────────────────
const MONTHS = ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027'];
const annual3b = (() => {
  let t = [0, 0, 0, 0, 0, 0];
  const rows = MONTHS.map((m, i) => {
    if (i > 3) return [m, 'NOT PULLED', '', '', '', '', ''];
    const r = [1000 * (i + 1), 100, 1100 * (i + 1) - 1000 * i, 900, 850, 250 * (i + 1)];
    t = t.map((x, k) => x + r[k]);
    return [m, ...r];
  });
  return T('GSTR 3B Annual Summary Report', ['Month', 'Outward Liability', 'RCM Liability', 'Total Liability', 'ITC Available', 'Net ITC', 'Total Payable (as filed)'], [...rows, ['TOTAL — FY 2026-27', ...t]],
    { subtitle: 'Client: FICTIONAL TRADERS   |   GSTIN: 24ABCDE1234F1Z5   |   FY 2026-27   |   As filed on the portal for each month (4/12 months pulled).' });
})();
const susOne = (() => {
  const rows = MONTHS.map((m, i) => [i + 1, m, 10 * i, 10 * i, 5 * i, 25 * i]);
  const tot = [2, 3, 4, 5].map((c) => rows.reduce((s, r) => s + r[c], 0));
  return T('Suspended Ledger — Closing Balance — All Months', ['Sr No.', 'Month', 'CGST', 'SGST', 'IGST', 'TOTAL'], [...rows, ['', 'TOTAL', ...tot]]);
})();
const credLiab = T('Credit And Liability Statement', ['Month', 'Total Liability', 'ITC Set Off (as filed)', 'Paid in Cash (as filed)'], [
  ...MONTHS.map((m, i) => (i < 2 ? [m, 1000, 600, 400] : [m, 'NOT PULLED', '', ''])), ['TOTAL — FY 2026-27', 2000, 1200, 800],
]);

{
  const g = 'annual trend';
  check(g, 'quarters of the FY, FY first', M.quarterOf('Apr 2026') === 'FY 2026-27 Q1 (Apr to Jun)' && M.quarterOf('Dec 2026') === 'FY 2026-27 Q3 (Oct to Dec)' && M.quarterOf('Mar 2027') === 'FY 2026-27 Q4 (Jan to Mar)' && M.quarterOf('TOTAL — FY 2026-27') === '', M.quarterOf('Mar 2027'));
  check(g, 'month column found after a Sr No.', M.monthColumn(susOne.headers) === 1 && M.monthColumn(annual3b.headers) === 0);
  const { table: q, quarterCol } = M.withQuarterColumn(susOne, 1);
  check(g, 'a Quarter column added at the end, widths and rows alike', quarterCol === 6 && q.headers[6] === 'Quarter' && q.columnWidths.length === 7 && q.rows.every((r) => r.length === 7) && q.rows[12][6] === '');
  const qm = M.buildModel(q);
  const byQ = M.buildView(qm, view({ groupBy: quarterCol }));
  check(g, 'grouped by quarter: four groups of three, subtotals add up', byQ.groups?.length === 4 && byQ.groups.every((x) => x.rows.length === 3) && byQ.groups[0].sums.get(5) === 25 * (0 + 1 + 2), JSON.stringify(byQ.groups?.map((x) => [x.label, x.sums.get(5)])));
  const qx = M.viewToReportTable(q, qm, view({ groupBy: quarterCol }), new Set([quarterCol]));
  const qn = M.withoutQuarterNote(qx);
  check(g, 'the export does not call the added Quarter column hidden', /Columns hidden: Quarter/.test(qx.subtitle) && !/Columns hidden/.test(qn.subtitle) && /grouped by Quarter/.test(qn.subtitle), qn.subtitle);
  const qy = M.withoutQuarterNote(M.viewToReportTable(q, qm, view(), new Set([0, quarterCol])));
  check(g, '… other hidden columns still named', /Columns hidden: Sr No\.(\s|$)/.test(qy.subtitle), qy.subtitle);
  const kp = M.shortKpiLabels({ kpis: [{ label: 'As per GSTR-3B (Table 4A, gross ITC available)', value: '1' }, { label: 'Total Payable (as filed)', value: '2' }] });
  check(g, 'export stat band: a long label keeps the words before its bracket; a short one stays', kp.kpis[0].label === 'As per GSTR-3B' && kp.kpis[1].label === 'Total Payable (as filed)', JSON.stringify(kp.kpis));
  check(g, 'annual tables add up: lists', [annual3b, susOne, credLiab].every((t) => !M.readShape(t).statement));
  check(g, 'a month not pulled is read from any cell (GSTR-3B summary: under Outward Liability)', M.isNotPulledRow(annual3b.rows[5]) && !M.isNotPulledRow(annual3b.rows[0]));
  const hm = M.buildModel(annual3b);
  const head = M.headlineColumn(annual3b.headers, (c) => M.isFigureColumn(hm, c));
  check(g, 'headline: the rightmost Total figure', head === 6, head);
  const live = (model) => (c) => model.data.some((r) => typeof r.cells[c] === 'number' && Math.abs(r.cells[c]) >= 0.005);
  check(g, 'a headline nil all year gives way (Total Payable nil: Total Liability)', M.headlineColumn(annual3b.headers, (c) => M.isFigureColumn(hm, c), (c) => c !== 6 && live(hm)(c)) === 3);
  const cred = T('Credit Ledger — Closing Balance — All Months', ['Sr No.', 'Month', 'CGST', 'SGST', 'IGST', 'TOTAL', 'GST Payable CGST', 'GST Payable SGST', 'GST Payable IGST', 'GST Payable TOTAL'], [
    ...MONTHS.slice(2).map((m, i) => [i + 1, m, 100, 200, 0, 300, 0, 0, 0, 0]), ['', 'TOTAL', 1000, 2000, 0, 3000, 0, 0, 0, 0],
  ]);
  const cm = M.buildModel(cred);
  check(g, 'credit ledger with no cash payable: the chart opens on the closing TOTAL', M.headlineColumn(cred.headers, (c) => M.isFigureColumn(cm, c), live(cm)) === 5);
  check(g, '… and on the payable when there is one', M.headlineColumn(cred.headers, (c) => M.isFigureColumn(cm, c)) === 9);
  const sm = M.buildModel(susOne);
  check(g, 'headline never the month or the serial', M.headlineColumn(susOne.headers, (c) => M.isFigureColumn(sm, c)) === 5);
  const months = M.buildModel(credLiab);
  const pick = M.applyFilters(months, view({ filters: { 0: { type: 'values', values: ['Apr 2026', 'May 2026'] } } }));
  const v = M.buildView(months, view({ filters: { 0: { type: 'values', values: ['Apr 2026', 'May 2026'] } } }));
  check(g, 'filtering months: the TOTAL follows', pick.length === 2 && v.footer?.type === 'sum' && v.footer.sums.get(1) === 2000 && months.columns[0].filter === 'values');
  const sorted = M.buildView(months, view({ sort: { col: 1, dir: 'desc' } }));
  check(g, 'sorted by a figure: a NOT PULLED month sorts with the blanks, last', sorted.rows.slice(-1)[0].cells[1] === 'NOT PULLED' && sorted.footer?.type === 'total');
}

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info.slice(0, 300)}]`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
