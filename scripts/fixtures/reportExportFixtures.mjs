// Fictional ReportTables covering every shape the Reports Hub exports, for
// scripts/verify-report-exports.mjs (Excel) and scripts/verify-report-pdf.mjs
// (PDF). Plain data: the merged multi-period table is built by the caller with
// the bundled mergeTables, so the fixture stays free of TypeScript. Every name,
// GSTIN and figure here is invented.

const CLIENTS = ['Alpha Traders', 'Bharat Steel Works', 'Coastal Foods LLP', 'Deccan Pharma Pvt Ltd', 'Everest Textiles'];
const GSTINS = ['24AAACA1111A1Z1', '24AABCB2222B1Z2', '27AACCC3333C1Z3', '29AADCD4444D1Z4', '24AAECE5555E1Z5'];

const r2 = (n) => Math.round(n * 100) / 100;

/** An all-clients snapshot: Sr / Name / GSTIN / figures, with a TOTAL row. */
export const snapshot = () => {
  const rows = CLIENTS.map((name, i) => [i + 1, name, GSTINS[i], r2(1200.5 * (i + 1)), r2(1200.5 * (i + 1)), r2(980.25 * i), i === 3 ? -450.75 : 0]);
  rows.push(['', 'TOTAL', '', ...[3, 4, 5, 6].map((c) => r2(rows.reduce((s, r) => s + r[c], 0)))]);
  return {
    title: 'Suspended ITC Closing Balance: All Clients',
    subtitle: 'Month: Jul 2026   |   One row per client',
    headers: ['Sr.', 'Client Name', 'GSTIN', 'CGST', 'SGST', 'IGST', 'Net Payable'],
    rows,
    fileNameBase: 'Suspended_Closing_All_Clients_07-2026',
    columnWidths: [5, 34, 18, 12, 12, 12, 12],
  };
};

