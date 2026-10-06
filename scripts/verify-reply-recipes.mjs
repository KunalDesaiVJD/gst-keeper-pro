#!/usr/bin/env node
// Golden test for the evidence recipes (src/lib/reply, roadmap Phase 4).
//
//   node scripts/verify-reply-recipes.mjs
//
// Builds the pure recipe core with esbuild (the Supabase client is stubbed —
// nothing here touches a database), feeds it synthetic portal data for a
// fictional client in the shapes the extension saves (12 months of GSTR-1,
// GSTR-3B and GSTR-2B for FY 2023-24 with known differences, a late-filed
// GSTR-3B, time-barred invoices, a GSTR-2A year under Rule 36(4)), and checks
// the figures each recipe must produce. Prints a pass / fail table; exits 1 on
// any failure.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
      export { computeEvidence } from './src/lib/reply/evidence';
      export { parseGstr2b, parseGstr2a, parseGstr3b } from './src/lib/reply/portal';
      export { hashOf } from './src/lib/reply/hash';
      export { parseGstr3bSummary } from './src/lib/gstr9/portalParser';
      export { flattenGstr2bDocs, flattenGstr2aDocs } from './src/utils/filedReturnReports';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'error',
  loader: { '.png': 'dataurl' },
});
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// ── Fixture: "Fictional Fabrics", FY 2023-24 ───────────────────────────────
const FY = ['04/2023', '05/2023', '06/2023', '07/2023', '08/2023', '09/2023', '10/2023', '11/2023', '12/2023', '01/2024', '02/2024', '03/2024'];
const next20 = (p, day = 20) => { const [m, y] = p.split('/').map(Number); const d = new Date(Date.UTC(y, m, day)); return d.toISOString().slice(0, 10); };
const ah = (i, c, s) => ({ iamt: i, camt: c, samt: s, csamt: 0 });
let seq = 0;
const row = (type, period, summary, extra = {}) => ({
  id: `r${++seq}`, period, type, arn: `AA24${String(seq).padStart(6, '0')}`, status: 'Filed', summary,
  filedDate: type === 'GSTR1' ? next20(period, 11) : type === 'GSTR3B' ? next20(period, 20) : null,
  updatedAt: '2026-10-05T10:00:00Z', ...extra,
});
const gstr1 = (i, c, s) => ({ sec_sum: [{ sec_nm: 'B2B', ttl_val: 1, ttl_igst: i, ttl_cgst: c, ttl_sgst: s, ttl_cess: 0 }, { sec_nm: 'TTL_LIAB', ttl_val: (i + c + s) * 5, ttl_igst: i, ttl_cgst: c, ttl_sgst: s, ttl_cess: 0 }] });
const gstr3b = ({ a, d = [0, 0, 0], oth, isrc = [0, 0, 0], fee = [0, 0, 0], intr = [0, 0, 0] }) => {
  const net = [0, 1, 2].map((k) => oth[k] + isrc[k]);
  return {
    sup_details: { osup_det: { txval: 1, ...ah(...a) }, osup_zero: { txval: 0, ...ah(0, 0, 0) }, isup_rev: { txval: 1, ...ah(...d) }, osup_nil_exmp: { txval: 0 }, osup_nongst: { txval: 0 } },
    itc_elg: {
      itc_avl: [{ ty: 'IMPG', ...ah(0, 0, 0) }, { ty: 'IMPS', ...ah(0, 0, 0) }, { ty: 'ISRC', ...ah(...isrc) }, { ty: 'ISD', ...ah(0, 0, 0) }, { ty: 'OTH', ...ah(...oth) }],
      itc_rev: [{ ty: 'RUL', ...ah(0, 0, 0) }, { ty: 'OTH', ...ah(0, 0, 0) }], itc_net: ah(...net), itc_inelg: [],
    },
    intr_ltfee: { intr_details: ah(...intr), ltfee_details: ah(...fee) },
  };
};
const inv = (inum, dt, i, c, s, more = {}) => ({ inum, dt, txval: (i + c + s) * 5, igst: i, cgst: c, sgst: s, cess: 0, rev: 'N', itcavl: 'Y', rsn: '', ...more });
const gstr2b = (invs) => ({ gstin: '24AAAAF0000F1Z5', rtnprd: '', docdata: { b2b: [{ ctin: '24BBBBB1111B1Z1', trdnm: 'Supplier One', supfildt: '11-05-2023', inv: invs }] } });

