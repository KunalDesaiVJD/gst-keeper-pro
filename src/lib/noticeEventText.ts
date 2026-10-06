// One plain-English line for every notice event (the workspace's Activity tab
// and the bell; audit U-02-1, U-41-4): who did what, with the old and new
// value where there is one, never "? → Reply drafted".
import { stageLabel } from '@/lib/noticeStages';
import { closeReasonText, fmtDate, fmtInrShort } from '@/lib/noticeFormat';
import type { Json } from '@/integrations/supabase/types';

export interface EventLike {
  event_type: string;
  old_value: Json | null;
  new_value: Json | null;
  actor_name: string | null;
  source?: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: Json | null): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const FOLDER: Record<string, string> = {
  INTIM: 'intimation', NOTCE: 'notice', REPLY: 'reply', ORDRS: 'order', CLSR: 'closure', CLOSR: 'closure',
  CLOSURE: 'closure', APLCN: 'application', NOTAC: 'notice / acknowledgement', AUDIT: 'audit item',
};

export const EVENT_LABELS: Record<string, string> = {
  captured: 'New notice captured',
  removed: 'No longer on the portal',
  restored: 'Back on the portal',
  stage_changed: 'Stage changed',
  status_changed: 'Status changed',
  closed: 'Closed',
  reopened: 'Reopened',
  assigned: 'Owner changed',
  due_changed: 'Due date changed',
  hearing_fixed: 'Hearing fixed',
  reply_logged: 'Reply logged',
  submission_logged: 'Submission logged',
  order_logged: 'Order logged',
  priority_changed: 'Priority changed',
  linked_to_matter: 'Linked to a matter',
  unlinked_from_matter: 'Unlinked from a matter',
  reply_filed: 'Reply filed on the portal',
  order_received: 'Order on the portal',
  notice_issued: 'New notice in the case',
  closure_on_portal: 'Case closed on the portal',
  folder_item_added: 'New item in the case folder',
  folder_item_removed: 'Case folder item removed',
  issue_added: 'Issue added',
  issue_updated: 'Issue updated',
  issue_removed: 'Issue removed',
  draft_saved: 'Draft saved',
  draft_sent_for_review: 'Draft sent for partner review',
  draft_approved: 'Draft approved',
  draft_changes_requested: 'Changes requested on the draft',
  documents_requested: 'Document requested from the client',
  document_received: 'Document received',
  document_waived: 'Document waived',
  client_emailed: 'Client e-mailed',
  client_reminded: 'Client reminded',
  payment_linked: 'Payment linked',
  payment_unlinked: 'Payment unlinked',
  document_added: 'Document uploaded',
  comment: 'Note',
  extension_requested: 'Extension requested',
};

export const eventLabel = (type: string): string => EVENT_LABELS[type] ?? type.replace(/_/g, ' ');

