// One plain-English line for every matter event (audit U-88-1): who did what,
// old → new where there is one, money as ₹ and dates as "05 Oct 2026" — never
// "note: null" or a UUID. Events written before Phase 2 (stage labels,
// "amount" instead of "total") read the same way.
import { stageLabel } from '@/lib/noticeStages';
import { fmtDate, fmtDateTime, fmtInr } from '@/lib/noticeFormat';
import {
  FORUMS, lifecycleLabel, matterCloseText, outcomeDef, paymentKind, toStageKey, type MatterEvent,
} from '@/lib/litigationData';

export type EventGroup = 'stage' | 'hearing' | 'money' | 'documents' | 'notes' | 'other';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const money = (v: unknown) => fmtInr(Number(v) || 0);
const when = (v: unknown) => (s(v).length > 10 ? fmtDateTime(s(v)) : fmtDate(s(v)));
const stage = (v: unknown) => stageLabel(toStageKey(s(v)));

const FIELD: Record<string, string> = {
  title: 'Title', lifecycle: 'Type', section_of_law: 'Section', financial_years: 'Financial years', authority: 'Forum',
  officer: 'Officer', jurisdiction: 'Jurisdiction', computed_due_date: 'Reply due', override_due_date: 'Due date',
  limitation_date: 'Limitation', next_action: 'Next action', priority: 'Priority',
  demand_tax: 'Demand (tax)', demand_interest: 'Demand (interest)', demand_penalty: 'Demand (penalty)', demand_cess: 'Demand (cess)',
};

function fieldValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  if (Array.isArray(v)) return v.join(', ') || 'blank';
  if (field.endsWith('_date')) return fmtDate(s(v));
  if (field.startsWith('demand_')) return money(v);
  if (field === 'lifecycle') return lifecycleLabel(s(v));
  if (field === 'authority') return FORUMS.find((f) => f.key === v)?.label ?? s(v);
  return s(v);
}

export const EVENT_GROUP: Record<string, EventGroup> = {
  created: 'stage', stage_changed: 'stage', closed: 'stage', reopened: 'stage', order_recorded: 'stage', reply_recorded: 'stage', appeal_started: 'stage',
  hearing_scheduled: 'hearing', hearing_added: 'hearing', hearing_rescheduled: 'hearing', hearing_updated: 'hearing', hearing_cancelled: 'hearing', hearing_outcome: 'hearing',
  payment_added: 'money', payment_removed: 'money', demand_changed: 'money',
  document_added: 'documents', notices_linked: 'documents', notice_unlinked: 'documents',
  note: 'notes',
};
export const eventGroup = (type: string): EventGroup => EVENT_GROUP[type] ?? 'other';

