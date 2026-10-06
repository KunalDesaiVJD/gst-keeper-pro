// Litigation MIS exports (audit U-100-5; cross-cutting ui-c "exports fail
// silently", "money computed four ways"): Excel for one tab or all of them, and
// a PDF pack with the summary, the next 30 days, hearings, clients, forums,
// clocks and staff — every figure from the same report the screen shows.
// The callers gate them with canExportData() and toast the outcome.
import { daysBetween } from '@/lib/noticeFacts';
import { stageLabel } from '@/lib/noticeStages';
import { fmtDate } from '@/lib/noticeFormat';
import { forumLabel, HEARING_PURPOSE, istTime, lifecycleLabel, ROLE_LABEL, type Bucket, type MisMatter, type MisReport } from './misData';

export type MisTab = 'overview' | 'clients' | 'breakdown' | 'ageing' | 'staff' | 'hearings';
type Cell = string | number;
type Sheet = { name: string; rows: Cell[][] };

const r0 = (n: number) => Math.round(n);

function bucketRows(label: string, buckets: Bucket[]): Cell[][] {
  return [
    [label, 'Matters', 'Demand', 'Pre-deposit', 'Paid', 'Outstanding', 'Refund at stake'],
    ...buckets.map((b) => [b.label, b.rows.length, r0(b.money.demand), r0(b.money.preDeposit), r0(b.money.paid), r0(b.money.outstanding), r0(b.money.refund)]),
  ];
}

function summaryRows(r: MisReport, asAt: string, filters: string): Cell[][] {
  const m = r.money;
  return [
    ['Litigation MIS', `Open matters as at ${asAt} IST`],
    ['Filters', filters || 'None'],
    [],
    ['Figure', 'Value'],
    ['Open matters', r.open.length],
    ['Demand under dispute (refunds excluded)', r0(m.demand)],
    ['  of which tax', r0(m.tax)], ['  of which interest', r0(m.interest)], ['  of which penalty', r0(m.penalty)], ['  of which cess', r0(m.cess)],
    ['Pre-deposit', r0(m.preDeposit)],
    ['Paid against demand', r0(m.paid)],
    ['Outstanding (demand − pre-deposit − paid)', r0(m.outstanding)],
    ['  proposed (notice stage)', r0(m.proposed)],
    ['  confirmed (order or later)', r0(m.confirmed)],
    ['Refund at stake', r0(m.refund)],
    ['Hearings in the next 14 days', r.hearings.next14.length],
    ['Appeal and limitation clocks within 30 days', r.sets.clocks30.length],
    ['Next clock already past', r.sets.overdue.length],
    ['Next clock within 7 days', r.sets.due7.length],
    ['Without an owner', r.sets.unassigned.length],
    ['Waiting for partner review', r.sets.review.length],
    ['No next action written', r.sets.noaction.length],
    ['Untouched for 30 days or more', r.sets.idle30.length],
    ['No amount recorded', r.sets.nodemand.length],
    ['Opened in the last 30 days', r.opened30.length],
    ['Closed in the last 30 days', r.sets.closed30.length],
  ];
}

const CLOCK_KIND: Record<string, string> = {
  reply: 'Reply due', due: 'Due', hearing: 'Hearing', appeal: 'Appeal clock', limitation: 'Limitation', attachment: 'Attachment',
};

function agendaRows(r: MisReport, days: number): Cell[][] {
  const items = r.open.flatMap((m) => m.clocks.filter((c) => c.days >= 0 && c.days < days).map((c) => ({
    date: c.date, d: c.days, kind: CLOCK_KIND[c.kind] ?? c.kind,
    what: c.kind === 'hearing' && !c.noticeId ? HEARING_PURPOSE[m.forum] : c.label, time: c.at ? istTime(c.at) : '', m,
  }))).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return [
    ['Date', 'Days away', 'Kind', 'What', 'Time (IST)', 'Matter no', 'Matter', 'Client', 'Owner'],
    ...items.map((i) => [fmtDate(i.date), i.d, i.kind, i.what, i.time, i.m.matterNo, i.m.title, i.m.clientName, i.m.ownerName ?? 'Unassigned']),
  ];
}

