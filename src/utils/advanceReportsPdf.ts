// The seven advance working papers.
//
// Same two conventions as the builder papers, and for the same reason — these
// get printed, photocopied and produced in assessment years later:
//   - status is a WORD in its own column, never a colour;
//   - a zero prints as an em dash, so an empty cell always means "nothing here"
//     rather than "not computed".
//
// docs/ADVANCE_SETOFF_POSITIONS.md §8 lists what each report is for.

import jsPDF from 'jspdf';
import {
  drawFooters, drawNote, drawSectionTitle, drawStatBand, nowStamp, reportFileName,
  reportTable, startDoc, type StatTile,
} from '@/utils/reportTheme';
import { parseKey, describeKey, type AdvanceLedger } from '@/lib/advanceBalance';
import { AGE_BUCKETS, bucketFor, type AdvanceReportContext, type LedgerReport, type RegisterReport, type ControlSheetRow } from '@/lib/advanceReportData';
import type { AdvanceOverride } from '@/lib/advanceSetoffOverrides';
import type { ContractProject, ContractRaBill, RecoveryRow, ProjectWorkingPaper } from '@/lib/contractProjects';
import type { AdvanceReceipt } from '@/lib/advanceRegister';

const INR = (v: number): string =>
  (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Zero prints as an em dash — an empty cell means nothing here, not not-computed. */
const n = (v: number): string => (Math.abs(v || 0) < 0.005 ? '—' : INR(v));

const clientFields = (ctx: AdvanceReportContext) => [
  { label: 'Client', value: ctx.clientName },
  { label: 'GSTIN', value: ctx.clientGstin || '—' },
  { label: 'Period', value: ctx.periodMonth },
];

const save = (doc: jsPDF, parts: (string | undefined)[]) => {
  drawFooters(doc, nowStamp());
  doc.save(reportFileName(parts, 'pdf'));
};

// ─── R1 — Advance Ledger, month-wise ────────────────────────────────────────

export const advanceLedgerPdf = (ctx: AdvanceReportContext, r: LedgerReport): void => {
  const { doc, y } = startDoc('l', {
    title: 'Advance ledger — month-wise',
    subtitle: 'Tax liability on advances received and its adjustment, period by period',
    fields: clientFields(ctx),
  });

  const tiles: StatTile[] = [
    { label: 'Open advance', value: INR(r.ledger.closingTotal.taxable) },
    {
      label: 'Tax on open advance',
      value: INR(r.ledger.closingTotal.igst + r.ledger.closingTotal.cgst + r.ledger.closingTotal.sgst),
    },
    { label: 'Oldest open', value: r.ledger.oldestOpenPeriod || '—' },
    { label: 'Months on record', value: String(r.ledger.monthsCovered) },
    ...(r.ledger.hasAmendments
      ? [{ label: 'Amendments', value: 'Present', note: 'Restated figures shown' }]
      : []),
  ];
  let cursor = drawStatBand(doc, tiles, y);

  cursor = drawNote(doc,
    'Figures are stated AS AMENDED — where a Table 11(2) amendment restates a month, that month shows '
    + 'the revised amount and the figure originally filed is shown alongside it. An amendment replaces '
    + 'the month it corrects rather than adding to it, so the differential column is what belongs in '
    + "that period's GSTR-3B as a prior-period adjustment. Advances against a supply of goods are "
    + 'excluded throughout — Notification 66/2017-CT removed tax on receipt for those.', cursor);

  cursor = drawSectionTitle(doc, 'Month-wise statement', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 1,
    head: [['Period', 'Opening', '11A received', 'as filed', '11B adjusted', 'as filed', 'Differential', 'Closing']],
    body: r.ledger.months.map((m) => [
      m.period,
      n(m.opening.taxable),
      n(m.effective.received.taxable),
      m.amended ? n(m.filed.received.taxable) : '—',
      n(m.effective.adjusted.taxable),
      m.amended ? n(m.filed.adjusted.taxable) : '—',
      m.amended ? n(m.differential.received.taxable - m.differential.adjusted.taxable) : '—',
      n(m.closing.taxable),
    ]),
  });

  if (r.openKeys.length) {
    const afterTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursor;
    const c2 = drawSectionTitle(doc, 'Open balance at the period end', afterTable + 8);
    reportTable(doc, {
      startY: c2,
      numericFrom: 2,
      head: [['Place of supply / rate', 'Open since', 'Taxable', 'IGST', 'CGST', 'SGST']],
      body: r.openKeys.map((k) => [
        k.label, k.since, n(k.amount.taxable), n(k.amount.igst), n(k.amount.cgst), n(k.amount.sgst),
      ]),
    });
  }

  save(doc, ['Advance_Ledger', ctx.clientName, ctx.periodMonth]);
};

