#!/usr/bin/env node
// Checks the Vendor GSTIN Risk Report (src/lib/vendorRisk): the GSTIN check
// character (against the app's other implementation in notice-ai), the
// structural classification, the filing table and turnover slab readers, the
// risk banding (cancelled → Critical, retrospective cancellation, composition,
// missing lookup → No Data, active filer → Low, e-invoice without IRN,
// material 2B mismatch, invalid GSTIN) and the report layout.
//
//   node scripts/verify-vendor-risk.mjs
//
// Fictional GSTINs (made valid by the algorithm itself); nothing is read from
// or written to Supabase. Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const stub = {
  name: 'stub-supabase',
  setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase = {};', loader: 'js' }));
    b.onResolve({ filter: /^jspdf$/ }, () => ({ path: path.join(root, 'node_modules', 'jspdf', 'dist', 'jspdf.es.min.js') }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export * from './src/lib/vendorRisk/gstin';
      export * from './src/lib/vendorRisk/engine';
      export * from './src/lib/vendorRisk/rules';
      export { vendorRiskTable } from './src/utils/vendorRiskReports';
      export { gstinValid } from './supabase/functions/notice-ai/gstin';
      export { buildReportWorkbook } from './src/lib/reportExport/excel';
      export { buildReportPdf } from './src/lib/reportExport/pdf';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'error',
  loader: { '.png': 'dataurl' },
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const V = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });

// ── 1. GSTIN ────────────────────────────────────────────────────────────────
{
  const g = 'GSTIN';
  const bases = ['27AAACR5055K1Z', '29ABCDE1234F1Z', '07AAAPL1234C2Z', '24AABCT3518Q1Z', '33AAAFZ0001A1Z', '09AAACH7409R1Z', '19ZZZPS9999X9Z'];
  for (const b14 of bases) {
    const full = V.withCheckChar(b14);
    check(g, `${full}: valid, agrees with notice-ai's check`, V.checkGstin(full).valid && V.gstinValid(full), JSON.stringify(V.checkGstin(full)));
    const wrong = full.slice(0, 14) + (full[14] === 'A' ? 'B' : 'A');
    check(g, `${wrong}: fails the check character (and notice-ai agrees)`, !V.checkGstin(wrong).checkDigitOk && !V.gstinValid(wrong));
  }
  // Every single-character typo in the body is caught.
  const base = V.withCheckChar('27AAACR5055K1Z');
  let caught = 0, tried = 0;
  for (let i = 0; i < 14; i++) for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (c === base[i]) continue;
    const t = base.slice(0, i) + c + base.slice(i + 1);
    const r = V.checkGstin(t);
    if (!r.formatOk) continue;
    tried++; if (!r.checkDigitOk) caught++;
  }
  check(g, `every single-character typo of a well-formed GSTIN fails the check (${caught}/${tried})`, caught === tried && tried > 100);
  const c = V.checkGstin(base);
  check(g, 'state, PAN, holder, entity number', c.stateCode === '27' && c.state === 'Maharashtra' && c.pan === 'AAACR5055K' && c.panHolder === 'Company' && c.entityNumber === '1', JSON.stringify(c));
  check(g, 'normal kind (14th Z)', c.kind === 'normal');
  check(g, 'TCS (14th C)', V.checkGstin(V.withCheckChar('29AAICA3918J1C')).kind === 'tcs');
  check(g, 'TDS deductor (TAN-shaped, 14th D)', V.checkGstin(V.withCheckChar('27MUMA12345B1D')).kind === 'tds', JSON.stringify(V.checkGstin(V.withCheckChar('27MUMA12345B1D'))));
  check(g, 'UIN (…UN…)', V.checkGstin(V.withCheckChar('0717UNO00157UN')).kind === 'uin');
  check(g, 'NRTP (…NR…)', V.checkGstin(V.withCheckChar('0718USA00001NR')).kind === 'nrtp');
  check(g, 'OIDAR (99…OS…)', V.checkGstin(V.withCheckChar('9917USA29001OS')).kind === 'oidar');
  check(g, 'short GSTIN invalid', !V.checkGstin('27AAACR5055K1Z').valid && V.checkGstin('27AAACR5055K1Z').kind === 'invalid');
  check(g, 'bad state code invalid', !V.checkGstin(V.withCheckChar('45AAACR5055K1Z')).valid);
  check(g, 'spaces and case are ignored', V.checkGstin(` ${base.toLowerCase().slice(0, 7)} ${base.toLowerCase().slice(7)} `).valid);
}

