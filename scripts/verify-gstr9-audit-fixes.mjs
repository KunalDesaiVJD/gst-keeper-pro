#!/usr/bin/env node
// Checks for the GSTR-9/9C audit fixes of 24 Oct 2026 (docs/GSTR9_9C_WORKINGS.md
// §6 positions 8, 10, 21–27), on small hand-made workings. Needs no client data:
//
//   node scripts/verify-gstr9-audit-fixes.mjs

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
const ctx = { clientName: 'Test', gstin: '27AAAAA0000A1Z5', financialYear: '2024-25', noItcBuilder: false };

let failed = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
};
const sale = (id, category, taxable, cgst) => ({ id, ledger: id, category, supplyType: 'intra', rate: 18, taxable, igst: 0, cgst, sgst: null, cess: 0 });
const out = (w, key) => w.outward.rows.find((r) => r.key === key).books;

// 4F, 4G1 and 4J buckets; an advance adjusted nets 4F and is not a credit note.
{
  const d = D.emptyDocs();
  d.sales.partA.push(sale('adv', 'at', 500, 45), sale('adv-adj', 'at', -100, -9), sale('eco', 'ecom', 200, 18), sale('dn', 'dr_nt', 50, 4.5), sale('ret', 'b2b', -30, -2.7));
  d.gstr9.t4BooksExtra.at = { t: 10, i: 0, c: 1, s: 1, x: 0 };
  const w = E.computeWorkings(d, ctx);
  eq('4F value (ledgers net of adjusted + extras)', out(w, 'at').t, 410);
  eq('4F CGST', out(w, 'at').c, 37);
  eq('4G1 value', out(w, 'ecom').t, 200);
  eq('4J value', out(w, 'dr_nt').t, 50);
  eq('4I value (only the B2B return)', out(w, 'cr_nt').t, 30);
  eq('advance adjusted is not a return', w.sales.rows['adv-adj'].isReturn ? 1 : 0, 0);
  eq('books total = Part A + extras', w.outward.booksTotal.t, w.sales.partA.t + 10);
}

// A bucket a saved doc does not know is B2B, not a crash.
{
  const d = D.emptyDocs();
  d.sales.partA.push({ ...sale('old', undefined, 100, 9) });
  const w = E.computeWorkings(d, ctx);
  eq('unknown bucket → 4B', out(w, 'b2b').t, 100);
}

// 7E: 4B(1) less 7A2 / 7C / 7D, never below nil.
{
  const d = D.emptyDocs();
  d.portal.months.apr.itc4b1 = { i: 1000, c: 100, s: 100, x: 0 };
  d.gstr9.t7.r42 = { i: 400, c: 150, s: null, x: 0 };
  const w = E.computeWorkings(d, ctx);
  eq('7E IGST', w.g9.t7.E.i, 600);
  eq('7E CGST (floored)', w.g9.t7.E.c, 0);
  eq('7I IGST (no double count)', w.g9.t7I.i, 1000);
  eq('7E as filed', w.g9.t7EAsFiled.i, 1000);
}

// 6E capital goods, 8G = 8H + 8H1.
{
  const d = D.emptyDocs();
  const row = (id, section) => ({ id, section, ledger: id, supplyType: 'inter', rate: 18, taxable: 1000, igst: 180, cgst: 0, sgst: null, cess: 0, head: 'imported_goods' });
  d.purchases.rows.push(row('goods', 'purchase'), row('machine', 'capital_goods'));
  d.gstr9.t8H1 = { i: 50, c: 0, s: null, x: 0 };
  const w = E.computeWorkings(d, ctx);
  eq('6E inputs IGST', w.g9.t6.E_ip.i, 180);
  eq('6E capital goods IGST', w.g9.t6.E_cg.i, 180);
  eq('6B capital goods IGST', w.g9.t6.B_cg.i, 0);
  eq('8H IGST', w.g9.t8.H.i, 360);
  eq('8G IGST', w.g9.t8.G.i, 410);
  eq('8I IGST', w.g9.t8.I.i, 0);
  eq('8K IGST', w.g9.t8.K.i, 0);
}

// 5C1 is cross-checked against the portal's Table 5.
{
  const d = D.emptyDocs();
  d.sales.partB.push({ id: 'b', ledger: 'ECO sales', nature: 'ecom_95', amount: 300 });
  d.portal.gstr9Meta.source = 'upload';
  d.portal.gstr9.table5.ecom_14 = 250;
  const w = E.computeWorkings(d, ctx);
  const line = w.diffs.find((x) => x.key === 'g9.t5.5C1');
  eq('5C1 line difference', line ? line.diff.t : NaN, 50);
}

