import * as XLSX from 'xlsx';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { POSTING_BASIS_LABEL, creditNoteDeadline, type PostingBasis } from '@/utils/builderBuEvent';
import { REPORT_FIRM, nowStamp, reportFileName } from '@/utils/builderReportTheme';
import type {
  BuWorkingReport, Drc03Report, PeriodReport, ReportContext, UnitLedgerReport,
} from '@/lib/builderReportData';

// Excel renderers.
//
// Numbers are written as NUMBERS, never as pre-formatted strings — the whole
// point of the Excel copy is that the recipient can foot it, pivot it and tie it
// back. Formatting is applied through the cell number format instead.

type Cell = string | number | null;
type Sheet = Cell[][];

/** Indian accounting format, negatives in brackets, blank for zero. */
const NUM_FMT = '#,##0.00;(#,##0.00);"—"';

const applySheet = (
  wb: XLSX.WorkBook,
  name: string,
  rows: Sheet,
  opts: { widths?: number[]; numericFrom?: number; headerRows?: number[] } = {},
): void => {
  const ws = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  ws['!cols'] = (opts.widths || []).map((w) => ({ wch: w }));

  // Number format on the numeric columns, skipping heading rows.
  if (opts.numericFrom !== undefined) {
    const skip = new Set(opts.headerRows || []);
    rows.forEach((row, r) => {
      if (skip.has(r)) return;
      row.forEach((v, c) => {
        if (c < opts.numericFrom! || typeof v !== 'number') return;
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) ws[addr].z = NUM_FMT;
      });
    });
  }
  // Sheet names are capped at 31 chars by the format.
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
};

const titleBlock = (ctx: ReportContext, title: string, extra: [string, Cell][] = []): Sheet => [
  [REPORT_FIRM.name],
  [REPORT_FIRM.designation],
  [],
  [title],
  ['Client', ctx.clientName],
  ['GSTIN', ctx.clientGstin || '—'],
  ...(ctx.projectName ? [['Project', ctx.projectName] as Cell[]] : []),
  ...(ctx.reraNumber ? [['RERA', ctx.reraNumber] as Cell[]] : []),
  ...(ctx.periodMonth ? [['Period', prettyPeriodLabel(ctx.periodMonth)] as Cell[]] : []),
  ...extra.map(([k, v]) => [k, v] as Cell[]),
  ['Prepared', nowStamp()],
  [],
];

// ─── 1. Unit-wise BU working ────────────────────────────────────────────────