// ── 2. Readers ──────────────────────────────────────────────────────────────
{
  const g = 'Readers';
  const s1 = V.parseSlab('Slab: Rs. 5 Cr. to 25 Cr.');
  check(g, 'slab 5–25 crore', s1 && s1.lo === 5e7 && s1.hi === 25e7, JSON.stringify(s1));
  const s2 = V.parseSlab('Slab: Rs. 1.5 Cr. to 5 Cr.');
  check(g, 'slab 1.5–5 crore', s2 && s2.lo === 1.5e7 && s2.hi === 5e7, JSON.stringify(s2));
  const s3 = V.parseSlab('Slab: Rs. 500 Cr. and above');
  check(g, 'slab 500 crore and above', s3 && s3.lo === 5e9 && s3.hi === null, JSON.stringify(s3));
  const s4 = V.parseSlab('Slab: Rs. 0 to 40 lakhs');
  check(g, 'slab 0–40 lakh', s4 && s4.lo === 0 && s4.hi === 4e6, JSON.stringify(s4));
  const s5 = V.parseSlab('Slab: Rs. 500 Cr. and above (FY 2024-25)');
  check(g, 'slab with its FY appended', s5 && s5.lo === 5e9 && s5.hi === null, JSON.stringify(s5));
  const s6 = V.parseSlab('Upto Rs. 40 lakhs (FY 2024-25)');
  check(g, 'slab "upto" with its FY', s6 && s6.lo === 0 && s6.hi === 4e6, JSON.stringify(s6));
  const months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
  const all = months.map((m, i) => ({ rtntype: 'GSTR3B', fy: '2025-26', taxp: m, dof: `${i < 9 ? 18 : 19}/${String(((i + 4) % 12) + 1).padStart(2, '0')}/${i < 8 ? 2025 : 2026}`, status: 'Filed' }));
  const fa = V.analyseFilings(all, '2025-26', '2026-11-27', 'GSTR3B');
  check(g, 'monthly 3B: 12 of 12, none late', fa.state === 'ok' && !fa.quarterly && fa.filed.length === 12 && fa.missing.length === 0 && fa.late.length === 0, JSON.stringify(fa));
  const fb = V.analyseFilings(all.filter((f) => !['February', 'March'].includes(f.taxp)), '2025-26', '2026-11-27', 'GSTR3B');
  check(g, 'two months missing', fb.missing.length === 2 && fb.missing.includes('02/2026') && fb.missing.includes('03/2026'), JSON.stringify(fb.missing));
  const q = ['June', 'September', 'December', 'March'].map((m) => ({ rtntype: 'GSTR3B', fy: '2025-26', taxp: m, dof: null, status: 'Filed' }));
  const fq = V.analyseFilings(q, '2025-26', '2026-11-27', 'GSTR3B');
  check(g, 'quarterly filer read as quarterly, nothing missing', fq.quarterly && fq.missing.length === 0 && fq.due.length === 4, JSON.stringify(fq));
  check(g, 'no filing table → no_data', V.analyseFilings(null, '2025-26', '2026-11-27', 'GSTR3B').state === 'no_data' && V.analyseFilings([{ rtntype: 'GSTR3B', fy: '2024-25', taxp: 'April' }], '2025-26', '2026-11-27', 'GSTR3B').state === 'no_data');
  const late = V.analyseFilings([{ rtntype: 'GSTR3B', fy: '2025-26', taxp: 'April', dof: '05/06/2025', status: 'Filed' }], '2025-26', '2026-11-27', 'GSTR3B');
  check(g, 'late filing found', late.late.length === 1 && late.late[0].due === '2025-05-20', JSON.stringify(late.late));
  check(g, 'names: suffixes and case do not count', V.nameSimilarity('M/s. ABC Traders Pvt. Ltd.', 'ABC TRADERS PRIVATE LIMITED') === 1 && V.nameSimilarity('Sharma Steel', 'Gupta Textiles') < 0.5);
}

