#!/usr/bin/env node
// Checks GSTR-3B Table 3.1 and 3.2 as computed from a GSTR-1 JSON, and every
// figure built on them (firm's report of 20 Oct 2026: ORVIX's supply to an
// SEZ without payment of tax sat in 3.1(a) instead of 3.1(b)).
// docs/GSTR3B_OUTWARD_POSITIONS.md states the law and the positions:
//  - the classifier (src/lib/gstr1/supplyKind.ts): R, DE and CBW invoices to
//    3.1(a); SEWP and SEWOP to 3.1(b); registered notes follow their inv_typ,
//    unregistered notes their typ (B2CL to 3.1(a), EXPWP / EXPWOP to 3.1(b));
//    a credit note takes off, a debit note adds;
//  - the draft (src/utils/buildGstr3bJson.ts): 3.1(a) to (e) on a fixture
//    holding every kind, export cess in 3.1(b), Table 3.2 (unregistered
//    persons with B2CL notes, UIN holders; no composition flag), total
//    liability = 3.1(a) + (b) + (d), amendments flagged and never folded
//    (a Table 10 re-rating difference folded), reverse charge value only;
//  - output tax (computeGstr1OutputTax, the credit closing report, the GST
//    receivable reco): 3.1(a) + 3.1(b) tax, every advance rate line;
//  - the advance set-off check leaves SEZ invoices out;
//  - the as-filed reports (gstr3bReports, taxLiabilityReports, panReports,
//    extraPortalReports, interestScrutinyReports) count 3.1(b) in total
//    liability, and split B2B and the notes into 3.1(a) and 3.1(b);
//  - the GSTR-3B version diff sees Table 3.2's UIN and composition rows.
//
//   node scripts/verify-gstr3b-outward.mjs
//   GSTK_ROOT=/path/to/other/checkout node scripts/verify-gstr3b-outward.mjs
//
// A real month (read-only: a GSTR-1 raw_json saved to a file beforehand):
//   node scripts/verify-gstr3b-outward.mjs --json /path/raw.json --period 09/2026 \
//     --gstin 24ABCDE1234F1Z5 [--expect-a 3671300 --expect-b 379394.67]
// prints its Table 3.1 and 3.2 and checks the expected taxable values.
//
// Fictional figures; Supabase is replaced by an in-memory table store, so
// nothing is read from or written to the live project. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { gstr1Summary, gstr3bSummary } from './fixtures/gstr1SecSumFixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const run = async (group, fn) => { try { await fn(); } catch (e) { check(group, 'runs', false, e?.stack ?? e); } };
const near = (a, b, tol = 0.005) => typeof a === 'number' && Math.abs(a - b) <= tol;
const J = (x) => JSON.stringify(x);

// An in-memory stand-in for the supabase client (as verify-import2b-notes):
// select / eq / in / not / order / maybeSingle over globalThis.__db.
const FAKE_SUPABASE = `
class Q {
  constructor(t) { this.t = t; this.f = []; this.one = false; this.cols = null; }
  select(c) { this.cols = c && c.trim() !== '*' ? c.split(',').map((x) => x.trim()).filter(Boolean) : null; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { this.f.push((r) => (r[c] ?? null) !== v); return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  exec() {
    const rows = ((globalThis.__db || {})[this.t] || []).filter((r) => this.f.every((fn) => fn(r)))
      .map((r) => (this.cols ? Object.fromEntries(this.cols.map((k) => [k, r[k] ?? null])) : { ...r }));
    return { data: this.one ? rows[0] ?? null : rows, error: null };
  }
  then(ok, ko) { let r; try { r = this.exec(); } catch (e) { return Promise.reject(e).then(ok, ko); } return Promise.resolve(r).then(ok, ko); }
}
export const supabase = { from: (t) => new Q(t), rpc: async () => ({ data: null, error: null }) };
`;
const load = async (contents) => {
  const out = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
      },
    }],
    define: { 'import.meta.env': '{}' },
    banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
// The classifier is new with the fix: without it the rest is still checked.
const K = await load(`export * from './src/lib/gstr1/supplyKind';`).catch(() => ({}));
// One bundle, so the modules share the one fake client.
const M = await load(`
export * as G from './src/utils/buildGstr3bJson';
export * as O from './src/utils/computeGstr1OutputTax';
export * as A from './src/utils/allClientsReports';
export * as R from './src/lib/gstReceivableRecoCalc';
export * as S from './src/lib/advanceSetoffCheck';
export * as D from './src/utils/gstReturnDiff';
export * as G3 from './src/utils/gstr3bReports';
export * as TL from './src/utils/taxLiabilityReports';
export * as PAN from './src/utils/panReports';
export * as X from './src/utils/extraPortalReports';
export * as INT from './src/utils/interestScrutinyReports';
export * as B from './src/lib/gstr1/b2csaBaseline';
export * as SUM from './src/utils/buildGstr1Summary';
`);
const { G, O, A, R, S, D, G3, TL, PAN, X, INT, B, SUM } = M;

const ZERO_RCM = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
const draft = (gstr1Raw, extra = {}) => G.buildGstr3bJson({
  gstin: '24AAAAA0000A1Z5', periodMonth: '09/2026', gstr1Raw, itc: null, rcm: ZERO_RCM, alreadyFiled: false, ...extra,
});

