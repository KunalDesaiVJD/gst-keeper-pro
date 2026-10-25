import { prettyPeriodLabel } from '@/utils/builderLedger';
import { POSTING_BASIS_LABEL, creditNoteDeadline, type PostingBasis } from '@/utils/builderBuEvent';
import { FSI_RCM_RATE_PCT, FSI_STATUS_LABEL, type FsiStatus } from '@/utils/builderFsi';
import type {
  ReportKpi, ReportMetaField, ReportSheet, ReportTable, RowTone,
} from '@/utils/allClientsReports';
import type {
  AdvanceRollforward, BuWorkingReport, Drc03RegisterLine, Drc03Report, FsiWorkingReport, ItcReversalReport,
  PeriodReport, ReportContext, ReportKind, UnitLedgerReport, UnitPosition,
} from '@/lib/builderReportData';
import { HEADS, HEAD_LABEL, fyLabel, total as taxTotal, type Tax } from '@/utils/builderItcReversal';

// Builder working papers as ReportTables, so every download goes through the
// firm's Big4 layout (src/lib/reportExport: letterhead, identification strip,
// stat band, bold totals, notes) exactly as the Reports Hub does.
//
// Numbers stay NUMBERS: the Excel copy is meant to be footed and pivoted. A
// cell with nothing to report is '' (printed blank), never a made-up zero.

type Cell = string | number;

const blank = (n: number): Cell[] => Array.from({ length: n }, () => '');

/** The identification strip and the matching subtitle every report starts with. */
const identity = (ctx: ReportContext, extra: ReportMetaField[] = []): { meta: ReportMetaField[]; subtitle: string } => {
  const meta: ReportMetaField[] = [
    { label: 'Client', value: ctx.clientName },
    { label: 'GSTIN', value: ctx.clientGstin || '—' },
    ...(ctx.projectName ? [{ label: 'Project', value: ctx.projectName }] : []),
    ...(ctx.reraNumber ? [{ label: 'RERA', value: ctx.reraNumber }] : []),
    ...(ctx.periodMonth ? [{ label: 'Period', value: prettyPeriodLabel(ctx.periodMonth) }] : []),
    ...extra,
  ];
  return { meta, subtitle: meta.map((m) => `${m.label}: ${m.value}`).join(' | ') };
};

/** Basis-of-preparation notes, as their own sheet / PDF section. */
const notesSheet = (notes: string[]): ReportSheet[] => (notes.length ? [{
  name: 'Notes',
  title: 'Basis of preparation',
  headers: ['Note'],
  rows: notes.map((n) => [n]),
  columnWidths: [120],
}] : []);

const stem = (...parts: (string | null | undefined)[]): string =>
  parts.filter(Boolean).join('_');

// ─── 1. Unit-wise BU working ────────────────────────────────────────────────

export const buWorkingTable = (ctx: ReportContext, r: BuWorkingReport): ReportTable => {
  const dastavejOnly = r.rows.length === 1 && r.rows[0].cutOffSource === 'DASTAVEJ';
  const { meta, subtitle } = identity(ctx, [
    { label: dastavejOnly ? 'Dastavej date' : 'BU date', value: r.buDate },
    { label: 'BU reference', value: r.buRefNo || '—' },
    { label: 'Posted to', value: prettyPeriodLabel(r.postingPeriod) },
    { label: 'Posting basis', value: POSTING_BASIS_LABEL[r.postingBasis as PostingBasis] || r.postingBasis },
    { label: 'Credit note window closes', value: String(creditNoteDeadline(r.postingPeriod)) },
  ]);
  const headers = [
    'Unit', 'Type', 'Cut-off date', 'Cut-off via', 'Status', 'Rate %',
    'Agreement value', 'Value taxed to opening', 'Invoiced before', 'Open advance (incl. opening)',
    'Received to cut-off', 'Differential value', 'Taxable value', 'CGST', 'SGST',
    'Interest days', 'Interest', 'Tie-out',
  ];
  const rows: Cell[][] = r.rows.map((u) => [
    u.unitNo, u.unitType, u.cutOffDate, u.cutOffSource === 'DASTAVEJ' ? 'Dastavej' : 'BU',
    u.bookedAtCutOff ? 'Booked' : 'Unbooked — Sch. III',
    u.bookedAtCutOff ? u.ratePct : '',
    u.agreementValue, u.valueTaxedUptoOpening, u.invoicedBefore, u.openAdvanceBefore,
    u.receivedUptoCutOff,
    u.bookedAtCutOff ? u.differentialValue : '',
    u.bookedAtCutOff ? u.differentialTaxableValue : '',
    u.bookedAtCutOff ? u.differentialCgst : '',
    u.bookedAtCutOff ? u.differentialSgst : '',
    u.interestDays || '', u.interestAmount || '',
    Math.abs(u.tieOutDiff) < 1 ? 'OK' : u.tieOutDiff,
  ]);
  rows.push([
    'Total', '', '', '', `${r.taxable.length} taxable`, '',
    r.totals.agreementValue, r.totals.valueTaxed, '', '', '',
    r.totals.differentialValue, r.totals.taxableValue, r.totals.cgst, r.totals.sgst,
    '', r.totals.interest, '',
  ]);
  const tone = (u: BuWorkingReport['rows'][number]): RowTone => (u.bookedAtCutOff ? 'good' : 'muted');
  const kpis: ReportKpi[] = [
    { label: 'Units in the event', value: r.rows.length },
    { label: 'Booked at cut-off', value: r.taxable.length },
    { label: 'Unbooked (Sch. III)', value: r.unbooked.length, note: 'omitted from GSTR-1 and 3B' },
    { label: 'Differential value', value: r.totals.differentialValue },
    { label: 'Tax on differential', value: r.totals.cgst + r.totals.sgst },
  ];
  return {
    title: 'Unit-wise BU working',
    subtitle,
    meta,
    kpis,
    headers,
    rows,
    rowTones: [...r.rows.map(tone), null],
    toneColumn: 4,
    freezeColumns: 1,
    pdfColumns: [0, 2, 4, 5, 6, 7, 11, 12, 13, 14, 16],
    sheetName: 'BU working',
    columnWidths: [12, 12, 12, 11, 22, 8, 16, 18, 15, 14, 16, 15, 15, 13, 13, 11, 13, 10],
    fileNameBase: stem('BU_Working', ctx.projectName, r.buDate),
    extraSheets: notesSheet([
      'A unit is taxable in the BU month if it was booked before its cut-off, on its whole balance. '
      + 'The cut-off is the earlier of the BU date and the dastavej date.',
      'Units unbooked at the cut-off fall under Schedule III and are left out of GSTR-1 and 3B.',
      'Tie-out compares the stored working with the unit ledger; "OK" means within ₹1.',
    ]),
  };
};