// ── 3. Banding ──────────────────────────────────────────────────────────────
const FY = '2025-26';
const TODAY = '2026-11-27';
const G = {
  cancelled: V.withCheckChar('27AAACC1111C1Z'),
  retro: V.withCheckChar('27AAACR2222R1Z'),
  composition: V.withCheckChar('27AAAPC3333C1Z'),
  nolookup: V.withCheckChar('24AAACN4444N1Z'),
  good: V.withCheckChar('29AAACG5555G1Z'),
  einv: V.withCheckChar('27AAACE6666E1Z'),
  mismatch: V.withCheckChar('27AAACM7777M1Z'),
  suspended: V.withCheckChar('27AAACS8888S1Z'),
  compclean: V.withCheckChar('27AAAPD9999D1Z'),
  nonfiler: V.withCheckChar('27AAACF1212F1Z'),
};
const BAD = '27AAACX1234X1ZQ'.slice(0, 14) + (V.withCheckChar('27AAACX1234X1Z')[14] === 'Q' ? 'R' : 'Q');
let n = 0;
const doc = (ctin, over = {}) => ({
  ref: `x${++n}`, source: '2B', statementPeriod: '07/2025', section: 'B2B', isAmendment: false, original: null, ctin,
  supplierName: 'Vendor', family: 'INV', number: `INV-${n}`, date: '2025-07-10', docValue: 11800, pos: '27', reverseCharge: false,
  taxable: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, supplierPeriod: '07/2025', supplierFiledOn: '2025-08-10', supplierFiled: true,
  supplier3bFiled: null, supplierCancelledFrom: null, itcAvailable: true, itcReason: null, imsStatus: null, bucket: 'available', irn: null, ...over,
});
const fullFilings = (rt) => ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
  .map((m) => ({ rtntype: rt, fy: '2025-26', taxp: m, dof: null, status: 'Filed' }));
