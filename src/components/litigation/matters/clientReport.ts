// The client's litigation report (audit U-81-2): the same figures as the
// Matters list — open matters with their next clock and money, then closed
// matters with how they ended. Amounts in rupees with Indian grouping.
import {
  drawFooters, drawNote, drawSectionTitle, drawStatBand, nowStamp, reportFileName, reportTable, startDoc,
} from '@/utils/reportTheme';
import { stageLabel } from '@/lib/noticeStages';
import { fmtDate } from '@/lib/noticeFormat';
import { forumLabel, istDate, lifecycleLabel, matterCloseText, type MatterListRow } from '@/lib/litigationData';
import { clockWhen, clockWords } from './ClockCell';

const rs = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));

export function exportClientMattersPdf(client: { name: string; gstin: string | null }, rows: MatterListRow[], ownerName: (id: string | null) => string | null) {
  const open = rows.filter((r) => r.open);
  const closed = rows.filter((r) => !r.open);
  const sum = (f: (r: MatterListRow) => number) => open.reduce((s, r) => s + f(r), 0);
  const stamp = nowStamp();
  const { doc, y: y0 } = startDoc('l', {
    title: 'Litigation report',
    subtitle: `${client.name}${client.gstin ? ` · ${client.gstin}` : ''}`,
    fields: [
      { label: 'Client', value: client.name },
      { label: 'GSTIN', value: client.gstin ?? '—' },
      { label: 'Open matters', value: String(open.length) },
      { label: 'Closed matters', value: String(closed.length) },
    ],
  });
  let y = drawStatBand(doc, [
    { label: 'Demand (open)', value: `Rs. ${rs(sum((r) => r.money.demand))}` },
    { label: 'Paid', value: `Rs. ${rs(sum((r) => r.money.paid))}` },
    { label: 'Pre-deposit', value: `Rs. ${rs(sum((r) => r.money.preDeposit))}` },
    { label: 'Outstanding', value: `Rs. ${rs(sum((r) => r.money.outstanding))}`, note: 'demand less paid less pre-deposit' },
  ], y0);
  y = drawSectionTitle(doc, 'Open matters', y);
  reportTable(doc, {
    startY: y,
    head: [['Matter', 'Title', 'Type · forum', 'Stage', 'Next clock', 'Owner', 'Demand (Rs.)', 'Paid + pre-deposit (Rs.)', 'Outstanding (Rs.)']],
    body: open.map((r) => [
      r.matter_no, r.title ?? '—', `${lifecycleLabel(r.lifecycle)} · ${forumLabel(r)}`, stageLabel(r.stage),
      r.next ? `${r.next.label}: ${clockWhen(r.next)} (${clockWords(r.next.days)})` : 'no clock running',
      ownerName(r.owner_user_id) ?? 'Unassigned',
      rs(r.money.demand), rs(r.money.paid + r.money.preDeposit), rs(r.money.outstanding),
    ]),
    numericFrom: 6,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  if (closed.length) {
    y = drawSectionTitle(doc, 'Closed matters', y);
    reportTable(doc, {
      startY: y,
      head: [['Matter', 'Title', 'Type', 'How it ended', 'Closed on', 'Demand (Rs.)']],
      body: closed.map((r) => [r.matter_no, r.title ?? '—', lifecycleLabel(r.lifecycle), matterCloseText(r.closed_reason) || '—',
        fmtDate(istDate(r.closed_at)), rs(r.money.demand)]),
      numericFrom: 5,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }
  drawNote(doc, 'Clocks are counted in calendar days in IST from the date of this report. Statutory periods follow the firm\'s litigation rules and should be confirmed against the order\'s date of communication.', y);
  drawFooters(doc, stamp);
  doc.save(reportFileName(['Litigation', client.name, stamp.slice(0, 10).replace(/\//g, '-')], 'pdf'));
}