// 9C 9Q is the tax paid in GSTR-9 Table 9.
{
  const d = D.emptyDocs();
  d.portal.gstr9Meta.source = 'upload';
  d.portal.gstr9.table9.cgst = { payable: 1000, cash: 300, itcI: 0, itcC: 500, itcS: 0, itcX: 0 };
  const w = E.computeWorkings(d, ctx);
  eq('9Q CGST = paid', w.gstr9c.t9.Q.c, 800);
}

// RCM: No ITC stays in the liability, out of ITC; 6C/6D split by inputs / capital goods / services.
{
  const d = D.emptyDocs();
  const months = (taxable) => Object.fromEntries(['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'].map((m, k) => [m, { taxable: k === 0 ? taxable : 0 }]));
  d.rcm.categories.push(
    { id: 'svc', name: 'Legal', rate: 18, supplyType: 'intra', itcTable: '6C', months: months(1000) },
    { id: 'gds', name: 'Cashew', rate: 5, supplyType: 'intra', itcTable: '6C', itcType: 'ip', months: months(2000) },
    { id: 'cg', name: 'Machine', rate: 18, supplyType: 'intra', itcTable: '6D', itcType: 'cg', months: months(500) },
    { id: 'blk', name: 'Motor car rent', rate: 18, supplyType: 'intra', itcTable: 'none', months: months(100) },
  );
  const w = E.computeWorkings(d, ctx);
  eq('6C inputs CGST', w.g9.t6.C_ip.c, 50);
  eq('6C input services CGST', w.g9.t6.C_is.c, 90);
  eq('6D capital goods CGST', w.g9.t6.D_cg.c, 45);
  eq('RCM liability (Part B) CGST incl. no-ITC', w.rcm.partB.c, 194);
  eq('RCM ITC in P&L net ITC CGST', w.purchases.rcmCredit.c, 185);
  eq('RCM ITC in D&T CGST', w.dti.rcmBooks.c, 185);
  eq('9C 14P CGST', w.c14.rows.P.c, 185);
  eq('Annexure-1 D (tax paid) CGST', w.ann1.D.c, 194);
}

// QRMP: a quarter's 3B is compared with three months of books.
{
  const d = D.emptyDocs();
  ['apr', 'may', 'jun'].forEach((m) => { d.duties_output.months[m].sales = { i: 0, c: 100, s: null, x: 0 }; });
  d.portal.months.jun.outTax = { i: 0, c: 300, s: 300, x: 0 };
  d.portal.monthMeta.jun = { source: 'as_filed_3b' };
  const w = E.computeWorkings(d, { ...ctx, quarterly: true });
  const line = w.diffs.find((x) => x.key === 'dto.jun');
  eq('quarter line difference', line ? line.diff.c : NaN, 0);
  eq('no "not fetched" line for Apr/May', w.diffs.some((x) => x.key === 'dto.no3b') ? 1 : 0, 0);
  eq('Jun row difference', w.dto.months.jun.diff.c, 0);
  const wm = E.computeWorkings(d, ctx);
  eq('monthly client: Apr/May not fetched', wm.diffs.some((x) => x.key === 'dto.no3b') ? 1 : 0, 1);
}

// 8G typed from the bills of entry: what was paid and not availed lapses in 8J.
{
  const d = D.emptyDocs();
  d.purchases.rows.push({ id: 'g', section: 'purchase', ledger: 'Import', supplyType: 'inter', rate: 18, taxable: 1000, igst: 180, cgst: 0, sgst: null, cess: 0, head: 'imported_goods' });
  d.gstr9.t8G = { i: 200, c: 0, s: null, x: 0 };
  const w = E.computeWorkings(d, ctx);
  eq('8G typed', w.g9.t8.G.i, 200);
  eq('8J not availed', w.g9.t8.J.i, 20);
}

// 9C 9K2 takes the 4G1 ledgers.
{
  const d = D.emptyDocs();
  d.sales.partA.push(sale('eco', 'ecom', 1000, 90), sale('b', 'b2b', 500, 45));
  const w = E.computeWorkings(d, ctx);
  eq('9K2 value', w.gstr9c.t9.rows.K2.t, 1000);
  eq('9E (18%) value', w.gstr9c.t9.rows.E.t, 500);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