const filed = [];
for (const p of FY) {
  const [m, y] = p.split('/');
  const dt = `15-${m}-${y}`;
  // GSTR-1: base 60k / 90k / 90k; Jun IGST +50k; Nov CGST/SGST +5k; Dec CGST +8; Mar not filed.
  let g1 = [60000, 90000, 90000];
  if (p === '06/2023') g1 = [110000, 90000, 90000];
  if (p === '11/2023') g1 = [60000, 95000, 95000];
  if (p === '12/2023') g1 = [60000, 90008, 90000];
  if (p === '01/2024') g1 = [60000, 89992, 90000];
  if (p === '03/2024') filed.push(row('GSTR1', p, {}, { status: 'NOT FILED / NOT FOUND', filedDate: null }));
  else filed.push(row('GSTR1', p, gstr1(...g1)));
  // GSTR-2B docs.
  const docs = [inv(`A-${m}`, dt, 40000, 60000, 60000)];
  if (p === '10/2023') docs.push(inv('C-1', '20-03-2023', 3600, 0, 0), inv('D-1', '10-10-2023', 11400, 0, 0));
  if (p === '01/2024') docs.push(inv('OLD-1', '15-03-2022', 1800, 0, 0), inv('OLD-2', '10-02-2023', 0, 900, 900));
  filed.push(row('GSTR2B', p, gstr2b(docs), { status: 'Generated', filedDate: null }));
  // GSTR-3B: Sep pays IGST +30k; Aug claims IGST +40k over 2B; Jan 4A(5) includes re-claimed 2k C/S.
  if (p === '02/2024') continue; // not fetched
  const a = p === '09/2023' ? [90000, 90000, 90000] : [60000, 90000, 90000];
  let oth = [40000, 60000, 60000];
  if (p === '08/2023') oth = [80000, 60000, 60000];
  if (p === '01/2024') oth = [41800, 62900, 62900];
  const d = p === '05/2023' ? [0, 9000, 9000] : [0, 0, 0];
  const isrc = p === '05/2023' ? [0, 9000, 9000] : p === '08/2023' ? [0, 2000, 2000] : [0, 0, 0];
  const extra = p === '07/2023' ? { filedDate: '2023-09-04' } : {};
  filed.push(row('GSTR3B', p, gstr3b({ a, d, oth, isrc }), extra));
}
const data = {
  filed,
  gstr9: [{ id: 'g9', period: '03/2023', type: 'GSTR9_CALC', arn: 'AA2422', filedDate: '2023-10-15', status: 'Filed', summary: {}, updatedAt: '2026-10-01T00:00:00Z' }],
  filingStatus: [],
  reclaims: [
    { id: 'rc0', financialYear: '2023-2024', period: null, isOpening: true, description: null, claimed: z(), reversed: z(), reclaimed: z(), closing: z(), pulledAt: '2026-10-01T00:00:00Z' },
    { id: 'rc1', financialYear: '2023-2024', period: '01/2024', isOpening: false, description: 'GSTR-3B', claimed: z(), reversed: z(), reclaimed: { igst: 0, cgst: 2000, sgst: 2000, cess: 0 }, closing: z(), pulledAt: '2026-10-01T00:00:00Z' },
  ],
  reclaimFys: ['2023-24'],
  rcmStatement: [],
  drc03: [
    { id: 'd1', arn: 'AD2404240001', cause: 'Liability mismatch – GSTR-1 to GSTR-3B', filedDate: '2024-04-30', periodFrom: '2023-04-01', periodTo: '2024-03-31', heads: { igst: 8000, cgst: 0, sgst: 0, cess: 0 }, total: 8000, status: 'Acknowledged', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'd2', arn: 'AD2404240002', cause: 'Voluntary', filedDate: '2024-04-30', periodFrom: '2023-04-01', periodTo: '2024-03-31', heads: { igst: 1000, cgst: 0, sgst: 0, cess: 0 }, total: 1000, status: 'Acknowledged', updatedAt: '2026-10-01T00:00:00Z' },
  ],
  turnover: [{ id: 't1', financialYear: '2023-24', aggregate: 3e7, exempt: 0, directExempt: 0, updatedAt: '2026-09-01T00:00:00Z' }],
  annual: [],
  errors: [],
};
function z() { return { igst: 0, cgst: 0, sgst: 0, cess: 0 }; }