const lookup = (gstin, over = {}) => ({
  gstin, status: 'ok', lookedUpAt: '2026-11-20T06:00:00Z', source: 'gst_portal_search_taxpayer', legalName: 'VENDOR PRIVATE LIMITED', tradeName: 'Vendor',
  regStatus: 'Active', regDate: '2018-04-01', cancelDate: null, cancelReason: null, taxpayerType: 'Regular', constitution: 'Private Limited Company',
  natureOfBusiness: null, atoSlab: 'Slab: Rs. 1.5 Cr. to 5 Cr.', einvoiceStatus: null, filings: [...fullFilings('GSTR1'), ...fullFilings('GSTR3B')], ...over,
});
const input = {
  client: { name: 'Fictional Client Pvt Ltd', gstin: V.withCheckChar('27AAACZ0000Z1Z') },
  fy: FY, today: TODAY,
  statements: ['04/2025', '05/2025', '06/2025', '07/2025', '08/2025', '09/2025', '10/2025', '11/2025', '12/2025', '01/2026', '02/2026', '03/2026']
    .flatMap((p) => ['2A', '2B'].map((source) => ({ source, period: p, state: 'ready', pulledAt: '2026-10-12' }))),
  docs2A: [doc(G.good, { source: '2A', supplier3bFiled: true, bucket: null, itcAvailable: null })],
  docs2B: [
    doc(G.cancelled, { date: '2025-05-01' }),
    doc(G.retro, { date: '2025-09-15' }),
    doc(G.composition),
    doc(G.nolookup),
    doc(G.good),
    doc(G.einv), doc(G.einv),
    doc(G.mismatch),
    doc(G.suspended, { date: '2025-12-01' }),
    doc(G.compclean, { cgst: 0, sgst: 0 }),
    doc(G.nonfiler),
  ],
  importDocs: [],
  books: [
    { id: 'b1', gstin: G.mismatch, name: 'Vendor', period: '08/2025', number: 'M-1', docType: 'Invoice', date: '2025-08-05', tax: 200000 },
    { id: 'b2', gstin: BAD, name: 'Typo Vendor', period: '08/2025', number: 'T-1', docType: 'Invoice', date: '2025-08-05', tax: 5000 },
  ],
  ledgerAsOf: '03/2026',
  notIn2B: [{ gstin: G.mismatch, name: 'Vendor', tax: 60000 }],
  notInBooks: [],
  recoPeriods: [], reco: [],
  master: [], masterFile: null,
  lookups: [
    lookup(G.cancelled, { regStatus: 'Cancelled', cancelDate: '2025-08-01', cancelReason: 'Non-filing of returns' }),
    lookup(G.retro, { regStatus: 'Cancelled', cancelDate: '2025-06-01' }),
    lookup(G.composition, { taxpayerType: 'Composition' }),
    lookup(G.good),
    lookup(G.einv, { atoSlab: 'Slab: Rs. 5 Cr. to 25 Cr.' }),
    lookup(G.mismatch),
    lookup(G.suspended, { regStatus: 'Suspended', cancelDate: '2025-11-01' }),
    lookup(G.compclean, { taxpayerType: 'Composition' }),
    lookup(G.nonfiler, { filings: [...fullFilings('GSTR1'), ...fullFilings('GSTR3B').slice(0, 9)] }),
  ],
};
const res = V.assessVendors(input);
const row = (g) => res.rows.find((r) => r.gstin === g);
const has = (g, code) => row(g)?.findings.some((f) => f.code === code);
{
  const g = 'Banding';
  check(g, 'client\'s own GSTIN is not a vendor', !res.rows.some((r) => r.gstin === input.client.gstin));
  check(g, 'cancelled (invoices before the date) → Critical, potential, conditionally eligible',
    row(G.cancelled)?.band === 'Critical' && row(G.cancelled)?.nature === 'Potential risk' && has(G.cancelled, 'CANCELLED') && !has(G.cancelled, 'CANCELLED_RETRO')
    && /conditionally eligible/i.test(row(G.cancelled).cells['ITC Eligibility Status']) && row(G.cancelled).cells['Cancellation Reason'] === 'Non-filing of returns', JSON.stringify(row(G.cancelled)?.cells));
  check(g, 'retrospective cancellation → Critical, confirmed, potentially ineligible',
    row(G.retro)?.band === 'Critical' && row(G.retro)?.nature === 'Confirmed' && has(G.retro, 'CANCELLED_RETRO') && /potentially ineligible/i.test(row(G.retro).cells['ITC Eligibility Status']), JSON.stringify(row(G.retro)?.findings));
  check(g, 'composition with tax charged → High, potential', row(G.composition)?.band === 'High' && has(G.composition, 'COMPOSITION_TAX_CHARGED') && row(G.composition).composition === 'Yes', JSON.stringify(row(G.composition)?.findings));
  check(g, 'composition without tax → not ineligible (no ITC arises), Low', row(G.compclean)?.band === 'Low' && /no itc arises/i.test(row(G.compclean).cells['ITC Eligibility Status']), JSON.stringify(row(G.compclean)?.cells['ITC Eligibility Status']));
  check(g, 'missing lookup → No Data, verification required, never non-compliant',
    row(G.nolookup)?.band === 'No Data' && /verification required/i.test(row(G.nolookup).cells['GST Registration Status']) && row(G.nolookup).cells['ITC Risk Category'] === 'No Data / Verification Required'
    && row(G.nolookup).cells['Composition Scheme (Yes/No)'] === 'Verification required', JSON.stringify(row(G.nolookup)?.cells));
  check(g, 'active filer → Low, eligible', row(G.good)?.band === 'Low' && /eligible, subject/i.test(row(G.good).cells['ITC Eligibility Status']) && /Filed 12 of 12/.test(row(G.good).cells['GSTR-3B Filing Status']), JSON.stringify(row(G.good)?.cells));
  check(g, 'e-invoice liable by slab, no IRN → High, risk Yes', row(G.einv)?.band === 'High' && has(G.einv, 'EINVOICE_MISSING_IRN') && row(G.einv).einvRisk === 'Yes' && row(G.einv).einvApplicable === 'Yes' && row(G.einv).einvNotEnabled, JSON.stringify(row(G.einv)?.findings));
  check(g, 'below-threshold slab → e-invoice No, risk No', row(G.good)?.einvApplicable === 'No' && row(G.good)?.einvRisk === 'No');
  check(g, 'material open Not in 2B → High', row(G.mismatch)?.band === 'High' && has(G.mismatch, 'MISMATCH_MATERIAL'), JSON.stringify(row(G.mismatch)?.findings));
  check(g, 'suspended with invoices after the date → Critical, hold list', row(G.suspended)?.band === 'Critical' && has(G.suspended, 'SUSPENDED_INVOICES'));
  check(g, 'three months of 3B missing → High (persistent non-filing, confirmed)', row(G.nonfiler)?.band === 'High' && has(G.nonfiler, 'NON_FILING_PERSISTENT') && row(G.nonfiler)?.nature === 'Confirmed', JSON.stringify(row(G.nonfiler)?.findings));
  check(g, 'invalid GSTIN with ITC booked → Critical', row(BAD)?.band === 'Critical' && has(BAD, 'INVALID_GSTIN'), JSON.stringify(row(BAD)?.findings));
  check(g, 'every finding names its source', res.rows.every((r) => r.findings.every((f) => f.code === 'NO_LOOKUP' || (f.source && f.source !== '-'))));
  check(g, 'portal findings carry the lookup date', /GST portal Search Taxpayer \(20-Nov-2026\)/.test(row(G.cancelled).cells['Reason for ITC Risk']), row(G.cancelled).cells['Reason for ITC Risk']);
  check(g, 'Critical rows first', res.rows[0].band === 'Critical' && res.rows[res.rows.length - 1].band !== 'Critical');
  check(g, 'counts per band add up', Object.values(res.bands).reduce((a, b) => a + b, 0) === res.rows.length);

  // View missing: every vendor verification required, unless the GSTIN / 2A shows something.
  const noView = V.assessVendors({ ...input, lookups: null });
  check(g, 'lookups view missing → good vendor is No Data, not Low', noView.rows.find((r) => r.gstin === G.good).band === 'No Data');
  check(g, 'lookups view missing → a note says so', noView.notes.some((x) => /not set up/.test(x)));
  const twoACancel = V.assessVendors({ ...input, lookups: [], docs2A: [doc(G.nolookup, { source: '2A', bucket: null, supplierCancelledFrom: '2025-06-01', date: '2025-07-01' })] });
  check(g, '2A cancellation date without a lookup → Critical (potential)', twoACancel.rows.find((r) => r.gstin === G.nolookup).band === 'Critical' && twoACancel.rows.find((r) => r.gstin === G.nolookup).nature === 'Potential risk');
  const masterOnly = V.assessVendors({ ...input, master: [{ gstin: V.withCheckChar('27AAACQ3434Q1Z'), name: 'Quiet Vendor', code: 'V001' }], masterFile: { fileName: 'vendors.xlsx', uploadedAt: '2026-11-27T05:00:00Z' } });
  const mo = masterOnly.rows.find((r) => r.name === 'Quiet Vendor');
  check(g, 'vendor master only → a row flagged "No purchases seen in FY"', mo && /No purchases seen in FY/.test(mo.cells.Remarks) && mo.band === 'No Data', JSON.stringify(mo?.cells));
  const nameMis = V.assessVendors({ ...input, master: [{ gstin: G.good, name: 'Completely Different Industries', code: null }], masterFile: { fileName: 'v.csv', uploadedAt: '2026-11-27T05:00:00Z' } });
  check(g, 'name differing from the portal → Medium', nameMis.rows.find((r) => r.gstin === G.good).band === 'Medium' && nameMis.rows.find((r) => r.gstin === G.good).findings.some((f) => f.code === 'NAME_MISMATCH'));
}