// ─── R2 — Advance ageing ────────────────────────────────────────────────────

export const advanceAgeingPdf = (ctx: AdvanceReportContext, r: LedgerReport): void => {
  const { doc, y } = startDoc('p', {
    title: 'Advance ageing statement',
    subtitle: `Unadjusted advances as at ${ctx.periodMonth}`,
    fields: clientFields(ctx),
  });

  const byBucket = new Map<string, number>();
  r.openKeys.forEach((k) => {
    const b = bucketFor(k.ageMonths);
    byBucket.set(b, (byBucket.get(b) || 0) + k.amount.taxable);
  });

  const tiles: StatTile[] = AGE_BUCKETS.map((b) => ({
    label: b,
    value: INR(byBucket.get(b) || 0),
    note: b === 'Over 12 months' && (byBucket.get(b) || 0) > 0 ? 'Review' : undefined,
  }));
  let cursor = drawStatBand(doc, tiles, y);

  cursor = drawNote(doc,
    'An advance ages from the month it was first offered to tax in Table 11A, or from its recorded '
    + 'opening balance where it predates the app. An old unadjusted advance is not itself an error — '
    + 'the supply may still be outstanding — but it is where a missed set-off hides, because the '
    + 'invoice that should have absorbed it has usually long since been raised.', cursor);

  cursor = drawSectionTitle(doc, 'Ageing by place of supply and rate', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 3,
    head: [['Place of supply / rate', 'Open since', 'Bucket', 'Taxable', 'Tax']],
    body: r.openKeys.map((k) => [
      k.label,
      k.since,
      bucketFor(k.ageMonths),
      n(k.amount.taxable),
      n(k.amount.igst + k.amount.cgst + k.amount.sgst),
    ]),
    foot: [[
      'Total', '', '',
      n(r.openKeys.reduce((t, k) => t + k.amount.taxable, 0)),
      n(r.openKeys.reduce((t, k) => t + k.amount.igst + k.amount.cgst + k.amount.sgst, 0)),
    ]],
  });

  save(doc, ['Advance_Ageing', ctx.clientName, ctx.periodMonth]);
};

// ─── R3 — Set-off register ──────────────────────────────────────────────────

export const setoffRegisterPdf = (ctx: AdvanceReportContext, r: RegisterReport): void => {
  const { doc, y } = startDoc('l', {
    title: 'Advance set-off register',
    subtitle: 'Receipt vouchers and the invoices that absorbed them',
    fields: clientFields(ctx),
  });

  let cursor = drawStatBand(doc, [
    { label: 'Advance received', value: INR(r.totals.received) },
    { label: 'Adjusted', value: INR(r.totals.adjusted) },
    { label: 'Open', value: INR(r.totals.open) },
    { label: 'Receipts on record', value: String(r.positions.length) },
    ...(r.reconciliation.length
      ? [{ label: 'Reconciliation', value: 'Difference', note: 'See below' }]
      : [{ label: 'Reconciliation', value: 'Agrees' }]),
  ], y);

  cursor = drawNote(doc,
    'GSTR-1 Table 11A and 11B carry only place of supply, supply type and rate — no counterparty and '
    + 'no invoice number. This register is therefore the only record of WHICH advance an invoice '
    + 'absorbed. A refund, cancellation or write-back closes a receipt here but is not reported in '
    + 'Table 11B: it nets against the same month’s Table 11A instead, capped at that pool, with any '
    + 'excess forfeited.', cursor);

  cursor = drawSectionTitle(doc, 'Receipts and their set-off', cursor);
  const body: (string | number)[][] = [];
  r.positions.forEach((p) => {
    body.push([
      p.receipt.receipt_no || '—',
      p.receipt.receipt_date,
      p.receipt.party_name || p.receipt.party_gstin || '—',
      `${p.receipt.pos} @ ${p.receipt.rate_pct}%`,
      p.receipt.supply_nature === 'GOODS' ? 'Goods — not taxable' : n(p.receipt.taxable_value),
      n(p.adjusted),
      n(p.open),
      p.derivedStatus,
    ]);
    p.legs.forEach((leg) => {
      body.push([
        '', `  ${leg.period_month}`,
        `  ${leg.reason === 'INVOICE' ? `Invoice ${leg.invoice_no || '—'}` : leg.reason.replace(/_/g, ' ').toLowerCase()}`,
        '', '', n(leg.taxable_value_adjusted), '', '',
      ]);
    });
  });
  reportTable(doc, {
    startY: cursor,
    numericFrom: 4,
    head: [['Receipt', 'Date', 'Party / leg', 'POS / rate', 'Taxable', 'Adjusted', 'Open', 'Status']],
    body,
  });

  if (r.reconciliation.length) {
    const afterTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursor;
    const c2 = drawSectionTitle(doc, 'Register against the filed returns', afterTable + 8);
    reportTable(doc, {
      startY: c2,
      numericFrom: 1,
      head: [['Place of supply / rate', 'Per register', 'Per returns', 'Difference']],
      body: r.reconciliation.map((row) => [row.label, n(row.register), n(row.filed), n(row.difference)]),
    });
  }

  save(doc, ['Advance_Setoff_Register', ctx.clientName, ctx.periodMonth]);
};