const client = { id: 'c1', name: 'Fictional Fabrics', gstin: '24AAAAF0000F1Z5', dueDay1: null, dueDay2: null };
const notice = (over) => ({ id: 'n1', clientId: 'c1', formCode: 'ASMT-10', referenceNumber: 'ZD240001', issueDate: '2026-09-01', financialYear: '2023-24', periodFrom: null, periodTo: null, demand: null, demandTotal: null, amountOfDemand: null, ...over });
const issue = (code, over = {}) => ({ id: `i-${code}`, seq: 1, title: code, issueCode: code, amount: 0, explainedAmount: 0, explainedBy: null, periodFrom: null, periodTo: null, demand: null, status: 'open', ...over });
const TYPES = [
  ['LIAB_GSTR1_V_3B', 'gstr1_vs_3b'], ['ITC_2B_V_3B', 'gstr3b_vs_2b'], ['ITC_2A_V_3B', 'gstr3b_vs_2a'], ['RCM_LIAB', 'rcm'], ['INTEREST_50', 'interest'],
  ['LATE_FEE_47', 'late_fee'], ['ITC_16_4', 'itc_16_4'], ['ITC_17_5', 'itc_17_5'], ['RETURN_NOT_FILED', 'filing_status'], ['TURNOVER_MISMATCH', null],
].map(([code, recipeKey]) => ({ code, title: code, recipeKey, documents: [`Docs for ${code}`], forms: [] }));
const TODAY = '2026-10-06';
const run = (n, issues, d = data) => R.computeEvidence({ notice: n, client, issues, types: TYPES, linkedDrc03: [], data: d, today: TODAY });
const card = (n, issues, recipe, d) => run(n, issues, d).cards.find((c) => c.plan.recipe === recipe);
const heads = (c) => Object.fromEntries(c.result.summary.heads.map((h) => [h.head, h.to_pay]));

// ── Checks ─────────────────────────────────────────────────────────────────
const results = [];
const check = (name, actual, expected) => {
  const ok = typeof expected === 'number' ? Math.abs(Number(actual) - expected) < 0.006 : JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
};