// ─── 2 & 4. Period reports ──────────────────────────────────────────────────

const bucketSheet = (name: string, title: string, buckets: PeriodReport['summary']['table7']): ReportSheet => ({
  name,
  title,
  headers: ['Rate %', 'Effective %', 'Documents', 'Consideration', 'Non-GST (land)', 'Taxable value', 'CGST', 'SGST', 'Total tax'],
  rows: [
    ...buckets.map((b): Cell[] => [
      b.ratePct, b.effectiveRatePct, b.count, b.consideration, b.landDeduction,
      b.taxableValue, b.cgst, b.sgst, b.totalTax,
    ]),
    ['Total', '', buckets.reduce((s, b) => s + b.count, 0),
      buckets.reduce((s, b) => s + b.consideration, 0), buckets.reduce((s, b) => s + b.landDeduction, 0),
      buckets.reduce((s, b) => s + b.taxableValue, 0), buckets.reduce((s, b) => s + b.cgst, 0),
      buckets.reduce((s, b) => s + b.sgst, 0), buckets.reduce((s, b) => s + b.totalTax, 0)],
  ],
  columnWidths: [10, 12, 11, 16, 16, 16, 14, 14, 14],
});

const periodTable = (ctx: ReportContext, r: PeriodReport, title: string, fileStem: string): ReportTable => {
  const { meta, subtitle } = identity(ctx);
  const t = r.summary.totals;
  const docRows: Cell[][] = r.documents.map((d) => [
    d.docDate, d.unitNo,
    d.sourceType.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    d.gstr1Table, d.ratePct, d.consideration, d.landDeduction, d.taxableValue, d.cgst, d.sgst,
  ]);
  docRows.push(['Total', '', '', '', '',
    r.documents.reduce((s, d) => s + d.consideration, 0), r.documents.reduce((s, d) => s + d.landDeduction, 0),
    r.documents.reduce((s, d) => s + d.taxableValue, 0), r.documents.reduce((s, d) => s + d.cgst, 0),
    r.documents.reduce((s, d) => s + d.sgst, 0)]);

  const summarySheet: ReportSheet = {
    name: '3B summary',
    title: 'GSTR-3B Table 3.1 — what this period carries',
    headers: ['Head', 'Amount'],
    rows: [
      ['3.1(a) Outward taxable value', t.taxableValue],
      ['3.1(a) Outward non-GST (land)', t.landDeduction],
      ['3.1(a) Outward CGST', t.cgst],
      ['3.1(a) Outward SGST', t.sgst],
      ['3.1(a) Outward tax', t.totalTax],
      ['3.1(d) Reverse charge on development rights', r.fsiTotal],
    ],
    columnWidths: [56, 18],
    notes: ['Table 3.1(d) is payable in cash; the credit is blocked under the 1%/5% scheme.'],
  };

  const extra: ReportSheet[] = [
    summarySheet,
    bucketSheet('Table 7 B2CS', 'GSTR-1 Table 7 — B2C (Others)', r.summary.table7),
    bucketSheet('Table 11A advances', 'GSTR-1 Table 11A — advances received', r.summary.table11A),
    bucketSheet('Table 11B adjustments', 'GSTR-1 Table 11B — advances adjusted', r.summary.table11B),
  ];
  if (r.fsi.length) {
    extra.push({
      name: 'Table 3.1(d) FSI',
      title: 'Reverse charge on development rights',
      headers: ['Project', 'BU date', 'FSI allocated', 'Residential leg', 'Commercial leg', 'CGST', 'SGST', 'Total'],
      rows: [
        ...r.fsi.map((f): Cell[] => [
          f.projectName, f.buDate, f.allocatedValue, f.residentialRcm, f.commercialRcm, f.cgst, f.sgst, f.totalRcm,
        ]),
        ['Total', '', r.fsi.reduce((s, f) => s + f.allocatedValue, 0),
          r.fsi.reduce((s, f) => s + f.residentialRcm, 0), r.fsi.reduce((s, f) => s + f.commercialRcm, 0),
          r.fsi.reduce((s, f) => s + f.cgst, 0), r.fsi.reduce((s, f) => s + f.sgst, 0), r.fsiTotal],
      ],
      columnWidths: [28, 12, 16, 16, 16, 14, 14, 14],
    });
  }

  return {
    title,
    subtitle,
    meta,
    kpis: [
      { label: 'Outward taxable value', value: t.taxableValue },
      { label: 'Outward tax', value: t.totalTax },
      { label: 'Reverse charge on FSI', value: r.fsiTotal },
      { label: 'Documents', value: r.documents.length },
    ],
    headers: ['Date', 'Unit', 'Source', 'GSTR-1 table', 'Rate %', 'Consideration', 'Non-GST (land)', 'Taxable value', 'CGST', 'SGST'],
    rows: docRows,
    sheetName: 'Documents',
    freezeColumns: 2,
    columnWidths: [12, 12, 20, 14, 9, 16, 16, 16, 14, 14],
    fileNameBase: stem(fileStem, ctx.projectName || ctx.clientName, ctx.periodMonth?.replace('/', '-')),
    extraSheets: [
      ...extra,
      ...notesSheet(['Every figure is read back from what the engines already computed and stored, '
        + 'so the working paper cannot disagree with the return it supports.']),
    ],
  };
};

