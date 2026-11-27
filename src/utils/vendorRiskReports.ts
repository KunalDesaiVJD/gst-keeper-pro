// Reports Hub: Vendor GSTIN Risk Report. One client, one FY: every supplier
// GSTIN with its registration, filing, e-invoice and ITC risk, a management
// summary and the three action lists, laid out for the Big4 Excel / PDF
// (src/lib/reportExport). Reads only (src/lib/vendorRisk/load.ts); the engine
// is src/lib/vendorRisk/engine.ts. Positions: docs/VENDOR_GSTIN_RISK.md.
import { fyOfPeriod } from '@/lib/reply/periods';
import { assessVendors, COLUMNS, dmy, rupees, type VendorRiskResult, type VendorRow } from '@/lib/vendorRisk/engine';
import { loadVendorRiskInput } from '@/lib/vendorRisk/load';
import { BAND_LABEL, BAND_ORDER, FINDINGS, LIMITATIONS, PRACTICAL, type RiskBand } from '@/lib/vendorRisk/rules';
import type { ReportSheet, ReportTable, RowTone } from './allClientsReports';

const TONE: Record<RiskBand, RowTone> = { Critical: 'bad', High: 'bad', Medium: 'warn', Low: 'good', 'No Data': 'muted' };
const RISK_COL = COLUMNS.indexOf('ITC Risk Category');
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/** The PDF prints these (the Excel has all 26). */
const PDF_COLUMNS = [
  'Vendor Name', 'GSTIN', 'GST Registration Status', 'Composition Scheme (Yes/No)', 'E-Invoice Risk (Yes/No)', 'GSTR-3B Filing Status',
  'GSTR-2B Availability/Matching Status', 'ITC Eligibility Status', 'ITC Risk Category', 'Reason for ITC Risk', 'Recommended Corrective Action',
].map((h) => COLUMNS.indexOf(h as (typeof COLUMNS)[number]));

const WIDTHS: Record<string, number> = {
  'Vendor Name': 30, GSTIN: 17, State: 16, 'Reason for ITC Risk': 60, 'Recommended Corrective Action': 60,
  'Relevant GST Section/Rule/Notification': 36, 'GSTR-2B Availability/Matching Status': 40, 'ITC Eligibility Status': 36,
  'GSTR-1 Filing Status': 34, 'GSTR-3B Filing Status': 34, 'Data Source': 40, Remarks: 40, 'E-Invoice Enablement Status': 28,
};

type Lists = { immediate: (string | number)[][]; clarify: (string | number)[][]; hold: (string | number)[][] };

function actionLists(rows: VendorRow[]): Lists {
  const out: Lists = { immediate: [], clarify: [], hold: [] };
  for (const r of rows) {
    for (const f of r.findings) {
      const rule = FINDINGS[f.code];
      const risk = r.cells['ITC Risk Category'];
      const src = f.source && f.source !== '-' ? f.source : '';
      if (rule.lists.includes('immediate')) out.immediate.push([r.name, r.gstin, risk, `${rule.label}: ${f.detail}`, rule.provision, rule.action, src]);
      if (rule.lists.includes('clarify')) out.clarify.push([r.name, r.gstin, risk, `${rule.label}: ${f.detail}`, rule.action, src]);
      if (rule.lists.includes('hold')) {
        out.hold.push([r.name, r.gstin, risk, `Hold the ITC claim (and the tax portion of the payment) pending verification: ${rule.label.toLowerCase()}`, r.itc, rule.provision, src]);
      }
    }
  }
  return out;
}

const sheet = (name: string, title: string, headers: string[], rows: (string | number)[][], columnWidths: number[], notes: string[], empty: string): ReportSheet => ({
  name, title, headers,
  rows: rows.length ? rows : [[empty, ...headers.slice(1).map(() => '')]],
  columnWidths, notes,
});