// 1. DRC-01B, June 2023: IGST short 50,000; 30,000 paid in Sep (timing); DRC-03 8,000 → 12,000 to pay.
{
  const c = card(notice({ formCode: 'DRC-01B', periodFrom: '2023-06-01', periodTo: '2023-06-30' }), [issue('LIAB_GSTR1_V_3B', { amount: 50000, demand: { igst: { tax: 50000 } } })], 'gstr1_vs_3b');
  const ln = (l) => c.result.summary.lines.find((x) => x.label.startsWith(l)).values.igst;
  check('GSTR-1 v 3B (Jun): IGST difference', ln('Difference'), 50000);
  check('GSTR-1 v 3B (Jun): timing paid in Sep', ln('Settled in another month'), 30000);
  check('GSTR-1 v 3B (Jun): DRC-03 counted', ln('DRC-03 paid'), 8000);
  check('GSTR-1 v 3B (Jun): IGST to pay', heads(c).igst, 12000);
  check('GSTR-1 v 3B (Jun): explained', c.result.explained, 38000);
  check('GSTR-1 v 3B (Jun): status (Feb 3B, Mar GSTR-1 missing in the FY)', c.result.status, 'partial');
  const jun = c.result.tables[0].rows.find((r) => r.cells.month === 'Jun 2023');
  check('GSTR-1 v 3B (Jun): row source = GSTR-1 + GSTR-3B', jun._source.map((s) => s.label), ['GSTR-1', 'GSTR-3B']);
  check('GSTR-1 v 3B (Jun): treatment names Sep', /paid later in Sep 2023/.test(jun.cells.treatment), true);
  const voluntary = c.result.tables.find((t) => t.key === 'drc03').rows.find((r) => r.cells.arn === 'AD2404240002');
  check('DRC-03 for another cause is listed, not counted', /^Not counted/.test(voluntary.cells.counted), true);
}
// 2. The FY: IGST 12,000, CGST/SGST 5,000 each; one "not fetched" row per missing month.
{
  const c = card(notice({ formCode: 'DRC-01B' }), [issue('LIAB_GSTR1_V_3B')], 'gstr1_vs_3b');
  check('GSTR-1 v 3B (FY): to pay per head', heads(c), { igst: 12000, cgst: 5000, sgst: 5000 });
  const miss = c.result.tables[0].rows.filter((r) => r.kind === 'missing').map((r) => [r.cells.month, r.cells.treatment]);
  check('GSTR-1 v 3B (FY): one line per missing month', miss, [['Feb 2024', 'GSTR-3B not fetched'], ['Mar 2024', 'GSTR-1 not filed']]);
  check('GSTR-1 v 3B (FY): fetch plan', c.result.readiness.plan, [{ mode: 'gstr3b_pull', label: 'GSTR-3B', periods: ['02/2024'] }]);
  const row = (m) => c.result.tables[0].rows.find((r) => r.cells.month === m).cells;
  check('GSTR-1 v 3B (FY): cumulative IGST after Sep', row('Sep 2023').c_igst, 20000);
  check('GSTR-1 v 3B (FY): cumulative CGST after Jan', row('Jan 2024').c_cgst, 5000);
}
// 3. ₹10 tolerance: Dec 2023 CGST differs by ₹8 → nothing to pay.
{
  const c = card(notice({ formCode: 'DRC-01B', periodFrom: '2023-12-01', periodTo: '2023-12-31' }), [issue('LIAB_GSTR1_V_3B')], 'gstr1_vs_3b');
  check('Tolerance: ₹8 difference → to pay 0', c.result.toPay, 0);
  check('Tolerance: row reads as a match', c.result.tables[0].rows.find((r) => r.cells.month === 'Dec 2023').cells.treatment, 'Matches (within ₹10 per head)');
}
// 4. DRC-01C, FY: IGST 40,000 over 2B in Aug; 15,000 in Oct's 2B (timing); Jan re-claim of 2,000 C/S deducted → 25,000.
{
  const c = card(notice({ formCode: 'DRC-01C', amountOfDemand: 40000 }), [], 'gstr3b_vs_2b');
  check('3B v 2B (FY): to pay per head', heads(c), { igst: 25000, cgst: 0, sgst: 0 });
  check('3B v 2B (FY): explained (notice 40,000)', c.result.explained, 15000);
  const ln = (l) => c.result.summary.lines.find((x) => x.label.startsWith(l)).values;
  check('3B v 2B (FY): 4D(1) re-claim deducted', ln('less 4D(1)').cgst, 2000);
  check('3B v 2B (FY): timing', ln('In GSTR-2B in another month').igst, 15000);
  check('3B v 2B (FY): reverse charge listed outside', c.result.tables.find((t) => t.key === 'itc_outside').rows.find((r) => r.cells.item.startsWith('Reverse charge — GSTR-3B')).cells.v_cgst, 11000);
}
// 5. The year at a glance (ASMT-10, no coded issue): 12,000 + 25,000 IGST; 5,000 + 2,000 CGST / SGST.
{
  const c = card(notice({ formCode: 'ASMT-10' }), [], 'fy_summary');
  check('Year at a glance: to pay per head', heads(c), { igst: 37000, cgst: 7000, sgst: 7000 });
  check('Year at a glance: total', c.result.toPay, 51000);
  check('Year at a glance: tables', c.result.tables.map((t) => t.key), ['fy_glance', 'liability_monthly', 'itc_monthly', 'itc_reclaims', 'itc_outside', 'rcm_monthly', 'drc03']);
}
// 6. Reverse charge: Aug credit 2,000 C/S without tax.
{
  const c = card(notice({}), [issue('RCM_LIAB')], 'rcm');
  check('RCM: excess credit per head', heads(c), { cgst: 2000, sgst: 2000 });
}
// 7. Interest: Jul 3B filed 4 Sep 2023, due 20 Aug → 15 days; cash 20,000 / 30,000 / 30,000.
{
  const c = card(notice({}), [issue('INTEREST_50')], 'interest');
  check('Interest: per head (18%, 365 days, 15 days late)', heads(c), { igst: 147.95, cgst: 221.92, sgst: 221.92 });
  const jul = c.result.tables[0].rows.find((r) => r.cells.month === 'Jul 2023');
  check('Interest: days late', jul.cells.days, 15);
  check('Interest: cash part is an estimate', jul.cells.basis, 'Estimate');
}
// 8. Late fee: Jul 3B 15 days late, turnover ₹3 crore → ₹375 CGST + ₹375 SGST.
{
  const c = card(notice({}), [issue('LATE_FEE_47')], 'late_fee');
  check('Late fee: per head', heads(c), { cgst: 375, sgst: 375 });
}
// 9. s.16(4): two old invoices in Jan 2024 (3B filed 20 Feb 2024); one Mar 2023 invoice barred by the GSTR-9 date (15 Oct 2023).
{
  const c = card(notice({}), [issue('ITC_16_4')], 'itc_16_4');
  check('s.16(4): documents', c.result.tables[0].rows.filter((r) => r.kind === 'data').map((r) => r.cells.doc), ['C-1', 'OLD-1', 'OLD-2']);
  check('s.16(4): to pay per head', heads(c), { igst: 5400, cgst: 900, sgst: 900 });
  check('s.16(4): GSTR-9 date used', c.result.tables[0].rows[0].cells.last, '15 Oct 2023 (GSTR-9 filed)');
}
// 10. Filing status: Feb 3B not fetched, Mar GSTR-1 not filed.
{
  const c = card(notice({ formCode: 'GSTR-3A' }), [], 'filing_status');
  const st = (ret, m) => c.result.tables[0].rows.find((r) => r.cells.ret === ret && r.cells.month === m).cells.status;
  check('Filing status: Mar GSTR-1', st('GSTR-1', 'Mar 2024'), 'Not filed (portal)');
  check('Filing status: Feb GSTR-3B', st('GSTR-3B', 'Feb 2024'), 'Not fetched');
  check('Filing status: Jul GSTR-3B days late', c.result.tables[0].rows.find((r) => r.cells.ret === 'GSTR-3B' && r.cells.month === 'Jul 2023').cells.days, 15);
}
// 11. Needs data / needs a period / not applicable.
{
  check('s.17(5): needs data with the issue\'s documents', (() => { const c = card(notice({}), [issue('ITC_17_5')], 'itc_17_5'); return [c.result.status, c.result.summary.documents]; })(), ['needs_data', ['Docs for ITC_17_5']]);
  check('DRC-01B without a period: needs data', card(notice({ formCode: 'DRC-01B', financialYear: null }), [issue('LIAB_GSTR1_V_3B')], 'gstr1_vs_3b').result.status, 'needs_data');
  check('3B v 2B for FY 2020-21: not applicable', card(notice({ financialYear: '2020-21' }), [issue('ITC_2B_V_3B')], 'gstr3b_vs_2b').result.status, 'not_applicable');
  const plan = run(notice({}), [issue('TURNOVER_MISMATCH')]);
  check('Issue code without a recipe is listed as uncovered', plan.uncovered.map((u) => u.issue.issueCode), ['TURNOVER_MISMATCH']);
}
// 12. GSTR-2A with Rule 36(4) (FY 2020-21): Oct 8,000 over, within 10%; Nov 15,000 over → 5,000 left.
{
  const a2 = (i) => ({ b2b: [{ ctin: '24CCCCC2222C1Z2', trdnm: 'Old Supplier', supfildt: null, inv: [{ inum: 'X', idt: '15-10-2020', val: 1, rchrg: 'N', itms: [{ num: 1, itm_det: { rt: 18, txval: i * 5, iamt: i, camt: 0, samt: 0, csamt: 0 } }] }] }] });
  const d2 = { ...data, filed: [
    row('GSTR2A', '10/2020', a2(100000), { status: 'Pulled', filedDate: null }), row('GSTR3B', '10/2020', gstr3b({ a: [0, 0, 0], oth: [108000, 0, 0] })),
    row('GSTR2A', '11/2020', a2(100000), { status: 'Pulled', filedDate: null }), row('GSTR3B', '11/2020', gstr3b({ a: [0, 0, 0], oth: [115000, 0, 0] })),
  ], reclaims: [], drc03: [] };
  const c = card(notice({ financialYear: '2020-21' }), [issue('ITC_2A_V_3B')], 'gstr3b_vs_2a', d2);
  check('3B v 2A (Rule 36(4)): IGST to pay', heads(c).igst, 5000);
  check('3B v 2A: 2A item-level tax read', R.parseGstr2a(a2(100000))[0].tax.igst, 100000);
}
// 13. Parsers and the inputs hash.
{
  const doc = gstr2b([inv('P', '01-04-2023', 1800, 0, 0)]);
  check('2B parser reads invoice-level igst', R.parseGstr2b(doc).docs[0].tax.igst, 1800);
  const g3 = gstr3b({ a: [60000, 90000, 90000], oth: [1, 2, 3] });
  const mine = R.parseGstr3b(g3);
  const theirs = R.parseGstr3bSummary(g3);
  check('3B 3.1(a)+(b) agrees with the Annual Return parser', [mine.t31a.cgst + mine.t31b.cgst, mine.t31a.igst + mine.t31b.igst], [theirs.outTax.c, theirs.outTax.i]);
  const h1 = run(notice({ formCode: 'DRC-01B' }), [issue('LIAB_GSTR1_V_3B')]).cards[0].hash;
  const h2 = run(notice({ formCode: 'DRC-01B' }), [issue('LIAB_GSTR1_V_3B')]).cards[0].hash;
  const d3 = { ...data, filed: data.filed.map((r) => (r.type === 'GSTR3B' && r.period === '06/2023' ? { ...r, updatedAt: '2026-10-06T09:00:00Z' } : r)) };
  const h3 = run(notice({ formCode: 'DRC-01B' }), [issue('LIAB_GSTR1_V_3B')], d3).cards[0].hash;
  check('Inputs hash: same inputs → same hash', h1 === h2, true);
  check('Inputs hash: a re-pulled month → new hash', h1 !== h3, true);
}

