#!/usr/bin/env node
// Checks for the Rule 42 and Rule 43 workings of the Annual Return (src/lib/gstr9/rule42.ts
// and its wiring in engine.ts), on small hand-made workings. Needs no client data:
//
//   node scripts/verify-gstr9-rule42.mjs

import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (rel) => {
  const out = buildSync({ entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const E = await load('src/lib/gstr9/engine.ts');
const D = await load('src/lib/gstr9/defaults.ts');
const R = await load('src/lib/gstr9/rule42.ts');
const PP = await load('src/lib/gstr9/portalParser.ts');
const R43 = await load('src/lib/gstr9/rule43.ts');
const RS = await load('src/lib/gstr9/rule4243Reasons.ts');
const J = await load('src/lib/gstr9/gstr9cJson.ts');

const FY = '2024-25';
const ctx = { clientName: 'Test', gstin: '27AAAAA0000A1Z5', financialYear: FY, noItcBuilder: false };
let failed = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.011;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
};
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
};
const M = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];
const day = 86_400_000;
const daysBetween = (a, b) => Math.round((b - a) / day);

/** A year: each month 1,000 CGST + 1,000 SGST credit in 4A, 3.1 values taxable / exempt as given. */
const year = ({ taxable = 90000, exempt = 10000, partA = 1080000, partBExempt = 120000 } = {}) => {
  const d = D.emptyDocs();
  M.forEach((m) => {
    d.portal.months[m].itc4aTotal = { i: 0, c: 1000, s: 1000, x: 0 };
    d.portal.months[m].turnover = { taxable, zero: 0, nilExempt: exempt, nonGst: 0 };
    d.portal.monthMeta[m] = { source: 'as_filed_3b' };
  });
  d.sales.partA = [{ id: 'a', ledger: 'Sales', category: 'b2b', supplyType: 'intra', rate: 18, taxable: partA, igst: 0, cgst: partA * 0.09, sgst: null, cess: 0 }];
  d.sales.partB = [{ id: 'b', ledger: 'Exempt sales', nature: 'exempt', amount: partBExempt }];
  d.gstr9.r42 = D.emptyRule42();
  d.gstr9.r42.enabled = true;
  return d;
};

// 1. Steady ratio, one month not reversed.
{
  const d = year();
  M.forEach((m) => { d.gstr9.r42.months[m].reversed = { i: 0, c: 100, s: null, x: 0 }; });
  d.gstr9.r42.months.jun.reversed = null;
  const w = E.computeWorkings(d, ctx);
  eq('1 ratio of a month', w.r42.periods[0].ratio, 0.1);
  eq('1 D1 a month (CGST)', w.r42.periods[0].d1.c, 100);
  eq('1 provisional for the year (CGST)', w.r42.provisional.c, 1200);
  eq('1 final for the year (CGST)', w.r42.annual.final.c, 1200);
  eq('1 true-up nil', w.r42.trueUp.c, 0);
  eq('1 reversed in 3B', w.r42.reversed.c, 1100);
  eq('1 still due (CGST)', w.r42.payable.c, 100);
  eq('1 GSTR-9 7C = final', w.g9.t7.C.c, 1200);
  // June 3B due 20 Jul 2024; true-up posted in 09/2025, due 20 Oct 2025.
  const dJun = daysBetween(Date.UTC(2024, 6, 20), Date.UTC(2025, 9, 20));
  eq('1 interest days on June', w.r42.periods[2].interestDays, dJun);
  eq('1 interest on June (CGST)', w.r42.periods[2].interest.c, Math.round(100 * 0.18 * dJun / 365 * 100) / 100);
  const comp = w.payables.input.components.find((c) => c.key === 'r42');
  eq('1 Payables carries the reversal due', comp ? comp.value.c : -1, 100);
  is('1 posting period defaults to September after the year', w.r42.postingPeriod, '09/2025');
}