// ── Real month mode ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
if (arg('--json')) {
  const raw = JSON.parse(fs.readFileSync(arg('--json'), 'utf8'));
  const g = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const period = arg('--period') || '';
  const res = G.buildGstr3bJson({ gstin: arg('--gstin') || '', periodMonth: period, gstr1Raw: g, itc: null, rcm: ZERO_RCM, alreadyFiled: argv.includes('--filed') });
  const sd = res.json.sup_details;
  const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const line = (label, h) => console.log(`  ${label.padEnd(8)} value ${inr(h.txval).padStart(16)}   IGST ${inr(h.iamt).padStart(14)}   CGST ${inr(h.camt).padStart(12)}   SGST ${inr(h.samt).padStart(12)}   cess ${inr(h.csamt).padStart(8)}`);
  console.log(`GSTR-3B Table 3.1 from ${arg('--json')} (${period})`);
  line('3.1(a)', sd.osup_det); line('3.1(b)', sd.osup_zero); line('3.1(c)', sd.osup_nil_exmp); line('3.1(e)', sd.osup_nongst);
  console.log(`  3.2 unregistered: ${J(res.json.inter_sup.unreg_details)}`);
  console.log(`  3.2 UIN holders:  ${J(res.json.inter_sup.uin_details)}`);
  console.log(`  total liability (a + b + d): ${J(res.summary.totalLiability)}`);
  res.flags.forEach((f) => console.log(`  flag: ${f}`));
  let bad = 0;
  for (const [k, row] of [['--expect-a', 'osup_det'], ['--expect-b', 'osup_zero']]) {
    if (arg(k) === undefined) continue;
    const ok = near(sd[row].txval, Number(arg(k)));
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${row} taxable value ${inr(sd[row].txval)} = ${inr(Number(arg(k)))}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

// ── Fixture: one month holding every kind of document ───────────────────────
// Supplier in Gujarat (24). Recipients: a Maharashtra GSTIN (27), an SEZ unit
// in Gujarat, a UN body (UIN, place of supply Delhi 07); unregistered buyers in
// Karnataka (29).
const itm = (d) => ({ num: 1, itm_det: { rt: 18, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, ...d } });
const inv = (inum, o, lines) => ({ inum, idt: '10-09-2026', val: 0, pos: '27', rchrg: 'N', ...o, itms: lines.map(itm) });
const nt = (nt_num, o, lines) => ({ nt_num, nt_dt: '20-09-2026', val: 0, pos: '27', rchrg: 'N', ...o, itms: lines.map(itm) });
const UIN = '0717UNO00157UNO';
const MAIN = {
  gstin: '24AAAAA0000A1Z5', fp: '092026',
  b2b: [
    { ctin: '27BBBBB1111B1Z5', inv: [
      inv('R-1', { inv_typ: 'R' }, [{ txval: 100000, iamt: 18000 }]),
      inv('R-2', { pos: '24' }, [{ txval: 50000, camt: 4500, samt: 4500 }]),           // no inv_typ: R
      inv('DE-1', { inv_typ: 'DE' }, [{ txval: 20000, iamt: 3600 }]),
      inv('CBW-1', { inv_typ: 'CBW', pos: '24' }, [{ txval: 10000, iamt: 1800 }]),
      inv('RCM-1', { inv_typ: 'R', rchrg: 'Y' }, [{ rt: 5, txval: 30000, iamt: 1500 }]),
    ] },
    { ctin: '24CCCCC2222C1Z5', inv: [                                                  // SEZ unit in the supplier's own state
      inv('SEZ-1', { inv_typ: 'SEWP', pos: '24' }, [{ txval: 233000, iamt: 41940 }]),
      inv('SEZ-2', { inv_typ: 'SEWOP', pos: '24' }, [{ rt: 0, txval: 48000 }]),
    ] },
    { ctin: UIN, inv: [inv('UN-1', { pos: '07' }, [{ txval: 5000, iamt: 900 }])] },
  ],
  b2cl: [{ pos: '29', inv: [{ inum: 'L-1', idt: '11-09-2026', val: 354000, itms: [itm({ txval: 300000, iamt: 54000 })] }] }],
  b2cs: [
    { sply_ty: 'INTER', pos: '29', typ: 'OE', rt: 18, txval: 20000, iamt: 3600, csamt: 0 },
    { sply_ty: 'INTRA', pos: '24', typ: 'OE', rt: 18, txval: 40000, camt: 3600, samt: 3600, csamt: 0 },
  ],
  cdnr: [
    { ctin: '27BBBBB1111B1Z5', nt: [
      nt('CN-R', { ntty: 'C', inv_typ: 'R' }, [{ txval: 10000, iamt: 1800 }]),
      nt('DN-R', { ntty: 'D', inv_typ: 'R' }, [{ txval: 2000, iamt: 360 }]),
      nt('CN-DE', { ntty: 'C', inv_typ: 'DE' }, [{ txval: 1000, iamt: 180 }]),
      nt('DN-DE', { ntty: 'D', inv_typ: 'DE' }, [{ txval: 300, iamt: 54 }]),
      nt('CN-CBW', { ntty: 'C', inv_typ: 'CBW', pos: '24' }, [{ txval: 500, iamt: 90 }]),
      nt('DN-CBW', { ntty: 'D', inv_typ: 'CBW', pos: '24' }, [{ txval: 200, iamt: 36 }]),
      nt('DN-OLD', { typ: 'D' }, [{ txval: 400, iamt: 72 }]),                        // older export: type in typ, no inv_typ
    ] },
    { ctin: '24CCCCC2222C1Z5', nt: [
      nt('CN-SWP', { ntty: 'C', inv_typ: 'SEWP', pos: '24' }, [{ txval: 23300, iamt: 4194 }]),
      nt('DN-SWP', { ntty: 'D', inv_typ: 'SEWP', pos: '24' }, [{ txval: 1000, iamt: 180 }]),
      nt('CN-SWOP', { ntty: 'C', inv_typ: 'SEWOP', pos: '24' }, [{ rt: 0, txval: 4800 }]),
      nt('DN-SWOP', { ntty: 'D', inv_typ: 'SEWOP', pos: '24' }, [{ rt: 0, txval: 800 }]),
    ] },
    { ctin: UIN, nt: [nt('CN-UN', { ntty: 'C', inv_typ: 'R', pos: '07' }, [{ txval: 1000, iamt: 180 }])] },
  ],
  cdnur: [
    { typ: 'B2CL', ntty: 'C', nt_num: 'CN-L', nt_dt: '21-09-2026', val: 35400, pos: '29', itms: [itm({ txval: 30000, iamt: 5400 })] },
    { typ: 'B2CL', ntty: 'D', nt_num: 'DN-L', nt_dt: '21-09-2026', val: 1180, pos: '29', itms: [itm({ txval: 1000, iamt: 180 })] },
    { typ: 'EXPWP', ntty: 'D', nt_num: 'DN-E', nt_dt: '22-09-2026', val: 5900, pos: '96', itms: [itm({ txval: 5000, iamt: 900 })] },
    { typ: 'EXPWP', ntty: 'C', nt_num: 'CN-E', nt_dt: '22-09-2026', val: 1180, pos: '96', itms: [itm({ txval: 1000, iamt: 180 })] },
    { typ: 'EXPWOP', ntty: 'C', nt_num: 'CN-E0', nt_dt: '22-09-2026', val: 7000, pos: '96', itms: [itm({ rt: 0, txval: 7000 })] },
    { typ: 'EXPWOP', ntty: 'D', nt_num: 'DN-E0', nt_dt: '22-09-2026', val: 2000, pos: '96', itms: [itm({ rt: 0, txval: 2000 })] },
  ],
  exp: [
    { exp_typ: 'WPAY', inv: [{ inum: 'E-1', idt: '12-09-2026', val: 585294, itms: [{ rt: 18, txval: 495927.12, iamt: 89266.88, csamt: 100 }] }] },
    { exp_typ: 'WOPAY', inv: [{ inum: 'E-2', idt: '13-09-2026', val: 263681.9, itms: [{ rt: 0, txval: 263681.9, iamt: 0, csamt: 0 }] }] },
  ],
  nil: { inv: [{ sply_ty: 'INTRB2B', nil_amt: 1000, expt_amt: 2000, ngsup_amt: 500 }] },
  at: [{ pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 10000, camt: 900, samt: 900 }, { rt: 12, ad_amt: 5000, camt: 300, samt: 300 }] }],
  txpd: [{ pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 4000, camt: 360, samt: 360 }] }],
};
// Worked by hand, document by document:
// 3.1(a) value: invoices 100000 + 50000 + 20000 + 10000 + 30000 (RCM, value
//   only) + 5000 (UIN) + B2CL 300000 + B2CS 60000; registered notes -10000
//   +2000 -1000 +300 -500 +200 +400 -1000; B2CL notes -30000 +1000; advances
//   +15000 -4000 = 547400. IGST 18000 + 3600 + 1800 + 900 + 54000 + 3600
//   - 1800 + 360 - 180 + 54 - 90 + 36 + 72 - 180 - 5400 + 180 = 74952.
//   CGST = SGST = 4500 + 3600 + 900 + 300 - 360 = 8940.
// 3.1(b) value: SEZ 233000 + 48000; SEZ notes -23300 +1000 -4800 +800;
//   export notes +5000 -1000 -7000 +2000; exports 495927.12 + 263681.90
//   = 1013309.02. IGST 41940 - 4194 + 180 + 900 - 180 + 89266.88
//   = 127912.88. Cess 100.
const EXPECT = {
  a: { txval: 547400, iamt: 74952, camt: 8940, samt: 8940, csamt: 0 },
  b: { txval: 1013309.02, iamt: 127912.88, csamt: 100 },
  c: 3000, e: 500,
  unreg29: { txval: 300000 + 20000 - 30000 + 1000, iamt: 54000 + 3600 - 5400 + 180 },
  uin07: { txval: 4000, iamt: 720 },
};
const sameHeads = (got, want) => Object.keys(want).every((k) => near(got?.[k], want[k]));