export const buWorkingExcel = (ctx: ReportContext, r: BuWorkingReport): void => {
  const isDastavejOnly = r.rows.length === 1 && r.rows[0].cutOffSource === 'DASTAVEJ';
  const wb = XLSX.utils.book_new();
  const head = titleBlock(ctx, 'Unit-wise BU working', [
    [isDastavejOnly ? 'Dastavej date' : 'BU date', r.buDate],
    ['BU reference', r.buRefNo || '—'],
    ['Posted to', prettyPeriodLabel(r.postingPeriod)],
    ['Posting basis', POSTING_BASIS_LABEL[r.postingBasis as PostingBasis] || r.postingBasis],
    ['Credit note window closes', creditNoteDeadline(r.postingPeriod)],
  ]);

  const headerRowIdx = head.length;
  const rows: Sheet = [
    ...head,
    ['Unit', 'Type', 'Cut-off date', 'Cut-off via', 'Status at cut-off', 'Rate %',
      'Agreement value', 'Value taxed to opening', 'Invoiced before', 'Open advance',
      'Received to cut-off', 'Differential', 'Taxable value', 'CGST', 'SGST',
      'Interest days', 'Interest', 'Tie-out'],
    ...r.rows.map((u): Cell[] => [
      u.unitNo, u.unitType, u.cutOffDate,
      u.cutOffSource === 'DASTAVEJ' ? 'Dastavej' : 'BU',
      u.bookedAtCutOff ? 'Booked' : 'Unbooked — Schedule III',
      u.bookedAtCutOff ? u.ratePct : null,
      u.agreementValue, u.valueTaxedUptoOpening, u.invoicedBefore, u.openAdvanceBefore,
      u.receivedUptoCutOff,
      u.bookedAtCutOff ? u.differentialValue : null,
      u.bookedAtCutOff ? u.differentialTaxableValue : null,
      u.bookedAtCutOff ? u.differentialCgst : null,
      u.bookedAtCutOff ? u.differentialSgst : null,
      u.interestDays || null, u.interestAmount || null,
      Math.abs(u.tieOutDiff) < 1 ? 'OK' : u.tieOutDiff,
    ]),
    ['Total', '', '', '', `${r.taxable.length} taxable`, '',
      r.totals.agreementValue, r.totals.valueTaxed, null, null, null,
      r.totals.differentialValue, r.totals.taxableValue,
      r.totals.cgst, r.totals.sgst, null, r.totals.interest, ''],
  ];

  applySheet(wb, 'BU working', rows, {
    widths: [12, 12, 12, 11, 22, 8, 16, 18, 15, 14, 16, 15, 15, 13, 13, 11, 13, 12],
    numericFrom: 6,
    headerRows: [headerRowIdx],
  });
  XLSX.writeFile(wb, reportFileName(['BU_Working', ctx.projectName, r.buDate], 'xlsx'));
};

// ─── 2 & 4. Period reports ──────────────────────────────────────────────────

const bucketRows = (buckets: PeriodReport['summary']['table7']): Sheet => [
  ['Rate %', 'Effective %', 'Documents', 'Consideration', 'Non-GST (land)', 'Taxable value', 'CGST', 'SGST', 'Total tax'],
  ...buckets.map((b): Cell[] => [
    b.ratePct, b.effectiveRatePct, b.count,
    b.consideration, b.landDeduction, b.taxableValue, b.cgst, b.sgst, b.totalTax,
  ]),
];

const periodExcel = (
  ctx: ReportContext, r: PeriodReport, title: string, fileStem: string,
): void => {
  const wb = XLSX.utils.book_new();
  const head = titleBlock(ctx, title);
  const t = r.summary.totals;

  const summary: Sheet = [
    ...head,
    ['GSTR-3B Table 3.1(a) — outward taxable supplies'],
    ...bucketRows(r.summary.outward),
    [],
    ['Outward taxable value', t.taxableValue],
    ['Outward non-GST (land)', t.landDeduction],
    ['Outward CGST', t.cgst],
    ['Outward SGST', t.sgst],
    ['Outward tax', t.totalTax],
    [],
    ['GSTR-3B Table 3.1(d) — reverse charge on development rights', r.fsiTotal],
    ['Payable in cash; the credit is blocked under the 1%/5% scheme.'],
  ];
  applySheet(wb, '3B summary', summary, { widths: [46, 14, 12, 16, 16, 16, 14, 14, 14], numericFrom: 1 });

  const leg = (name: string, buckets: PeriodReport['summary']['table7']) => {
    applySheet(wb, name, [[name], [], ...bucketRows(buckets)], {
      widths: [12, 13, 12, 16, 16, 16, 14, 14, 14], numericFrom: 0, headerRows: [0, 2],
    });
  };
  leg('Table 7 B2CS', r.summary.table7);
  leg('Table 11A advances', r.summary.table11A);
  leg('Table 11B adjustments', r.summary.table11B);

  if (r.fsi.length) {
    applySheet(wb, 'Table 3.1(d) FSI', [
      ['Reverse charge on development rights'], [],
      ['Project', 'BU date', 'FSI allocated', 'Residential leg', 'Commercial leg', 'CGST', 'SGST', 'Total'],
      ...r.fsi.map((f): Cell[] => [
        f.projectName, f.buDate, f.allocatedValue, f.residentialRcm,
        f.commercialRcm, f.cgst, f.sgst, f.totalRcm,
      ]),
      ['Total', '', null, null, null, null, null, r.fsiTotal],
    ], { widths: [28, 12, 16, 16, 16, 14, 14, 14], numericFrom: 2, headerRows: [0, 2] });
  }

  applySheet(wb, 'Documents', [
    ['Documents behind the totals'], [],
    ['Date', 'Unit', 'Source', 'GSTR-1 table', 'Rate %', 'Consideration', 'Non-GST (land)', 'Taxable value', 'CGST', 'SGST'],
    ...r.documents.map((d): Cell[] => [
      d.docDate, d.unitNo,
      d.sourceType.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      d.gstr1Table, d.ratePct, d.consideration, d.landDeduction, d.taxableValue, d.cgst, d.sgst,
    ]),
  ], { widths: [12, 12, 20, 14, 9, 16, 16, 16, 14, 14], numericFrom: 4, headerRows: [0, 2] });

  XLSX.writeFile(wb, reportFileName([fileStem, ctx.projectName || ctx.clientName, ctx.periodMonth], 'xlsx'));
};