// 2. Annual ratio higher than the months: a true-up with interest from 1 April.
{
  const d = year({ partA: 960000, partBExempt: 240000 });
  M.forEach((m) => { d.gstr9.r42.months[m].reversed = { i: 0, c: 100, s: null, x: 0 }; });
  const w = E.computeWorkings(d, ctx);
  eq('2 final ratio', w.r42.annual.ratio, 0.2);
  eq('2 final (CGST)', w.r42.annual.final.c, 2400);
  eq('2 true-up (CGST)', w.r42.trueUp.c, 1200);
  const days = daysBetween(Date.UTC(2025, 3, 1), Date.UTC(2025, 9, 20));
  eq('2 true-up interest days', w.r42.trueUpInterestDays, days);
  eq('2 true-up interest (CGST)', w.r42.interestTrueUp.c, Math.round(1200 * 0.18 * days / 365 * 100) / 100);
  eq('2 no short months', w.r42.interestShort.c, 0);
  const f = w.diffs.find((x) => x.key === 'itc.r42F');
  is('2 F books vs periods matches', f ? f.open : null, false);
}

// 3. Annual ratio lower: a re-credit, nothing payable.
{
  const d = year({ partA: 1140000, partBExempt: 60000 });
  M.forEach((m) => { d.gstr9.r42.months[m].reversed = { i: 0, c: 100, s: null, x: 0 }; });
  const w = E.computeWorkings(d, ctx);
  eq('3 final (CGST)', w.r42.annual.final.c, 600);
  eq('3 re-credit (CGST)', w.r42.recredit.c, 600);
  eq('3 nothing payable', w.r42.payable.c, 0);
  eq('3 no true-up interest', w.r42.interestTrueUp.c, 0);
}

// 4. T4 tagged on Purchases, spread over the months.
{
  const d = year();
  d.purchases.rows = [{ id: 'p', section: 'expense', ledger: 'Export freight', supplyType: 'intra', rate: 18, taxable: 13333.33, igst: 0, cgst: 1200, sgst: null, cess: 0, head: null, use: 't4' }];
  const w = E.computeWorkings(d, ctx);
  eq('4 T4 a month (CGST)', w.r42.periods[0].t4.c, 100);
  eq('4 C2 a month (CGST)', w.r42.periods[0].c2.c, 900);
  eq('4 D1 a month (CGST)', w.r42.periods[0].d1.c, 90);
  eq('4 final (CGST)', w.r42.annual.final.c, 1080);
}

// 5. Capital goods credit leaves T; D2 on.
{
  const d = year();
  d.purchases.rows = [{ id: 'cg', section: 'capital_goods', ledger: 'Machine', supplyType: 'intra', rate: 18, taxable: 13333.33, igst: 0, cgst: 1200, sgst: null, cess: 0, head: null }];
  d.gstr9.r42.d2 = true;
  d.gstr9.r42.d2Reason = 'Office car used by directors';
  const w = E.computeWorkings(d, ctx);
  eq('5 T a month after capital goods (CGST)', w.r42.periods[0].t.c, 900);
  eq('5 D2 a month (CGST)', w.r42.periods[0].d2.c, 45);
  eq('5 final D1 + D2 (CGST)', w.r42.annual.final.c, 900 * 12 * 0.15);
}

// 6. A month with no turnover takes the last month's ratio.
{
  const d = year();
  d.portal.months.may.turnover = { taxable: 0, zero: 0, nilExempt: 0, nonGst: 0 };
  d.gstr9.r42.months.apr.e = 30000; d.gstr9.r42.months.apr.f = 100000;
  const w = E.computeWorkings(d, ctx);
  eq('6 April typed ratio', w.r42.periods[0].ratio, 0.3);
  is('6 May ratio source', w.r42.periods[1].ratioSource, 'carried');
  eq('6 May ratio carried', w.r42.periods[1].ratio, 0.3);
  is('6 F books vs periods needs a reason', w.diffs.find((x) => x.key === 'itc.r42F').open, true);
}

// 7. QRMP: four quarters, filed in the quarter's last month.
{
  const d = year();
  M.forEach((m, k) => {
    const end = k % 3 === 2;
    d.portal.months[m].itc4aTotal = end ? { i: 0, c: 3000, s: 3000, x: 0 } : { i: 0, c: 0, s: 0, x: 0 };
    d.portal.months[m].turnover = end ? { taxable: 270000, zero: 0, nilExempt: 30000, nonGst: 0 } : { taxable: 0, zero: 0, nilExempt: 0, nonGst: 0 };
  });
  const w = E.computeWorkings(d, { ...ctx, quarterly: true });
  is('7 four periods', w.r42.periods.length, 4);
  eq('7 D1 a quarter (CGST)', w.r42.periods[0].d1.c, 300);
  is('7 quarter filed in', w.r42.periods[0].period, '06/2024');
}