// ── 1. The classifier ───────────────────────────────────────────────────────
await run('classifier (src/lib/gstr1/supplyKind.ts)', async () => {
  const g = 'classifier (src/lib/gstr1/supplyKind.ts)';
  check(g, 'the module exists', typeof K.b2bRow === 'function' && typeof K.cdnurRow === 'function' && typeof K.noteSign === 'function', Object.keys(K).join(', ') || 'not found');
  if (typeof K.b2bRow !== 'function') return;
  const rows = ['R', 'DE', 'CBW', 'SEWP', 'SEWOP', '', ' sewp '].map((t) => K.b2bRow({ inv_typ: t }));
  check(g, 'b2b / cdnr: R, DE, CBW, blank to 3.1(a); SEWP, SEWOP (any case) to 3.1(b)', J(rows) === J(['3.1(a)', '3.1(a)', '3.1(a)', '3.1(b)', '3.1(b)', '3.1(a)', '3.1(b)']), J(rows));
  const ur = ['B2CL', 'EXPWP', 'EXPWOP', undefined].map((t) => K.cdnurRow({ typ: t }));
  check(g, 'cdnur: B2CL (or none) to 3.1(a); EXPWP, EXPWOP to 3.1(b)', J(ur) === J(['3.1(a)', '3.1(b)', '3.1(b)', '3.1(a)']), J(ur));
  const signs = [
    K.noteSign({ ntty: 'D' }, 'cdnr'), K.noteSign({ ntty: 'C' }, 'cdnr'), K.noteSign({ typ: 'D' }, 'cdnr'),
    K.noteSign({ ntty: 'D', typ: 'EXPWP' }, 'cdnur'), K.noteSign({ typ: 'D' }, 'cdnur'), K.noteSign({}, 'cdnur'),
  ];
  check(g, 'noteSign: ntty first; typ read only on cdnr (on cdnur it is B2CL / EXPWP / EXPWOP)', J(signs) === J([1, -1, 1, 1, -1, -1]), J(signs));
  check(g, 'UIN format', K.isUin(UIN) && !K.isUin('27BBBBB1111B1Z5') && !K.isUin(''), J([K.isUin(UIN), K.isUin('27BBBBB1111B1Z5')]));
});