/** "Riya moved Draft → Partner review", with a detail line where it helps. */
export function describeEvent(e: EventLike): { title: string; detail?: string } {
  const who = e.actor_name || (e.source === 'sync' ? 'Portal sync' : 'System');
  const o = obj(e.old_value);
  const n = obj(e.new_value);
  switch (e.event_type) {
    case 'captured':
      return { title: `${who} captured it${n.manual ? ' (typed in)' : ''}`, detail: [s(n.reference_number), n.due_date ? `due ${fmtDate(s(n.due_date))}` : ''].filter(Boolean).join(' · ') || undefined };
    case 'stage_changed':
      return { title: `${who} moved it ${o.stage ? `${stageLabel(s(o.stage))} → ` : 'to '}${stageLabel(s(n.stage))}` };
    case 'closed':
      return { title: `${who} closed it`, detail: closeReasonText(s(n.close_reason)) || undefined };
    case 'reopened':
      return { title: `${who} reopened it${n.stage ? ` at ${stageLabel(s(n.stage))}` : ''}` };
    case 'status_changed':
      return { title: `${who} changed the status ${o.staff_status ? `${s(o.staff_status)} → ` : 'to '}${s(n.staff_status) || 'none'}` };
    case 'assigned':
      return { title: n.assign_to ? `${who} assigned it to ${s(n.assign_to)}` : `${who} removed the owner`, detail: o.assign_to ? `was ${s(o.assign_to)}` : undefined };
    case 'due_changed':
      return { title: `${who} moved the due date ${o.due ? `${fmtDate(s(o.due))} → ` : 'to '}${n.due ? fmtDate(s(n.due)) : 'none'}`, detail: n.extended ? 'extension' : undefined };
    case 'hearing_fixed':
      return { title: `${who} fixed a hearing on ${fmtDate(s(n.hearing_date))}` };
    case 'reply_logged':
      return { title: `${who} logged the reply filed on ${fmtDate(s(n.reply_date))}`, detail: s(n.reply_ref_number) || undefined };
    case 'order_logged':
      return { title: `${who} logged the order dated ${fmtDate(s(n.order_date))}`, detail: s(n.order_number) || undefined };
    case 'priority_changed':
      return { title: `${who} set priority ${s(n.priority) || 'none'}`, detail: o.priority ? `was ${s(o.priority)}` : undefined };
    case 'reply_filed': case 'order_received': case 'notice_issued': case 'closure_on_portal':
    case 'folder_item_added': case 'folder_item_removed': {
      const what = FOLDER[s(n.folder_section ?? o.folder_section)] ?? 'item';
      return { title: `${eventLabel(e.event_type)}`, detail: [`${what}`, s(n.reference_number ?? o.reference_number)].filter(Boolean).join(' · ') };
    }
    case 'issue_added':
      return { title: `${who} added an issue: ${s(n.title)}`, detail: n.amount ? fmtInrShort(Number(n.amount)) : undefined };
    case 'issue_updated':
      return { title: `${who} updated the issue ${s(n.title)}`, detail: o.status !== n.status ? `${s(o.status)} → ${s(n.status)}` : undefined };
    case 'issue_removed':
      return { title: `${who} removed the issue ${s(o.title)}` };
    case 'draft_saved':
      return { title: `${who} saved draft v${s(n.version)}` };
    case 'draft_sent_for_review':
      return { title: `${who} sent draft v${s(n.version)} for partner review` };
    case 'draft_approved':
      return { title: `${who} approved draft v${s(n.version)}` };
    case 'draft_changes_requested':
      return { title: `${who} asked for changes to draft v${s(n.version)}`, detail: s(n.note) || undefined };
    case 'documents_requested':
      return { title: `${who} asked the client for ${s(n.item)}`, detail: n.due_date ? `by ${fmtDate(s(n.due_date))}` : undefined };
    case 'document_received':
      return { title: `${who} marked ${s(n.item)} received`, detail: s(n.note) || undefined };
    case 'document_waived':
      return { title: `${who} waived ${s(n.item)}`, detail: s(n.note) || undefined };
    case 'client_emailed': case 'client_reminded':
      return { title: `${who} ${e.event_type === 'client_reminded' ? 'reminded' : 'e-mailed'} the client (${s(n.items)} open)`, detail: n.mode && n.mode !== 'live' ? `${s(n.mode)} — not actually sent` : s(n.to) };
    case 'payment_linked':
      return { title: `${who} linked a ${n.kind === 'drc03' ? 'DRC-03' : s(n.kind).replace('_', '-')} payment of ${fmtInrShort(Number(n.amount))}`, detail: s(n.drc03_arn) || undefined };
    case 'payment_unlinked':
      return { title: `${who} unlinked a payment`, detail: s(o.drc03_arn) || undefined };
    case 'document_added':
      return { title: `${who} uploaded ${s(n.title)}` };
    case 'comment':
      return { title: `${who} noted`, detail: s(n.text) };
    case 'extension_requested':
      return { title: `${who} recorded an extension request`, detail: s(n.text) };
    case 'linked_to_matter':
      return { title: `${who} linked it to a matter` };
    case 'unlinked_from_matter':
      return { title: `${who} unlinked it from its matter` };
    case 'removed':
      return { title: 'No longer listed on the portal', detail: 'Kept here; restored if the portal lists it again' };
    default:
      return { title: `${who}: ${eventLabel(e.event_type)}` };
  }
}