export const projectLiabilityTable = (ctx: ReportContext, r: PeriodReport): ReportTable =>
  periodTable(ctx, r, 'Project monthly liability', 'Project_Liability');

export const returnWorkpaperTable = (ctx: ReportContext, r: PeriodReport): ReportTable =>
  periodTable({ ...ctx, projectName: undefined }, r, 'Monthly return workpaper', 'Return_Workpaper');

// ─── 3. Unit ledger ─────────────────────────────────────────────────────────

export const unitLedgerTable = (ctx: ReportContext, r: UnitLedgerReport): ReportTable => {
  const { meta, subtitle } = identity(ctx, [
    { label: 'Unit', value: r.unitNo },
    { label: 'Type', value: r.unitType },
    { label: 'Carpet area (sq m)', value: String(r.carpetAreaSqM) },
    { label: 'Booked on', value: r.bookingDate || 'Unbooked' },
  ]);
  const rows: Cell[][] = r.entries.map((e) => [
    e.date, e.period ? prettyPeriodLabel(e.period) : '', e.kind, e.reference,
    e.consideration || '', e.taxableValue || '', e.cgst || '', e.sgst || '', e.tds || '',
    e.runningValueTaxed, e.status || '',
  ]);
  rows.push(['Total', '', '', '', r.totals.valueTaxed, '', r.totals.cgst, r.totals.sgst, r.totals.tds, r.totals.valueTaxed, '']);
  const extra: ReportSheet[] = r.members.length ? [{
    name: 'Members',
    title: 'Members',
    headers: ['Name', 'PAN', 'Share %'],
    rows: r.members.map((m): Cell[] => [m.name, m.pan || '—', m.ratio]),
    columnWidths: [30, 16, 10],
  }] : [];
  return {
    title: 'Unit ledger',
    subtitle,
    meta,
    kpis: [
      { label: 'Agreement value', value: r.agreementValue },
      { label: 'Value taxed', value: r.totals.valueTaxed },
      { label: 'Balance to tax', value: r.balanceToTax },
      { label: 'Received to date', value: r.totals.received },
      { label: 'Tax discharged', value: r.totals.cgst + r.totals.sgst },
    ],
    headers: ['Date', 'Period', 'Entry', 'Reference', 'Consideration', 'Taxable value', 'CGST', 'SGST', 'TDS 194-IA', 'Value taxed to date', 'Note'],
    rows,
    sheetName: 'Ledger',
    freezeColumns: 3,
    columnWidths: [12, 14, 20, 34, 16, 16, 13, 13, 13, 19, 34],
    fileNameBase: stem('Unit_Ledger', ctx.projectName, r.unitNo),
    extraSheets: extra,
  };
};

// ─── 5. Member statement (client-facing) ────────────────────────────────────