// ── 2. The draft: Table 3.1 ─────────────────────────────────────────────────
await run('draft Table 3.1', async () => {
  const g = 'draft Table 3.1';
  const res = draft(MAIN);
  const sd = res.json.sup_details;
  check(g, '3.1(a): R, DE, CBW, B2CL, B2CS, advances and their notes; RCM value only', sameHeads(sd.osup_det, EXPECT.a), J(sd.osup_det));
  check(g, '3.1(b): SEWP, SEWOP, exports (WPAY, WOPAY) and their notes, signed', sameHeads(sd.osup_zero, EXPECT.b), J(sd.osup_zero));
  check(g, '3.1(b) carries the export cess (csamt)', near(sd.osup_zero.csamt, 100), J(sd.osup_zero));
  check(g, '3.1(c) nil + exempt, 3.1(e) non-GST', near(sd.osup_nil_exmp.txval, EXPECT.c) && near(sd.osup_nongst.txval, EXPECT.e), J([sd.osup_nil_exmp, sd.osup_nongst]));
  const s = res.summary;
  check(g, 'summary: outward = 3.1(a), zeroRated = 3.1(b) value, IGST, cess', near(s.outward.txval, EXPECT.a.txval) && near(s.zeroRated.txval, EXPECT.b.txval) && near(s.zeroRated.igst, EXPECT.b.iamt) && near(s.zeroRated.cess, 100), J([s.outward, s.zeroRated]));
  const tl = { igst: EXPECT.a.iamt + EXPECT.b.iamt + 1000, cgst: EXPECT.a.camt + 50, sgst: EXPECT.a.samt + 50 };
  const withRcm = draft(MAIN, { rcm: { taxable: 6000, igst: 1000, cgst: 50, sgst: 50 } }).summary;
  check(g, 'total liability = 3.1(a) + 3.1(b) + 3.1(d) tax', sameHeads(withRcm.totalLiability, tl), J(withRcm.totalLiability));
  // No ITC Summary: the only ITC is 4A(3), the same RCM, so what is left to pay is 3.1(a) + 3.1(b).
  const net = { igst: EXPECT.a.iamt + EXPECT.b.iamt, cgst: EXPECT.a.camt, sgst: EXPECT.a.samt };
  check(g, 'indicative net payable is built on it (less 4A(3), the RCM ITC)', sameHeads(withRcm.indicativeNetPayable, net), J(withRcm.indicativeNetPayable));

  // ORVIX Sep-26 in small: a month whose only zero rated supply is an SEZ invoice without payment.
  const orvix = draft({ b2b: [{ ctin: '24CCCCC2222C1Z5', inv: [inv('S-1', { inv_typ: 'SEWOP', pos: '24' }, [{ rt: 0, txval: 48000 }])] }, { ctin: '27BBBBB1111B1Z5', inv: [inv('R-1', {}, [{ txval: 100000, iamt: 18000 }])] }] });
  check(g, 'SEWOP 48,000 sits in 3.1(b), not 3.1(a)', near(orvix.json.sup_details.osup_zero.txval, 48000) && near(orvix.json.sup_details.osup_det.txval, 100000), J(orvix.json.sup_details));

  // ACCURATE Aug-26 in small: SEZ with payment moves its IGST to 3.1(b); total liability unchanged.
  const sewp = draft({ b2b: [{ ctin: '24CCCCC2222C1Z5', inv: [inv('S-2', { inv_typ: 'SEWP', pos: '24' }, [{ txval: 233000, iamt: 41940 }])] }] });
  check(g, 'SEWP 2,33,000 / IGST 41,940 in 3.1(b), and still in total liability', near(sewp.json.sup_details.osup_zero.iamt, 41940) && near(sewp.json.sup_details.osup_det.iamt, 0) && near(sewp.summary.totalLiability.igst, 41940), J([sewp.json.sup_details, sewp.summary.totalLiability]));

  // A filed month before Aug-2026 keeps the RCM tax (the existing position).
  const rcmOld = G.buildGstr3bJson({ gstin: '24AAAAA0000A1Z5', periodMonth: '07/2026', gstr1Raw: { b2b: MAIN.b2b.slice(0, 1) }, itc: null, rcm: ZERO_RCM, alreadyFiled: true });
  check(g, 'reverse charge: a month filed before Aug-2026 keeps the old figure (RCM tax in)', near(rcmOld.json.sup_details.osup_det.iamt, 18000 + 3600 + 1800 + 1500), J(rcmOld.json.sup_details.osup_det));
  check(g, 'no zero rated document carries CGST / SGST here: no such flag', !res.flags.some((f) => /zero rated document/.test(f)), J(res.flags));
  const bad = draft({ b2b: [{ ctin: '24CCCCC2222C1Z5', inv: [inv('S-3', { inv_typ: 'SEWP', pos: '24' }, [{ txval: 1000, camt: 90, samt: 90 }])] }] });
  check(g, 'an SEZ invoice wrongly carrying CGST / SGST is flagged', bad.flags.some((f) => /zero rated document/.test(f) && /180\.00/.test(f)), J(bad.flags));
});

// ── 3. The draft: Table 3.2 ─────────────────────────────────────────────────
await run('draft Table 3.2', async () => {
  const g = 'draft Table 3.2';
  const res = draft(MAIN);
  const inter = res.json.inter_sup;
  const unreg29 = inter.unreg_details.find((r) => r.pos === '29');
  check(g, 'unregistered: B2CL + inter-state B2CS, B2CL notes netted, by place of supply', inter.unreg_details.length === 1 && sameHeads(unreg29, EXPECT.unreg29), J(inter.unreg_details));
  const uin07 = (inter.uin_details || []).find((r) => r.pos === '07');
  check(g, 'UIN holders: the UN body invoice less its credit note', (inter.uin_details || []).length === 1 && sameHeads(uin07, EXPECT.uin07), J(inter.uin_details));
  check(g, 'no zero rated row (SEZ, export) in any 3.2 row', ![...inter.unreg_details, ...(inter.uin_details || [])].some((r) => r.pos === '24' || r.pos === '96'), J(inter));
  check(g, 'composition rows: empty and not flagged (the portal fills them from GSTR-1)', (inter.comp_details || []).length === 0 && !res.flags.some((f) => /composition/.test(f)), J(res.flags));
  const intra = draft({ b2b: [{ ctin: '24DDDDD3333D1Z5', inv: [inv('I-1', { pos: '24' }, [{ txval: 1000, camt: 90, samt: 90 }])] }] });
  check(g, 'no composition flag for an intra-state month', !intra.flags.some((f) => /composition/.test(f)), J(intra.flags));
});

