import { supabase } from '@/integrations/supabase/client';
import {
  startDoc, drawStatBand, drawSectionTitle, reportTable,
  drawFooters, nowStamp, reportFileName,
} from '@/utils/reportTheme';

interface MatterRow {
  id: string;
  matter_no: string;
  lifecycle: string;
  stage: string;
  status: string;
  title: string | null;
  priority: string | null;
  authority: string | null;
  demand_tax: number;
  demand_interest: number;
  demand_penalty: number;
  demand_cess: number;
  paid_total: number;
  pre_deposit_total: number;
  computed_due_date: string | null;
  override_due_date: string | null;
  limitation_date: string | null;
  created_at: string;
  client_id: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export async function exportLitigationMIS(): Promise<void> {
  const { data: matters } = await supabase
    .from('litigation_matters')
    .select('*')
    .order('created_at', { ascending: false });

  if (!matters || matters.length === 0) return;

  const { data: clients } = await supabase.from('clients').select('id, name, gstin');
  const clientMap = new Map((clients ?? []).map(c => [c.id, c]));

  const { data: profiles } = await supabase.from('profiles').select('user_id, first_name');
  const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p.first_name ?? 'Staff']));

  const rows = matters as MatterRow[];
  const open = rows.filter(r => r.status !== 'Closed');

  const totalDemand = open.reduce((s, r) => s + r.demand_tax + r.demand_interest + r.demand_penalty + r.demand_cess, 0);
  const totalPaid = open.reduce((s, r) => s + r.paid_total, 0);
  const totalPreDeposit = open.reduce((s, r) => s + r.pre_deposit_total, 0);
  const outstanding = totalDemand - totalPaid - totalPreDeposit;

  const stamp = nowStamp();

  const { doc, y: startY } = startDoc('l', {
    title: 'Litigation MIS Report',
    subtitle: `As at ${stamp}`,
    fields: [
      { label: 'Open matters', value: String(open.length) },
      { label: 'Closed matters', value: String(rows.length - open.length) },
      { label: 'Total matters', value: String(rows.length) },
    ],
  });

  let y = drawStatBand(doc, [
    { label: 'Total demand', value: `₹${fmt(totalDemand)}` },
    { label: 'Paid', value: `₹${fmt(totalPaid)}` },
    { label: 'Pre-deposit', value: `₹${fmt(totalPreDeposit)}` },
    { label: 'Outstanding', value: `₹${fmt(outstanding)}` },
  ], startY);

  y = drawSectionTitle(doc, 'Exposure by client', y);

  const byClient = new Map<string, { name: string; gstin: string; count: number; demand: number; paid: number; outstanding: number }>();
  for (const m of open) {
    const cl = clientMap.get(m.client_id);
    const key = m.client_id;
    if (!byClient.has(key)) {
      byClient.set(key, { name: cl?.name ?? '—', gstin: cl?.gstin ?? '—', count: 0, demand: 0, paid: 0, outstanding: 0 });
    }
    const entry = byClient.get(key)!;
    entry.count += 1;
    const demand = m.demand_tax + m.demand_interest + m.demand_penalty + m.demand_cess;
    entry.demand += demand;
    entry.paid += m.paid_total + m.pre_deposit_total;
    entry.outstanding += demand - m.paid_total - m.pre_deposit_total;
  }

  const clientRows = [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding);

  reportTable(doc, {
    startY: y,
    head: [['Client', 'GSTIN', 'Matters', 'Demand', 'Paid', 'Outstanding']],
    body: clientRows.map(r => [r.name, r.gstin, String(r.count), fmt(r.demand), fmt(r.paid), fmt(r.outstanding)]),
    numericFrom: 2,
  });

  doc.addPage('a4', 'l');

  y = drawSectionTitle(doc, 'Exposure by stage', 18);

  const byStage = new Map<string, { count: number; demand: number }>();
  for (const m of open) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, { count: 0, demand: 0 });
    const entry = byStage.get(m.stage)!;
    entry.count += 1;
    entry.demand += m.demand_tax + m.demand_interest + m.demand_penalty + m.demand_cess;
  }

  reportTable(doc, {
    startY: y,
    head: [['Stage', 'Count', 'Total demand']],
    body: [...byStage.entries()].map(([k, v]) => [k, String(v.count), fmt(v.demand)]),
    numericFrom: 1,
  });

  y = drawSectionTitle(doc, 'All open matters', (doc as any).lastAutoTable?.finalY + 10 || 100);

  reportTable(doc, {
    startY: y,
    head: [['Matter No', 'Client', 'Lifecycle', 'Stage', 'Priority', 'Due', 'Demand', 'Paid', 'Outstanding']],
    body: open.map(m => {
      const cl = clientMap.get(m.client_id);
      const demand = m.demand_tax + m.demand_interest + m.demand_penalty + m.demand_cess;
      const effectiveDue = m.override_due_date ?? m.computed_due_date;
      return [
        m.matter_no,
        cl?.name ?? '—',
        m.lifecycle.replace(/_/g, ' '),
        m.stage,
        m.priority ?? '—',
        fmtDate(effectiveDue),
        fmt(demand),
        fmt(m.paid_total + m.pre_deposit_total),
        fmt(demand - m.paid_total - m.pre_deposit_total),
      ];
    }),
    numericFrom: 6,
  });

  drawFooters(doc, stamp);
  doc.save(reportFileName(['Litigation_MIS', stamp.replace(/[/:]/g, '-')], 'pdf'));
}

