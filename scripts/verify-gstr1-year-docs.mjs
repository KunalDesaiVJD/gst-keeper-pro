#!/usr/bin/env node
// Checks the full-year GSTR-1 documents report (src/utils/gstr1YearDocuments.ts,
// src/lib/gstr1Year/flatten.ts) on a fictional filed GSTR-1 JSON holding every
// section the portal's offline download carries: B2B, B2BA, B2CL, B2CLA, B2CS,
// B2CSA, EXP, EXPA, CDNR, CDNRA, CDNUR, CDNURA, AT, ATA, TXPD, TXPDA, NIL,
// HSN (B2B / B2C), DOC_ISSUE, SUPECO, ECOM and a section the code does not know.
// Two months are pulled, one is generating on the portal, the rest not pulled.
// Also builds the Big4 Excel (reportToXlsx) and checks its sheets.
//
//   node scripts/verify-gstr1-year-docs.mjs
//
// Fictional data only; nothing is read from or written to Supabase.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');
globalThis.__verifyExcelJS = requireRoot('exceljs');

const itm = (rt, txval, i, c, s, cs = 0) => ({ num: 1, itm_det: { rt, txval, iamt: i, camt: c, samt: s, csamt: cs } });
const APRIL = {
  gstin: '24ABCDE1234F1Z5', fp: '042025', gt: 0, cur_gt: 0,
  b2b: [{ ctin: '27AAAAA0000A1Z5', inv: [
    { inum: 'INV-1', idt: '05-04-2025', val: 1180, pos: '27', rchrg: 'N', inv_typ: 'R', chksum: 'x', itms: [itm(18, 1000, 180, 0, 0)] },
    { inum: 'INV-2', idt: '06-04-2025', val: 2360, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [itm(18, 1000, 180, 0, 0), itm(18, 1000, 180, 0, 0)] },
  ] }],
  b2ba: [{ ctin: '27AAAAA0000A1Z5', inv: [{ oinum: 'INV-0', oidt: '20-03-2025', inum: 'INV-0A', idt: '20-03-2025', val: 590, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [itm(18, 500, 90, 0, 0)] }] }],
  b2cl: [{ pos: '29', inv: [{ inum: 'BL-1', idt: '07-04-2025', val: 295000, itms: [itm(18, 250000, 45000, 0, 0)] }] }],
  b2cla: [{ pos: '29', inv: [{ oinum: 'BL-0', oidt: '01-03-2025', inum: 'BL-0', idt: '01-03-2025', val: 295000, itms: [itm(18, 250000, 45000, 0, 0)] }] }],
  b2cs: [{ sply_ty: 'INTRA', pos: '24', typ: 'OE', rt: 5, txval: 2000, camt: 50, samt: 50, csamt: 0 }],
  b2csa: [{ omon: '032025', sply_ty: 'INTRA', pos: '24', typ: 'OE', itms: [{ rt: 5, txval: 100, camt: 2.5, samt: 2.5 }] }],
  exp: [{ exp_typ: 'WOPAY', inv: [{ inum: 'EX-1', idt: '08-04-2025', val: 5000, sbpcode: 'INMUN1', sbnum: '123', sbdt: '09-04-2025', itms: [{ rt: 0, txval: 5000, iamt: 0 }] }] }],
  expa: [{ exp_typ: 'WPAY', inv: [{ oinum: 'EX-0', oidt: '02-03-2025', inum: 'EX-0', idt: '02-03-2025', val: 1180, itms: [{ rt: 18, txval: 1000, iamt: 180 }] }] }],
  cdnr: [{ ctin: '27AAAAA0000A1Z5', nt: [
    { ntty: 'C', nt_num: 'CN-1', nt_dt: '10-04-2025', val: 118, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [itm(18, 100, 18, 0, 0)] },
    { ntty: 'D', nt_num: 'DN-1', nt_dt: '11-04-2025', val: 59, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [itm(18, 50, 9, 0, 0)] },
  ] }],
  cdnra: [{ ctin: '27AAAAA0000A1Z5', nt: [{ ntty: 'C', ont_num: 'CN-0', ont_dt: '15-03-2025', nt_num: 'CN-0', nt_dt: '15-03-2025', val: 118, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [itm(18, 100, 18, 0, 0)] }] }],
  cdnur: [{ typ: 'B2CL', ntty: 'C', nt_num: 'CNU-1', nt_dt: '12-04-2025', val: 1180, pos: '29', itms: [itm(18, 1000, 180, 0, 0)] }],
  cdnura: [{ typ: 'EXPWP', ntty: 'D', ont_num: 'CNU-0', ont_dt: '01-03-2025', nt_num: 'CNU-0', nt_dt: '01-03-2025', val: 118, itms: [itm(18, 100, 18, 0, 0)] }],
  at: [{ pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 10000, camt: 900, samt: 900 }] }],
  ata: [{ omon: '032025', pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 500, camt: 45, samt: 45 }] }],
  txpd: [{ pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 4000, camt: 360, samt: 360 }] }],
  txpda: [{ omon: '032025', pos: '24', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 100, camt: 9, samt: 9 }] }],
  nil: { inv: [{ sply_ty: 'INTRB2B', nil_amt: 100, expt_amt: 200, ngsup_amt: 300 }, { sply_ty: 'INTRAB2C', nil_amt: 10, expt_amt: 0, ngsup_amt: 0 }] },
  hsn: { hsn_b2b: [{ num: 1, hsn_sc: '8471', desc: 'Computers', uqc: 'NOS', qty: 2, rt: 18, txval: 2000, iamt: 360, camt: 0, samt: 0, csamt: 0 }],
    hsn_b2c: [{ num: 1, hsn_sc: '9983', desc: 'Services', uqc: 'NA', qty: 0, rt: 5, txval: 2000, iamt: 0, camt: 50, samt: 50, csamt: 0 }] },
  doc_issue: { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: 'INV-1', to: 'INV-9', totnum: 9, cancel: 1, net_issue: 8 }] }, { doc_num: 5, docs: [{ num: 1, from: 'CN-1', to: 'CN-1', totnum: 1, cancel: 0, net_issue: 1 }] }] },
  supeco: { clttx: [{ etin: '24ECOMM0000A1Z5', suppval: 3000, igst: 0, camt: 0, samt: 0 }], paytx: [{ etin: '24ECOMM0000A1Z5', suppval: 700, camt: 17.5, samt: 17.5 }] },
  ecom: { b2c: [{ stin: '24SUPPL0000A1Z5', pos: '24', sply_ty: 'INTRA', rt: 5, txval: 400, camt: 10, samt: 10 }] },
  newtable: [{ foo: 'bar', txval: 7 }],
};
const MAY = { gstin: '24ABCDE1234F1Z5', fp: '052025', b2b: [{ ctin: '29BBBBB1111B1Z5', inv: [{ inum: 'INV-10', idt: '05-05-2025', val: 1180, pos: '29', rchrg: 'Y', inv_typ: 'R', itms: [itm(18, 1000, 180, 0, 0)] }] }] };
const ROWS = {
  '04/2025': { full_json: APRIL, full_json_pulled_at: '2025-06-01T05:00:00Z', status: 'FILED' },
  '05/2025': { full_json: MAY, full_json_pulled_at: '2025-06-02T05:00:00Z', status: 'FILED' },
  '06/2025': { full_json: null, full_json_pulled_at: null, status: 'PENDING: filed JSON still generating' },
};

