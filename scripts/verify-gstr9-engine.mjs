#!/usr/bin/env node
// Golden test for the Annual Return engine (src/lib/gstr9/engine.ts).
//
//   node scripts/verify-gstr9-engine.mjs /path/to/MASTER_PMS.xlsx
//
// Reads the firm's own GSTR-9/9C working, types every manually-entered
// figure into the app's doc shape exactly as staff would, runs
// computeWorkings(), and compares each computed figure with the value Excel
// cached for the same cell. Deliberate departures from the workbook
// (docs/GSTR9_9C_WORKINGS.md §6) are listed in DEVIATIONS with the value
// the engine is expected to produce instead. The workbook itself is client
// data and is not committed — pass its path.

import { buildSync } from 'esbuild';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/verify-gstr9-engine.mjs /path/to/MASTER_PMS.xlsx');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (rel) => {
  const out = buildSync({ entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const engine = await load('src/lib/gstr9/engine.ts');
const defaults = await load('src/lib/gstr9/defaults.ts');

const wb = XLSX.read(readFileSync(file));
const sheet = (name) => {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`sheet "${name}" not found`);
  return ws;
};
const v = (name, addr) => {
  const c = sheet(name)[addr];
  if (!c || c.v === undefined || c.v === null || c.v === '') return 0;
  return typeof c.v === 'number' ? c.v : Number(c.v) || 0;
};
const s = (name, addr) => {
  const c = sheet(name)[addr];
  return c && c.v !== undefined ? String(c.v) : '';
};

const MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];
const docs = defaults.emptyDocs();
let id = 0;
const nid = () => `r${++id}`;
const rateFromName = (name) => {
  const m = /([0-9.]+)\s*%/.exec(name);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------- PL-OUTPUT
for (let r = 10; r <= 31; r++) {
  const ledger = s('PL-OUTPUT', `C${r}`);
  if (!ledger) continue;
  const igst = v('PL-OUTPUT', `E${r}`);
  const sgstCol = v('PL-OUTPUT', `F${r}`); // this sheet has F = SGST, G = CGST (=F)
  let category = 'b2b';
  if (/deem/i.test(ledger)) category = 'deemed';
  else if (/SEZ/i.test(ledger)) category = 'sez_wp';
  docs.sales.partA.push({
    id: nid(), ledger, category, supplyType: igst ? 'inter' : 'intra', rate: rateFromName(ledger),
    taxable: v('PL-OUTPUT', `D${r}`), igst, cgst: v('PL-OUTPUT', `G${r}`) || sgstCol, sgst: null, cess: 0,
  });
}
const NATURE = { 'EXPORT SALE W/O': 'export_wo', 'SEZ W/O': 'sez_wo', 'NON-GST': 'non_gst' };
for (let r = 41; r <= 48; r++) {
  const ledger = s('PL-OUTPUT', `C${r}`);
  if (!ledger) continue;
  docs.sales.partB.push({ id: nid(), ledger, nature: NATURE[s('PL-OUTPUT', `E${r}`).trim()] || 'non_gst', amount: v('PL-OUTPUT', `D${r}`) });
}
docs.sales.auditReportTotal = v('PL-OUTPUT', 'D54');

// ---------------------------------------------------------------- PL-INPUT (+ the 9C sheet's head mapping)
const HEAD_BY_ROW = {
  34: 'rent_insurance', 42: 'rent_insurance', 44: 'rent_insurance', 45: 'rent_insurance', 48: 'rent_insurance',
  36: 'bank_charges',
  53: 'stationery', 54: 'stationery', 40: 'stationery',
  38: 'repair_maintenance', 46: 'repair_maintenance', 51: 'repair_maintenance',
};
const addPurchases = (from, to, section) => {
  for (let r = from; r <= to; r++) {
    const ledger = s('PL-INPUT', `C${r}`);
    if (!ledger) continue;
    const igst = v('PL-INPUT', `E${r}`);
    docs.purchases.rows.push({
      id: nid(), section, ledger, supplyType: igst ? 'inter' : 'intra', rate: rateFromName(ledger),
      taxable: v('PL-INPUT', `D${r}`), igst, cgst: v('PL-INPUT', `F${r}`), sgst: null, cess: 0,
      head: HEAD_BY_ROW[r] || null,
    });
  }
};
addPurchases(9, 28, 'purchase');
addPurchases(34, 56, 'expense');
addPurchases(63, 67, 'capital_goods');
docs.purchases.suspendedOtherAdj = { i: v('PL-INPUT', 'E75'), c: v('PL-INPUT', 'F75'), s: null, x: 0 };

// ---------------------------------------------------------------- DUTIES & TAXES-OUTPUT (+ AS PER 3B → portal months)
MONTHS.forEach((m, k) => {
  const r = 8 + k;
  const D = 'DUTIES & TAXES-OUTPUT';
  docs.duties_output.months[m] = {
    sales: { i: v(D, `C${r}`), c: v(D, `D${r}`), s: null, x: 0 },
    creditNote: { i: v(D, `F${r}`), c: v(D, `G${r}`), s: null, x: 0 },
  };
  docs.portal.months[m].outTax = { i: v(D, `L${r}`), c: v(D, `M${r}`), s: v(D, `N${r}`), x: 0 };
  docs.portal.monthMeta[m] = { source: 'manual' };
});

// ---------------------------------------------------------------- DUTIES & TAXES-INPUT
{
  const D = 'DUTIES & TAXES-INPUT';
  docs.duties_input.lastYearEffect = { i: v(D, 'U9'), c: v(D, 'V9'), s: v(D, 'W9'), x: 0 };
  const t = (r, a, b, c) => ({ i: v(D, `${a}${r}`), c: v(D, `${b}${r}`), s: v(D, `${c}${r}`), x: 0 });
  MONTHS.forEach((m, k) => {
    const r = 10 + k;
    docs.duties_input.months[m] = {
      purchase: t(r, 'C', 'D', 'E'),
      debitNote: t(r, 'F', 'G', 'H'),
      suspRev: t(r, 'I', 'J', 'K'),
      suspRev180: t(r, 'L', 'M', 'N'),
      suspReclaim: t(r, 'O', 'P', 'Q'),
      suspReclaim180: t(r, 'R', 'S', 'T'),
    };
    docs.portal.months[m].itcExclRcm = t(r, 'X', 'Y', 'Z');
  });
}

// ---------------------------------------------------------------- RCM (Part A → portal months; Part B blocks → categories)
MONTHS.forEach((m, k) => {
  const r = 9 + k;
  docs.portal.months[m].rcm = { t: v('RCM', `D${r}`), i: v('RCM', `E${r}`), c: v('RCM', `F${r}`), s: v('RCM', `G${r}`), x: 0 };
});
const RCM_BLOCKS = [
  { name: 'Transportation Exp', first: 52, rate: 5 },
  { name: 'Delivery Exp', first: 71, rate: 5 },
  { name: 'Office Rent Expense', first: 90, rate: 18 },
  { name: 'Advocate Fees', first: 109, rate: 18 },
];
RCM_BLOCKS.forEach((b) => {
  const months = {};
  MONTHS.forEach((m, k) => { months[m] = { taxable: v('RCM', `D${b.first + k}`) }; });
  docs.rcm.categories.push({ id: nid(), name: b.name, rate: b.rate, supplyType: 'intra', itcTable: '6C', months });
});

// ---------------------------------------------------------------- Portal GSTR-9 (auto-populated values the sheet types)
{
  const O = 'GSTR 9-OUTPUT';
  const row = (r) => ({ t: v(O, `I${r}`), i: v(O, `J${r}`), c: v(O, `K${r}`), s: v(O, `L${r}`) || v(O, `K${r}`), x: 0 });
  docs.portal.gstr9.table4.b2c = row(9);
  docs.portal.gstr9.table4.b2b = row(10);
  docs.portal.gstr9.table4.sez = { ...row(11), c: 0, s: 0 };
  docs.portal.gstr9.table4.cr_nt = row(15);
  const G = 'GSTR-9';
  docs.portal.gstr9.t6A = { i: v(G, 'I41'), c: v(G, 'G41'), s: v(G, 'H41'), x: v(G, 'J41') };
  docs.portal.gstr9.t8A = { i: v(G, 'I81'), c: v(G, 'G81'), s: v(G, 'H81'), x: v(G, 'J81') };
  // Table 9 — rows 97/98/99: D payable, E cash, F central ITC, G state ITC, H integrated ITC.
  const t9 = (r) => ({ payable: v(G, `D${r}`), cash: v(G, `E${r}`), itcC: v(G, `F${r}`), itcS: v(G, `G${r}`), itcI: v(G, `H${r}`), itcX: v(G, `I${r}`) });
  docs.portal.gstr9.table9.igst = t9(97);
  docs.portal.gstr9.table9.cgst = t9(98);
  docs.portal.gstr9.table9.sgst = t9(99);
  docs.portal.gstr9Meta = { source: 'manual' };
  // GSTR-9 cells the sheet types by hand
  docs.gstr9.t7.s17_5 = { i: v(G, 'I73'), c: v(G, 'G73'), s: v(G, 'H73'), x: 0 };
  docs.gstr9.t7.otherDesc = s(G, 'C76');
  docs.gstr9.t13 = { i: v(G, 'I111'), c: v(G, 'G111'), s: v(G, 'H111'), x: v(G, 'J111') };
}

// ---------------------------------------------------------------- Annexure / Notice typed cells
{
  const A = 'ANNEXURE';
  docs.annexures.a1NonGstIncome = v(A, 'D9');
  docs.annexures.a3RcmToPay = { i: v(A, 'D43'), c: v(A, 'E43'), s: v(A, 'F43'), x: v(A, 'G43') };
  docs.annexures.a3ExcessItc = { i: v(A, 'D44'), c: v(A, 'E44'), s: v(A, 'F44'), x: v(A, 'G44') };
  const N = 'NOTICE FORMATE';
  // Notice columns: E = SGST, F = CGST, G = IGST, H = Cess
  const nt = (r) => ({ i: v(N, `G${r}`), c: v(N, `F${r}`), s: v(N, `E${r}`), x: v(N, `H${r}`) });
  docs.notice.deemedSupplies = nt(10);
  docs.notice.unreturnedGoods = nt(11);
  docs.notice.pendingDemands = nt(12);
  docs.notice.prevYearT14 = nt(17);
  docs.notice.prevYear8C = { i: 0, c: v(N, 'F24'), s: v(N, 'E24'), x: 0 }; // G24 reads the current FY's Table 12 (quirk)
  docs.notice.ineligible4D = nt(26);
  docs.notice.ineligible164 = nt(27);
  docs.notice.itcUsed4A5 = nt(29);
  docs.notice.reversed4B2 = nt(30);
}

const w = engine.computeWorkings(docs, { clientName: 'fixture', gstin: '', financialYear: '2024-25', noItcBuilder: false });

// ---------------------------------------------------------------- Expected values
const X = (sheetName, addr) => v(sheetName, addr);
const checks = [];
const eq = (label, actual, sheetName, addr, tol = 0.011) => checks.push({ label, actual, expected: X(sheetName, addr), ref: `${sheetName}!${addr}`, tol });
const dev = (label, actual, expected, ref, why) => checks.push({ label, actual, expected, ref, tol: 0.011, deviation: why });

const PO = 'PL-OUTPUT', PI = 'PL-INPUT', DO = 'DUTIES & TAXES-OUTPUT', DI = 'DUTIES & TAXES-INPUT';
const RC = 'RCM', GO = 'GSTR 9-OUTPUT', GI = 'GSTR 9-INPUT', C9 = 'GSTR 9C', AN = 'ANNEXURE', G9 = 'GSTR-9', NF = 'NOTICE FORMATE';

// PL-OUTPUT
eq('Part A value', w.sales.partA.t, PO, 'D33');
eq('Part A IGST', w.sales.partA.i, PO, 'E33');
eq('Part A SGST', w.sales.partA.s, PO, 'F33');
eq('Part A CGST', w.sales.partA.c, PO, 'G33');
eq('Part B total', w.sales.partBTotal, PO, 'D50');
eq('Part A+B', w.sales.total, PO, 'D52');
eq('Audit report − books', w.sales.auditDiff, PO, 'D56');

// PL-INPUT
[['purchase', 30], ['expense', 58], ['capital_goods', 69]].forEach(([k, r]) => {
  eq(`${k} value`, w.purchases.sections[k].t, PI, `D${r}`);
  eq(`${k} IGST`, w.purchases.sections[k].i, PI, `E${r}`);
  eq(`${k} CGST`, w.purchases.sections[k].c, PI, `F${r}`);
  eq(`${k} SGST`, w.purchases.sections[k].s, PI, `G${r}`);
});
eq('Total ITC as per P&L IGST', w.purchases.totalPl.i, PI, 'E71');
eq('Total ITC as per P&L CGST', w.purchases.totalPl.c, PI, 'F71');
eq('Suspended ITC IGST', w.purchases.suspended.i, PI, 'E73');
eq('Suspended ITC CGST', w.purchases.suspended.c, PI, 'F73');
eq('RCM credit CGST', w.purchases.rcmCredit.c, PI, 'F77');
dev('RCM credit value', w.purchases.rcmCredit.t, 1270630, `${PI}!D77`, 'RCM Part B taxable sums all four blocks (sheet D28:D39 adds two)');
eq('Net ITC IGST', w.purchases.netItc.i, PI, 'E79');
eq('Net ITC CGST', w.purchases.netItc.c, PI, 'F79');
eq('Net ITC SGST', w.purchases.netItc.s, PI, 'G79');
dev('Net ITC value', w.purchases.netItc.t, X(PI, 'D79') + 166000, `${PI}!D79`, 'follows the RCM Part B taxable fix (+1,66,000)');
eq('D&T net IGST', w.purchases.dtNet.i, PI, 'E80');
eq('D&T net CGST', w.purchases.dtNet.c, PI, 'F80');
eq('P&L − D&T IGST', w.purchases.diffVsDt.i, PI, 'E81');
eq('P&L − D&T CGST', w.purchases.diffVsDt.c, PI, 'F81');

// DUTIES & TAXES-OUTPUT
eq('Sales IGST total', w.dto.totals.sales.i, DO, 'C20');
eq('Sales CGST total', w.dto.totals.sales.c, DO, 'D20');
eq('CN IGST total', w.dto.totals.cn.i, DO, 'F20');
eq('Net IGST', w.dto.totals.net.i, DO, 'I20');
eq('Net CGST', w.dto.totals.net.c, DO, 'J20');
eq('Net SGST', w.dto.totals.net.s, DO, 'K20');
eq('3B IGST', w.dto.totals.asPer3B.i, DO, 'L20');
eq('3B CGST', w.dto.totals.asPer3B.c, DO, 'M20');
eq('Diff IGST', w.dto.totals.diff.i, DO, 'O20');
eq('Diff CGST', w.dto.totals.diff.c, DO, 'P20');
eq('Oct diff IGST', w.dto.months.oct.diff.i, DO, 'O14');
eq('Aug diff CGST', w.dto.months.aug.diff.c, DO, 'P12');
eq('P&L IGST', w.dto.asPerPl.i, DO, 'I22');
eq('P&L CGST', w.dto.asPerPl.c, DO, 'J22');
eq('P&L − D&T IGST', w.dto.plDiff.i, DO, 'I24');
eq('P&L − D&T CGST', w.dto.plDiff.c, DO, 'J24');
eq('Total CR side CGST', w.dto.totalCrSide.c, DO, 'D30');

// DUTIES & TAXES-INPUT
[['sr', 'I', 'J'], ['sr180', 'L', 'M'], ['rc', 'O', 'P'], ['rc180', 'R', 'S'], ['purchase', 'C', 'D'], ['dn', 'F', 'G']].forEach(([k, ci, cc]) => {
  eq(`${k} IGST`, w.dti.totals[k].i, DI, `${ci}22`);
  eq(`${k} CGST`, w.dti.totals[k].c, DI, `${cc}22`);
});
eq('Net purchase IGST (U22)', w.dti.totals.net.i, DI, 'U22');
eq('Net purchase CGST (V22)', w.dti.totals.net.c, DI, 'V22');
eq('3B IGST (X22)', w.dti.totals.asPer3B.i, DI, 'X22');
eq('3B CGST (Y22)', w.dti.totals.asPer3B.c, DI, 'Y22');
eq('Diff IGST (AA22)', w.dti.totals.diff.i, DI, 'AA22');
eq('Diff CGST (AB22)', w.dti.totals.diff.c, DI, 'AB22');
eq('Oct diff CGST (AB16)', w.dti.months.oct.diff.c, DI, 'AB16');
eq('RCM books CGST (V23)', w.dti.rcmBooks.c, DI, 'V23');
eq('RCM 3B IGST (X23)', w.dti.rcmPortal.i, DI, 'X23');
eq('RCM 3B CGST (Y23)', w.dti.rcmPortal.c, DI, 'Y23');
eq('RCM diff CGST (AB23)', w.dti.rcmDiff.c, DI, 'AB23');
eq('Total ITC books CGST (V24)', w.dti.totalItcBooks.c, DI, 'V24');
eq('Total ITC 3B CGST (Y24)', w.dti.totalItcPortal.c, DI, 'Y24');
eq('Total ITC diff IGST (AA24)', w.dti.totalItcDiff.i, DI, 'AA24');
eq('Total ITC diff CGST (AB24)', w.dti.totalItcDiff.c, DI, 'AB24');
eq('Net IGST (U26)', w.dti.net.i, DI, 'U26');
eq('Net CGST (V26)', w.dti.net.c, DI, 'V26');
eq('P&L CGST (V28)', w.dti.asPerPl.c, DI, 'V28');
eq('P&L − D&T IGST (U29)', w.dti.plDiff.i, DI, 'U29');
eq('P&L − D&T CGST (V29)', w.dti.plDiff.c, DI, 'V29');

// RCM
eq('Part A value', w.rcm.partA.t, RC, 'D22');
eq('Part A IGST', w.rcm.partA.i, RC, 'E22');
eq('Part A CGST', w.rcm.partA.c, RC, 'F22');
eq('Part B IGST', w.rcm.partB.i, RC, 'E41');
eq('Part B CGST', w.rcm.partB.c, RC, 'F41');
eq('Part B SGST', w.rcm.partB.s, RC, 'G41');
dev('Part B value', w.rcm.partB.t, 1270630, `${RC}!D41`, 'all four expense blocks (sheet D28:D39 adds two)');
dev('Books − portal value', w.rcm.diff.t, 120, `${RC}!D43`, 'Books − Portal (sheet: Part A − Part B) with the four-block fix');
dev('Books − portal IGST', w.rcm.diff.i, -X(RC, 'E43'), `${RC}!E43`, 'sign standardised to Books − Portal');
dev('Books − portal CGST', w.rcm.diff.c, -X(RC, 'F43'), `${RC}!F43`, 'sign standardised to Books − Portal');
const catTotals = Object.values(w.rcm.categories).map((c) => c.total);
[[0, 65], [1, 84], [2, 103], [3, 122]].forEach(([k, r]) => {
  eq(`RCM block ${k + 1} value`, catTotals[k].t, RC, `D${r}`);
  eq(`RCM block ${k + 1} CGST`, catTotals[k].c, RC, `F${r}`);
});
eq('Oct Part B CGST', w.rcm.partBMonths.oct.c, RC, 'F34');

// GSTR 9-OUTPUT
eq('Books total value', w.outward.booksTotal.t, GO, 'C17');
eq('Books total IGST', w.outward.booksTotal.i, GO, 'D17');
eq('Books total CGST', w.outward.booksTotal.c, GO, 'E17');
eq('Portal total value', w.outward.portalTotal.t, GO, 'I17');
eq('Portal total IGST', w.outward.portalTotal.i, GO, 'J17');
eq('Portal total CGST', w.outward.portalTotal.c, GO, 'K17');
eq('Total diff value', w.outward.diffTotal.t, GO, 'D32');
eq('Total diff IGST', w.outward.diffTotal.i, GO, 'E32');
eq('Total diff CGST', w.outward.diffTotal.c, GO, 'F32');

// GSTR 9-INPUT
eq('Inputs IGST', w.itc.inputs.i, GI, 'D9');
eq('Inputs CGST', w.itc.inputs.c, GI, 'E9');
eq('Input services value', w.itc.inputServices.t, GI, 'C10');
eq('Input services IGST (plug)', w.itc.inputServices.i, GI, 'D10');
eq('Input services CGST (plug)', w.itc.inputServices.c, GI, 'E10');
eq('Capital goods IGST', w.itc.capitalGoods.i, GI, 'D12');
eq('RCM CGST', w.itc.rcm.c, GI, 'E13');
eq('Reclaim IGST', w.itc.reclaim.i, GI, 'D14');
eq('Reclaim CGST', w.itc.reclaim.c, GI, 'E14');
eq('As per 3B IGST', w.itc.asPer3B.i, GI, 'D16');
eq('As per 3B CGST', w.itc.asPer3B.c, GI, 'E16');
eq('Total 6O IGST', w.itc.total.i, GI, 'D18');
eq('Total 6O CGST', w.itc.total.c, GI, 'E18');
dev('Total 6O value', w.itc.total.t, X(GI, 'C18') + 166000, `${GI}!C18`, 'follows the RCM Part B taxable fix');
eq('Reversal 7H1 IGST', w.itc.reversal7H1.i, GI, 'D20');
eq('Reversal 7H1 CGST', w.itc.reversal7H1.c, GI, 'E20');
eq('17(5) CGST', w.itc.s17_5.c, GI, 'E21');
eq('7J IGST', w.itc.total7J.i, GI, 'D23');
eq('7J CGST', w.itc.total7J.c, GI, 'E23');
eq('As per book IGST', w.itc.asPerBook.i, GI, 'D25');
eq('As per book CGST', w.itc.asPerBook.c, GI, 'E25');
eq('Table 12 suggested IGST', w.itc.t12Suggested.i, GI, 'D27');
eq('Table 12 suggested CGST', w.itc.t12Suggested.c, GI, 'E27');
dev('Table 13 suggested IGST', w.itc.t13Suggested.i, -X(GI, 'D28'), `${GI}!D28`, 'shown positive (the sheet shows the negative residual)');
dev('Table 13 suggested CGST', w.itc.t13Suggested.c, -X(GI, 'E28'), `${GI}!E28`, 'shown positive (the sheet shows the negative residual)');

// GSTR 9C sheet
eq('A purchases value', w.c14.rows.A.t, C9, 'D8');
eq('A purchases IGST', w.c14.rows.A.i, C9, 'E8');
eq('A1 suspended CGST', w.c14.rows.A1.c, C9, 'F9');
eq('A2 net purchase CGST', w.c14.rows.A2.c, C9, 'F10');
eq('E rent & insurance value', w.c14.rows.E.t, C9, 'D14');
eq('E rent & insurance IGST', w.c14.rows.E.i, C9, 'E14');
eq('E rent & insurance CGST', w.c14.rows.E.c, C9, 'F14');
eq('J bank charges CGST', w.c14.rows.J.c, C9, 'F19');
eq('L stationery value', w.c14.rows.L.t, C9, 'D21');
eq('L stationery IGST', w.c14.rows.L.i, C9, 'E21');
eq('M repair CGST', w.c14.rows.M.c, C9, 'F22');
eq('O capital goods CGST', w.c14.rows.O.c, C9, 'F24');
eq('P RCM CGST', w.c14.rows.P.c, C9, 'F25');
eq('Q other expense 2 value', w.c14.rows.Q.t, C9, 'D26');
eq('Q other expense 2 IGST', w.c14.rows.Q.i, C9, 'E26');
eq('Q other expense 2 CGST', w.c14.rows.Q.c, C9, 'F26');
eq('R total IGST', w.c14.rows.R.i, C9, 'E28');
eq('R total CGST', w.c14.rows.R.c, C9, 'F28');
eq('Check CGST', w.c14.check.c, C9, 'F30');

// ANNEXURE
eq('A1-A value', w.ann1.A.t, AN, 'D8');
eq('A1-C CGST', w.ann1.C.c, AN, 'F11');
eq('A1-D CGST', w.ann1.D.c, AN, 'F12');
eq('A1-E CGST', w.ann1.E.c, AN, 'F13');
eq('A1-F value', w.ann1.F.t, AN, 'D14');
eq('A1-F IGST', w.ann1.F.i, AN, 'E14');
eq('A1-F CGST', w.ann1.F.c, AN, 'F14');
dev('A1-G value', w.ann1.G.t, 120.64, `${AN}!D15`, 'with the RCM four-block fix the −1,65,879.36 artefact becomes +120.64');
eq('A1-G IGST', w.ann1.G.i, AN, 'E15');
eq('A1-G CGST', w.ann1.G.c, AN, 'F15');
eq('Payable IGST', w.ann1.payable.i, AN, 'D19');
eq('Payable CGST', w.ann1.payable.c, AN, 'D20');
eq('Paid IGST', w.ann1.paid.i, AN, 'E19');
eq('Paid CGST', w.ann1.paid.c, AN, 'E20');
eq('Paid SGST', w.ann1.paid.s, AN, 'E21');
eq('Pay diff IGST', w.ann1.payDiff.i, AN, 'F19');
eq('Pay diff CGST', w.ann1.payDiff.c, AN, 'F20');
eq('A2-A IGST', w.ann2.A.i, AN, 'D26');
eq('A2-A1 CGST', w.ann2.A1.c, AN, 'E27');
eq('A2-A2 IGST', w.ann2.A2.i, AN, 'D28');
eq('A2-B CGST', w.ann2.B.c, AN, 'E29');
eq('A2-C IGST', w.ann2.C.i, AN, 'D30');
eq('A2-C CGST', w.ann2.C.c, AN, 'E30');
eq('A2-D CGST', w.ann2.D.c, AN, 'E31');
eq('A2-E CGST', w.ann2.E.c, AN, 'E32');
eq('A2-F CGST', w.ann2.F.c, AN, 'E33');
eq('A2-G(7H1) CGST', w.ann2.G1.c, AN, 'E34');
eq('A2-I IGST', w.ann2.I.i, AN, 'D36');
dev('A2-I CGST', w.ann2.I.c, X(AN, 'E36') - 157, `${AN}!E36`, 'I also deducts the rest of Table 7 (7E 157), not only 7H1');
eq('A2-J IGST', w.ann2.J.i, AN, 'D37');
dev('A2-J CGST', w.ann2.J.c, 0, `${AN}!E37`, 'J nets to 0 once all of Table 7 is deducted (sheet shows −157)');
eq('A3 row 1 IGST', w.ann3.clause9.i, AN, 'D42');
eq('A3 row 1 CGST', w.ann3.clause9.c, AN, 'E42');
eq('A3 total IGST', w.ann3.total.i, AN, 'D46');
eq('A3 total CGST', w.ann3.total.c, AN, 'E46');

// GSTR-9
const g = w.g9;
[['A', 7], ['B', 8], ['D', 10], ['G', 13], ['H', 15], ['I', 16], ['M', 20], ['N', 21]].forEach(([k, r]) => {
  eq(`4${k} value`, g.t4[k].t, G9, `F${r}`);
  eq(`4${k} CGST`, g.t4[k].c, G9, `G${r}`);
  eq(`4${k} IGST`, g.t4[k].i, G9, `I${r}`);
});
[['A', 24], ['B', 25], ['F', 30], ['G', 31], ['H', 32], ['L', 36], ['M', 37], ['N', 38]].forEach(([k, r]) => {
  eq(`5${k} value`, g.t5[k].t, G9, `F${r}`);
});
eq('5N CGST', g.t5.N.c, G9, 'G38');
eq('5N IGST', g.t5.N.i, G9, 'I38');
eq('6A CGST', g.t6.A.c, G9, 'G41');
eq('6A2 IGST', g.t6.A2.i, G9, 'I43');
eq('6B inputs CGST', g.t6.B_ip.c, G9, 'G44');
eq('6B inputs IGST', g.t6.B_ip.i, G9, 'I44');
eq('6B capital goods CGST', g.t6.B_cg.c, G9, 'G45');
eq('6B input services CGST', g.t6.B_is.c, G9, 'G46');
eq('6B input services IGST', g.t6.B_is.i, G9, 'I46');
eq('6C input services CGST', g.t6.C_is.c, G9, 'G49');
eq('6H CGST', g.t6.H.c, G9, 'G57');
eq('6I CGST', g.t6.I.c, G9, 'G58');
eq('6I IGST', g.t6.I.i, G9, 'I58');
eq('6J CGST', g.t6.J.c, G9, 'G59');
eq('6O CGST', g.t6.O.c, G9, 'G64');
eq('6O IGST', g.t6.O.i, G9, 'I64');
eq('7E CGST', g.t7.E.c, G9, 'G73');
eq('7H1 CGST', g.t7H[0].tax.c, G9, 'G76');
eq('7H1 IGST', g.t7H[0].tax.i, G9, 'I76');
eq('7I CGST', g.t7I.c, G9, 'G77');
eq('7I IGST', g.t7I.i, G9, 'I77');
eq('7J CGST', g.t7J.c, G9, 'G78');
eq('7J IGST', g.t7J.i, G9, 'I78');
eq('8A CGST', g.t8.A.c, G9, 'G81');
dev('8B CGST', g.t8.B.c, X(G9, 'G82') + X(G9, 'G57'), `${G9}!G82`, '8B = 6(B) + 6(H) per the form (sheet: 6(B) only)');
dev('8B IGST', g.t8.B.i, X(G9, 'I82') + X(G9, 'I57'), `${G9}!I82`, '8B = 6(B) + 6(H) per the form (sheet: 6(B) only)');
eq('8C CGST', g.t8.C.c, G9, 'G83');
dev('8D CGST', g.t8.D.c, X(G9, 'G84') - X(G9, 'G57'), `${G9}!G84`, 'follows 8B');
dev('8D IGST', g.t8.D.i, X(G9, 'I84') - X(G9, 'I57'), `${G9}!I84`, 'follows 8B');
eq('9 IGST paid', g.t9.igst.paid, G9, 'J97');
eq('9 CGST paid', g.t9.cgst.paid, G9, 'J98');
eq('9 IGST diff', g.t9.igst.diff, G9, 'K97');
eq('9 CGST diff', g.t9.cgst.diff, G9, 'K98');
eq('9 SGST diff', g.t9.sgst.diff, G9, 'K99');
eq('12 CGST', g.t12.c, G9, 'G110');
eq('Total turnover', g.totalTurnover.t, G9, 'F112');
eq('Total turnover CGST', g.totalTurnover.c, G9, 'G112');

// NOTICE FORMATE (E = SGST column, but E8/E14… read Central; CGST = SGST here so heads compare equal)
const n = w.notice;
eq('Outward 4N CGST', n.outward.r1.c, NF, 'F8');
eq('Outward 4N IGST', n.outward.r1.i, NF, 'G8');
eq('Outward total CGST', n.outward.r6.c, NF, 'F13');
eq('Cash CGST', n.outward.r7.c, NF, 'F14');
eq('Cash SGST', n.outward.r7.s, NF, 'E14');
eq('Cash IGST', n.outward.r7.i, NF, 'G14');
eq('ITC used CGST', n.outward.r8.c, NF, 'F15');
eq('ITC used SGST', n.outward.r8.s, NF, 'E15');
eq('ITC used IGST', n.outward.r8.i, NF, 'G15');
eq('Net payable CGST', n.outward.r11.c, NF, 'F18');
eq('Net payable IGST', n.outward.r11.i, NF, 'G18');
eq('Inward 8A CGST', n.inward.r1.c, NF, 'F23');
eq('Inward 8A IGST', n.inward.r1.i, NF, 'G23');
eq('Inward available CGST', n.inward.r6.c, NF, 'F28');
eq('Inward used CGST', n.inward.r7.c, NF, 'F29');
eq('Net excess CGST', n.inward.r9.c, NF, 'F31');
eq('Net excess IGST', n.inward.r9.i, NF, 'G31');

// ---------------------------------------------------------------- Report
let fail = 0;
let devs = 0;
checks.forEach((c) => {
  const ok = Math.abs((c.actual ?? NaN) - c.expected) <= c.tol;
  if (!ok) fail++;
  if (c.deviation) devs++;
  const tag = ok ? (c.deviation ? 'DEV ' : 'ok  ') : 'FAIL';
  if (!ok || c.deviation || process.env.VERBOSE) {
    console.log(`${tag} ${c.ref.padEnd(28)} ${c.label.padEnd(34)} engine=${Number(c.actual).toFixed(2).padStart(18)} expected=${Number(c.expected).toFixed(2).padStart(18)}${c.deviation ? '  — ' + c.deviation : ''}`);
  }
});
console.log(`\n${checks.length} checks: ${checks.length - fail} passed (${devs} documented deviations), ${fail} failed.`);
console.log(`Open differences needing a reason: ${w.openCount}`);
if (process.env.VERBOSE) w.diffs.filter((d) => d.requiresReason).forEach((d) => console.log('  needs reason:', d.key, d.label));
process.exit(fail ? 1 : 0);