export const projectLiabilityExcel = (ctx: ReportContext, r: PeriodReport): void =>
  periodExcel(ctx, r, 'Project monthly liability', 'Project_Liability');

export const returnWorkpaperExcel = (ctx: ReportContext, r: PeriodReport): void =>
  periodExcel(ctx, r, 'Monthly return workpaper', 'Return_Workpaper');

// ─── 3. Unit ledger ─────────────────────────────────────────────────────────

export const unitLedgerExcel = (ctx: ReportContext, r: UnitLedgerReport): void => {
  const wb = XLSX.utils.book_new();
  const head = titleBlock(ctx, 'Unit ledger', [
    ['Unit', r.unitNo],
    ['Type', r.unitType],
    ['Carpet area (sq m)', r.carpetAreaSqM],
    ['Booked on', r.bookingDate || 'Unbooked'],
    ['Agreement value', r.agreementValue],
    ['Value taxed', r.totals.valueTaxed],
    ['Balance to tax', r.balanceToTax],
    ['Received to date', r.totals.received],
  ]);
  const headerRowIdx = head.length;

  applySheet(wb, 'Ledger', [
    ...head,
    ['Date', 'Period', 'Entry', 'Reference', 'Consideration', 'Taxable value',
      'CGST', 'SGST', 'TDS 194-IA', 'Value taxed to date', 'Note'],
    ...r.entries.map((e): Cell[] => [
      e.date, e.period ? prettyPeriodLabel(e.period) : '',
      e.kind, e.reference,
      e.consideration || null, e.taxableValue || null,
      e.cgst || null, e.sgst || null, e.tds || null,
      e.runningValueTaxed, e.status || '',
    ]),
    ['Total', '', '', '', r.totals.valueTaxed, null,
      r.totals.cgst, r.totals.sgst, r.totals.tds, r.totals.valueTaxed, ''],
  ], {
    widths: [12, 14, 20, 34, 16, 16, 13, 13, 13, 19, 34],
    numericFrom: 4,
    headerRows: [headerRowIdx],
  });

  if (r.members.length) {
    applySheet(wb, 'Members', [
      ['Members'], [],
      ['Name', 'PAN', 'Share %'],
      ...r.members.map((m): Cell[] => [m.name, m.pan || '—', m.ratio]),
    ], { widths: [30, 16, 10], numericFrom: 2, headerRows: [0, 2] });
  }

  XLSX.writeFile(wb, reportFileName(['Unit_Ledger', ctx.projectName, r.unitNo], 'xlsx'));
};

// ─── 5. Member statement ────────────────────────────────────────────────────