// ─── R4 — As-filed vs as-amended reconciliation ─────────────────────────────

export const amendmentBridgePdf = (ctx: AdvanceReportContext, ledger: AdvanceLedger): void => {
  const { doc, y } = startDoc('l', {
    title: 'Advances — as filed vs as amended',
    subtitle: 'Table 11(2) restatements and the differential they carry',
    fields: clientFields(ctx),
  });

  const amended = ledger.months.filter((m) => m.amended);
  const diff11A = amended.reduce((t, m) => t + m.differential.received.taxable, 0);
  const diff11B = amended.reduce((t, m) => t + m.differential.adjusted.taxable, 0);

  let cursor = drawStatBand(doc, [
    { label: 'Months restated', value: String(amended.length) },
    { label: '11A differential', value: INR(diff11A) },
    { label: '11B differential', value: INR(diff11B) },
    {
      label: 'Net effect on liability',
      value: INR(diff11A - diff11B),
      note: 'To GSTR-3B Adjustments',
    },
  ], y);

  cursor = drawNote(doc,
    'A GSTR-1 amendment states the REVISED figure for the period it corrects, not a difference — so '
    + 'the restated month replaces its original rather than adding to it. The differential below is '
    + 'what has to reach a GSTR-3B Adjustment against 3.1(a) with source "Prior Period"; it is never '
    + 'folded into 3.1(a) automatically, because the amount that belongs there depends on what that '
    + "earlier period's own GSTR-3B actually reported.", cursor);

  cursor = drawSectionTitle(doc, 'Restated periods', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 2,
    head: [['Period restated', 'Amended in', '11A as filed', '11A as amended', '11A differential', '11B as filed', '11B as amended', '11B differential']],
    body: amended.length
      ? amended.map((m) => [
        m.period,
        m.amendedIn.join(', ') || '—',
        n(m.filed.received.taxable),
        n(m.effective.received.taxable),
        n(m.differential.received.taxable),
        n(m.filed.adjusted.taxable),
        n(m.effective.adjusted.taxable),
        n(m.differential.adjusted.taxable),
      ])
      : [['No Table 11(2) amendment on record for this client.', '', '', '', '', '', '', '']],
  });

  save(doc, ['Advance_Amendment_Bridge', ctx.clientName, ctx.periodMonth]);
};

// ─── R5 — Firm-wide open advance control sheet ──────────────────────────────

