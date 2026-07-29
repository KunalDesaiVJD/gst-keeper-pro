import { formatINR } from '@/utils/builderRates';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { POSTING_BASIS_LABEL, creditNoteDeadline, type PostingBasis } from '@/utils/builderBuEvent';
import {
  drawFooters, drawNote, drawSectionTitle, drawStatBand, nowStamp, reportFileName,
  reportTable, startDoc, type StatTile,
} from '@/utils/builderReportTheme';
import type {
  BuWorkingReport, PeriodReport, ReportContext, UnitLedgerReport,
} from '@/lib/builderReportData';

// PDF renderers for the five working papers.
//
// Two conventions run through all of them, both because these get printed and
// photocopied in mono:
//   - status is a WORD in its own column, never a colour;
//   - a zero is shown as an em dash, so an empty cell always means "nothing
//     here" rather than "not computed".

const n = (v: number): string => (Math.abs(v) < 0.005 ? '—' : formatINR(v));
const clientFields = (ctx: ReportContext) => [
  { label: 'Client', value: ctx.clientName },
  { label: 'GSTIN', value: ctx.clientGstin || '—' },
  ...(ctx.projectName ? [{ label: 'Project', value: ctx.projectName }] : []),
  ...(ctx.reraNumber ? [{ label: 'RERA', value: ctx.reraNumber }] : []),
];

// ─── 1. Unit-wise BU working ────────────────────────────────────────────────

export const buWorkingPdf = (ctx: ReportContext, r: BuWorkingReport): void => {
  const { doc, y } = startDoc('l', {
    title: 'Unit-wise BU working',
    subtitle: `BU dated ${r.buDate}${r.buRefNo ? ` · ${r.buRefNo}` : ''}`,
    fields: [
      ...clientFields(ctx),
      { label: 'BU date', value: r.buDate },
      { label: 'Posted to', value: prettyPeriodLabel(r.postingPeriod) },
    ],
  });

  const tiles: StatTile[] = [
    { label: 'Units in the event', value: String(r.rows.length) },
    { label: 'Taxable at cut-off', value: String(r.taxable.length) },
    {
      label: 'Unbooked at cut-off', value: String(r.unbooked.length),
      note: r.unbooked.length ? 'Schedule III — omitted' : undefined,
    },
    { label: 'Differential value', value: formatINR(r.totals.differentialValue) },
    {
      label: 'Tax on differential',
      value: formatINR(r.totals.cgst + r.totals.sgst),
      note: `CGST ${formatINR(r.totals.cgst)} + SGST ${formatINR(r.totals.sgst)}`,
    },
    ...(r.totals.interest > 0
      ? [{ label: 'Interest u/s 50', value: formatINR(r.totals.interest), note: 'Payable in cash' }]
      : []),
  ];
  let cursor = drawStatBand(doc, tiles, y);

  cursor = drawNote(doc,
    'A unit is taxed on its entire remaining balance where it was booked before its cut-off — the '
    + 'earlier of the BU date and its dastavej date. The base deducted is value on which GST was '
    + 'discharged up to the opening of the BU month, so receipts inside that month are subsumed here '
    + 'rather than taxed separately. Units unbooked at the cut-off fall under Schedule III and are '
    + 'omitted from the returns altogether.', cursor);

  cursor = drawSectionTitle(doc, 'Unit-wise computation', cursor);

  reportTable(doc, {
    startY: cursor,
    numericFrom: 4,
    head: [[
      'Unit', 'Type', 'Cut-off', 'Status at cut-off', 'Rate %', 'Agreement',
      'Taxed to opening', 'Invoiced before', 'Open advance', 'Differential',
      'Taxable value', 'CGST', 'SGST', 'Interest', 'Tie-out',
    ]],
    body: r.rows.map((u) => [
      u.unitNo,
      u.unitType,
      `${u.cutOffDate}\n${u.cutOffSource === 'DASTAVEJ' ? 'via dastavej' : 'via BU'}`,
      u.bookedAtCutOff ? 'Booked' : 'Unbooked — Sch. III',
      u.bookedAtCutOff ? String(u.ratePct) : '—',
      n(u.agreementValue),
      n(u.valueTaxedUptoOpening),
      n(u.invoicedBefore),
      n(u.openAdvanceBefore),
      u.bookedAtCutOff ? n(u.differentialValue) : '—',
      u.bookedAtCutOff ? n(u.differentialTaxableValue) : '—',
      u.bookedAtCutOff ? n(u.differentialCgst) : '—',
      u.bookedAtCutOff ? n(u.differentialSgst) : '—',
      u.interestAmount > 0 ? `${n(u.interestAmount)} (${u.interestDays}d)` : '—',
      Math.abs(u.tieOutDiff) < 1 ? 'OK' : n(u.tieOutDiff),
    ]),
    foot: [[
      'Total', '', '', `${r.taxable.length} taxable`, '',
      n(r.totals.agreementValue), n(r.totals.valueTaxed), '', '',
      n(r.totals.differentialValue), n(r.totals.taxableValue),
      n(r.totals.cgst), n(r.totals.sgst), n(r.totals.interest), '',
    ]],
    footStyles: { fillColor: [226, 232, 240], textColor: [17, 24, 39], fontStyle: 'bold' },
    styles: { fontSize: 6.5, cellPadding: 1.4 },
  });

  const afterY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  drawNote(doc,
    `Posting basis: ${POSTING_BASIS_LABEL[r.postingBasis as PostingBasis] || r.postingBasis}. `
    + `These units are taxed in full, so if a booking later cancels the tax is recoverable only `
    + `through a credit note under s.34 — the window closes on ${creditNoteDeadline(r.postingPeriod)}.`,
    afterY);

  drawFooters(doc, nowStamp());
  doc.save(reportFileName(['BU_Working', ctx.projectName, r.buDate], 'pdf'));
};

