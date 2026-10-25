// Checks how a case document is recognised as a type of evidence and named
// (src/lib/evidenceTypes.ts), on files as the AI reader and the portal named
// them in real cases. Run: node --experimental-strip-types scripts/verify-evidence-types.mjs
import { detectEvidenceTypes, downloadName, joinTypeLabels } from '../src/lib/evidenceTypes.ts';

let failed = 0;
const eq = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const keys = (v) => detectEvidenceTypes(v).map((t) => t.key);

eq('invoices + e-way bills + bank statement, purchase side from the summary',
  keys({ aiTitle: 'Ratnakar Enterprise cement invoices, e-way bills and bank statement', aiSummary: 'These are tax invoices from Ratnakar Enterprise to Tamnna Infrastructure' }),
  ['purchase_invoices', 'eway_bills', 'bank_statement']);
eq('Table 8A statement, not 2A, not invoices from the summary',
  keys({ aiTitle: 'GSTR-9 Table 8A ITC statement, GSTR-2A inward supplies 2020-21', aiSummary: 'It lists invoices from May 2020' }), ['gstr_8a']);
eq('annexure naming 8A is the 8A statement', keys({ aiTitle: 'Annexure-2: GSTR-2A inward supplies list, Table 8A of GSTR-9' }), ['gstr_8a']);
eq('filename only: FIRC', keys({ filename: '0067GRSC25048899_FIRS.pdf' }), ['foreign_remittance']);
eq('filename only: DRC-03', keys({ filename: 'DRC03_05AADCS9204N1Z4.pdf' }), ['tax_payment']);
eq('filename only: tender documents', keys({ filename: 'TENDER DOCS.pdf' }), ['contracts']);
eq('filename only: undertaking', keys({ filename: 'Undertaking.pdf' }), ['declarations']);
eq('nothing known: other', keys({ filename: 'Binder2.pdf' }), ['other']);
eq('the title wins over the filename', keys({ aiTitle: 'Bank statement of HDFC current account', filename: 'invoices.pdf' }), ['bank_statement']);
eq('joined name', joinTypeLabels(detectEvidenceTypes({ aiTitle: 'invoices, e-way bills and bank statement', aiSummary: 'invoices from X' })),
  'Purchase invoices, E-way bills & Bank statement / payment proof');
eq('download name drops reserved characters and keeps the extension', downloadName('E-1 Bank statement / payment proof', 'x.PDF'), 'E-1 Bank statement payment proof.pdf');

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall ok');
