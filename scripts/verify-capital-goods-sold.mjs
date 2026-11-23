#!/usr/bin/env node
// Checks the s.18(6) computation for capital goods sold (src/lib/gstr9/capitalGoods.ts)
// and the shared "5 percentage points per quarter or part" helper (src/lib/gstr9/quarters.ts).
// docs/GSTR9_9C_WORKINGS.md §6 items 34–38 and §9.
//
//   node --experimental-strip-types scripts/verify-capital-goods-sold.mjs
import assert from 'node:assert/strict';

const Q = await import('../src/lib/gstr9/quarters.ts');
const C = await import('../src/lib/gstr9/capitalGoods.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const T = (i = 0, c = 0, s = 0, x = 0) => ({ i, c, s, x });
const asset = (over) => ({ ...C.newCgAsset('a1'), ...over });

t('quarters: same day is quarter 1', () => assert.equal(Q.quartersOrPart('2022-06-15', '2022-06-15'), 1));
t('quarters: the day before three months is still quarter 1', () => assert.equal(Q.quartersOrPart('2022-06-15', '2022-09-14'), 1));
t('quarters: three months to the day starts quarter 2', () => assert.equal(Q.quartersOrPart('2022-06-15', '2022-09-15'), 2));
t('quarters: 15 Jun 2022 to 10 Sep 2025 is 13 (12 full + a part)', () => assert.equal(Q.quartersOrPart('2022-06-15', '2025-09-10'), 13));
t('quarters: month-end invoice (31 Jan) counts 30 Apr as quarter 2', () => assert.equal(Q.quartersOrPart('2024-01-31', '2024-04-30'), 2));
t('quarters: 31 Jan to 29 Apr is quarter 1', () => assert.equal(Q.quartersOrPart('2024-01-31', '2024-04-29'), 1));
t('quarters: event before invoice → null', () => assert.equal(Q.quartersOrPart('2024-05-01', '2024-04-30'), null));
t('quarters: unreadable date → null', () => assert.equal(Q.quartersOrPart('2024-02-30', '2024-04-30'), null));
t('reduce: 13 quarters leaves 35%', () => assert.deepEqual(Q.reduceByQuarters(T(180000), 13), T(63000)));
t('reduce: nil from 20 quarters on', () => {
  assert.deepEqual(Q.reduceByQuarters(T(1000, 50, 50, 10), 20), T(0, 0, 0, 0));
  assert.deepEqual(Q.reduceByQuarters(T(1000), 27), T(0));
});
t('reduce: per head, rounded to the paisa', () => assert.deepEqual(Q.reduceByQuarters(T(0, 333.33, 333.33, 0), 1), T(0, 316.66, 316.66, 0)));

t('worked example: ITC 1,80,000 IGST, 13 quarters, sold intra-State for 2,00,000 at 18% → shortfall 27,000 IGST', () => {
  const c = C.computeCgSale(asset({ invoiceDate: '2022-06-15', itc: T(180000), disposalDate: '2025-09-10', disposalValue: 200000, rate: 18, supplyType: 'intra' }));
  assert.equal(c.basis, 'sec18_6');
  assert.equal(c.quarters, 13);
  assert.equal(c.reductionPct, 65);
  assert.deepEqual(c.reduced, T(63000));
  assert.deepEqual(c.outTax, T(0, 18000, 18000));
  assert.equal(c.higher, 'itc');
  assert.equal(c.payable, 63000);
  assert.deepEqual(c.shortfall, T(27000));
  assert.deepEqual(c.issues, []);
});
t('worked example at 6,00,000: tax on value 1,08,000 is higher, no shortfall', () => {
  const c = C.computeCgSale(asset({ invoiceDate: '2022-06-15', itc: T(180000), disposalDate: '2025-09-10', disposalValue: 600000, rate: 18 }));
  assert.equal(c.higher, 'tv');
  assert.equal(c.payable, 108000);
  assert.deepEqual(c.shortfall, T());
});
t('shortfall split over the heads of the reduced ITC, remainder to the largest', () => {
  // ITC CGST 10,000 + SGST 10,000 + cess 1,000, 1 quarter → 95%: 9,500 / 9,500 / 950 = 19,950. Sold inter-State for 10,000 at 18% → 1,800 IGST.
  const c = C.computeCgSale(asset({ invoiceDate: '2025-04-01', itc: T(0, 10000, 10000, 1000), disposalDate: '2025-05-01', disposalValue: 10000, rate: 18, supplyType: 'inter' }));
  assert.deepEqual(c.reduced, T(0, 9500, 9500, 950));
  assert.deepEqual(c.outTax, T(1800));
  const sh = c.shortfall;
  assert.equal(Math.round((sh.i + sh.c + sh.s + sh.x) * 100) / 100, 18150);
  assert.equal(sh.i, 0);
  assert.ok(Math.abs(sh.c - 8642.86) < 0.02 && Math.abs(sh.s - 8642.86) < 0.02 && Math.abs(sh.x - 864.29) < 0.02, JSON.stringify(sh));
});
t('20 quarters or more: reduced ITC nil, tax on value stands', () => {
  const c = C.computeCgSale(asset({ invoiceDate: '2019-04-01', itc: T(50000), disposalDate: '2025-04-01', disposalValue: 1000, rate: 18 }));
  assert.equal(c.reductionPct, 100);
  assert.deepEqual(c.reduced, T());
  assert.equal(c.higher, 'tv');
  assert.deepEqual(c.shortfall, T());
});
t('ITC not taken: tax on value only', () => {
  const c = C.computeCgSale(asset({ itcRoute: 'not_taken', disposalDate: '2025-07-01', disposalValue: 100000, rate: 28 }));
  assert.equal(c.basis, 'tv_no_itc');
  assert.equal(c.payable, 28000);
  assert.deepEqual(c.shortfall, T());
  assert.deepEqual(c.issues, []);
});
t('scrap proviso: tax on value only, even with ITC taken', () => {
  const c = C.computeCgSale(asset({ scrapProviso: true, invoiceDate: '2025-01-01', itc: T(90000), disposalDate: '2025-07-01', disposalValue: 5000, rate: 18 }));
  assert.equal(c.basis, 'tv_scrap');
  assert.deepEqual(c.shortfall, T());
});
t('typed output tax wins over the rate', () => {
  const c = C.computeCgSale(asset({ invoiceDate: '2025-01-01', itc: T(1000), disposalDate: '2025-07-01', disposalValue: 10000, rate: 18, outTax: T(0, 100, 100) }));
  assert.deepEqual(c.outTax, T(0, 100, 100));
  assert.equal(c.outTaxComputed, false);
});
t('incomplete rows say what is missing', () => {
  const c = C.computeCgSale(asset({ invoiceDate: null, itc: T(), disposalDate: null, rate: null, disposalValue: 100 }));
  assert.ok(c.issues.includes('Date of sale missing'));
  assert.ok(c.issues.includes('Purchase invoice date missing'));
  assert.ok(c.issues.some((x) => x.startsWith('ITC taken is nil')));
  assert.ok(c.issues.some((x) => x.startsWith('Rate missing')));
  const before = C.computeCgSale(asset({ invoiceDate: '2025-05-01', itc: T(10), disposalDate: '2025-04-01' }));
  assert.ok(before.issues.includes('Sale is dated before the purchase invoice'));
});
t('Rule 43 reversals shown, the basis stays ITC taken', () => {
  const c = C.computeCgSale(asset({ invoiceDate: '2025-04-01', itc: T(0, 5000, 5000), rule43Reversed: T(0, 400, 400), disposalDate: '2025-04-02', disposalValue: 0, rate: 18 }));
  assert.deepEqual(c.itcAfterR43, T(0, 4600, 4600));
  assert.deepEqual(c.reduced, T(0, 4750, 4750));
});
t('fyOfDate', () => {
  assert.equal(C.fyOfDate('2025-04-01'), '2025-26');
  assert.equal(C.fyOfDate('2026-03-31'), '2025-26');
  assert.equal(C.fyOfDate('2000-01-05'), '1999-00');
});
t('year summary: routes land where they should, not-in-books and outside-P&L tracked', () => {
  const base = { invoiceDate: '2022-06-15', itc: T(180000), disposalDate: '2025-09-10', disposalValue: 200000, rate: 18 };
  const s = C.summariseCgYear([
    asset({ ...base, id: 'r1', shortfallRoute: 'reversed_4b2', postedInBooks: true }),
    asset({ ...base, id: 'r2', shortfallRoute: 'not_done', buyerType: 'b2c' }),
    asset({ ...base, id: 'r3', shortfallRoute: 'output_tax', inSalesLedger: true }),
    asset({ ...base, id: 'r4', disposalDate: '2024-09-10' }), // another year
    asset({ ...base, id: 'r5', disposalType: null, disposalDate: null }), // in use
  ], '2025-26');
  assert.equal(s.assets.length, 3);
  assert.deepEqual(s.reversal, T(54000));
  assert.deepEqual(s.notDone, T(27000));
  assert.deepEqual(s.reversed3b, T(27000));
  assert.deepEqual(s.asOutputTax, T(27000));
  assert.deepEqual(s.notInBooks, T(27000));
  assert.equal(s.valueOutsidePl, 400000);
  assert.deepEqual(s.table4.b2b, { t: 200000, i: 0, c: 18000, s: 18000, x: 0 });
  assert.deepEqual(s.table4.b2c, { t: 200000, i: 0, c: 18000, s: 18000, x: 0 });
  assert.equal(s.payable, 189000);
});
t('extra output tax on a sale outside the Sales ledgers goes to Table 4', () => {
  const s = C.summariseCgYear([asset({ invoiceDate: '2022-06-15', itc: T(180000), disposalDate: '2025-09-10', disposalValue: 200000, rate: 18, shortfallRoute: 'output_tax' })], '2025-26');
  assert.deepEqual(s.table4.b2b, { t: 200000, i: 27000, c: 18000, s: 18000, x: 0 });
  assert.deepEqual(s.reversal, T());
});

console.log(`\n${n} checks passed.`);