export const memberStatementTable = (ctx: ReportContext, r: UnitLedgerReport): ReportTable => {
  const receipts = r.entries.filter((e) => e.kind === 'Receipt');
  const totalTax = r.totals.cgst + r.totals.sgst;
  const { meta, subtitle } = identity(ctx, [
    { label: 'Member', value: r.members[0]?.name || '—' },
    { label: 'Unit', value: r.unitNo },
    { label: 'Booked on', value: r.bookingDate || '—' },
  ]);
  const rows: Cell[][] = receipts.map((e) => [
    e.date, e.reference, e.consideration || '', (e.cgst + e.sgst) || '', e.tds || '',
  ]);
  rows.push(['Total', '',
    receipts.reduce((s, e) => s + e.consideration, 0),
    receipts.reduce((s, e) => s + e.cgst + e.sgst, 0),
    receipts.reduce((s, e) => s + e.tds, 0)]);
  return {
    title: 'Statement of account',
    subtitle,
    meta,
    kpis: [
      { label: 'Agreed consideration (ex-GST)', value: r.agreementValue },
      { label: 'GST charged to date', value: totalTax },
      { label: 'Received to date', value: r.totals.received },
      { label: 'Outstanding', value: r.uncollected },
    ],
    headers: ['Date', 'Reference', 'Amount', 'GST', 'TDS deducted'],
    rows,
    sheetName: 'Statement',
    columnWidths: [14, 40, 18, 16, 16],
    fileNameBase: stem('Statement', r.unitNo, r.members[0]?.name),
    extraSheets: notesSheet([
      'GST is charged on the consideration for the unit at the rate applicable to it, on the value '
      + 'after the statutory one-third deduction towards land.',
      'Tax deducted at source under section 194-IA reduces the amount remitted to us, not the '
      + 'consideration agreed or the GST payable on it.',
    ]),
  };
};

// ─── 6. DRC-03 workpaper ────────────────────────────────────────────────────

export const drc03Table = (ctx: ReportContext, r: Drc03Report): ReportTable => {
  const { meta, subtitle } = identity(ctx, [
    { label: 'Unit', value: r.unitNo },
    { label: 'Rate change', value: `${r.fromRatePct}% to ${r.toRatePct}%` },
    { label: 'Posting period', value: prettyPeriodLabel(r.postingPeriod) },
    { label: 'DRC-03 status', value: r.drc03Status === 'FILED' ? `Filed${r.drc03Arn ? ` — ${r.drc03Arn}` : ''}` : 'Pending' },
  ]);
  const rows: Cell[][] = r.periods.map((p) => [
    prettyPeriodLabel(p.periodMonth), p.taxableValue, p.oldCgst + p.oldSgst, p.newCgst + p.newSgst,
    p.differentialTax, p.dueDate, p.interestDays, p.interestAmount,
  ]);
  rows.push(['Total', r.totals.valueRetaxed, '', '', r.totals.differentialTax, '', '', r.totals.interest]);
  return {
    title: 'DRC-03 workpaper',
    subtitle,
    meta,
    kpis: [
      { label: 'Differential tax', value: r.totals.differentialTax },
      { label: 'Interest', value: r.totals.interest },
      { label: 'Payable by DRC-03', value: r.totals.differentialTax + r.totals.interest },
    ],
    headers: ['Period', 'Taxable value', `Tax at ${r.fromRatePct}%`, `Tax at ${r.toRatePct}%`, 'Differential tax', 'Due date', 'Interest days', 'Interest'],
    rows,
    sheetName: 'DRC-03',
    columnWidths: [22, 16, 16, 16, 16, 14, 10, 14],
    fileNameBase: stem('DRC03', r.unitNo, r.postingPeriod.replace('/', '-')),
    extraSheets: notesSheet([
      'The concession under Notification 03/2019-CT(R) never applied to this unit once its gross '
      + 'consideration crossed ₹45,00,000 — the higher rate is due on everything already offered to tax, '
      + 'discharged by voluntary payment (DRC-03) rather than a GSTR-1 amendment.',
    ]),
  };
};

// ─── 7. TDR / FSI reverse-charge working paper ──────────────────────────────