// ─── 2 & 4. Period reports ──────────────────────────────────────────────────

const rateBucketBody = (buckets: PeriodReport['summary']['table7']) =>
  buckets.map((b) => [
    `${b.ratePct}% (eff. ${b.effectiveRatePct}%)`,
    String(b.count),
    n(b.consideration),
    n(b.taxableValue),
    n(b.cgst),
    n(b.sgst),
    n(b.totalTax),
  ]);

const periodPdf = (
  ctx: ReportContext, r: PeriodReport, title: string, fileStem: string,
): void => {
  const { doc, y } = startDoc('l', {
    title,
    subtitle: prettyPeriodLabel(ctx.periodMonth || ''),
    fields: [
      ...clientFields(ctx),
      { label: 'Period', value: prettyPeriodLabel(ctx.periodMonth || '') },
    ],
  });

  const t = r.summary.totals;
  let cursor = drawStatBand(doc, [
    { label: 'Outward taxable value', value: formatINR(t.taxableValue), note: '3B Table 3.1(a)' },
    { label: 'Outward tax', value: formatINR(t.totalTax), note: `CGST ${formatINR(t.cgst)} + SGST ${formatINR(t.sgst)}` },
    {
      label: 'Reverse charge on FSI', value: formatINR(r.fsiTotal),
      note: r.fsiTotal > 0 ? '3B Table 3.1(d) — cash only' : undefined,
    },
    { label: 'Documents', value: String(r.documents.length) },
  ], y);

  cursor = drawNote(doc,
    'Every supply here is intra-state: the place of supply for a service in relation to immovable '
    + 'property is the location of the property, so only CGST and SGST arise. Buyers are unregistered, '
    + 'so B2CS is the only outward invoice table in play.', cursor);

  const section = (name: string, buckets: PeriodReport['summary']['table7'], note?: string) => {
    if (!buckets.length) return;
    cursor = drawSectionTitle(doc, name, cursor);
    if (note) cursor = drawNote(doc, note, cursor);
    reportTable(doc, {
      startY: cursor,
      numericFrom: 1,
      head: [['Rate', 'Documents', 'Consideration', 'Taxable value', 'CGST', 'SGST', 'Total tax']],
      body: rateBucketBody(buckets),
    });
    cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  };

  section('GSTR-3B Table 3.1(a) — outward taxable supplies', r.summary.outward,
    'All legs netted. An invoice absorbing an earlier advance reports in full in Table 7 and reverses '
    + 'that advance in Table 11B, so only the incremental liability reaches 3.1(a).');
  section('GSTR-1 Table 7 — B2CS', r.summary.table7);
  section('GSTR-1 Table 11A — tax liability on advances received', r.summary.table11A,
    'Construction is a service, so Notification 66/2017 does not apply and every advance bears tax in '
    + 'the month of receipt.');
  section('GSTR-1 Table 11B — adjustment of advances', r.summary.table11B,
    'Negative by design: these advances were taxed on receipt and are now covered by an invoice.');

  if (r.fsi.length) {
    if (cursor > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); cursor = 20; }
    cursor = drawSectionTitle(doc, 'GSTR-3B Table 3.1(d) — reverse charge on development rights', cursor);
    cursor = drawNote(doc,
      'Payable in cash. The credit is blocked under the 1%/5% scheme, so this is reversed out of '
      + 'Table 4 and never reaches GSTR-1.', cursor);
    reportTable(doc, {
      startY: cursor,
      numericFrom: 2,
      head: [['Project', 'BU date', 'FSI allocated', 'Residential leg', 'Commercial leg', 'CGST', 'SGST', 'Total']],
      body: r.fsi.map((f) => [
        f.projectName, f.buDate, n(f.allocatedValue), n(f.residentialRcm),
        n(f.commercialRcm), n(f.cgst), n(f.sgst), n(f.totalRcm),
      ]),
    });
    cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  }

  if (r.documents.length) {
    doc.addPage();
    let docY = drawSectionTitle(doc, 'Documents behind the totals', 20);
    reportTable(doc, {
      startY: docY,
      numericFrom: 4,
      head: [['Date', 'Unit', 'Source', 'Table', 'Rate %', 'Consideration', 'Taxable value', 'CGST', 'SGST']],
      body: r.documents.map((d) => [
        d.docDate, d.unitNo,
        d.sourceType.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
        d.gstr1Table, String(d.ratePct),
        n(d.consideration), n(d.taxableValue), n(d.cgst), n(d.sgst),
      ]),
      styles: { fontSize: 6.5, cellPadding: 1.4 },
    });
    docY = 0;
  }

  drawFooters(doc, nowStamp());
  doc.save(reportFileName([fileStem, ctx.projectName || ctx.clientName, ctx.periodMonth], 'pdf'));
};