export function vendorRiskTable(res: VendorRiskResult, info: { client: { name: string; gstin: string | null }; fy: string; today: string }): ReportTable {
  const { rows } = res;
  const table = rows.map((r) => COLUMNS.map((c) => r.cells[c]));
  const lists = actionLists(rows);
  const listSheets: ReportSheet[] = [
    sheet('Immediate action', 'Immediate action', ['Vendor Name', 'GSTIN', 'ITC Risk Category', 'Finding', 'Provision', 'Action', 'Source'],
      lists.immediate, [30, 17, 22, 60, 36, 60, 34], ['Critical findings and confirmed reversals: act before the next GSTR-3B.'], 'No vendor needs immediate action.'),
    sheet('Obtain clarification', 'Obtain clarification / documents', ['Vendor Name', 'GSTIN', 'ITC Risk Category', 'Point to clarify', 'What to obtain or do', 'Source'],
      lists.clarify, [30, 17, 22, 60, 60, 34], ['Ask the vendor for the document or explanation named; a point here is not a finding of non-compliance.'], 'Nothing to clarify.'),
    sheet('Hold before ITC', 'Hold before payment / ITC claim', ['Vendor Name', 'GSTIN', 'ITC Risk Category', 'Hold', 'ITC involved (FY)', 'Provision', 'Source'],
      lists.hold, [30, 17, 22, 60, 16, 40, 34],
      ['Listed only where a provision supports withholding the ITC: hold pending verification, then release once the point is cleared.',
        'Withholding the tax portion of a payment is a commercial step; the 180-day payment condition (s.16(2), second proviso) still runs.'],
      'Nothing to hold.'),
    sheet('Recommendations', 'Practical recommendations and limitations', ['Kind', 'Point'],
      [...PRACTICAL.map((p) => ['Recommendation', p]), ...LIMITATIONS.map((l) => ['Limitation', l]), ...res.notes.map((n) => ['This report', n])],
      [18, 120], [], 'None.'),
  ];

  const summaryRows: (string | number)[][] = res.summary.map((s) => [s.label, s.count, s.itc ?? '', s.note]);
  summaryRows.push(['By risk band', '', '', '']);
  for (const b of BAND_ORDER) {
    const xs = rows.filter((r) => r.band === b);
    summaryRows.push([BAND_LABEL[b], xs.length, Math.round(xs.reduce((s, r) => s + r.itc, 0) * 100) / 100, b === 'No Data' ? 'Run Pull (Search Taxpayer); never read as non-compliance' : '']);
  }
  const summaryKinds = summaryRows.map((r) => (r[0] === 'By risk band' ? 'section' as const : 'data' as const));
  const summaryTones = summaryRows.map((r) => {
    const b = BAND_ORDER.find((x) => BAND_LABEL[x] === r[0]);
    return b ? TONE[b] : null;
  });

  const lookedUp = rows.filter((r) => r.lookedUp).length;
  return {
    title: 'Vendor GSTIN Risk Report',
    subtitle: `Client: ${info.client.name} | GSTIN: ${info.client.gstin || '—'} | FY ${info.fy} | As on: ${dmy(info.today)}`,
    meta: [
      { label: 'Client', value: info.client.name },
      { label: 'GSTIN', value: info.client.gstin || '—' },
      { label: 'Financial year', value: `FY ${info.fy}` },
      { label: 'As on', value: dmy(info.today) },
      { label: 'Verified on portal', value: `${lookedUp} of ${rows.length} GSTINs` },
    ],
    kpis: [
      { label: 'Vendor GSTINs', value: rows.length },
      ...BAND_ORDER.map((b) => ({ label: BAND_LABEL[b], value: res.bands[b], tone: TONE[b] })),
      { label: 'ITC at Critical / High', value: rupees(rows.filter((r) => r.band === 'Critical' || r.band === 'High').reduce((s, r) => s + r.itc, 0)), tone: 'bad' as RowTone },
    ],
    headers: [...COLUMNS],
    rows: table,
    rowTones: rows.map((r) => TONE[r.band]),
    rowKinds: rows.map(() => 'data'),
    toneColumn: RISK_COL,
    freezeColumns: 2,
    sheetName: 'Vendors',
    pdfColumns: PDF_COLUMNS,
    columnWidths: COLUMNS.map((c) => WIDTHS[c] ?? 20),
    columnGroups: [
      { label: 'Vendor', span: 3 },
      { label: 'Registration', span: 8 },
      { label: 'E-invoice', span: 3 },
      { label: 'Returns and 2B', span: 4 },
      { label: 'ITC risk', span: 5, tone: 'bad' },
      { label: 'Verification', span: 3 },
    ],
    summary: {
      title: 'Management summary',
      headers: ['Particulars', 'Count', 'ITC involved (FY)', 'Notes'],
      rows: summaryRows,
      columnWidths: [44, 10, 18, 60],
      rowKinds: summaryKinds,
      rowTones: summaryTones,
      notes: [
        `Sources: ${res.sources.join('; ')}.`,
        'ITC involved is the vendor\'s ITC available in the year\'s GSTR-2B, else its ITC in the books.',
        'Confirmed: a portal record or the GSTIN itself shows it. Potential risk: the evidence points to it. Verification required: not enough data to say; never read as non-compliance.',
        ...res.notes,
      ],
    },
    extraSheets: listSheets,
    fileNameBase: `Vendor_GSTIN_Risk_${fileSafe(info.client.name)}_FY_${info.fy}`,
  };
}

export const buildVendorRiskReport = async (clientId: string, month: string): Promise<ReportTable> => {
  if (!/^\d{2}\/\d{4}$/.test(month || '')) throw new Error('Pick a month of the financial year first.');
  const fy = fyOfPeriod(month);
  const input = await loadVendorRiskInput(clientId, fy);
  const res = assessVendors(input);
  if (!res.rows.length) {
    throw new Error(`No vendor GSTIN found for ${input.client.name} in FY ${fy}: pull the year's GSTR-2A / 2B, import 2B or upload the vendor master first.`);
  }
  return vendorRiskTable(res, { client: input.client, fy, today: input.today });
};