// 8. Switched off: 7C is what Table 7 holds, and 7E keeps it out of 4B(1).
{
  const d = year();
  d.gstr9.r42.enabled = false;
  d.gstr9.t7.r42 = { i: 0, c: 50, s: null, x: 0 };
  M.forEach((m) => { d.portal.months[m].itc4b1 = { i: 0, c: 100, s: 100, x: 0 }; });
  const w = E.computeWorkings(d, ctx);
  eq('8 7C as typed', w.g9.t7.C.c, 50);
  eq('8 7E = 4B(1) less typed 7C', w.g9.t7.E.c, 1150);
  is('8 no Payables line', w.payables.input.components.some((c) => c.key === 'r42'), false);
}

// 9. Switched on: 7E keeps out only what the 3Bs reversed under Rule 42; override wins in 7C.
{
  const d = year();
  M.forEach((m) => { d.portal.months[m].itc4b1 = { i: 0, c: 150, s: 150, x: 0 }; d.gstr9.r42.months[m].reversed = { i: 0, c: 100, s: null, x: 0 }; });
  let w = E.computeWorkings(d, ctx);
  eq('9 7E = 4B(1) less Rule 42 reversed', w.g9.t7.E.c, 600);
  d.gstr9.r42.final7C = { i: 0, c: 1300, s: null, x: 0 };
  w = E.computeWorkings(d, ctx);
  eq('9 7C override', w.g9.t7.C.c, 1300);
  is('9 7C source', w.r42.t7CSource, 'override');
}

// 10. Sales classes: zero rated in F only, securities at 1%, interest on loans out of E.
{
  const d = year();
  d.sales.partB = [
    { id: 'e', ledger: 'Exempt', nature: 'exempt', amount: 100000 },
    { id: 'x', ledger: 'Exports', nature: 'export_wo', amount: 100000 },
    { id: 's', ledger: 'Shares sold', nature: 'non_gst', amount: 1000000, r42: 'securities' },
    { id: 'i', ledger: 'Interest on loans', nature: 'exempt', amount: 50000, r42: 'excluded_e' },
    { id: 'n', ledger: 'Dividend', nature: 'not_in_gstr9', amount: 70000 },
  ];
  const w = E.computeWorkings(d, ctx);
  eq('10 E books', w.r42.books.e, 110000);
  eq('10 F books', w.r42.books.f, 1080000 + 100000 + 100000 + 10000 + 50000);
}

// 11. The GSTR-3B parser keeps 3.1 values.
{
  const m = PP.parseGstr3bSummary({ sup_details: { osup_det: { txval: 500 }, osup_zero: { txval: 20 }, osup_nil_exmp: { txval: 30 }, osup_nongst: { txval: 7 } } });
  eq('11 3.1(c) nil and exempt', m.turnover.nilExempt, 30);
  eq('11 3.1(e) non-GST', m.turnover.nonGst, 7);
}

// 12. Spread keeps typed months and spreads the rest.
{
  const w = Object.fromEntries(M.map((m) => [m, { i: 0, c: 10, s: 10, x: 0 }]));
  const out = R.spreadTagged({ i: 0, c: 120, s: 120, x: 0 }, { apr: { i: 0, c: 32, s: 32, x: 0 } }, w);
  eq('12 typed month kept', out.apr.c, 32);
  eq('12 others spread', out.may.c, 8);
}

// ─── Rule 43 ────────────────────────────────────────────────────────────────
const asset = (o) => ({
  id: o.id ?? 'a1', description: o.description ?? 'Machine', hsn: '', invoiceNo: '', invoiceDate: o.invoiceDate, supplierGstin: '', putToUseDate: null,
  useClass: o.useClass ?? 'common', itc: o.itc ?? { i: 0, c: 60000, s: 60000, x: 0 }, itcRoute: o.itcRoute ?? 'normal', rule43Reversed: { i: 0, c: 0, s: 0, x: 0 },
  disposalType: o.disposalDate ? 'sale' : null, disposalDate: o.disposalDate ?? null, disposalInvoiceNo: '', buyerType: 'b2b', supplyType: 'intra', rate: 18,
  disposalValue: 0, outTax: null, scrapProviso: false, relatedParty: false, inSalesLedger: false, shortfallRoute: 'not_done', postedInBooks: false, note: '',
  useHistory: o.useHistory ?? [],
});