export const fsiWorkingTable = (ctx: ReportContext, r: FsiWorkingReport): ReportTable => {
  const { meta, subtitle } = identity({ ...ctx, periodMonth: undefined });
  const headers = [
    'BU date', 'Posts to', 'Status', 'Treatment', 'Project FSI cost', 'Event carpet (sq m)', 'Project carpet (sq m)',
    'Allocated to this BU', 'Unbooked residential (sq m)', 'Unbooked residential value',
    'Residential portion', 'Residential RCM (uncapped)', 'Cap amount', 'Residential RCM',
    'Commercial portion', 'Commercial RCM', 'Total RCM → 3.1(d)', 'CGST', 'SGST', 'Client instruction',
  ];
  const rows: Cell[][] = r.lines.map((l) => [
    l.buRefNo ? `${l.buDate} · ${l.buRefNo}` : l.buDate,
    prettyPeriodLabel(l.periodMonth),
    FSI_STATUS_LABEL[l.status as FsiStatus] || l.status,
    l.treatment === 'PAY' ? 'Pay' : 'Hold back',
    l.tdrFsiTotalValue, l.eventCarpetSqm, l.projectCarpetSqm, l.allocatedValue,
    l.unbookedResidentialCarpetSqm, l.unbookedResidentialValue,
    l.residentialPortion, l.residentialRcmUncapped, l.capAmount, l.residentialRcm,
    l.commercialPortion, l.commercialRcm, l.totalRcm, l.cgst, l.sgst, l.consent,
  ]);
  const t = r.totals;
  rows.push([
    'Total', '', '', '', '', '', '', t.allocatedValue, '', '', '', '', '', t.residentialRcm,
    '', t.commercialRcm, t.totalRcm, t.cgst, t.sgst, '',
  ]);
  const tones = r.lines.map((l): RowTone => (
    l.consent && l.consent !== 'Instruction approved' ? 'bad'
      : l.status === 'POSTED' ? 'good'
        : l.status === 'DRAFT' ? 'warn' : 'info'));
  return {
    title: 'TDR / FSI reverse-charge working paper',
    subtitle,
    meta,
    kpis: [
      { label: 'BU events with a working', value: r.lines.length },
      { label: 'FSI allocated', value: t.allocatedValue },
      { label: 'Residential RCM', value: t.residentialRcm },
      { label: 'Commercial RCM', value: t.commercialRcm },
      { label: 'Total → Table 3.1(d)', value: t.totalRcm, note: 'payable in cash' },
    ],
    headers,
    rows: rows.length > 1 ? rows : [],
    rowTones: [...tones, null],
    toneColumn: 2,
    freezeColumns: 1,
    // The PDF keeps the money trail on one landscape page; Excel carries every column.
    pdfColumns: [0, 1, 2, 3, 7, 9, 11, 12, 13, 15, 16, 19],
    sheetName: 'FSI working',
    columnWidths: [20, 14, 22, 11, 16, 12, 12, 16, 14, 16, 16, 16, 14, 16, 16, 16, 16, 13, 13, 26],
    fileNameBase: stem('TDR_FSI_Working', ctx.projectName),
    extraSheets: notesSheet([
      'Notifications 04, 05 and 06/2019-CT(R). The liability crystallises on the date of the completion '
      + 'certificate, so each working hangs off a posted BU event.',
      `Residential: the portion attributable to units unbooked at the cut-off, at ${FSI_RCM_RATE_PCT}%, capped at `
      + '1% (affordable) or 5% of those units\' value, summed per unit. Units booked before the permission are exempt.',
      `Commercial: the portion attributable to commercial apartments, at ${FSI_RCM_RATE_PCT}% in full — no exemption, no cap.`,
      'Allocation across blocks is by carpet area, applied before the split into legs. Paid in cash through '
      + 'GSTR-3B Table 3.1(d); the credit is blocked under the 1%/5% scheme.',
      'A working held back on the client\'s instruction blocks the period from filing until the written '
      + 'instruction is on record and a GST Manager has approved it.',
    ]),
  };
};

// ─── 8. Unit register (lead schedule) ───────────────────────────────────────

const RATE_SHORT: Record<string, string> = {
  AFFORDABLE: 'Affordable', OTHER_RESIDENTIAL: 'Other residential',
  COMMERCIAL_RREP: 'Commercial (RREP)', COMMERCIAL_REP: 'Commercial (REP)',
};

const unitStatusOf = (u: UnitPosition): string => (
  u.closedPreOnboarding ? 'Closed before onboarding'
    : u.closedAtBu ? (u.bookingDate ? 'Closed at BU / dastavej' : 'Sch. III — unbooked at cut-off')
      : u.status === 'Cancelled' ? 'Cancelled'
        : u.bookingDate ? 'Booked' : 'Unbooked');