function clientRows(r: MisReport): Cell[][] {
  return [
    ['Client', 'GSTIN', 'Open matters', 'Demand', 'Pre-deposit', 'Paid', 'Outstanding', 'Share of outstanding %', 'Next clock', 'Next clock date', 'Overdue', 'Hearings in 14 days'],
    ...r.byClient.map((c) => [c.name, c.gstin ?? '', c.rows.length, r0(c.money.demand), r0(c.money.preDeposit), r0(c.money.paid), r0(c.money.outstanding),
      Math.round(c.share * 1000) / 10, c.next?.clock.label ?? '', c.next ? fmtDate(c.next.clock.date) : '', c.overdue, c.hearings14]),
  ];
}

function staffRows(r: MisReport): Cell[][] {
  return [
    ['Person', 'Role', 'Open matters', 'Overdue', 'Due within 7 days', 'Hearings in 14 days', 'To review', 'No next action', 'Longest untouched (days)', 'Outstanding'],
    ...r.byStaff.map((s) => [s.name, s.role ? ROLE_LABEL[s.role] ?? s.role : '', s.rows.length, s.overdue, s.due7, s.hearings14, s.reviews.length, s.noAction,
      s.stalest?.idleDays ?? '', r0(s.money.outstanding)]),
  ];
}

function hearingRows(r: MisReport): Cell[][] {
  return [
    ['Date', 'Time (IST)', 'Days away', 'Matter no', 'Matter', 'Client', 'Purpose', 'Mode', 'Venue', 'Before', 'Stage', 'Owner', 'Outstanding', 'Refund at stake'],
    ...[...r.hearings.next14, ...r.hearings.later].map(({ hearing: h, matter: m }) => [fmtDate(h.on), h.time ?? '', h.days, m.matterNo, m.title, m.clientName,
      h.noticeId ? `${h.label} (linked notice)` : HEARING_PURPOSE[m.forum], h.mode ?? '', h.venue ?? '', h.officer ?? '', stageLabel(m.stage), m.ownerName ?? 'Unassigned',
      m.recorded && !m.isRefund ? r0(m.outstanding) : '', m.isRefund ? r0(m.refundAtStake) : '']),
  ];
}

function matterRows(ms: MisMatter[], today: string): Cell[][] {
  return [
    ['Matter no', 'Matter', 'Client', 'GSTIN', 'Lifecycle', 'Forum', 'Stage', 'Priority', 'Owner', 'Reviewer', 'Opened on', 'Open for (days)',
      'Untouched (days)', 'Next clock', 'Next clock date', 'Days left', 'Tax', 'Interest', 'Penalty', 'Cess', 'Demand', 'Pre-deposit', 'Paid',
      'Outstanding', 'Refund at stake', 'Next action'],
    ...ms.map((m) => [m.matterNo, m.title, m.clientName, m.clientGstin ?? '', lifecycleLabel(m.lifecycle), forumLabel(m.forum), stageLabel(m.stage),
      m.priority ?? '', m.ownerName ?? 'Unassigned', m.reviewerName ?? '', fmtDate(m.openedOn), m.ageDays, m.idleDays, m.nextClock?.label ?? '',
      m.nextClock ? fmtDate(m.nextClock.date) : '', m.nextClock ? daysBetween(today, m.nextClock.date) : '', r0(m.tax), r0(m.interest), r0(m.penalty),
      r0(m.cess), r0(m.demand), r0(m.preDeposit), r0(m.paid), r0(m.outstanding), r0(m.refundAtStake), m.nextAction ?? '']),
  ];
}

function sheetsFor(tab: MisTab | 'all', r: MisReport, asAt: string, filters: string): Sheet[] {
  const all: Record<MisTab, Sheet[]> = {
    overview: [{ name: 'Summary', rows: summaryRows(r, asAt, filters) }, { name: 'Next 14 days', rows: agendaRows(r, 14) }],
    clients: [{ name: 'By client', rows: clientRows(r) }],
    breakdown: [
      { name: 'By forum', rows: bucketRows('Forum', r.byForum) },
      { name: 'By stage', rows: bucketRows('Stage', r.byStage.filter((b) => b.rows.length > 0)) },
      { name: 'By lifecycle', rows: bucketRows('Lifecycle', r.byLifecycle) },
    ],
    ageing: [
      { name: 'Time left on clock', rows: bucketRows('Time left', r.byClock) },
      { name: 'Untouched for', rows: bucketRows('Untouched for', r.byIdle) },
      { name: 'Open for', rows: bucketRows('Open for', r.byAge) },
    ],
    staff: [{ name: 'Per staff', rows: staffRows(r) }],
    hearings: [{ name: 'Hearings', rows: hearingRows(r) }],
  };
  if (tab !== 'all') return all[tab];
  return [...Object.values(all).flat(), { name: 'Open matters', rows: matterRows(r.open, r.today) }];
}