export const controlSheetPdf = (periodMonth: string, rows: ControlSheetRow[]): void => {
  const { doc, y } = startDoc('l', {
    title: 'Open advance control sheet',
    subtitle: 'Every client carrying an unadjusted advance',
    fields: [
      { label: 'As at', value: periodMonth },
      { label: 'Clients listed', value: String(rows.length) },
    ],
  });

  const total = rows.reduce((t, r) => t + r.open, 0);
  const over12 = rows.filter((r) => r.bucket === 'Over 12 months');
  let cursor = drawStatBand(doc, [
    { label: 'Total open advance', value: INR(total) },
    { label: 'Clients carrying advance', value: String(rows.length) },
    {
      label: 'Open over 12 months',
      value: INR(over12.reduce((t, r) => t + r.open, 0)),
      note: over12.length ? `${over12.length} client(s)` : undefined,
    },
  ], y);

  cursor = drawNote(doc,
    'Derived from each client’s filed GSTR-1 returns, not from the register — this is the position '
    + 'the returns themselves imply. Promoter clients are listed for completeness but their advances '
    + 'are generated and balanced by the Builder module, so they are not the Advance Register’s to '
    + 'reconcile.', cursor);

  cursor = drawSectionTitle(doc, 'Clients carrying an open advance', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 4,
    head: [['Client', 'GSTIN', 'Managed by', 'Oldest', 'Open advance', 'Adjusted this month', 'Age']],
    body: rows.map((r) => [
      r.clientName, r.clientGstin || '—', r.managedBy, r.oldest || '—',
      n(r.open), n(r.adjustedThisMonth), r.bucket,
    ]),
    foot: [['Total', '', '', '', n(total), n(rows.reduce((t, r) => t + r.adjustedThisMonth, 0)), '']],
  });

  save(doc, ['Open_Advance_Control_Sheet', periodMonth]);
};

// ─── R6 — Pre-filing exception & override certificate ───────────────────────

export const overrideCertificatePdf = (
  ctx: AdvanceReportContext,
  overrides: AdvanceOverride[],
): void => {
  const { doc, y } = startDoc('p', {
    title: 'Pre-filing exception certificate',
    subtitle: 'Advance set-off findings and the authority under which the return was filed',
    fields: clientFields(ctx),
  });

  const approved = overrides.filter((o) => o.status === 'APPROVED');
  let cursor = drawStatBand(doc, [
    { label: 'Exceptions raised', value: String(overrides.length) },
    {
      label: 'Overridden',
      value: String(approved.length),
      note: approved.length ? 'Filed under approval' : undefined,
    },
    {
      label: 'Outcome',
      value: overrides.length === 0 ? 'No exception' : approved.length ? 'Overridden' : 'Not overridden',
    },
  ], y);

  cursor = drawNote(doc,
    'The advance set-off check runs before a GSTR-1 upload, a GSTR-3B push, and before a return can be '
    + 'marked Filed. A blocking finding can be passed only on a GST Manager’s recorded approval, '
    + 'bound to the findings that manager actually saw — if the return changed afterwards the approval '
    + 'lapsed and the block returned. This certificate is that record.', cursor);

  if (overrides.length === 0) {
    cursor = drawSectionTitle(doc, 'Result', cursor);
    drawNote(doc, 'No advance set-off exception was raised for this client and period.', cursor);
    save(doc, ['Advance_Exception_Certificate', ctx.clientName, ctx.periodMonth]);
    return;
  }

  overrides.forEach((o, i) => {
    cursor = drawSectionTitle(doc, `Exception ${i + 1} — ${o.return_type}`, cursor + (i ? 6 : 0));
    reportTable(doc, {
      startY: cursor,
      head: [['Field', 'Detail']],
      body: [
        ['Status', o.status],
        ['Requested by', `${o.requested_by_name || '—'} on ${new Date(o.requested_at).toLocaleString('en-IN')}`],
        ['Reason given', o.request_reason || '—'],
        ['Decided by', o.decided_by_name || 'Not yet decided'],
        ['Decided on', o.decided_at ? new Date(o.decided_at).toLocaleString('en-IN') : '—'],
        ['Decision note', o.decision_note || '—'],
        ['Filed under this override', o.filed_after_override ? `Yes${o.arn ? ` · ARN ${o.arn}` : ''}` : 'No'],
        ['Findings fingerprint', o.findings_fingerprint || '—'],
      ],
      columnStyles: { 0: { cellWidth: 45 } },
    });
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursor;
    cursor = after + 4;

    const findings = Array.isArray(o.findings) ? o.findings : [];
    if (findings.length) {
      reportTable(doc, {
        startY: cursor,
        head: [['Severity', 'Finding', 'Detail']],
        body: findings.map((f) => [
          f.severity === 'hard' ? 'Blocking' : 'Advisory',
          f.title,
          f.detail,
        ]),
        columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 45 } },
      });
      cursor = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursor;
    }
  });

  save(doc, ['Advance_Exception_Certificate', ctx.clientName, ctx.periodMonth]);
};