// 13. A common asset all year: Tm = Tc ÷ 60, Te = E ÷ F × Tr, 7D = Σ Te.
{
  const d = year();
  const w = E.computeWorkings(d, { ...ctx, capitalGoods: [asset({ invoiceDate: '2023-10-15' })] });
  eq('13 Tm (CGST)', w.r43.assets[0].tm.c, 1000);
  is('13 months in the year', w.r43.assets[0].monthsInYear, 12);
  eq('13 Tr a month', w.r43.periods[0].tr.c, 1000);
  eq('13 Te a month', w.r43.periods[0].te.c, 100);
  eq('13 7D = Σ Te', w.g9.t7.D.c, 1200);
  eq('13 payable (nothing reversed)', w.r43.payable.c, 1200);
  const pay = w.payables.input.components.find((x) => x.key === 'r43');
  eq('13 Payables carries Rule 43', pay ? pay.value.c : -1, 1200);
  // interest on April's 100 from 20 May 2024 to 20 Oct 2025
  eq('13 April interest', w.r43.periods[0].interest.c, Math.round(100 * 0.18 * daysBetween(Date.UTC(2024, 4, 20), Date.UTC(2025, 9, 20)) / 365 * 100) / 100);
}

// 14. Exempt-only to common: Tc less 5 points a quarter or part from the invoice.
{
  const a = asset({ invoiceDate: '2023-01-10', itc: { i: 0, c: 100000, s: 100000, x: 0 }, useHistory: [
    { fromDate: '2023-01-10', useClass: 'exempt_or_non_business' }, { fromDate: '2024-07-10', useClass: 'common' }] });
  const t = R43.tcOf(a);
  is('14 quarters to the change', t.quarters, 7);
  eq('14 Tc after 35 points', t.tc.c, 65000);
  const w = E.computeWorkings(year(), { ...ctx, capitalGoods: [a] });
  is('14 months common (Jul–Mar)', w.r43.assets[0].monthsInYear, 9);
  is('14 nothing in April', w.r43.periods[0].tr.c, 0);
}

// 15. Disposed of in December: out of Tr from that month; useful life ends.
{
  const w = E.computeWorkings(year(), { ...ctx, capitalGoods: [
    asset({ id: 's', invoiceDate: '2023-10-15', disposalDate: '2024-12-05' }),
    asset({ id: 'o', invoiceDate: '2019-04-01' }),
    asset({ id: 'l', invoiceDate: '2019-05-01' }),
    asset({ id: 't', invoiceDate: '2023-10-15', useClass: 'taxable' }),
    asset({ id: 'n', invoiceDate: '2023-10-15', itcRoute: 'not_taken' }),
  ] });
  const by = Object.fromEntries(w.r43.assets.map((a) => [a.id, a]));
  is('15 sold in Dec: Apr–Nov', by.s.monthsInYear, 8);
  is('15 life over', by.o.excluded, 'Useful life over');
  is('15 last month of life', by.l.monthsInYear, 1);
  is('15 taxable only out', by.t.excluded, 'Not in common use this year');
  is('15 no credit out', by.n.excluded, 'No credit taken');
}