export async function exportClientLitigationReport(clientId: string): Promise<void> {
  const { data: client } = await supabase.from('clients').select('name, gstin').eq('id', clientId).maybeSingle();
  if (!client) return;

  const { data: matters } = await supabase
    .from('litigation_matters')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (!matters || matters.length === 0) return;

  const rows = matters as MatterRow[];
  const open = rows.filter(r => r.status !== 'Closed');

  const totalDemand = open.reduce((s, r) => s + r.demand_tax + r.demand_interest + r.demand_penalty + r.demand_cess, 0);
  const totalPaid = open.reduce((s, r) => s + r.paid_total, 0);
  const totalPreDeposit = open.reduce((s, r) => s + r.pre_deposit_total, 0);

  const stamp = nowStamp();

  const { doc, y: startY } = startDoc('l', {
    title: 'Litigation Report',
    subtitle: `${client.name}${client.gstin ? ` · ${client.gstin}` : ''}`,
    fields: [
      { label: 'Client', value: client.name ?? '—' },
      { label: 'GSTIN', value: client.gstin ?? '—' },
      { label: 'Open matters', value: String(open.length) },
      { label: 'Closed', value: String(rows.length - open.length) },
    ],
  });

  let y = drawStatBand(doc, [
    { label: 'Total demand', value: `₹${fmt(totalDemand)}` },
    { label: 'Paid', value: `₹${fmt(totalPaid)}` },
    { label: 'Pre-deposit', value: `₹${fmt(totalPreDeposit)}` },
    { label: 'Outstanding', value: `₹${fmt(totalDemand - totalPaid - totalPreDeposit)}` },
  ], startY);

  y = drawSectionTitle(doc, 'Open matters', y);

  reportTable(doc, {
    startY: y,
    head: [['Matter No', 'Lifecycle', 'Stage', 'Priority', 'Section', 'Due', 'Tax', 'Interest', 'Penalty', 'Cess', 'Outstanding']],
    body: open.map(m => {
      const demand = m.demand_tax + m.demand_interest + m.demand_penalty + m.demand_cess;
      const effectiveDue = m.override_due_date ?? m.computed_due_date;
      return [
        m.matter_no,
        m.lifecycle.replace(/_/g, ' '),
        m.stage,
        m.priority ?? '—',
        m.title ?? '—',
        fmtDate(effectiveDue),
        fmt(m.demand_tax),
        fmt(m.demand_interest),
        fmt(m.demand_penalty),
        fmt(m.demand_cess),
        fmt(demand - m.paid_total - m.pre_deposit_total),
      ];
    }),
    numericFrom: 6,
  });

  if (rows.length > open.length) {
    const closed = rows.filter(r => r.status === 'Closed');
    y = drawSectionTitle(doc, 'Closed matters', (doc as any).lastAutoTable?.finalY + 10 || 160);

    reportTable(doc, {
      startY: y,
      head: [['Matter No', 'Lifecycle', 'Stage', 'Outcome', 'Total demand']],
      body: closed.map(m => [
        m.matter_no,
        m.lifecycle.replace(/_/g, ' '),
        m.stage,
        (m as any).closed_reason ?? '—',
        fmt(m.demand_tax + m.demand_interest + m.demand_penalty + m.demand_cess),
      ]),
      numericFrom: 4,
    });
  }

  drawFooters(doc, stamp);
  doc.save(reportFileName(['Litigation', client.name ?? 'client', stamp.replace(/[/:]/g, '-')], 'pdf'));
}