// ─── R7 — Project-wise advance and recovery ─────────────────────────────────

export const projectWorkingPaperPdf = (
  ctx: AdvanceReportContext,
  data: {
    project: ContractProject;
    bills: ContractRaBill[];
    schedule: RecoveryRow[];
    workingPaper: ProjectWorkingPaper;
    receipts: AdvanceReceipt[];
  },
): void => {
  const { project, schedule, workingPaper: wp } = data;
  const { doc, y } = startDoc('l', {
    title: 'Project advance & recovery working paper',
    subtitle: `${project.name}${project.work_order_no ? ` · WO ${project.work_order_no}` : ''}`,
    fields: [
      ...clientFields(ctx),
      { label: 'Department', value: project.department || '—' },
      { label: 'Place of supply', value: project.pos_state },
    ],
  });

  let cursor = drawStatBand(doc, [
    { label: 'Contract value', value: INR(wp.contractValue) },
    { label: 'Billed to date', value: INR(wp.billedToDate), note: `${wp.billedPctOfContract}% of contract` },
    { label: 'Advance received', value: INR(wp.advanceReceived) },
    { label: 'Recovered', value: INR(wp.recovered) },
    { label: 'Balance advance', value: INR(wp.balanceAdvance) },
    {
      label: 'Recovery shortfall',
      value: INR(wp.recoveryShortfall),
      note: wp.recoveryShortfall > 0 ? 'Under-recovered' : 'On schedule',
    },
  ], y);

  cursor = drawNote(doc,
    `Recovery terms: ${project.recovery_rule === 'LUMPSUM_AT_BILL_N'
      ? `the whole advance at RA bill ${project.recovery_at_bill_no ?? '—'}`
      : `${project.recovery_pct}% of every RA bill`}. `
    + 'Place of supply is the location of the property (s.12(3)), not the client’s own state, so the '
    + 'tax split follows the project rather than the registration. A variance means the advance is '
    + 'still carrying tax while the value it relates to has already been billed.', cursor);

  cursor = drawSectionTitle(doc, 'RA bills and advance recovery', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 2,
    head: [['RA bill', 'Period', 'Billed (taxable)', 'Expected recovery', 'Adjusted', 'Variance', 'Advance left', 'Note']],
    body: schedule.map((s) => [
      s.bill.bill_ref || `RA-${s.bill.bill_no}`,
      s.bill.period_month,
      n(s.bill.taxable_value),
      n(s.expected),
      n(s.actual),
      n(s.variance),
      n(s.advanceOutstanding),
      s.beforeAdvance ? 'Predates advance' : s.variance > 0.5 ? 'Short' : '',
    ]),
    foot: [[
      'Total', '',
      n(schedule.reduce((t, s) => t + s.bill.taxable_value, 0)),
      n(schedule.reduce((t, s) => t + s.expected, 0)),
      n(schedule.reduce((t, s) => t + s.actual, 0)),
      n(schedule.reduce((t, s) => t + s.variance, 0)),
      '', '',
    ]],
  });

  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursor;
  const c2 = drawSectionTitle(doc, 'Position summary', after + 8);
  reportTable(doc, {
    startY: c2,
    numericFrom: 1,
    head: [['Particulars', 'Amount']],
    body: [
      ['Contract value', n(wp.contractValue)],
      ['Billed to date', n(wp.billedToDate)],
      ['Advance received', n(wp.advanceReceived)],
      ['Less: recovered against RA bills', n(wp.recovered)],
      ['Balance advance outstanding', n(wp.balanceAdvance)],
      ['GST carried on the balance advance', n(wp.openGstOnAdvance.igst + wp.openGstOnAdvance.cgst + wp.openGstOnAdvance.sgst)],
      ['Retention expected on value billed', n(wp.retentionExpected)],
      ['Retention actually held', n(wp.retentionHeld)],
      ['Bank guarantee', project.bg_no ? `${project.bg_no} · ${INR(project.bg_amount)} · expires ${project.bg_expiry || '—'}` : '—'],
    ],
    columnStyles: { 0: { cellWidth: 90 } },
  });

  save(doc, ['Project_Advance_Recovery', project.name, ctx.periodMonth]);
};
