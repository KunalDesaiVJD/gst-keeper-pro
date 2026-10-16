#!/usr/bin/env node
// Checks that every Reports Hub report printing a GSTR-1 "Taxable Value" reads
// the portal's ttl_tax, not its ttl_val. GSTN's RETSUM names them the other way
// round from what the words suggest: ttl_tax is the TAXABLE value and ttl_val
// the INVOICE value (taxable value plus tax). The reports used to print
// ttl_val, so GSTR-3B vs GSTR-1 showed a taxable value "variance" equal to the
// tax on every month the two returns agreed.
//
//   node scripts/verify-gstr1-taxable.mjs
//
// Builds the real report builders (gstr3bReports, taxLiabilityReports,
// filedReturnReports) with a stand-in Supabase client serving a fictional
// client's GSTR-1 and GSTR-3B pulls, shaped exactly like a stored pull
// (scripts/fixtures/gstr1SecSumFixture.mjs), and checks:
//   - the taxable value of each report is ttl_tax: GSTR-3B vs GSTR-1 (tax and
//     comparison), tax liability other than export, export and SEZ, GSTR-1 as
//     filed; its variance is nil when both returns agree;
//   - the invoice value appears only as its own "Invoice Value" column;
//   - NIL's value is its nil rated, exempt and non-GST amounts; the documents
//     issued are counts, never under a value heading;
//   - an older pull without ttl_tax falls back to the invoice value less the
//     tax (an HSN row, whose ttl_val is nil, stays nil, not negative);
//   - the views draw the new tables: the variance view finds no mismatch, the
//     filed GSTR-1 view keeps its "Total liability" tile (the tax heads).
//
// GSTK_ROOT=<another checkout> runs it against that tree (how it was seen to
// fail before the fix). Nothing is read from or written to Supabase. Prints
// pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gstr1Summary, gstr3bSummary, withoutTtlTax } from './fixtures/gstr1SecSumFixture.mjs';
import { loadViews } from './fixtures/reportViewHarness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

// ── Fixture: "Fictional Exports Pvt Ltd" ──────────────────────────────────
const CLIENT = { id: 'c-fict', name: 'FICTIONAL EXPORTS PVT LTD', gstin: '24AAAAA0000A1Z5' };
const GSTIN = CLIENT.gstin;
// Jun 2026, an export month shaped like the stored one: one export with
// payment, its HSN row (ttl_val 0) and TTL_LIAB; invoice value in whole rupees
// (412,345.67 + 74,222.22 = 486,567.89, stated as 486,568).
const EXP_TAX = 412345.67, EXP_IGST = 74222.22, EXP_VAL = 486568;
const exportMonth = (period) => gstr1Summary({
  gstin: GSTIN, period,
  figures: {
    EXP: { rec: 1, tax: EXP_TAX, val: EXP_VAL, igst: EXP_IGST, sub: 'EXPWP' },
    HSN: { rec: 1, tax: EXP_TAX, igst: EXP_IGST },
    HSN_B2B: { rec: 1, tax: EXP_TAX, igst: EXP_IGST },
    TTL_LIAB: { rec: 2, tax: EXP_TAX, val: EXP_VAL, igst: EXP_IGST },
    DOC_ISSUE: { rec: 1, issued: 1, cancelled: 0 },
  },
});
const exportMonth3b = gstr3bSummary({ b: { tx: EXP_TAX, igst: EXP_IGST }, d: { tx: 27000, cgst: 2430, sgst: 2430 } });
// Jul 2026, a domestic month: B2B and B2CS with CGST / SGST, nil rated,
// exempt and non-GST supplies, and documents issued with two cancelled.
const B2B = { rec: 3, tax: 250000, val: 295000, cgst: 22500, sgst: 22500 };
const B2CS = { rec: 1, tax: 10000.5, val: 11801, cgst: 900.05, sgst: 900.05 };
const NIL = { rec: 2, nil: 1500, expt: 2500, ngsup: 1000 };
const domestic = gstr1Summary({
  gstin: GSTIN, period: '07/2026',
  figures: {
    B2B, B2CS, NIL,
    HSN: { rec: 2, tax: 260000.5, cgst: 23400.05, sgst: 23400.05 },
    HSN_B2C: { rec: 1, tax: 10000.5, cgst: 900.05, sgst: 900.05 },
    TTL_LIAB: { rec: 4, tax: 260000.5, val: 306801, cgst: 23400.05, sgst: 23400.05 },
    DOC_ISSUE: { rec: 2, issued: 42, cancelled: 2 },
  },
});
const domestic3b = gstr3bSummary({ a: { tx: 260000.5, cgst: 23400.05, sgst: 23400.05 }, c: { tx: 4000 }, e: { tx: 1000 } });
// Aug 2026: the export month again, as an older pull without ttl_tax.
const older = withoutTtlTax(exportMonth('08/2026'));