export const projectLiabilityPdf = (ctx: ReportContext, r: PeriodReport): void =>
  periodPdf(ctx, r, 'Project monthly liability', 'Project_Liability');

export const returnWorkpaperPdf = (ctx: ReportContext, r: PeriodReport): void =>
  periodPdf(ctx, r, 'Monthly return workpaper', 'Return_Workpaper');

// ─── 3. Unit ledger ─────────────────────────────────────────────────────────

export const unitLedgerPdf = (ctx: ReportContext, r: UnitLedgerReport): void => {
  const { doc, y } = startDoc('l', {
    title: 'Unit ledger',
    subtitle: `Unit ${r.unitNo}`,
    fields: [
      ...clientFields(ctx),
      { label: 'Unit', value: r.unitNo },
      { label: 'Booked on', value: r.bookingDate || 'Unbooked' },
    ],
  });

  let cursor = drawStatBand(doc, [
    { label: 'Agreement value', value: formatINR(r.agreementValue) },
    { label: 'Value taxed', value: formatINR(r.totals.valueTaxed) },
    {
      label: 'Balance to tax', value: formatINR(r.balanceToTax),
      note: r.balanceToTax > 1 ? 'Falls due at BU' : 'Fully taxed',
    },
    { label: 'Received', value: formatINR(r.totals.received) },
    { label: 'Tax discharged', value: formatINR(r.totals.cgst + r.totals.sgst) },
    ...(r.totals.tds > 0
      ? [{ label: 'TDS u/s 194-IA', value: formatINR(r.totals.tds), note: 'No GST effect' }]
      : []),
  ], y);

  if (r.members.length) {
    cursor = drawSectionTitle(doc, 'Member(s)', cursor);
    reportTable(doc, {
      startY: cursor,
      numericFrom: 2,
      head: [['Name', 'PAN', 'Share %']],
      body: r.members.map((m) => [m.name, m.pan || '—', String(m.ratio)]),
      tableWidth: 140,
    });
    cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  }

  cursor = drawSectionTitle(doc, 'Movements', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 4,
    head: [[
      'Date', 'Period', 'Entry', 'Reference', 'Consideration', 'Taxable value',
      'CGST', 'SGST', 'TDS', 'Value taxed to date', 'Note',
    ]],
    body: r.entries.map((e) => [
      e.date, e.period ? prettyPeriodLabel(e.period) : '—', e.kind, e.reference,
      n(e.consideration), n(e.taxableValue), n(e.cgst), n(e.sgst), n(e.tds),
      n(e.runningValueTaxed), e.status || '',
    ]),
    foot: [[
      'Total', '', '', '', n(r.totals.valueTaxed), '', n(r.totals.cgst), n(r.totals.sgst),
      n(r.totals.tds), n(r.totals.valueTaxed), '',
    ]],
    footStyles: { fillColor: [226, 232, 240], textColor: [17, 24, 39], fontStyle: 'bold' },
    styles: { fontSize: 6.5, cellPadding: 1.4 },
  });

  const afterY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  drawNote(doc,
    'Entries carrying no tax still appear, with the reason stated — a bounced cheque never became '
    + 'consideration, a collection against an invoice was taxed when that invoice was raised, and a '
    + 'receipt inside the BU month is covered by the differential. Omitting them would leave the '
    + 'amount received unexplainable.', afterY);

  drawFooters(doc, nowStamp());
  doc.save(reportFileName(['Unit_Ledger', ctx.projectName, r.unitNo], 'pdf'));
};