// ── 4. Amendments ───────────────────────────────────────────────────────────
await run('amendments', async () => {
  const g = 'amendments';
  const AMD = {
    b2b: [{ ctin: '27BBBBB1111B1Z5', inv: [inv('R-1', {}, [{ txval: 100000, iamt: 18000 }])] }],
    // ATC LOGISTICS Jul-26 in small: an RCM invoice restated.
    b2ba: [{ ctin: '27BBBBB1111B1Z5', inv: [{ oinum: '0263/26-27', oidt: '05-07-2026', ...inv('0263/26-27', { inv_typ: 'R', rchrg: 'Y' }, [{ rt: 5, txval: 136260, iamt: 6813 }]) }] }],
    expa: [{ exp_typ: 'WOPAY', inv: [{ oinum: 'E-0', oidt: '01-08-2026', inum: 'E-0', idt: '01-08-2026', val: 1000, itms: [{ rt: 0, txval: 1000, iamt: 0 }] }] }],
    cdnra: [{ ctin: '24CCCCC2222C1Z5', nt: [{ ont_num: 'CN-0', ont_dt: '01-08-2026', ...nt('CN-0', { ntty: 'C', inv_typ: 'SEWP', pos: '24' }, [{ txval: 2000, iamt: 360 }]) }] }],
    b2cla: [{ pos: '29', inv: [{ oinum: 'L-0', oidt: '01-08-2026', inum: 'L-0', idt: '01-08-2026', val: 236000, itms: [itm({ txval: 200000, iamt: 36000 })] }] }],
    cdnura: [{ typ: 'EXPWP', ntty: 'C', ont_num: 'CN-E9', ont_dt: '01-08-2026', nt_num: 'CN-E9', nt_dt: '01-08-2026', val: 118, pos: '96', itms: [itm({ txval: 100, iamt: 18 })] }],
    b2csa: [
      // A restated month: counted at its difference (earlier month not in the app: nil).
      { omon: '082026', sply_ty: 'INTRA', typ: 'OE', pos: '24', itms: [{ rt: 18, txval: 9000, camt: 810, samt: 810 }] },
      // The Builder's re-rating: old rate reversed, the same value at the new rate. Folded.
      { omon: '072026', sply_ty: 'INTRA', typ: 'OE', pos: '24', itms: [{ rt: 1, txval: -50000, camt: -250, samt: -250 }, { rt: 5, txval: 50000, camt: 1250, samt: 1250 }] },
    ],
    ata: [{ omon: '082026', pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 7000, camt: 630, samt: 630 }] }],
  };
  const res = draft(AMD);
  const sd = res.json.sup_details;
  check(g, 'no 9A / 9C amendment folded into 3.1(a); Table 10 in: the re-rating difference (+1,000) and the restatement against a nil month (+9,000, 810)',
    sameHeads(sd.osup_det, { txval: 109000, iamt: 18000, camt: 1810, samt: 1810 }), J(sd.osup_det));
  check(g, 'nothing folded into 3.1(b)', sameHeads(sd.osup_zero, { txval: 0, iamt: 0 }), J(sd.osup_zero));
  const f = res.flags.find((x) => /amendments present/.test(x)) || '';
  check(g, 'one flag names b2ba, b2cla, expa, cdnra, cdnura, and not b2csa', ['b2ba', 'b2cla', 'expa', 'cdnra', 'cdnura'].every((t) => f.includes(`(${t})`)) && !f.includes('(b2csa)'), f || J(res.flags));
  const f10 = res.flags.find((x) => /Table 10 amendment counted/.test(x)) || '';
  check(g, 'a Table 10 flag gives the difference and says the earlier month is not in the app',
    /08\/2026 POS 24 at 18%: revised value ₹9000\.00, tax ₹1620\.00; 08\/2026's GSTR-1 is not in the app/.test(f10) && /difference value ₹9000\.00, tax ₹1620\.00/.test(f10), f10 || J(res.flags));
  check(g, '… each against its own row: b2ba value only (RCM) in 3.1(a); expa, cdnra (SEZ), cdnura (export) in 3.1(b)',
    /\(b2ba\): 1 document\(s\), 3\.1\(a\) value ₹136260\.00, tax ₹0\.00/.test(f) && /\(expa\): 1 document\(s\), 3\.1\(b\) value ₹1000\.00/.test(f)
    && /\(cdnra\): 1 document\(s\), 3\.1\(b\) value ₹-2000\.00/.test(f) && /\(cdnura\): 1 document\(s\), 3\.1\(b\) value ₹-100\.00/.test(f)
    , f);
  check(g, 'the Table 11(2) flag stays as it was', res.flags.some((x) => /Table 11\(2\) advance amendment present/.test(x)), J(res.flags));
  const out = typeof O.computeGstr1OutputTax === 'function' ? O.computeGstr1OutputTax(AMD, '09/2026') : null;
  check(g, 'output tax: 9A / 9C add nothing, Table 10 adds its differences', out && near(out.igst, 18000) && near(out.cgst, 1810) && near(out.sgst, 1810), J(out));

  // The amended month known: only the difference counts; a later restatement is the earlier figure.
  const T10 = { fp: '092026', b2csa: [{ omon: '032026', sply_ty: 'INTER', typ: 'OE', pos: '27', itms: [{ rt: 18, txval: 10000, iamt: 1800 }] },
    { omon: '032026', sply_ty: 'INTRA', typ: 'OE', pos: '24', itms: [{ rt: 18, txval: 34835.59, camt: 3135.2, samt: 3135.2 }] }] };
  const restated = (a) => !G.isB2csaDifference(a);
  const known = B.buildB2csaBaselines(T10, {
    '032026': { b2cs: [{ pos: '27', rt: 18, sply_ty: 'INTER', txval: 6000, iamt: 1080 }, { pos: '24', rt: 5, txval: 500, camt: 12.5, samt: 12.5 }] },
    '062026': { b2csa: [{ omon: '032026', pos: '27', sply_ty: 'INTER', itms: [{ rt: 18, txval: 8000, iamt: 1440 }] }] },
    '102026': { b2csa: [{ omon: '032026', pos: '27', sply_ty: 'INTER', itms: [{ rt: 18, txval: 1, iamt: 1 }] }] },
  }, restated);
  const k = draft(T10, { b2csaBaselines: known });
  check(g, 'Table 10, month known: POS 27 counts revised 10,000 less the Jun-26 restatement 8,000 (not Mar-26 6,000, not a later month); POS 24 at 18% had nothing, so in full',
    sameHeads(k.json.sup_details.osup_det, { txval: 2000 + 34835.59, iamt: 360, camt: 3135.2, samt: 3135.2 }), J(k.json.sup_details.osup_det));
  check(g, '… an inter-state Table 10 difference reaches 3.2 unregistered (POS 27, 2,000 / 360)',
    k.json.inter_sup.unreg_details.length === 1 && k.json.inter_sup.unreg_details[0].pos === '27' && sameHeads(k.json.inter_sup.unreg_details[0], { txval: 2000, iamt: 360 }), J(k.json.inter_sup.unreg_details));
  check(g, '… the flag names the source of the earlier figure', (k.flags.find((x) => /Table 10 amendment counted/.test(x)) || '').includes('Table 10 in GSTR-1 06/2026'), J(k.flags));
  const sum = SUM.buildGstr1Summary(T10, { b2csaBaselines: known });
  check(g, 'GSTR-1 summary total = the draft 3.1(a) with Table 10 at its difference', near(sum.totals.value, 36835.59) && near(sum.totals.igst, 360) && near(sum.totals.cgst, 3135.2) && sum.b2csaDifferences.length === 2 && !sum.amendmentsLeftOut.length, J([sum.totals, sum.b2csaDifferences.length]));
  const filedSum = SUM.buildGstr1Summary(T10, { filed: true, b2csaBaselines: known });
  check(g, '… a filed GSTR-1 keeps its old total, without Table 10', near(filedSum.totals.value, 0) && near(filedSum.totals.cgst, 0) && !filedSum.b2csaDifferences.length, J(filedSum.totals));
});