// 16. 7E keeps out the Rule 43 reversal; override of 7D; working off = typed 7D.
{
  const d = year();
  M.forEach((m) => { d.portal.months[m].itc4b1 = { i: 0, c: 200, s: 200, x: 0 }; d.gstr9.r42.months[m].reversed = { i: 0, c: 100, s: null, x: 0 }; d.gstr9.r42.months[m].reversed43 = { i: 0, c: 50, s: null, x: 0 }; });
  const c2 = { ...ctx, capitalGoods: [asset({ invoiceDate: '2023-10-15' })] };
  let w = E.computeWorkings(d, c2);
  eq('16 7E = 4B(1) less 42 and 43 reversed', w.g9.t7.E.c, 2400 - 1200 - 600);
  eq('16 still to reverse', w.r43.payable.c, 600);
  d.gstr9.r42.final7D = { i: 0, c: 900, s: null, x: 0 };
  w = E.computeWorkings(d, c2);
  eq('16 7D override', w.g9.t7.D.c, 900);
  d.gstr9.r42.enabled = false;
  d.gstr9.t7.r43 = { i: 0, c: 77, s: null, x: 0 };
  w = E.computeWorkings(d, c2);
  eq('16 working off: 7D as typed', w.g9.t7.D.c, 77);
}

// 17. Builder: the approved carpet-area working posted in this FY adds to 7C / 7D and is kept out of 7E.
{
  const d = year();
  M.forEach((m) => { d.portal.months[m].itc4b1 = { i: 0, c: 300, s: 300, x: 0 }; d.gstr9.r42.months[m].reversed = { i: 0, c: 100, s: null, x: 0 }; });
  const bw = { id: 'b', project: 'Tower A', completionDate: '2024-11-20', postingPeriod: '01/2025', approvedAt: null,
    r42: { i: 0, c: 1000, s: 1000, x: 0 }, r43: { i: 0, c: 200, s: 200, x: 0 }, interest: { i: 0, c: 0, s: 0, x: 0 } };
  const other = { ...bw, id: 'o', postingPeriod: '01/2026' };
  const c2 = { ...ctx, builderReversals: [bw, other] };
  let w = E.computeWorkings(d, c2);
  is('17 only the year’s working', w.builderRev.workings.length, 1);
  eq('17 7C = final + builder', w.g9.t7.C.c, 1200 + 1000);
  eq('17 7D = builder (no assets)', w.g9.t7.D.c, 200);
  eq('17 7E keeps out builder and Rule 42 reversed', w.g9.t7.E.c, 3600 - 1200 - 1000 - 200);
  d.gstr9.r42.turnover = false;
  w = E.computeWorkings(d, c2);
  eq('18 turnover off: 7C = builder only', w.g9.t7.C.c, 1000);
  is('18 turnover off: no Rule 42 payable line', w.payables.input.components.some((x) => x.key === 'r42'), false);
  w = E.computeWorkings(d, { ...c2, noItcBuilder: true });
  is('18 no-ITC builder ignores it', w.builderRev.workings.length, 0);
  const neg = E.computeWorkings(year(), { ...ctx, builderReversals: [{ ...bw, r42: { i: 0, c: -50, s: -50, x: 0 } }] });
  eq('18 re-credit not netted into 7C', neg.builderRev.recredit.c, 50);
}

// 19. GSTR-9C Table 13 / 16 from the working: plain characters only, payable to 16.
{
  const d = year();
  const w = E.computeWorkings(d, ctx);
  const r = RS.rule4243Reason({ financialYear: FY, on: true, t7C: w.g9.t7.C, t7D: w.g9.t7.D, payable42: w.r42.payable, payable43: w.r43.payable,
    interest42: w.r42.interest, interest43: w.r43.interest, postingPeriod: w.r42.postingPeriod, builderR42: { i: 0, c: 10, s: 10, x: 0 }, builderR43: { i: 0, c: 0, s: 0, x: 0 } });
  is('19 reason lines', r.lines.length, 3);
  is('19 every line in the utility charset', r.lines.every((l) => J.REASON_CHARS_REGEX.test(l)), true);
  eq('19 16A = CGST still due', r.t16.A, w.r42.payable.c);
  eq('19 16E = interest', r.t16.E, Math.round((w.r42.interest.i + w.r42.interest.c + w.r42.interest.s + w.r42.interest.x) * 100) / 100);
  is('19 off: nothing', RS.rule4243Reason({ ...r, on: false, financialYear: FY, t7C: w.g9.t7.C, t7D: w.g9.t7.D, payable42: w.r42.payable, payable43: w.r43.payable, interest42: w.r42.interest, interest43: w.r43.interest, postingPeriod: '09/2025', builderR42: w.g9.t7.C, builderR43: w.g9.t7.D }).lines.length, 0);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