export const unitRegisterTable = (ctx: ReportContext, units: UnitPosition[]): ReportTable => {
  const { meta, subtitle } = identity({ ...ctx, periodMonth: undefined });
  const headers = [
    'Block', 'Unit', 'Type', 'Carpet (sq m)', 'Class', 'Rate %', 'Status', 'Booked on', 'Member',
    'Agreement value', 'Value taxed', 'Open advance', 'Balance to tax', 'Received (bank)', 'TDS 194-IA', '₹45L headroom', 'Flag',
  ];
  const rows: Cell[][] = units.map((u) => {
    const flags = [
      u.balanceToTax < -1 ? 'Taxed above agreement' : '',
      u.impliedByReceipts ? 'Master below money received' : '',
      u.unitType === 'Residential' && u.isAffordable && u.valueHeadroom < 100000 ? 'Within ₹1L of ₹45L' : '',
    ].filter(Boolean).join('; ');
    return [
      u.groupLabel || '', u.unitNo, u.unitType, u.carpetAreaSqM, RATE_SHORT[u.rateCode] || u.rateCode, u.ratePct,
      unitStatusOf(u), u.bookingDate || '', u.primaryMember || '',
      u.agreementValue, u.valueTaxed, u.openAdvance || '', u.balanceToTax, u.totalReceived, u.tds || '',
      u.unitType === 'Residential' ? u.valueHeadroom : '', flags,
    ];
  });
  const sum = (f: (u: UnitPosition) => number) => units.reduce((a, u) => a + f(u), 0);
  rows.push([
    'Total', `${units.length} units`, '', sum((u) => u.carpetAreaSqM), '', '', '', '', '',
    sum((u) => u.agreementValue), sum((u) => u.valueTaxed), sum((u) => u.openAdvance), sum((u) => u.balanceToTax),
    sum((u) => u.totalReceived), sum((u) => u.tds), '', '',
  ]);
  const tones = units.map((u): RowTone => (
    u.balanceToTax < -1 ? 'bad'
      : u.closedAtBu || u.closedPreOnboarding ? 'muted'
        : u.bookingDate ? 'good' : 'info'));
  const booked = units.filter((u) => !!u.bookingDate && u.status !== 'Cancelled').length;
  const byClass = new Map<string, { n: number; carpet: number; agreement: number; taxed: number }>();
  units.forEach((u) => {
    const k = `${RATE_SHORT[u.rateCode] || u.rateCode} — ${u.ratePct}%`;
    const c = byClass.get(k) || { n: 0, carpet: 0, agreement: 0, taxed: 0 };
    byClass.set(k, { n: c.n + 1, carpet: c.carpet + u.carpetAreaSqM, agreement: c.agreement + u.agreementValue, taxed: c.taxed + u.valueTaxed });
  });
  return {
    title: 'Unit register — lead schedule',
    subtitle,
    meta,
    kpis: [
      { label: 'Units', value: units.length },
      { label: 'Booked', value: booked, note: `${units.length - booked} unbooked or closed` },
      { label: 'Agreement value', value: sum((u) => u.agreementValue) },
      { label: 'Value taxed', value: sum((u) => u.valueTaxed) },
      { label: 'Balance to tax', value: sum((u) => u.balanceToTax), note: 'falls due at BU' },
    ],
    headers,
    rows: units.length ? rows : [],
    rowTones: [...tones, null],
    toneColumn: 6,
    freezeColumns: 2,
    pdfColumns: [0, 1, 2, 4, 5, 6, 9, 10, 11, 12, 13, 16],
    sheetName: 'Unit register',
    columnWidths: [14, 12, 12, 11, 18, 8, 24, 12, 24, 16, 16, 14, 16, 16, 12, 14, 30],
    fileNameBase: stem('Unit_Register', ctx.projectName),
    extraSheets: [
      {
        name: 'By class',
        title: 'Summary by rate class',
        headers: ['Class', 'Units', 'Carpet (sq m)', 'Agreement value', 'Value taxed'],
        rows: [
          ...[...byClass.entries()].map(([k, v]): Cell[] => [k, v.n, v.carpet, v.agreement, v.taxed]),
          ['Total', units.length, sum((u) => u.carpetAreaSqM), sum((u) => u.agreementValue), sum((u) => u.valueTaxed)],
        ],
        columnWidths: [34, 10, 14, 18, 18],
      },
      ...notesSheet([
        'Value taxed is the consideration offered to tax to date (opening balance, advances and invoices, net of '
        + 'advances absorbed): what a BU event deducts. Balance to tax is agreement value less value taxed.',
        'Open advance is value taxed that no invoice has absorbed yet, the opening balance included (positions §6).',
        'Received is money banked (consideration plus GST less TDS) and does not drive the tax.',
        'A unit taxed above its agreement value is flagged: the master or a receipt needs correcting.',
      ]),
    ],
  };
};

// ─── 9. Advances roll-forward ───────────────────────────────────────────────

export const advanceRollforwardTable = (ctx: ReportContext, r: AdvanceRollforward): ReportTable => {
  const { meta, subtitle } = identity({ ...ctx, periodMonth: undefined }, [{ label: 'Financial year', value: `FY ${r.fy}` }]);
  const rows: Cell[][] = r.months.map((m) => [
    prettyPeriodLabel(m.periodMonth), m.opening, m.received || '', m.reversed || '', m.adjusted || '', m.closing,
    m.receivedTax || '', m.reversedTax || '', m.adjustedTax || '',
  ]);
  rows.push(['Total', r.broughtForwardOpening, r.totals.received, r.totals.reversed, r.totals.adjusted, r.closing,
    r.totals.receivedTax, r.totals.reversedTax, r.totals.adjustedTax]);
  const proof = Math.round((r.broughtForwardOpening + r.totals.received - r.totals.reversed - r.totals.adjusted - r.closing) * 100) / 100;
  return {
    title: 'Advances roll-forward — GSTR-1 Tables 11A / 11B',
    subtitle,
    meta,
    kpis: [
      { label: 'Brought forward', value: r.broughtForwardOpening },
      { label: 'Received (11A)', value: r.totals.received },
      { label: 'Adjusted (11B)', value: r.totals.adjusted },
      { label: 'Carried forward', value: r.closing, tone: r.closing < -1 ? 'bad' : undefined, note: r.closing < -1 ? 'negative: check' : undefined },
    ],
    headers: ['Month', 'Opening', 'Received (11A)', 'Reversed (bounce / cancellation)', 'Adjusted (11B)', 'Closing',
      'Tax on 11A', 'Tax reversed', 'Tax on 11B'],
    columnGroups: [
      { label: '', span: 1 },
      { label: 'Consideration (before the 1/3rd land deduction)', span: 5 },
      { label: 'CGST + SGST', span: 3 },
    ],
    rows,
    sheetName: 'Roll-forward',
    freezeColumns: 1,
    columnWidths: [18, 16, 16, 20, 16, 16, 14, 14, 14],
    fileNameBase: stem('Advances_Rollforward', ctx.projectName || ctx.clientName, r.fy),
    extraSheets: notesSheet([
      'Brought forward = value taxed carried in at onboarding plus every advance posted before the year, less every '
      + 'reversal and adjustment before it. Read from the same postings the returns are built from.',
      `Proof: brought forward + received − reversed − adjusted − carried forward = ${proof.toFixed(2)} (should be 0.00).`,
      'Carried forward should equal the sum of the units\' open advance in the unit register at the year end.',
      'A negative balance means an adjustment drew on an advance this year never saw: an opening balance missing or a '
      + 'receipt dated after its invoice.',
    ]),
  };
};