export const memberStatementExcel = (ctx: ReportContext, r: UnitLedgerReport): void => {
  const wb = XLSX.utils.book_new();
  const receipts = r.entries.filter((e) => e.kind === 'Receipt');
  const totalTax = r.totals.cgst + r.totals.sgst;

  const head = titleBlock(ctx, 'Statement of account', [
    ['Member', r.members[0]?.name || '—'],
    ['Unit', r.unitNo],
    ['Booked on', r.bookingDate || '—'],
  ]);
  const headerRowIdx = head.length;

  applySheet(wb, 'Statement', [
    ...head,
    ['Date', 'Reference', 'Amount', 'GST', 'TDS deducted'],
    ...receipts.map((e): Cell[] => [
      e.date, e.reference, e.consideration || null,
      (e.cgst + e.sgst) || null, e.tds || null,
    ]),
    ['Total', '',
      receipts.reduce((s, e) => s + e.consideration, 0),
      receipts.reduce((s, e) => s + e.cgst + e.sgst, 0),
      receipts.reduce((s, e) => s + e.tds, 0)],
    [],
    ['Position'],
    ['Agreed consideration (excluding GST)', r.agreementValue],
    ['GST charged to date', totalTax],
    ['Amount received to date', r.totals.received],
    ['Outstanding against the agreed consideration', r.uncollected],
    [],
    ['GST is charged on the consideration for the unit at the rate applicable to it, on the value '
      + 'after the statutory one-third deduction towards land.'],
    ['Tax deducted at source under section 194-IA reduces the amount remitted to us, not the '
      + 'consideration agreed or the GST payable on it.'],
  ], {
    widths: [44, 34, 16, 14, 14],
    numericFrom: 1,
    headerRows: [headerRowIdx],
  });

  XLSX.writeFile(wb, reportFileName(['Statement', r.unitNo, r.members[0]?.name], 'xlsx'));
};

// ─── 5. DRC-03 workpaper ────────────────────────────────────────────────────

export const drc03WorkpaperExcel = (ctx: ReportContext, r: Drc03Report): void => {
  const wb = XLSX.utils.book_new();
  const head = titleBlock(ctx, 'DRC-03 workpaper', [
    ['Unit', r.unitNo],
    ['Rate change', `${r.fromRatePct}% to ${r.toRatePct}%`],
    ['Posting period', prettyPeriodLabel(r.postingPeriod)],
    ['DRC-03 status', r.drc03Status === 'FILED' ? `Filed${r.drc03Arn ? ` — ${r.drc03Arn}` : ''}` : 'Pending'],
  ]);
  const headerRowIdx = head.length;

  applySheet(wb, 'DRC-03', [
    ...head,
    ['Period', 'Taxable value', `Tax at ${r.fromRatePct}%`, `Tax at ${r.toRatePct}%`, 'Differential', 'Due date', 'Days', 'Interest'],
    ...r.periods.map((p): Cell[] => [
      prettyPeriodLabel(p.periodMonth), p.taxableValue,
      p.oldCgst + p.oldSgst, p.newCgst + p.newSgst,
      p.differentialTax, p.dueDate, p.interestDays, p.interestAmount,
    ]),
    ['Total', r.totals.valueRetaxed, '', '', r.totals.differentialTax, '', '', r.totals.interest],
    [],
    ['Total payable by DRC-03 (tax + interest)', r.totals.differentialTax + r.totals.interest],
    [],
    ['The concession under Notification 03/2019-CT(R) never applied to this unit once its gross '
      + 'consideration crossed ₹45,00,000 — the higher rate is due on everything already offered to tax, '
      + 'discharged by voluntary payment (DRC-03) rather than a GSTR-1 amendment.'],
  ], {
    widths: [22, 16, 16, 16, 14, 14, 8, 14],
    numericFrom: 1,
    headerRows: [headerRowIdx],
  });

  XLSX.writeFile(wb, reportFileName(['DRC03', r.unitNo, r.postingPeriod], 'xlsx'));
};