// ─── 5. Member statement ────────────────────────────────────────────────────

/**
 * The client-facing one. Deliberately narrower than the ledger: a member wants
 * what they agreed, what they have paid and what remains — not the firm's
 * working. Internal mechanics (11A/11B, subsumption, tie-outs) stay out.
 */
export const memberStatementPdf = (ctx: ReportContext, r: UnitLedgerReport): void => {
  const { doc, y } = startDoc('p', {
    title: 'Statement of account',
    subtitle: `Unit ${r.unitNo}`,
    fields: [
      { label: 'Member', value: r.members[0]?.name || '—' },
      { label: 'Unit', value: r.unitNo },
      { label: 'Project', value: ctx.projectName || '—' },
      { label: 'Booked on', value: r.bookingDate || '—' },
    ],
  });

  const totalTax = r.totals.cgst + r.totals.sgst;
  let cursor = drawStatBand(doc, [
    { label: 'Agreed consideration', value: formatINR(r.agreementValue) },
    { label: 'GST charged', value: formatINR(totalTax) },
    { label: 'Received to date', value: formatINR(r.totals.received) },
  ], y);

  if (r.members.length > 1) {
    cursor = drawSectionTitle(doc, 'Joint holders', cursor);
    reportTable(doc, {
      startY: cursor,
      numericFrom: 2,
      head: [['Name', 'PAN', 'Share %']],
      body: r.members.map((m) => [m.name, m.pan || '—', String(m.ratio)]),
    });
    cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  }

  cursor = drawSectionTitle(doc, 'Payments received', cursor);
  const receipts = r.entries.filter((e) => e.kind === 'Receipt');
  reportTable(doc, {
    startY: cursor,
    numericFrom: 2,
    head: [['Date', 'Reference', 'Amount', 'GST', 'TDS deducted']],
    body: receipts.length
      ? receipts.map((e) => [
        e.date, e.reference,
        n(e.consideration), n(e.cgst + e.sgst), n(e.tds),
      ])
      : [['—', 'No payments recorded', '—', '—', '—']],
    foot: [[
      'Total', '', n(receipts.reduce((s, e) => s + e.consideration, 0)),
      n(receipts.reduce((s, e) => s + e.cgst + e.sgst, 0)),
      n(receipts.reduce((s, e) => s + e.tds, 0)),
    ]],
    footStyles: { fillColor: [226, 232, 240], textColor: [17, 24, 39], fontStyle: 'bold' },
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  cursor = drawSectionTitle(doc, 'Position', cursor);
  reportTable(doc, {
    startY: cursor,
    numericFrom: 1,
    head: [['Particulars', 'Amount']],
    body: [
      ['Agreed consideration (excluding GST)', n(r.agreementValue)],
      ['GST charged to date', n(totalTax)],
      ['Amount received to date', n(r.totals.received)],
      ['Outstanding against the agreed consideration', n(r.uncollected)],
    ],
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  drawNote(doc,
    'GST is charged on the consideration for the unit at the rate applicable to it, on the value after '
    + 'the statutory one-third deduction towards land. Any tax deducted at source under section 194-IA '
    + 'is shown for information: it reduces the amount remitted to us, not the consideration agreed or '
    + 'the GST payable on it. Please raise any discrepancy with us before relying on this statement.',
    cursor);

  drawFooters(doc, nowStamp());
  doc.save(reportFileName(['Statement', r.unitNo, r.members[0]?.name], 'pdf'));
};