const FILED = [
  ['06/2026', 'GSTR1', exportMonth('06/2026')], ['06/2026', 'GSTR3B', exportMonth3b],
  ['07/2026', 'GSTR1', domestic], ['07/2026', 'GSTR3B', domestic3b],
  ['08/2026', 'GSTR1', older], ['08/2026', 'GSTR3B', exportMonth3b],
].map(([period_month, return_type, summary], i) => ({
  client_id: CLIENT.id, period_month, return_type, summary,
  arn: `AA24${String(i + 1).padStart(10, '0')}`, filed_date: '2026-07-11', status: 'Filed',
}));

// A stand-in client: from(table) … eq(k, v) … maybeSingle() answers the first
// fixture row matching every eq; awaited directly, every matching row.
const stub = `
  const DB = globalThis.__gstkDb;
  const chain = (table) => {
    const where = [];
    const rows = () => (DB[table] || []).filter((r) => where.every(([k, v]) => r[k] === v));
    const q = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'eq') return (col, v) => { where.push([col, v]); return q; };
        if (k === 'maybeSingle' || k === 'single') return () => Promise.resolve({ data: rows()[0] ?? null, error: null });
        if (k === 'then') return (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
        return () => q;
      },
    });
    return q;
  };
  export const supabase = { from: (table) => chain(table), rpc: () => chain('rpc') };`;
globalThis.__gstkDb = { clients: [CLIENT], gst_filed_returns: FILED, filing_status: [], builder_rcm_postings: [] };