// ── 4. Layout ───────────────────────────────────────────────────────────────
{
  const g = 'Layout';
  const t = V.vendorRiskTable(res, { client: input.client, fy: FY, today: TODAY });
  check(g, '26 columns in the order asked', t.headers.length === 26 && t.headers[0] === 'Vendor Name' && t.headers[25] === 'Remarks' && t.headers[19] === 'ITC Risk Category');
  check(g, 'one row per GSTIN', t.rows.length === res.rows.length && new Set(t.rows.map((r) => r[1])).size === t.rows.length);
  check(g, 'column groups span every column', t.columnGroups.reduce((s, x) => s + x.span, 0) === 26);
  check(g, 'tones parallel to rows', t.rowTones.length === t.rows.length && t.toneColumn === 19);
  check(g, 'management summary and the three lists', t.summary?.title === 'Management summary'
    && ['Immediate action', 'Obtain clarification', 'Hold before ITC', 'Recommendations'].every((s) => t.extraSheets.some((x) => x.name === s)));
  const hold = t.extraSheets.find((x) => x.name === 'Hold before ITC');
  check(g, 'hold list phrased "pending verification"', hold.rows.length > 0 && hold.rows.every((r) => /pending verification/.test(String(r[3]))));
  check(g, 'sheet names fit Excel (≤ 31)', t.extraSheets.every((s) => s.name.length <= 31));
  const wb = await V.buildReportWorkbook(t);
  const names = wb.worksheets.map((w) => w.name);
  check(g, 'Excel: Vendors, Summary and the list sheets', ['Vendors', 'Immediate action', 'Obtain clarification', 'Hold before ITC', 'Recommendations'].every((x) => names.includes(x)) && names.some((x) => /summary/i.test(x)), names.join(', '));
  const pdf = await V.buildReportPdf(t);
  check(g, 'PDF builds', pdf.getNumberOfPages() >= 2, pdf.getNumberOfPages());
  check(g, 'limitations name the IRP CAPTCHA', t.extraSheets.find((x) => x.name === 'Recommendations').rows.some((r) => /CAPTCHA/.test(String(r[1]))));
}

let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.info.slice(0, 900)}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