export function describeMatterEvent(e: Pick<MatterEvent, 'event_type' | 'actor_name' | 'payload'>): { title: string; detail?: string } {
  const who = e.actor_name || 'System';
  const p = obj(e.payload);
  switch (e.event_type) {
    case 'created':
      return {
        title: `${who} opened the matter${p.matter_no ? ` ${s(p.matter_no)}` : ''}`,
        detail: [p.lifecycle ? lifecycleLabel(s(p.lifecycle)) : '', p.stage ? `at ${stage(p.stage)}` : '', p.from_matter_no ? `appeal from ${s(p.from_matter_no)}` : ''].filter(Boolean).join(' · ') || undefined,
      };
    case 'stage_changed':
      return { title: `${who} moved it ${p.from ? `${stage(p.from)} → ` : 'to '}${stage(p.to)}`, detail: s(p.note) || undefined };
    case 'closed':
      return { title: `${who} closed the matter`, detail: matterCloseText(s(p.reason)) || undefined };
    case 'reopened':
      return { title: `${who} reopened it${p.to ? ` at ${stage(p.to)}` : ''}`, detail: s(p.reason) || undefined };
    case 'assigned':
      return p.to_name || p.owner
        ? { title: `${who} made ${s(p.to_name ?? p.owner)} the owner`, detail: p.from_name ? `was ${s(p.from_name)}` : undefined }
        : { title: `${who} removed the owner`, detail: p.from_name ? `was ${s(p.from_name)}` : undefined };
    case 'reviewer_assigned':
      return p.to_name || p.reviewer
        ? { title: `${who} made ${s(p.to_name ?? p.reviewer)} the reviewer`, detail: p.from_name ? `was ${s(p.from_name)}` : undefined }
        : { title: `${who} removed the reviewer` };
    case 'priority_changed':
      return { title: `${who} set priority ${s(p.to ?? p.priority)}`, detail: p.from ? `was ${s(p.from)}` : undefined };
    case 'details_changed': {
      const list = Array.isArray(p.changes) ? (p.changes as Obj[]) : [];
      return {
        title: `${who} edited ${list.map((c) => (FIELD[s(c.field)] ?? s(c.field)).toLowerCase()).join(', ') || 'the details'}`,
        detail: list.map((c) => `${FIELD[s(c.field)] ?? s(c.field)}: ${fieldValue(s(c.field), c.from)} → ${fieldValue(s(c.field), c.to)}`).join(' · ') || undefined,
      };
    }
    case 'field_changed': {
      const f = s(p.field);
      return { title: `${who} changed ${(FIELD[f] ?? f).toLowerCase()}`, detail: `${fieldValue(f, p.from)} → ${fieldValue(f, p.to)}` };
    }
    case 'demand_changed': {
      const tot = (v: unknown) => { const o = obj(v); return (Number(o.tax) || 0) + (Number(o.interest) || 0) + (Number(o.penalty) || 0) + (Number(o.cess) || 0); };
      return { title: `${who} changed the demand ${money(tot(p.from))} → ${money(tot(p.to))}`, detail: [s(p.source), s(p.reason)].filter(Boolean).join(' · ') || undefined };
    }
    case 'hearing_scheduled': case 'hearing_added':
      return { title: `${who} fixed a hearing for ${when(p.at ?? p.date ?? p.scheduled_at)}`, detail: [s(p.venue), s(p.officer)].filter(Boolean).join(' · ') || undefined };
    case 'hearing_rescheduled':
      return { title: `${who} moved the hearing ${p.from ? `of ${when(p.from)} ` : ''}to ${when(p.to)}`, detail: s(p.reason) || undefined };
    case 'hearing_updated':
      return { title: `${who} updated the hearing of ${when(p.to)}`, detail: s(p.venue) || undefined };
    case 'hearing_cancelled':
      return { title: `${who} cancelled the hearing of ${when(p.at)}`, detail: s(p.reason) || undefined };
    case 'hearing_outcome': {
      const o = outcomeDef(s(p.outcome));
      const next = p.next_at ? ` → ${when(p.next_at)}${p.adjournment_no ? ` (adjournment ${s(p.adjournment_no)} of 3)` : ''}` : '';
      return { title: `${who} recorded the hearing${p.at ? ` of ${when(p.at)}` : ''}: ${o?.label ?? (p.adjourned ? 'Adjourned' : 'outcome')}${next}`, detail: s(p.notes) || undefined };
    }
    case 'payment_added': case 'payment_removed': {
      const k = paymentKind(s(p.kind));
      const amount = money(p.total ?? p.amount);
      return {
        title: `${who} ${e.event_type === 'payment_added' ? 'recorded' : 'removed'} ${amount} · ${k.label}`,
        detail: [p.arn ? `ARN ${s(p.arn)}` : '', p.paid_on ? `paid ${fmtDate(s(p.paid_on))}` : ''].filter(Boolean).join(' · ') || undefined,
      };
    }
    case 'document_added':
      return { title: `${who} added ${s(p.title) || 'a document'}`, detail: undefined };
    case 'notices_linked': {
      const labels = Array.isArray(p.labels) ? (p.labels as unknown[]).map(s).filter(Boolean) : [];
      const n = Number(p.count) || (Array.isArray(p.notice_ids) ? (p.notice_ids as unknown[]).length : 0);
      return { title: `${who} linked ${n === 1 ? 'a notice' : `${n} notices`}`, detail: labels.join(', ') || undefined };
    }
    case 'notice_unlinked':
      return { title: `${who} unlinked ${s(p.label) || 'a notice'}` };
    case 'note':
      return { title: `${who} noted`, detail: s(p.text) };
    case 'reply_recorded':
      return { title: `${who} recorded the reply filed on ${fmtDate(s(p.date))}`, detail: p.arn ? `ARN ${s(p.arn)}` : undefined };
    case 'order_recorded':
      return {
        title: `${who} recorded the order${p.number ? ` ${s(p.number)}` : ''} dated ${fmtDate(s(p.date))}`,
        detail: [p.served_on ? `served ${fmtDate(s(p.served_on))}` : '', p.demand ? `demand ${money(p.demand)}` : '', p.limitation ? `appeal by ${fmtDate(s(p.limitation))}` : ''].filter(Boolean).join(' · ') || undefined,
      };
    case 'appeal_started':
      return { title: `${who} started the appeal ${s(p.child_no)}` };
    default:
      return { title: `${who}: ${e.event_type.replace(/_/g, ' ')}` };
  }
}