const out = await build({
  stdin: {
    contents: `
      export * as G3 from './src/utils/gstr3bReports';
      export * as TL from './src/utils/taxLiabilityReports';
      export * as FR from './src/utils/filedReturnReports';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
  define: { 'import.meta.env': '{}' },
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
      b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
    },
  }],
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const { G3, TL, FR } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const near = (a, b, tol = 0.005) => typeof a === 'number' && Math.abs(a - b) <= tol;
/** Builds a report, never throwing: a failed build is a failed check. */
const built = async (fn, ...args) => { try { return await fn(...args); } catch (e) { return { error: String(e?.message ?? e), headers: [], rows: [] }; } };
const col = (t, h) => t.headers.indexOf(h);
const rowOf = (t, test) => t.rows.find((r) => r.some((c) => typeof c === 'string' && test(c)));
const cell = (t, test, h) => { const r = rowOf(t, test); return r ? r[col(t, h)] : undefined; };
const is = (s) => (c) => c === s;
const show = (t) => JSON.stringify(t.error ?? { headers: t.headers, rows: t.rows });

// ── 1. The helpers ──────────────────────────────────────────────────────────
{
  const g = 'gstr1Taxable / gstr1InvoiceValue';
  const tx = FR.gstr1Taxable, iv = FR.gstr1InvoiceValue;
  check(g, 'the helpers exist', typeof tx === 'function' && typeof iv === 'function', Object.keys(FR).join(', '));
  if (typeof tx === 'function' && typeof iv === 'function') {
    const ttl = exportMonth('06/2026').sec_sum.find((s) => s.sec_nm === 'TTL_LIAB');
    check(g, 'TTL_LIAB: taxable = ttl_tax, invoice = ttl_val', tx(ttl) === EXP_TAX && iv(ttl) === EXP_VAL, JSON.stringify([tx(ttl), iv(ttl)]));
    const hsn = exportMonth('06/2026').sec_sum.find((s) => s.sec_nm === 'HSN');
    check(g, 'HSN (ttl_val 0): taxable = ttl_tax, no invoice value', tx(hsn) === EXP_TAX && iv(hsn) === null, JSON.stringify([tx(hsn), iv(hsn)]));
    const nil = domestic.sec_sum.find((s) => s.sec_nm === 'NIL');
    check(g, 'NIL: nil rated + exempt + non-GST, no tax on them', tx(nil) === 5000 && iv(nil) === 5000, JSON.stringify([tx(nil), iv(nil)]));
    const doc = domestic.sec_sum.find((s) => s.sec_nm === 'DOC_ISSUE');
    check(g, 'DOC_ISSUE: counts are neither a taxable nor an invoice value', tx(doc) === 0 && iv(doc) === null, JSON.stringify([tx(doc), iv(doc)]));
    const oldTtl = older.sec_sum.find((s) => s.sec_nm === 'TTL_LIAB');
    check(g, 'older pull without ttl_tax: invoice value less the tax (486,568 − 74,222.22)', tx(oldTtl) === 412345.78, tx(oldTtl));
    const oldHsn = older.sec_sum.find((s) => s.sec_nm === 'HSN');
    check(g, '… an HSN row there (ttl_val 0) stays nil, never negative', tx(oldHsn) === 0, tx(oldHsn));
    check(g, 'figures stored as text read the same; a missing section is nil', tx({ ttl_tax: '1000.50', ttl_val: '1181' }) === 1000.5 && iv({ ttl_tax: '1000.50', ttl_val: '1181' }) === 1181 && tx(undefined) === 0 && iv(undefined) === null, JSON.stringify([tx({ ttl_tax: '1000.50' }), tx(undefined), iv(undefined)]));
  }
}

// ── 2. GSTR-3B vs GSTR-1 Tax Report ─────────────────────────────────────────
for (const [period, taxable, label] of [['06/2026', EXP_TAX, 'export month'], ['07/2026', 260000.5, 'domestic month']]) {
  const g = `gstr3b-vs-gstr1-tax, ${label} (${period})`;
  const t = await built(G3.buildGstr3bVsGstr1TaxReport, CLIENT.id, period);
  const tv = rowOf(t, is('Taxable Value'));
  check(g, 'GSTR-1 taxable value is TTL_LIAB ttl_tax', !!tv && tv[1] === taxable, show(t));
  check(g, '… the Taxable Value variance is nil (both returns agree)', !!tv && near(tv[3], 0), JSON.stringify(tv));
  const variance = col(t, 'Variance');
  check(g, 'no row of the report shows a variance', variance >= 0 && t.rows.every((r) => near(r[variance], 0)), show(t));
}
{
  const g = 'gstr3b-vs-gstr1-tax, older pull without ttl_tax (08/2026)';
  const t = await built(G3.buildGstr3bVsGstr1TaxReport, CLIENT.id, '08/2026');
  const tv = rowOf(t, is('Taxable Value'));
  check(g, 'falls back to the invoice value less the tax: within the view\'s 0.50 rounding of GSTR-3B', !!tv && near(tv[1], EXP_TAX, 0.5) && near(tv[3], 0, 0.5), JSON.stringify(tv ?? t.error));
}

// ── 3. GSTR-3B vs GSTR-1 Comparison Report ──────────────────────────────────
{
  const g = 'gstr3b-vs-gstr1-comparison';
  const jun = await built(G3.buildGstr3bVsGstr1ComparisonReport, CLIENT.id, '06/2026');
  check(g, 'Jun: EXP taxable value = ttl_tax, equal to GSTR-3B 3.1(b)', cell(jun, is('EXP'), 'Taxable Value') === EXP_TAX && cell(jun, (c) => c.startsWith('GSTR-3B Table 3.1(b)'), 'Taxable Value') === EXP_TAX, show(jun));
  const jul = await built(G3.buildGstr3bVsGstr1ComparisonReport, CLIENT.id, '07/2026');
  check(g, 'Jul: B2B and B2CS taxable values = ttl_tax', cell(jul, is('B2B'), 'Taxable Value') === 250000 && cell(jul, is('B2CS'), 'Taxable Value') === 10000.5, show(jul));
  check(g, 'Jul: NIL\'s value is its three amounts, mapped to 3.1(c) and 3.1(e), both listed', cell(jul, is('NIL'), 'Taxable Value') === 5000
    && /3\.1\(e\)/.test(String(cell(jul, is('NIL'), 'Maps to GSTR-3B Table')))
    && cell(jul, (c) => c.startsWith('GSTR-3B Table 3.1(c)'), 'Taxable Value') === 4000
    && cell(jul, (c) => c.startsWith('GSTR-3B Table 3.1(e)'), 'Taxable Value') === 1000, show(jul));
  check(g, 'no invoice value under Taxable Value (486,568 / 295,000 nowhere)', ![...jun.rows, ...jul.rows].some((r) => r.includes(EXP_VAL) || r.includes(295000)), show(jul));
}

// ── 4. Tax liability reports ────────────────────────────────────────────────
{
  const g = 'tax-liability-excl-export-rcm (07/2026)';
  const t = await built(TL.buildTaxLiabilityExclExportRcmReport, CLIENT.id, '07/2026');
  check(g, 'B2B and B2C (Small) taxable values = ttl_tax', cell(t, is('B2B Invoices'), 'Taxable Value') === 250000 && cell(t, is('B2C (Small)'), 'Taxable Value') === 10000.5, show(t));
  check(g, 'TOTAL taxable value = 2,60,000.50 (equal to GSTR-3B 3.1(a))', near(cell(t, is('TOTAL'), 'Taxable Value'), 260000.5), show(t));
}
{
  const g = 'tax-liability-export-sez (06/2026)';
  const t = await built(TL.buildTaxLiabilityExportSezReport, CLIENT.id, '06/2026');
  check(g, 'Exports: Taxable Value = ttl_tax, the invoice value its own column', cell(t, is('Exports'), 'Taxable Value') === EXP_TAX && cell(t, is('Exports'), 'Invoice Value') === EXP_VAL, show(t));
  check(g, 'TOTAL: both values and the IGST', cell(t, is('TOTAL'), 'Taxable Value') === EXP_TAX && cell(t, is('TOTAL'), 'Invoice Value') === EXP_VAL && cell(t, is('TOTAL'), 'IGST') === EXP_IGST, show(t));
  check(g, 'every row as wide as the headers', t.rows.length > 0 && t.rows.every((r) => r.length === t.headers.length) && t.columnWidths.length === t.headers.length, show(t));
}

// ── 5. GSTR-1 (Filed on Portal) ─────────────────────────────────────────────
let filedJun = null;
{
  const g = 'gstr1-filed';
  const jun = filedJun = await built(FR.buildFiledGstr1Report, CLIENT.id, '06/2026');
  check(g, 'headers: Taxable Value and Invoice Value side by side', col(jun, 'Taxable Value') >= 0 && col(jun, 'Invoice Value') === col(jun, 'Taxable Value') + 1, show(jun));
  check(g, 'Exports and TOTAL LIABILITY: taxable = ttl_tax, invoice = ttl_val', cell(jun, is('Exports'), 'Taxable Value') === EXP_TAX && cell(jun, is('Exports'), 'Invoice Value') === EXP_VAL
    && cell(jun, is('TOTAL LIABILITY'), 'Taxable Value') === EXP_TAX && cell(jun, is('TOTAL LIABILITY'), 'Invoice Value') === EXP_VAL, show(jun));
  check(g, 'HSN Summary: its taxable value, no invoice value (the portal states none)', cell(jun, is('HSN Summary'), 'Taxable Value') === EXP_TAX && cell(jun, is('HSN Summary'), 'Invoice Value') === '', show(jun));
  const jul = await built(FR.buildFiledGstr1Report, CLIENT.id, '07/2026');
  check(g, 'Jul: B2B taxable 2,50,000 and invoice 2,95,000; NIL 5,000', cell(jul, is('B2B Invoices'), 'Taxable Value') === 250000 && cell(jul, is('B2B Invoices'), 'Invoice Value') === 295000
    && cell(jul, is('Nil Rated / Exempt / Non-GST'), 'Taxable Value') === 5000, show(jul));
  const doc = rowOf(jul, (c) => c.startsWith('Documents Issued'));
  const values = [col(jul, 'Taxable Value'), col(jul, 'Invoice Value')];
  check(g, 'Documents Issued: the counts in its words, nothing under a value heading', !!doc && /42 issued, 2 cancelled, 40 net/.test(doc[0]) && values.every((c) => doc[c] === ''), JSON.stringify(doc));
  check(g, 'every row (the PDF row too) as wide as the headers', [...jun.rows, ...jul.rows].every((r) => r.length === jun.headers.length) && jun.columnWidths.length === jun.headers.length, show(jun));
  const old = await built(FR.buildFiledGstr1Report, CLIENT.id, '08/2026');
  check(g, 'older pull: Exports taxable from the fallback, HSN nil rather than negative', cell(old, is('Exports'), 'Taxable Value') === 412345.78 && cell(old, is('HSN Summary'), 'Taxable Value') === 0, show(old));
}

// ── 6. The views draw the new tables ────────────────────────────────────────
{
  const g = 'views';
  const V = await loadViews(root, ['VarianceComparisonView', 'FiledReturnSummaryView']);
  const draw = (name, table, report) => { try { return V.draw(name, table, report); } catch (e) { return { html: '', text: `DRAW FAILED: ${e?.stack ?? e}` }; } };
  const tax = await built(G3.buildGstr3bVsGstr1TaxReport, CLIENT.id, '06/2026');
  const v = draw('VarianceComparisonView', tax, V.report('gstr3b-vs-gstr1-tax'));
  const tile = /Mismatched(?:(?!<\/button>).)*?>(\d[\d,]*)</s.exec(v.html);
  check(g, 'variance view: the Mismatched tile reads 0', tile?.[1] === '0', tile?.[0]?.slice(0, 300) ?? v.text.slice(0, 300));
  if (filedJun && !filedJun.error) {
    const f = draw('FiledReturnSummaryView', filedJun, V.report('gstr1-filed'));
    check(g, 'filed GSTR-1 view: draws Invoice Value and the HSN row', /Invoice Value/.test(f.text) && /HSN Summary/.test(f.text), f.text.slice(0, 300));
    check(g, '… its Total liability tile is the tax heads (₹74,222.22), not a value', /Total liability/.test(f.text) && f.text.includes('74,222.22'), f.text.slice(0, 600));
  } else {
    check(g, 'filed GSTR-1 view: the table built', false, filedJun?.error);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info.slice(0, 400)}]`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