/** One client, one month: dates in two spellings, a URL column, a sentinel and a section row. */
export const perClientMonth = (period = '07/2026') => {
  const [mm, yyyy] = period.split('/');
  const rows = [
    ['B2B invoices', '', '', '', '', '', '', ''],
    [1, '24AAACA1111A1Z1', 'Alpha Traders', 'INV/101', `05-${mm}-${yyyy}`, 10000, 1800, 'https://example.invalid/doc/101.pdf'],
    [2, '24AABCB2222B1Z2', 'Bharat Steel Works', 'BSW-2026-778', `12-Jul-${yyyy.slice(2)}`, 25500.5, 4590.09, ''],
    ['Credit notes', '', '', '', '', '', '', ''],
    [3, '27AACCC3333C1Z3', 'Coastal Foods LLP', 'CN-9', `${yyyy}-${mm}-20`, -2000, -360, 'NOT PULLED'],
    ['', 'TOTAL', '', '', '', 33500.5, 6030.09, ''],
  ];
  return {
    title: 'GSTR-2B (Portal, Document-Level)',
    subtitle: `Client: Everest Textiles   |   GSTIN: 24AAECE5555E1Z5   |   Period: ${period === '07/2026' ? 'Jul 2026' : period}   |   Pulled directly from the portal's JSON`,
    headers: ['Sr.', 'Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'Total Tax', 'PDF'],
    rows,
    fileNameBase: `GSTR2B_Portal_Everest_${period.replace('/', '-')}`,
    columnWidths: [5, 18, 30, 16, 12, 14, 12, 10],
  };
};

/** A reconciliation-like table: summary + notes + KPIs + column groups + tones + extra sheets. */
export const reconciliation = () => {
  const statuses = ['Matched', 'Only in 2A', 'Only in 2B', 'Figures differ', 'Not compared'];
  const tones = ['good', 'warn', 'warn', 'bad', 'muted'];
  const rows = [];
  const rowTones = [];
  for (let i = 0; i < 40; i++) {
    const s = i % 5;
    const a = s === 2 || s === 4 ? '' : r2(1000 + i * 37.5);
    const b = s === 1 ? '' : r2(1000 + i * 37.5 + (s === 3 ? 125.5 : 0));
    rows.push([i + 1, i < 20 ? 'Jul 2026' : 'Aug 2026', GSTINS[i % 5], CLIENTS[i % 5], s === 4 ? 'Credit note' : 'Invoice', `D-${1000 + i}`, `0${(i % 9) + 1}-07-2026`,
      a, a === '' ? '' : r2(a * 0.18), b, b === '' ? '' : r2(b * 0.18), s === 4 ? '' : r2((b || 0) * 0.18 - (a || 0) * 0.18),
      statuses[s], s === 0 ? 'Matched' : `Reason ${s}: a long explanation of why this document differs, with the months it was found in and what was checked`]);
    rowTones.push(tones[s]);
  }
  const sum = (c) => r2(rows.reduce((t, r) => t + (typeof r[c] === 'number' ? r[c] : 0), 0));
  rows.push(['', 'TOTAL', '', '', '', '', '', sum(7), sum(8), sum(9), sum(10), sum(11), '', '']);
  rowTones.push(null);
  return {
    title: 'GSTR-2A vs GSTR-2B Reconciliation',
    subtitle: 'Client: Everest Textiles   |   GSTIN: 24AAECE5555E1Z5   |   Jul 2026 to Aug 2026 (2 months)',
    meta: [
      { label: 'Client', value: 'Everest Textiles' }, { label: 'GSTIN', value: '24AAECE5555E1Z5' },
      { label: 'Periods', value: 'Jul 2026 to Aug 2026 (2 months)' }, { label: '2A pulled', value: '20 Sep 2026' }, { label: '2B generated', value: '14 Sep 2026' },
    ],
    kpis: [
      { label: 'Documents', value: 40 }, { label: 'Matched', value: 8, note: '20%', tone: 'good' },
      { label: 'Only in 2A', value: 8, tone: 'warn' }, { label: 'Only in 2B', value: 8, tone: 'warn' },
      { label: 'Figures differ', value: 8, tone: 'bad' }, { label: 'Not compared', value: 8, tone: 'muted' },
      { label: '2A tax', value: sum(8) }, { label: '2B tax', value: sum(10) }, { label: 'Net difference', value: sum(11), tone: 'bad' },
    ],
    headers: ['Sr.', 'Month', 'Supplier GSTIN', 'Supplier Name', 'Doc Type', 'Doc No.', 'Doc Date', '2A Taxable Value', '2A Total Tax', '2B Taxable Value', '2B Total Tax', 'Total Tax Difference (2B minus 2A)', 'Status', 'Reason'],
    headerLabels: ['Sr.', 'Month', 'Supplier GSTIN', 'Supplier name', 'Doc type', 'Doc no.', 'Doc date', 'Taxable value', 'Total tax', 'Taxable value', 'Total tax', 'Total tax', 'Status', 'Reason'],
    columnGroups: [{ label: 'Document', span: 7 }, { label: 'GSTR-2A', span: 2 }, { label: 'GSTR-2B', span: 2 }, { label: 'Difference (2B minus 2A)', span: 1, tone: 'bad' }, { label: 'Reconciliation', span: 2 }],
    rows,
    rowTones,
    freezeColumns: 4,
    sheetName: 'Documents',
    fileNameBase: 'GSTR2A_vs_GSTR2B_Reco_Everest_07-2026_2months',
    columnWidths: [5, 9, 17, 26, 11, 12, 11, 13, 12, 13, 12, 14, 13, 44],
    pdfColumns: [1, 3, 5, 6, 8, 10, 11, 12, 13],
    summary: {
      title: 'Summary by reason',
      headers: ['Status', 'Reason', 'Documents', '2A Total Tax', '2B Total Tax', 'Total Tax Difference (2B minus 2A)', 'What to do'],
      rows: [
        ['Matched', 'Matched', 8, 1500, 1500, 0, 'Nothing'],
        ['Only in 2A', 'Filed after the 2B cut-off: in a later 2B', 8, 1600, '', -1600, 'Claim in the month of the later 2B'],
        ['Only in 2B', 'Filed late for an earlier month', 8, '', 1700, 1700, 'Check it was not claimed already'],
        ['Figures differ', 'Value difference', 8, 1800, 1822.59, 22.59, 'Ask the supplier to amend'],
        ['Not compared', 'Credit and debit notes', 8, '', 1900, '', 'Nothing: the 2A pull reads B2B only'],
        ['', 'TOTAL', 40, 4900, 6922.59, 122.59, ''],
      ],
      rowTones: ['good', 'warn', 'warn', 'bad', 'muted', null],
      columnWidths: [13, 40, 10, 13, 13, 14, 40],
      notes: [
        'Jul 2026: 2B of Oct 2026 not checked (beyond the three months read). 2 documents filed after the cut-off are expected there, not confirmed.',
        'Aug 2026: Compared: B2B invoices. Not compared: 8 documents (credit and debit notes), because the 2A pull reads B2B invoices only.',
      ],
    },
    extraSheets: [
      {
        name: 'By supplier',
        title: 'By supplier',
        headers: ['Supplier GSTIN', 'Supplier Name', 'Documents', 'Matched', 'Only in 2A', 'Only in 2B', '2A Total Tax', '2B Total Tax', 'Difference'],
        rows: [
          ...CLIENTS.map((n, i) => [GSTINS[i], n, 8, 2, 2, 2, r2(900 + i), r2(950 + i), 50]),
          ['', 'TOTAL', 40, 10, 10, 10, 4510, 4760, 250],
        ],
        rowTones: ['bad', 'warn', 'good', 'warn', 'bad', null],
        columnWidths: [17, 30, 10, 9, 10, 10, 13, 13, 12],
      },
      {
        name: 'By month',
        title: 'By month',
        headers: ['Month', 'Documents', '2A Total Tax', '2B Total Tax', 'Difference'],
        rows: [['Jul 2026', 20, 2400, 2500, 100], ['Aug 2026', 20, 2500, 2622.59, 122.59], ['TOTAL', 40, 4900, 5122.59, 222.59]],
        columnWidths: [12, 10, 13, 13, 12],
      },
      {
        name: 'Notes and evidence (every row that has one)',
        title: 'Notes and evidence',
        pdf: false,
        headers: ['Month', 'Doc No.', 'Evidence', 'Also note'],
        rows: [['Jul 2026', 'D-1001', 'Found in the 2B of Aug 2026', 'Reverse charge'], ['Aug 2026', 'D-1022', 'Not confirmed: 2B of Nov 2026 not pulled', '']],
        columnWidths: [12, 12, 40, 30],
      },
    ],
  };
};

/** 34 columns: the PDF prints pdfColumns, Excel all of them. */
export const wide = () => {
  const headers = ['Sr.', 'Supplier GSTIN', 'Supplier Name', 'Doc No.', 'Doc Date', ...Array.from({ length: 29 }, (_, i) => `Figure ${i + 1} Value`)];
  const rows = Array.from({ length: 30 }, (_, r) => [r + 1, GSTINS[r % 5], CLIENTS[r % 5], `W-${r}`, `1${r % 9}-07-2026`, ...Array.from({ length: 29 }, (_, i) => r2((r + 1) * (i + 1) * 10.25))]);
  return {
    title: 'Wide register',
    subtitle: 'Client: Everest Textiles   |   GSTIN: 24AAECE5555E1Z5   |   FY 2026-27',
    headers,
    rows,
    fileNameBase: 'Wide_Register',
    columnWidths: headers.map((h, i) => (i < 5 ? [5, 17, 26, 10, 11][i] : 11)),
    pdfColumns: [0, 2, 3, 4, 5, 6, 7, 8, 33],
  };
};

/** Headers and nothing else. */
export const empty = () => ({
  title: 'Refund Applications Filed on Portal',
  subtitle: 'Client: Everest Textiles   |   GSTIN: 24AAECE5555E1Z5',
  headers: ['Sr.', 'ARN', 'Filed On', 'Type', 'Amount', 'Status'],
  rows: [],
  fileNameBase: 'Refunds_Everest',
  columnWidths: [5, 18, 12, 20, 12, 14],
});

/** n data rows plus a TOTAL: the speed check. */
export const big = (n = 3500) => {
  const rows = Array.from({ length: n }, (_, i) => [i + 1, GSTINS[i % 5], CLIENTS[i % 5], `B-${i}`, `${String((i % 28) + 1).padStart(2, '0')}-07-2026`, r2(1000 + i), r2(90 + i * 0.09), r2(90 + i * 0.09), 0, r2(180 + i * 0.18), i % 7 === 0 ? 'Rejected in IMS' : 'Matched']);
  const sum = (c) => r2(rows.reduce((t, r) => t + r[c], 0));
  rows.push(['', 'TOTAL', '', '', '', sum(5), sum(6), sum(7), sum(8), sum(9), '']);
  return {
    title: 'GSTR-2A (Portal, Document-Level)',
    subtitle: 'Client: Everest Textiles   |   GSTIN: 24AAECE5555E1Z5   |   Period: Jul 2026',
    headers: ['Sr.', 'Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax', 'Status'],
    rows,
    fileNameBase: 'GSTR2A_Portal_Big',
    columnWidths: [6, 18, 28, 12, 12, 14, 12, 12, 12, 12, 16],
  };
};

/** Every fixture by name; `merged` needs mergeTables from the bundle. */
export const FIXTURES = { snapshot, perClientMonth, reconciliation, wide, empty, big };

/** The two-month merged table, built with the app's own merge. */
export const merged = (mergeTables) => mergeTables([perClientMonth('07/2026'), perClientMonth('08/2026')], ['07/2026', '08/2026']);