// ─── 10. ITC reversal ───────────────────────────────────────────────────────

const taxCells = (t: Tax): Cell[] => HEADS.map((h) => t[h] || '');

export const itcReversalTable = (ctx: ReportContext, r: ItcReversalReport): ReportTable => {
  const { meta, subtitle } = identity({ ...ctx, periodMonth: undefined }, [
    { label: 'Completion date', value: r.completionDate },
    { label: 'Years', value: `${fyLabel(r.startFy)} to ${fyLabel(r.buFy)}` },
    { label: 'Posts to', value: prettyPeriodLabel(r.postingPeriod) },
    { label: 'Status', value: r.frozen ? r.status : `${r.status} — computed live` },
  ]);
  const res = r.result;
  const hl = HEADS.map((h) => HEAD_LABEL[h]);
  const rows: Cell[][] = [];
  const kinds: (import('@/utils/allClientsReports').RowKind | null)[] = [];
  res.years.forEach((y) => {
    const label = `${fyLabel(y.financialYear)}${y.isBuYear ? ' (BU year)' : ''}`;
    const line = (what: string, t: Tax, kind: 'data' | 'subtotal' = 'data') => {
      rows.push([label, what, ...taxCells(t), taxTotal(t)]); kinds.push(kind);
    };
    line('Common credit — Rule 42 base', y.baseR42);
    line('Attributable to exempt (× Te/Tt)', y.attributableR42);
    line('Already reversed — 7C', y.reversedR42);
    line('Net Rule 42', y.netR42, 'subtotal');
    line('Capital goods — Rule 43 base', y.baseR43);
    line('Attributable to exempt (× Te/Tt)', y.attributableR43);
    line('Already reversed — 7D', y.reversedR43);
    line('Net Rule 43', y.netR43, 'subtotal');
    if (taxTotal(y.interest)) line(`Interest u/s 50 (${y.interestDays} days)`, y.interest);
  });
  rows.push(['Total', 'Net reversal', ...taxCells(res.totalNet), taxTotal(res.totalNet)]); kinds.push('total');
  if (taxTotal(res.totalInterest)) { rows.push(['Total', 'Interest u/s 50 (pay by DRC-03 / 5.1)', ...taxCells(res.totalInterest), taxTotal(res.totalInterest)]); kinds.push('total'); }
  return {
    title: 'ITC reversal at completion — Rules 42 and 43',
    subtitle,
    meta,
    kpis: [
      { label: 'Exempt carpet / total', value: `${r.exemptCarpet} / ${r.totalCarpet} sq m` },
      { label: 'Key Te/Tt', value: `${(res.ratio * 100).toFixed(4)}%` },
      { label: 'Net reversal', value: taxTotal(res.totalNet), tone: res.problems.length ? 'warn' : undefined },
      { label: 'Interest u/s 50', value: taxTotal(res.totalInterest) },
    ],
    headers: ['Year', 'Line', ...hl, 'Total'],
    rows,
    rowKinds: kinds,
    sheetName: 'Rule 42-43',
    freezeColumns: 2,
    columnWidths: [20, 38, 14, 14, 14, 12, 15],
    fileNameBase: stem('ITC_Reversal', ctx.projectName, r.completionDate),
    extraSheets: [
      {
        name: 'GSTR-3B lines',
        title: 'What the approval writes to GSTR-3B',
        headers: ['Table', 'Label', ...hl, 'Total', 'Reason'],
        rows: res.lines.map((l): Cell[] => [l.tableRef, l.label, ...taxCells(l.amount), taxTotal(l.amount), l.reason]),
        columnWidths: [10, 34, 13, 13, 13, 11, 14, 40],
      },
      ...notesSheet([
        'Te is the carpet of units unbooked at the cut-off (plus, for a Partial-ITC client, booked residential carpet); '
        + 'Tt is the carpet of every unit in the BU event (positions §7A).',
        'Past years are as filed in GSTR-9: Table 6 for credit availed, 7C / 7D for what was already reversed; the base '
        + 'is 7J + 7C + 7D. The BU year is entered by hand.',
        ...(r.basisNote ? [`Basis: ${r.basisNote}`] : []),
        ...res.problems.map((p) => `Problem: ${p}`),
        ...res.warnings.map((w) => `Warning: ${w}`),
      ]),
    ],
  };
};

// ─── 11. Re-rating & DRC-03 register ────────────────────────────────────────

