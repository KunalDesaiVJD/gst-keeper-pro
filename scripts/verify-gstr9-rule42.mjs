#!/usr/bin/env node
// Checks for the Rule 42 working of the Annual Return (src/lib/gstr9/rule42.ts
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

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