// ── 5. Output tax: computeGstr1OutputTax, credit closing, GST receivable reco ──
await run('output tax', async () => {
  const g = 'output tax';
  const want = { igst: EXPECT.a.iamt + EXPECT.b.iamt, cgst: EXPECT.a.camt, sgst: EXPECT.a.samt };
  const out = O.computeGstr1OutputTax(MAIN, '09/2026');
  check(g, 'computeGstr1OutputTax = 3.1(a) + 3.1(b) tax of the draft', sameHeads(out, want), J(out));
  check(g, '… equal to the draft builder\'s own gstr1OutputTax', typeof G.gstr1OutputTax === 'function' && sameHeads(G.gstr1OutputTax(MAIN, '09/2026', true), want), typeof G.gstr1OutputTax);
  const exportOnly = O.computeGstr1OutputTax({ exp: MAIN.exp }, '07/2026');
  check(g, 'CROWNGLOBE Jul-26 in small: an export with payment counts its IGST (89,266.88)', near(exportOnly.igst, 89266.88), J(exportOnly));
  const adv = O.computeGstr1OutputTax({ at: MAIN.at, txpd: [{ pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 1000, camt: 90, samt: 90 }, { rt: 12, ad_amt: 1000, camt: 60, samt: 60 }] }] }, '09/2026');
  check(g, 'advances: every rate line (11A 900 + 300, 11B 90 + 60)', near(adv.cgst, 1200 - 150) && near(adv.sgst, 1200 - 150), J(adv));
  const cl = A.computeCreditClosing(undefined, undefined, MAIN, '09/2026');
  check(g, 'credit closing: nothing available, so payable = output tax', near(cl.payableIgst, want.igst) && near(cl.payableCgst, want.cgst) && near(cl.payableSgst, want.sgst), J(cl));

  // GST receivable reco for Oct-26: ITC utilised = Sep-26's 3.1(a) + 3.1(b) tax.
  globalThis.__db = {
    gst_receivable_reco: [{ client_id: 'c-1', period_month: '10/2026', opening_igst: 500000, opening_cgst: 50000, opening_sgst: 50000, books_closing_igst: 0, books_closing_cgst: 50000, books_closing_sgst: 50000, utilized_igst: null, utilized_cgst: null, utilized_sgst: null, drc_igst: 0, drc_cgst: 0, drc_sgst: 0 }],
    gstr1_data: [{ client_id: 'c-1', period_month: 'Sep-26', raw_json: MAIN }],
  };
  // IGST credit goes first (Rule 88A): IGST 2,02,864.88, then CGST and SGST 8,940 each from IGST.
  const igstClosing = 500000 - want.igst - want.cgst - want.sgst;
  const diff = await R.computeGstReceivableRecoDiff('c-1', '10/2026');
  check(g, `GST receivable reco: portal closing IGST ${igstClosing.toFixed(2)} (books 0 → difference)`, diff && near(diff.igst, igstClosing, 0.01) && near(diff.cgst, 0) && near(diff.sgst, 0), J(diff));
});

// ── 6. The advance set-off check ────────────────────────────────────────────
await run('advance set-off check', async () => {
  const g = 'advance set-off check';
  // An advance at 18%, Gujarat, received in Aug-26 and still open; in Sep-26
  // the only invoice at that place of supply and rate is an SEZ supply.
  const aug = { at: [{ pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 100000, camt: 9000, samt: 9000 }] }] };
  const sep = { b2b: [{ ctin: '24CCCCC2222C1Z5', inv: [inv('S-1', { inv_typ: 'SEWP', pos: '24' }, [{ txval: 100000, iamt: 18000 }])] }] };
  globalThis.__db = { gstr1_data: [{ client_id: 'c-2', period_month: 'Aug-26', raw_json: aug }] };
  const res = await S.runAdvanceSetoffCheck({ clientId: 'c-2', gstin: '24AAAAA0000A1Z5', periodMonth: '09/2026', draftJson: sep });
  const codes = res.findings.map((x) => x.code);
  check(g, 'an SEZ invoice does not absorb an open advance: carried forward, not a hard block', !codes.includes('NO_SETOFF_REPORTED') && codes.includes('OPEN_NO_INVOICE'), J(codes));
});