export const drc03RegisterTable = (ctx: ReportContext, lines: Drc03RegisterLine[]): ReportTable => {
  const { meta, subtitle } = identity({ ...ctx, periodMonth: undefined });
  const live = lines.filter((l) => l.status !== 'REVERSED');
  const rows: Cell[][] = lines.map((l) => [
    l.unitNo, l.triggeredOn, `${l.fromRatePct}% → ${l.toRatePct}%`, l.grossBefore, l.grossAfter,
    prettyPeriodLabel(l.postingPeriod), l.dischargeMode === 'DRC03' ? 'DRC-03' : 'GSTR-1 Table 10',
    l.status === 'REVERSED' ? 'Voided' : l.drc03Status === 'FILED' ? 'Filed' : 'To file',
    l.valueRetaxed, l.differentialTax, l.interest, l.differentialTax + l.interest,
    l.drc03Arn || '', l.drc03FiledDate || '',
  ]);
  const sum = (f: (l: Drc03RegisterLine) => number) => live.reduce((a, l) => a + f(l), 0);
  rows.push(['Total', '', '', '', '', '', '', `${live.length} live`, sum((l) => l.valueRetaxed),
    sum((l) => l.differentialTax), sum((l) => l.interest), sum((l) => l.differentialTax + l.interest), '', '']);
  const pending = live.filter((l) => l.dischargeMode === 'DRC03' && l.drc03Status !== 'FILED');
  return {
    title: 'Re-rating & DRC-03 register',
    subtitle,
    meta,
    kpis: [
      { label: 'Units re-rated', value: live.length },
      { label: 'Differential tax', value: sum((l) => l.differentialTax) },
      { label: 'Interest u/s 50', value: sum((l) => l.interest) },
      { label: 'DRC-03 still to file', value: pending.length, tone: pending.length ? 'warn' : 'good' },
    ],
    headers: ['Unit', 'Crossed on', 'Rate change', 'Gross before', 'Gross after', 'Posting period', 'Discharged by',
      'Status', 'Value re-taxed', 'Differential tax', 'Interest', 'Payable', 'DRC-03 ARN', 'Filed on'],
    rows: lines.length ? rows : [],
    rowTones: [...lines.map((l): RowTone => (l.status === 'REVERSED' ? 'muted' : l.drc03Status === 'FILED' ? 'good' : 'warn')), null],
    toneColumn: 7,
    freezeColumns: 1,
    sheetName: 'DRC-03 register',
    columnWidths: [12, 12, 14, 15, 15, 16, 16, 10, 15, 15, 13, 14, 22, 12],
    fileNameBase: stem('DRC03_Register', ctx.projectName),
    extraSheets: notesSheet([
      'A residential unit whose gross amount charged crosses ₹45,00,000 was never affordable: the higher rate is due on '
      + 'everything already offered to tax in filed periods, paid by DRC-03 with interest u/s 50 from each period\'s due '
      + 'date (positions §8). Unfiled periods simply follow the live rate.',
      'Voided lines were crossings entered in error and are left out of the totals.',
    ]),
  };
};

// ─── Big-4 frame, applied to every builder working paper ────────────────────

/** Working-paper references, so a file of papers cross-refers like an audit file. */
export const WP_REF: Record<ReportKind, string> = {
  RETURN_WORKPAPER: 'B-1',
  PROJECT_LIABILITY: 'B-2',
  UNIT_REGISTER: 'B-3',
  ADVANCE_ROLLFORWARD: 'B-4',
  UNIT_LEDGER: 'B-5',
  BU_WORKING: 'B-6',
  FSI_WORKPAPER: 'B-7',
  ITC_REVERSAL: 'B-8',
  DRC03_REGISTER: 'B-9',
  MEMBER_STATEMENT: 'C-1',
};

/**
 * Adds what makes a schedule an audit working paper: its W/P reference and
 * preparer in the identification strip, and a sign-off sheet (prepared,
 * reviewed, approved) with the tick-mark legend. A client-facing statement
 * gets the reference only.
 */
export const withWorkingPaperFrame = (table: ReportTable, kind: ReportKind, ctx: ReportContext): ReportTable => {
  const ref = WP_REF[kind];
  const meta = [
    { label: 'W/P ref', value: ref },
    ...(table.meta || []),
    ...(kind !== 'MEMBER_STATEMENT' && ctx.preparedBy ? [{ label: 'Prepared by', value: ctx.preparedBy }] : []),
  ];
  if (kind === 'MEMBER_STATEMENT') return { ...table, meta };
  const signOff: ReportSheet = {
    name: 'Sign-off',
    title: `Sign-off — W/P ${ref}`,
    headers: ['Role', 'Name', 'Date', 'Signature / initials'],
    rows: [
      ['Prepared by', ctx.preparedBy || '', '', ''],
      ['Reviewed by (GST Manager)', '', '', ''],
      ['Approved by (Partner)', '', '', ''],
    ],
    columnWidths: [28, 30, 14, 30],
    notes: [
      'Tick marks: ✓ agreed to the return as filed · ⊕ footed · ↔ cross-referred to another W/P · ⚑ needs follow-up.',
      'Figures are read back from what the engines computed and stored; nothing is recalculated for the paper.',
    ],
  };
  return { ...table, meta, extraSheets: [...(table.extraSheets || []), signOff] };
};