/** Saves an .xlsx; returns its file name. */
export async function exportMisExcel(tab: MisTab | 'all', r: MisReport, asAt: string, filters: string): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  sheetsFor(tab, r, asAt, filters).forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31)));
  const name = `Litigation_MIS_${tab === 'all' ? 'all' : tab}_${r.today}.xlsx`;
  XLSX.writeFile(wb, name);
  return name;
}

const inr = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Saves the PDF pack; returns its file name. */
export async function exportMisPdf(r: MisReport, asAt: string, filters: string): Promise<string> {
  const { startDoc, drawStatBand, drawSectionTitle, drawNote, reportTable, drawFooters, reportFileName } = await import('@/utils/reportTheme');
  const m = r.money;
  const { doc, y: y0 } = startDoc('l', {
    title: 'Litigation MIS',
    subtitle: `Open matters as at ${asAt} IST`,
    fields: [
      { label: 'Open matters', value: String(r.open.length) },
      { label: 'Clients', value: String(r.byClient.length) },
      { label: 'Hearings in 14 days', value: String(r.hearings.next14.length) },
      { label: 'Filters', value: filters || 'None' },
    ],
  });
  const H = doc.internal.pageSize.getHeight();
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 20;
  const section = (title: string, y: number) => {
    if (y > H - 40) { doc.addPage('a4', 'l'); y = 18; }
    return drawSectionTitle(doc, title, y);
  };

  let y = drawStatBand(doc, [
    { label: 'Demand under dispute (Rs)', value: inr(m.demand), note: `tax ${inr(m.tax)} · interest ${inr(m.interest)} · penalty ${inr(m.penalty)}` },
    { label: 'Pre-deposit (Rs)', value: inr(m.preDeposit) },
    { label: 'Paid (Rs)', value: inr(m.paid) },
    { label: 'Outstanding (Rs)', value: inr(m.outstanding), note: `proposed ${inr(m.proposed)} · confirmed ${inr(m.confirmed)}` },
    { label: 'Refund at stake (Rs)', value: inr(m.refund), note: 'kept out of demand' },
  ], y0);
  y = drawNote(doc, 'Outstanding = demand - pre-deposit - paid, as recorded on each matter; interest is not accrued to date. Refund matters are kept out of demand. Amounts in rupees; dates and days are IST calendar days.', y);

  // Standard PDF fonts cannot print "−" or "₹": plain hyphens and "Rs" in headings.
  const text = (c: Cell) => (typeof c === 'number' ? c.toLocaleString('en-IN') : c.replace(/\u2212/g, '-').replace(/\u20B9/g, 'Rs '));
  const table = (title: string, rows: Cell[][], numericFrom: number, left: number[] = []) => {
    y = section(title, y);
    const [head, ...body] = rows;
    if (body.length === 0) { y = drawNote(doc, 'Nothing to show.', y); return; }
    reportTable(doc, {
      startY: y, head: [head.map(text)], body: body.map((row) => row.map(text)), numericFrom,
      columnStyles: Object.fromEntries(left.map((i) => [i, { halign: 'left' as const }])),
    });
    y = lastY() + 8;
  };

  table('Next 30 days: clocks and hearings', agendaRows(r, 30), 99);
  table('Hearings', hearingRows(r).map((row) => [row[0], row[1], row[3], row[4], row[5], row[6], [row[7], row[8], row[9]].filter(Boolean).join(' · '), row[11]]), 99);
  table('By client (Rs)', clientRows(r).map((row) => [row[0], row[2], row[3], row[4], row[5], row[6], row[7], row[10], row[11], row[9], row[8]]), 1, [9, 10]);
  table('Outstanding by forum (Rs)', bucketRows('Forum', r.byForum), 1);
  table('Outstanding by stage (Rs)', bucketRows('Stage', r.byStage.filter((b) => b.rows.length > 0)), 1);
  table('Time left on the next clock (Rs)', bucketRows('Time left', r.byClock), 1);
  table('Per staff (Rs)', staffRows(r), 2);
  table('Open matters (Rs)', matterRows(r.open, r.today).map((row) => [row[0], row[2], row[6], row[8], row[14], row[20], row[21], row[22], row[23]]), 5);

  drawFooters(doc, `${asAt} IST`);
  const name = reportFileName(['Litigation_MIS', r.today], 'pdf');
  doc.save(name);
  return name;
}