// ── 7. As-filed reports ─────────────────────────────────────────────────────
await run('as-filed reports', async () => {
  const g = 'as-filed reports';
  const CLIENT = { id: 'c-sez', name: 'FICTIONAL SEZ SUPPLIER PVT LTD', gstin: '24AAAAA0000A1Z5', target_date_group1: 20, target_date_group2: 22 };
  // Sep-26 as filed. GSTR-1: 4A, 4B (RCM), 6C, SEZ with and without payment,
  // a debit note against an SEZ supply, a debit note against an export, an
  // export with payment. GSTR-3B: 3.1(a) 4A + 4B value + 6C; 3.1(b) the rest.
  const g1 = gstr1Summary({
    gstin: CLIENT.gstin, period: '09/2026',
    figures: {
      B2B: { rec: 6, tax: 831000, val: 950040, igst: 119040, cgst: 9000, sgst: 9000 },
      B2B_4A: { rec: 2, tax: 500000, val: 590000, igst: 72000, cgst: 9000, sgst: 9000 },
      B2B_4B: { rec: 1, tax: 30000, val: 31500, igst: 1500 },
      B2B_6C: { rec: 1, tax: 20000, val: 23600, igst: 3600 },
      B2B_SEZWP: { rec: 1, tax: 233000, val: 274940, igst: 41940 },
      B2B_SEZWOP: { rec: 1, tax: 48000, val: 48000 },
      CDNR: { rec: 1, tax: 1000, val: 1180, igst: 180, sub: 'CDNR_SEZWP' },
      CDNUR: { rec: 1, tax: 5000, val: 5900, igst: 900, sub: 'EXPWP' },
      EXP: { rec: 1, tax: 495927.12, val: 585194, igst: 89266.88, sub: 'EXPWP' },
      TTL_LIAB: { rec: 9, tax: 1302927.12, val: 1460000, igst: 207886.88, cgst: 9000, sgst: 9000 },
    },
  });
  const g3 = gstr3bSummary({
    a: { tx: 550000, igst: 75600, cgst: 9000, sgst: 9000 },
    b: { tx: 782927.12, igst: 132286.88 },
    d: { tx: 27000, cgst: 2430, sgst: 2430 },
  });
  // Aug-26: a month whose only tax is the IGST on an export with payment.
  const g3aug = gstr3bSummary({ b: { tx: 495927.12, igst: 89266.88 } });
  globalThis.__db = {
    clients: [CLIENT],
    gst_filed_returns: [
      { client_id: CLIENT.id, period_month: '09/2026', return_type: 'GSTR1', summary: g1, arn: 'AA2409260000001', filed_date: '2026-10-11', status: 'Filed' },
      { client_id: CLIENT.id, period_month: '09/2026', return_type: 'GSTR3B', summary: g3, arn: 'AA2409260000002', filed_date: '2026-10-20', status: 'Filed' },
      { client_id: CLIENT.id, period_month: '08/2026', return_type: 'GSTR3B', summary: g3aug, arn: 'AA2408260000002', filed_date: '2026-09-25', status: 'Filed' },
    ],
    filing_status: [{ client_id: CLIENT.id, period_month: '08/2026', return_type: 'GSTR-3B', status: 'Filed', target_date: 20, filed_date: '2026-09-25' }],
    builder_rcm_postings: [],
  };
  const IGST_ALL = 75600 + 132286.88; // 3.1(a) + 3.1(b), no IGST in 3.1(d)
  const col = (t, h) => t.headers.indexOf(h);
  const rowOf = (t, test) => t.rows.find((r) => r.some((c) => typeof c === 'string' && test(c)));
  const cell = (t, test, h) => { const r = rowOf(t, test); return r ? r[col(t, h)] : undefined; };
  const has = (s) => (c) => c.includes(s);
  const is = (s) => (c) => c === s;
  const show = (t) => J({ headers: t.headers, rows: t.rows });

  const liab = await G3.buildGstr3bLiabilityReport(CLIENT.id, '09/2026');
  check(g, 'GSTR-3B Liability: total output tax liability = 3.1(a) + 3.1(b) + 3.1(d)', near(cell(liab, has('Total Output Tax Liability'), 'IGST'), IGST_ALL) && near(cell(liab, has('Total Output Tax Liability'), 'CGST'), 11430) && /3\.1\(b\)/.test(String(rowOf(liab, has('Total Output Tax Liability'))?.[1])), show(liab));
  check(g, '… its 3.1(b) row reads "exports and SEZ"', /exports and SEZ/.test(String(rowOf(liab, is('3.1(b)'))?.[1])), show(liab));

  const cmp = await G3.buildGstr3bVsGstr1ComparisonReport(CLIENT.id, '09/2026');
  const mapsTo = (code) => cell(cmp, is(code), 'Maps to GSTR-3B Table');
  check(g, 'GSTR-3B vs GSTR-1 comparison: SEZ parts map to 3.1(b), 4A and 6C to 3.1(a)',
    /^3\.1\(b\)/.test(String(mapsTo('B2B_SEZWP'))) && /^3\.1\(b\)/.test(String(mapsTo('B2B_SEZWOP'))) && /^3\.1\(a\)/.test(String(mapsTo('B2B_4A'))) && /^3\.1\(a\)/.test(String(mapsTo('B2B_6C'))), show(cmp));
  check(g, '… the SEZ and export notes map to 3.1(b), with their figures', /^3\.1\(b\)/.test(String(mapsTo('CDNR_SEZWP'))) && near(cell(cmp, is('CDNR_SEZWP'), 'IGST'), 180) && /^3\.1\(b\)/.test(String(mapsTo('CDNUR_EXPWP'))) && near(cell(cmp, is('CDNUR_EXPWP'), 'Taxable Value'), 5000), show(cmp));
  check(g, '… nil parts are not listed (CDNR_4A, CDNUR_B2CL)', !rowOf(cmp, is('CDNR_4A')) && !rowOf(cmp, is('CDNUR_B2CL')), show(cmp));

  const off = await G3.buildGstr3bOffsetSummaryReport(CLIENT.id, '09/2026');
  check(g, 'Offset Summary: IGST liability includes 3.1(b)', near(cell(off, has('IGST Liability'), 'Amount'), IGST_ALL), show(off));

  const ann = await G3.buildGstr3bAnnualSummaryReport(CLIENT.id, '09/2026');
  const totalRow = ann.rows[ann.rows.length - 1];
  check(g, 'Annual Summary: outward liability = 3.1(a) + 3.1(b) tax (Aug + Sep)', near(totalRow[1], (75600 + 18000 + 132286.88) + 89266.88), J(totalRow));

  const dvp = await TL.buildLiabilityDeclaredVsPaidReport(CLIENT.id, '09/2026');
  check(g, 'Liability Declared vs Paid: declared IGST includes 3.1(b)', near(cell(dvp, is('IGST'), 'Amount'), IGST_ALL), show(dvp));

  const sum = await TL.buildTaxLiabilityAndItcSummaryReport(CLIENT.id, '09/2026');
  check(g, 'Tax Liability and ITC Summary: a 3.1(b) row, and the total includes it', near(cell(sum, has('(3.1b)'), 'IGST'), 132286.88) && near(cell(sum, is('Total Output Tax Liability'), 'IGST'), IGST_ALL), show(sum));

  const excl = await TL.buildTaxLiabilityExclExportRcmReport(CLIENT.id, '09/2026');
  check(g, 'Tax Liability other than export / RCM: B2B less 4B and SEZ (= 4A + 6C)', near(cell(excl, is('B2B Invoices'), 'Taxable Value'), 520000) && near(cell(excl, is('B2B Invoices'), 'IGST'), 75600), show(excl));
  check(g, '… registered notes less SEZ notes, unregistered notes less export notes: nil', near(cell(excl, is('Credit/Debit Notes (Registered)'), 'Taxable Value'), 0) && near(cell(excl, is('Credit/Debit Notes (Unregistered)'), 'Taxable Value'), 0), show(excl));

  const zr = await TL.buildTaxLiabilityExportSezReport(CLIENT.id, '09/2026');
  check(g, 'Export and SEZ: 6A, 6B (with and without payment) and the 9B notes; TOTAL = filed 3.1(b)',
    near(cell(zr, has('SEZ with payment of tax'), 'IGST'), 41940) && near(cell(zr, has('SEZ without payment of tax'), 'Taxable Value'), 48000)
    && near(cell(zr, is('TOTAL'), 'Taxable Value'), 782927.12) && near(cell(zr, is('TOTAL'), 'IGST'), 132286.88), show(zr));
  check(g, '… every row as wide as the headers', zr.rows.every((r) => r.length === zr.headers.length), show(zr));

  const pan1 = await PAN.buildPanOutputLiabilityReport(CLIENT.id, '09/2026');
  const panRow = pan1.rows.find((r) => r[0] === CLIENT.name);
  check(g, 'PAN output liability: GSTR-3B 3.1(a) + 3.1(b) equals GSTR-1 TTL_LIAB, no variance', panRow && near(panRow[3], IGST_ALL + 18000) && near(panRow[4], 0), J(panRow));
  const pan4 = await PAN.buildPanNetOutputLiabilityReport(CLIENT.id, '09/2026');
  const pan4Row = pan4.rows.find((r) => r[0] === CLIENT.name);
  check(g, 'PAN net output liability: total liability = 3.1(a) + 3.1(b) + 3.1(d)', pan4Row && near(pan4Row[2], IGST_ALL + 18000 + 4860), J(pan4Row));

  const stmt = await X.buildCreditAndLiabilityStatementReport(CLIENT.id, '09/2026');
  const stmtTotal = stmt.rows[stmt.rows.length - 1];
  check(g, 'Credit and Liability Statement: total liability includes 3.1(b)', near(stmtTotal[1], (IGST_ALL + 18000 + 4860) + 89266.88), J(stmtTotal));

  const intr = await INT.buildInterestLateFeeCalculatorReport(CLIENT.id, '08/2026');
  const lf = intr.rows.find((r) => r[0] === 'Late Fee (s.47)');
  const it = intr.rows.find((r, i) => intr.rows[i - 1]?.[0] === 'Interest (Rule 88B, net of ITC set-off)');
  check(g, 'Interest: a month with only export IGST is not a nil return, and its cash part bears interest', lf && lf[1] !== 'NIL return' && it && it[1] > 0, J([lf, it]));
});