// Shared-util findings (informational, not failures).
const info = [];
{
  const doc = gstr2b([inv('P', '01-04-2023', 1800, 2700, 2700)]);
  const f = R.flattenGstr2bDocs(doc)[0];
  info.push(`src/utils/filedReturnReports.ts flattenGstr2bDocs on a GSTR-2B invoice (igst 1800, cgst 2700): reads igst ${f.igst}, cgst ${f.cgst}`);
  const a = R.flattenGstr2aDocs({ b2b: [{ ctin: 'X', inv: [{ inum: 'X', idt: '01-04-2020', itms: [{ itm_det: { txval: 10000, iamt: 1800 } }] }] }] })[0];
  info.push(`flattenGstr2aDocs on a GSTR-2A invoice with tax in itms[].itm_det (iamt 1800): reads igst ${a.igst}`);
}

const pad = (s, n) => String(s).padEnd(n);
let failed = 0;
console.log(`${pad('Check', 72)} Result`);
console.log('-'.repeat(80));
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${pad(r.name, 72)} ${r.ok ? 'pass' : 'FAIL'}`);
  if (!r.ok) console.log(`    expected ${JSON.stringify(r.expected)}\n    actual   ${JSON.stringify(r.actual)}`);
}
console.log('-'.repeat(80));
console.log(`${results.length - failed} passed, ${failed} failed`);
for (const i of info) console.log(`note: ${i}`);
process.exit(failed ? 1 : 0);