const SUPABASE_STUB = `
  const ROWS = ${JSON.stringify(ROWS)};
  const q = (table) => {
    const f = {};
    const api = {
      select() { return api; }, in() { return api; },
      eq(k, v) { f[k] = v; return api; },
      maybeSingle() {
        if (table === 'clients') return Promise.resolve({ data: { id: 'c1', name: 'FICTIONAL TRADERS', gstin: '24ABCDE1234F1Z5' }, error: null });
        return Promise.resolve({ data: ROWS[f.period_month] ?? null, error: null });
      },
    };
    return api;
  };
  export const supabase = { from: q };
`;
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onResolve({ filter: /^exceljs$/ }, () => ({ path: 'exceljs', namespace: 'stub' }));
    b.onResolve({ filter: /^@\/assets\/.*\.png$/ }, () => ({ path: 'png', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
      contents: a.path === 'exceljs' ? 'export default globalThis.__verifyExcelJS;'
        : a.path === 'png' ? 'export default "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";'
          : SUPABASE_STUB,
      loader: 'js',
    }));
    // The app imports jsPDF's ES build (as Vite does); its Node build is CommonJS.
    b.onResolve({ filter: /^jspdf$/ }, () => ({ path: path.join(root, 'node_modules', 'jspdf', 'dist', 'jspdf.es.min.js') }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export { buildGstr1YearDocumentsReport } from './src/utils/gstr1YearDocuments';
      export { flattenGstr1, toDocLine } from './src/lib/gstr1Year/flatten';
      export { reportToXlsx } from './src/lib/reportExport/excel';
      export { buildReportPdf } from './src/lib/reportExport/pdf';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stubs], logLevel: 'error',
  define: { 'import.meta.env': '{}' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let failed = 0;
const check = (name, cond, info = '') => { if (!cond) failed += 1; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` (${info})`}`); };
const close = (a, b) => Math.abs(a - b) < 0.011;

const flat = M.flattenGstr1(APRIL);
const sections = new Set(flat.map((r) => r.section));
for (const s of ['b2b', 'b2ba', 'b2cl', 'b2cla', 'b2cs', 'b2csa', 'exp', 'expa', 'cdnr', 'cdnra', 'cdnur', 'cdnura', 'at', 'ata', 'txpd', 'txpda', 'nil', 'hsn', 'doc_issue', 'supeco', 'ecom', 'newtable']) {
  check(`section ${s} is read`, sections.has(s), [...sections].join(','));
}
check('header keys are not sections', !sections.has('gstin') && !sections.has('fp'));
check('INV-2 gives one row per item line', flat.filter((r) => r.row.inum === 'INV-2').length === 2);
const b2ba = M.toDocLine(flat.find((r) => r.section === 'b2ba'));
check('B2BA carries the original invoice', b2ba.origNo === 'INV-0' && b2ba.docNo === 'INV-0A' && b2ba.origDate === '20-03-2025');
const cdnra = M.toDocLine(flat.find((r) => r.section === 'cdnra'));
check('CDNRA carries the original note', cdnra.origNo === 'CN-0' && cdnra.kind === 'Credit note');
const b2csa = M.toDocLine(flat.find((r) => r.section === 'b2csa'));
check('B2CSA carries its original month', b2csa.origMonth === '032025' && close(b2csa.taxable, 100));
const at = M.toDocLine(flat.find((r) => r.section === 'at'));
check('advance amount read as the taxable value', close(at.taxable, 10000) && at.kind === 'Advance received');
const exp = M.toDocLine(flat.find((r) => r.section === 'exp'));
check('export keeps its shipping bill in Other details', /sbnum: 123/.test(exp.other) && exp.type === 'WOPAY');
const hsnSubs = new Set(flat.filter((r) => r.section === 'hsn').map((r) => r.sub));
check('HSN keeps B2B and B2C apart', hsnSubs.has('B2B') && hsnSubs.has('B2C'), [...hsnSubs].join(','));
const supSubs = new Set(flat.filter((r) => r.section === 'supeco').map((r) => r.sub));
check('Table 14 keeps 14(a) and 14(b) apart', supSubs.size === 2, [...supSubs].join(','));
const eco = M.toDocLine(flat.find((r) => r.section === 'ecom'));
check('Table 15 reads the supplier', eco.counterparty === '24SUPPL0000A1Z5');
check('checksums are dropped', !flat.some((r) => 'chksum' in r.row));

const t = await M.buildGstr1YearDocumentsReport('c1', '09/2025');
const H = (name) => t.headers.indexOf(name);
check('one table for FY 2025-26', /FY 2025-26/.test(t.title));
const months = new Set(t.rows.filter((r) => r[0] !== 'TOTAL').map((r) => r[0]));
check('documents of April and May with a Month column', months.size === 2, [...months].join(','));
check('HSN, documents issued and nil are not in the documents list', !t.rows.some((r) => /^(HSN|DOC_ISSUE|NIL):/.test(String(r[H('Section')]))));
const total = t.rows[t.rows.length - 1];
// Net taxable: April b2b 3000 + b2ba 500 + b2cl 250000 + b2cla 250000 + b2cs 2000 + b2csa 100 + exp 5000 + expa 1000
//   - CN-1 100 + DN-1 50 - CN-0 100 - CNU-1 1000 + CNU-0 (debit) 100 + at 10000 + ata 500 + txpd 4000 + txpda 100
//   + supeco 3000 + 700 + ecom 400 + newtable 7; May 1000
const want = 3000 + 500 + 250000 + 250000 + 2000 + 100 + 5000 + 1000 - 100 + 50 - 100 - 1000 + 100 + 10000 + 500 + 4000 + 100 + 3000 + 700 + 400 + 7 + 1000;
check('TOTAL taxable takes credit notes off', total[0] === 'TOTAL' && close(total[H('Taxable Value')], want), `${total[H('Taxable Value')]} vs ${want}`);
check('summary lists every document section', t.summary.rows.length >= 20, t.summary.rows.length);
const ms = t.extraSheets.find((s) => s.name === 'Month-wise');
check('month-wise has 12 months and a TOTAL', ms.rows.length === 13);
check('June shows generating, July not pulled', /Generating/.test(ms.rows[2][1]) && ms.rows[3][1] === 'Not pulled', `${ms.rows[2][1]} / ${ms.rows[3][1]}`);
check('2 of 12 months pulled', /2 of 12/.test(ms.rows[12][1]));
const hsn = t.extraSheets.find((s) => s.name.startsWith('HSN'));
check('HSN sheet: 2 lines and TOTAL 4000', hsn && hsn.rows.length === 3 && close(hsn.rows[2][7], 4000));
const di = t.extraSheets.find((s) => s.name.startsWith('Documents issued'));
check('documents issued: nature named, net 9', di && di.rows[0][1] === 'Invoices for outward supply' && di.rows[2][6] === 9);
const nil = t.extraSheets.find((s) => s.name.startsWith('Nil'));
check('nil sheet totals 610', nil && close(nil.rows[nil.rows.length - 1][5], 610));
check('sheet names fit Excel (31 chars)', t.extraSheets.every((s) => s.name.length <= 31));
check('pdf columns exist', t.pdfColumns.every((i) => i < t.headers.length));

const buf = await M.reportToXlsx(t);
const wb = new globalThis.__verifyExcelJS.Workbook();
await wb.xlsx.load(buf);
const names = wb.worksheets.map((w) => w.name);
check('Excel has Summary, Documents and each extra sheet', ['Summary', 'Documents', 'Month-wise'].every((n) => names.includes(n)) && names.length === 6, names.join(', '));

let pdf;
try { pdf = await M.buildReportPdf(t); } catch (e) { console.log('FAIL PDF build: ' + String(e?.stack ?? e).slice(0, 600)); process.exit(1); }
const pages = pdf.getNumberOfPages();
check('PDF builds, landscape, summary and every sheet', pages >= 3 && pdf.internal.pageSize.getWidth() > pdf.internal.pageSize.getHeight(), `${pages} pages`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