// ── 8. GSTR-3B version diff ─────────────────────────────────────────────────
await run('GSTR-3B version diff', async () => {
  const g = 'GSTR-3B version diff';
  const base = { sup_details: {}, inter_sup: { unreg_details: [], comp_details: [], uin_details: [{ pos: '07', txval: 4000, iamt: 720 }] } };
  const next = { sup_details: {}, inter_sup: { unreg_details: [], comp_details: [{ pos: '27', txval: 1000, iamt: 180 }], uin_details: [{ pos: '07', txval: 5000, iamt: 900 }] } };
  const rows = D.diffGstr3b(base, next);
  check(g, 'a change in Table 3.2 UIN and composition rows is shown', rows.some((r) => /UIN/.test(r.section) && r.kind === 'changed') && rows.some((r) => /composition/.test(r.section) && r.kind === 'added'), J(rows));
});

// ── 9. The push check lets a minus 3.1(b) through ───────────────────────────
// The portal files a minus 3.1(b) itself when SEZ / export credit notes
// outweigh the month's zero-rated supplies; every other row stays refused.
await run('push check', async () => {
  const g = 'push check';
  const page = fs.readFileSync(path.join(root, 'src/pages/Gstr3bPage.tsx'), 'utf8');
  check(g, 'draftProblems exempts osup_zero (3.1(b)) from the minus check, and only it',
    page.includes("path[1] !== 'itc_net' && path[1] !== 'osup_zero'") && (page.match(/osup_zero'/g) || []).length >= 1);
});

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info.slice(0, 500)}]`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
