// Litigation matters: one data layer for the Matters list, the matter page and
// the notice workspace's "Create or link a matter" (audit cross-cutting "the
// pages bypass lib/litigationData", "four definitions of closed", "money is
// computed four ways"; L-28, L-31, L-34; U-80-*, U-84-* … U-96-*).
//
// Every write stamps the person and logs a readable matter_events row (errors
// are reported, never swallowed). Stages are keys from public.notice_stages; a
// stage change also writes matter_stage_history, and the database keeps
// litigation_matters.status in step with the stage (stage 'closed' ⇒ status
// Closed + closed_at), so the app writes the stage, never the status.
import { fyMatches, formMatches } from '@/lib/masterFilters';
import { supabase } from '@/integrations/supabase/client';
import type { Database, TablesUpdate } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { updateNotices, type NoticeActor } from '@/lib/noticeWrites';
import { isStageKey, stageIndex, type StageKey } from '@/lib/noticeStages';
import { daysBetween, istToday, type NoticeFact } from '@/lib/noticeFacts';
import { closeReasonText, fmtDate } from '@/lib/noticeFormat';

type Tables = Database['public']['Tables'];
export type MatterRow = Tables['litigation_matters']['Row'];
export type MatterHearing = Tables['matter_hearings']['Row'];
export type MatterPayment = Tables['matter_payments']['Row'];
export type MatterDocument = Tables['matter_documents']['Row'];
export type MatterEvent = Tables['matter_events']['Row'];
export type MatterStageRow = Tables['matter_stage_history']['Row'];
export type MatterDeadline = Tables['matter_deadlines']['Row'];
export type CaseFolderItem = Tables['gst_case_folder_items']['Row'];
export type NoticeEventRow = Tables['notice_events']['Row'];
export type Drc03Filing = Pick<Tables['gst_drc03_filings']['Row'],
  'id' | 'arn' | 'cause_of_payment' | 'section' | 'filed_date' | 'igst_amount' | 'cgst_amount' | 'sgst_amount' | 'cess_amount'
  | 'interest_amount' | 'penalty_amount' | 'late_fee_amount' | 'cash_amount' | 'credit_amount' | 'status' | 'pdf_url'>;

/** A matter with its client and owner names (MatterDialog, older callers). */
export type LitigationMatter = MatterRow & {
  client_name?: string;
  client_gstin?: string;
  owner_name?: string;
  notice_count?: number;
};

// ── Labels (cross-cutting "raw codes reach the screen") ────────────────────

export interface LabelDef { key: string; label: string; hint?: string }

/** What the matter is about. "voluntary_payment" stays readable for old rows but is not offered (U-96-3). */
export const LIFECYCLES: LabelDef[] = [
  { key: 'demand', label: 'Demand (SCN to order)', hint: 's.73 / 74 / 74A — DRC-01A, DRC-01, DRC-07' },
  { key: 'scrutiny', label: 'Scrutiny of returns', hint: 's.61 — ASMT-10 to ASMT-12' },
  { key: 'audit', label: 'Audit', hint: 's.65 / 66 — ADT-01 to ADT-02' },
  { key: 'appeal', label: 'First appeal', hint: 's.107 — APL-01 to APL-04' },
  { key: 'tribunal', label: 'Tribunal appeal', hint: 's.112 — APL-05 before GSTAT' },
  { key: 'refund', label: 'Refund', hint: 's.54 — RFD-01 to RFD-08' },
  { key: 'registration', label: 'Registration', hint: 's.29 / 30 — REG-03, REG-17, REG-23' },
  { key: 'recovery', label: 'Recovery', hint: 's.79 / 83 — DRC-13, DRC-22' },
  { key: 'enforcement', label: 'Inspection, search or seizure', hint: 's.67' },
  { key: 'summons', label: 'Summons', hint: 's.70' },
  { key: 'ewaybill', label: 'E-way bill detention', hint: 's.129 / 130 — MOV-07 to MOV-09' },
  { key: 'non_filer', label: 'Return not filed', hint: 's.46 / 62 — GSTR-3A, ASMT-13' },
  { key: 'rectification', label: 'Rectification', hint: 's.161' },
  { key: 'amnesty', label: 'Amnesty / waiver', hint: 's.128A' },
];
const LEGACY_LIFECYCLES: LabelDef[] = [{ key: 'voluntary_payment', label: 'Voluntary payment' }];

const labelOf = (list: LabelDef[], key: string | null | undefined, fallback = '—') =>
  list.find((l) => l.key === key)?.label ?? (key ? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : fallback);

export const lifecycleLabel = (key: string | null | undefined) => labelOf([...LIFECYCLES, ...LEGACY_LIFECYCLES], key);

/** The forum the matter is before (stored in litigation_matters.authority; U-82-3). */
export const FORUMS: LabelDef[] = [
  { key: 'adjudicating', label: 'Adjudicating authority', hint: 'The proper officer who issued the notice' },
  { key: 'appellate', label: 'Appellate authority (s.107)', hint: 'Commissioner (Appeals) / Joint Commissioner (Appeals)' },
  { key: 'tribunal', label: 'GSTAT (s.112)', hint: 'Goods and Services Tax Appellate Tribunal' },
  { key: 'high_court', label: 'High Court', hint: 'Writ or appeal (s.117)' },
  { key: 'supreme_court', label: 'Supreme Court', hint: 's.118' },
];

/** The forum: stored, else inferred from the type (old rows held "CGST"/"SGST" here, a jurisdiction). */
export function forumKey(m: Pick<MatterRow, 'authority' | 'lifecycle'>): string {
  if (FORUMS.some((f) => f.key === m.authority)) return m.authority as string;
  if (m.lifecycle === 'appeal') return 'appellate';
  if (m.lifecycle === 'tribunal') return 'tribunal';
  return 'adjudicating';
}
export const forumLabel = (m: Pick<MatterRow, 'authority' | 'lifecycle'>) => labelOf(FORUMS, forumKey(m));

/** Centre / State and the office (old rows kept "CGST"/"SGST" in authority). */
export function jurisdictionText(m: Pick<MatterRow, 'authority' | 'jurisdiction'>): string {
  const legacy = m.authority === 'CGST' ? 'Centre (CGST)' : m.authority === 'SGST' ? 'State (SGST)' : '';
  return [m.jurisdiction, !m.jurisdiction ? legacy : ''].filter(Boolean).join(' · ');
}

export type PaymentEffect = 'paid' | 'pre_deposit' | 'refund';
export interface PaymentKindDef extends LabelDef { effect: PaymentEffect; arnRequired: boolean; help: string }

/** Kinds of matter payment and what each does to the money story (U-93-1, U-93-4). Verify the list with the firm. */
export const PAYMENT_KINDS: PaymentKindDef[] = [
  { key: 'voluntary', label: 'Voluntary payment (DRC-03)', effect: 'paid', arnRequired: true,
    help: 'Tax and interest paid on your own: before the notice (s.73(5) / 74(5)), or within 30 days of the SCN to close it with no or reduced penalty (s.73(8) / 74(8)).' },
  { key: 'demand_paid', label: 'Demand paid after the order', effect: 'paid', arnRequired: true,
    help: 'The confirmed demand paid through DRC-03 against the order (DRC-07).' },
  { key: 'pre_deposit', label: 'Pre-deposit for appeal', effect: 'pre_deposit', arnRequired: false,
    help: '10% of the tax in dispute before the Appellate Authority (s.107(6)) and a further 10% before the Tribunal (s.112(8)); refundable with interest if the appeal succeeds (s.115).' },
  { key: 'recovery', label: 'Recovered by the department', effect: 'paid', arnRequired: false,
    help: 'Recovery from the bank, a debtor or by adjusting a refund (s.79, s.54(10)). Reported apart from voluntary payments.' },
  { key: 'refund_received', label: 'Refund received', effect: 'refund', arnRequired: false,
    help: 'A pre-deposit or payment refunded after the matter went the client\'s way (s.115). It does not reduce what is outstanding.' },
];
export const paymentKind = (key: string | null | undefined): PaymentKindDef =>
  PAYMENT_KINDS.find((k) => k.key === key) ?? { key: key ?? 'other', label: labelOf([], key, 'Payment'), effect: 'paid', arnRequired: false, help: '' };

/** Document kinds, in the order of the proceeding (U-87-2). */
export const DOC_KINDS: LabelDef[] = [
  { key: 'notice', label: 'Notices' }, { key: 'reply', label: 'Replies and submissions' }, { key: 'evidence', label: 'Evidence and workings' },
  { key: 'client', label: 'From the client' }, { key: 'hearing', label: 'Hearings' }, { key: 'order', label: 'Orders' },
  { key: 'appeal', label: 'Appeal papers' }, { key: 'acknowledgement', label: 'Acknowledgements' }, { key: 'other', label: 'Other' },
];
const DOC_KIND_ALIAS: Record<string, string> = { submission: 'reply', hearing_notes: 'hearing' };
export const docKindKey = (kind: string | null | undefined) => {
  const k = DOC_KIND_ALIAS[kind ?? ''] ?? kind ?? 'other';
  return DOC_KINDS.some((d) => d.key === k) ? k : 'other';
};
export const DOC_SOURCE_LABEL: Record<string, string> = {
  upload: 'Uploaded', manual: 'Uploaded', portal: 'GST portal', client: 'Client', department: 'Department',
};

export const HEARING_MODES: LabelDef[] = [
  { key: 'physical', label: 'In person' }, { key: 'video', label: 'Video conference' }, { key: 'written', label: 'Written submissions only' },
];
export const hearingModeLabel = (m: string | null | undefined) =>
  HEARING_MODES.find((x) => x.key === m || x.label.toLowerCase() === (m ?? '').toLowerCase())?.label ?? (m || '—');

export type OutcomeNext = 'hearing' | 'due' | 'order' | null;
export interface OutcomeDef extends LabelDef { next: OutcomeNext }
export const HEARING_OUTCOMES: OutcomeDef[] = [
  { key: 'Adjourned', label: 'Adjourned to another date', next: 'hearing' },
  { key: 'Part heard', label: 'Part heard — continues on another date', next: 'hearing' },
  { key: 'Submissions directed', label: 'Written submissions directed', next: 'due' },
  { key: 'Order reserved', label: 'Heard — order reserved', next: null },
  { key: 'Order passed', label: 'Order passed', next: 'order' },
  { key: 'Allowed', label: 'Allowed in the client\'s favour', next: 'order' },
  { key: 'Partly allowed', label: 'Partly allowed', next: 'order' },
  { key: 'Dismissed', label: 'Dismissed', next: 'order' },
  { key: 'Ex-parte', label: 'Not attended — heard ex parte', next: null },
];
export const outcomeDef = (o: string | null | undefined): OutcomeDef | null => (o ? HEARING_OUTCOMES.find((x) => x.key === o) ?? { key: o, label: o, next: null } : null);

/** How a matter ended (U-90-1, U-90-3). "Closed automatically" is never offered by hand (U-90-2). */
export const MATTER_OUTCOMES: (LabelDef & { appealable?: boolean })[] = [
  { key: 'won', label: 'Dropped or decided in the client\'s favour' },
  { key: 'partly', label: 'Partly allowed', appealable: true },
  { key: 'lost', label: 'Demand confirmed', appealable: true },
  { key: 'paid', label: 'Paid and settled' },
  { key: 'withdrawn', label: 'Withdrawn by the department' },
  { key: 'merged', label: 'Merged into another matter' },
  { key: 'other', label: 'Other' },
];
const LEGACY_CLOSE: Record<string, string> = {
  dropped: 'Dropped', paid: 'Paid and settled', won: 'Decided in the client\'s favour', lost: 'Demand confirmed',
  partly: 'Partly allowed', withdrawn: 'Withdrawn', 'auto:closure': 'Closed automatically: closure on the portal',
};
/** A matter's close reason in words (old rows stored codes such as "paid"). */
export function matterCloseText(reason: string | null | undefined): string {
  if (!reason) return '';
  return LEGACY_CLOSE[reason] ?? closeReasonText(reason);
}

const LEGACY_STAGE: Record<string, StageKey> = {
  Captured: 'new', Triage: 'triaged', 'Awaiting client data': 'waiting_client', 'Reply drafting': 'draft',
  'Partner review': 'partner_review', 'Filed/submitted': 'filed', Hearing: 'hearing', 'Order received': 'order',
  'Appeal decision': 'appeal', 'Appeal filed': 'appeal', Closed: 'closed',
};
/** A stage key from a key or an old label (events written before Phase 2 carry labels). */
export function toStageKey(v: string | null | undefined, fallback: StageKey = 'new'): StageKey {
  if (isStageKey(v)) return v;
  return LEGACY_STAGE[v ?? ''] ?? fallback;
}

// ── Open / money / age ─────────────────────────────────────────────────────

/** The one definition of an open matter (cross-cutting "four definitions of closed"). */
export const isMatterOpen = (m: Pick<MatterRow, 'status' | 'stage'>): boolean =>
  (m.status ?? '').toLowerCase() !== 'closed' && m.stage !== 'closed';

export interface MatterMoney {
  tax: number; interest: number; penalty: number; cess: number;
  demand: number; paid: number; preDeposit: number; refunded: number;
  /** demand − paid − pre-deposit, never below nil. */
  outstanding: number;
  /** What is at stake: the outstanding of an open matter (as the command centre counts it). */
  exposure: number;
  recorded: boolean;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Every matter figure from one place (U-86-1; the same formula as the dashboard's matter exposure). */
export function matterMoney(m: Pick<MatterRow, 'demand_tax' | 'demand_interest' | 'demand_penalty' | 'demand_cess' | 'paid_total' | 'pre_deposit_total' | 'status' | 'stage'>,
  payments?: Pick<MatterPayment, 'kind' | 'tax' | 'interest' | 'penalty' | 'cess'>[]): MatterMoney {
  const tax = num(m.demand_tax), interest = num(m.demand_interest), penalty = num(m.demand_penalty), cess = num(m.demand_cess);
  const demand = tax + interest + penalty + cess;
  const paid = num(m.paid_total), preDeposit = num(m.pre_deposit_total);
  const refunded = (payments ?? []).filter((p) => paymentKind(p.kind).effect === 'refund').reduce((s, p) => s + paymentTotal(p), 0);
  const outstanding = Math.max(demand - paid - preDeposit, 0);
  return { tax, interest, penalty, cess, demand, paid, preDeposit, refunded, outstanding, exposure: isMatterOpen(m) ? outstanding : 0, recorded: demand > 0 };
}

export const paymentTotal = (p: Pick<MatterPayment, 'tax' | 'interest' | 'penalty' | 'cess'>) => num(p.tax) + num(p.interest) + num(p.penalty) + num(p.cess);

/** A timestamp's calendar date in IST. */
export const istDate = (ts: string | null | undefined): string =>
  ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';

/** "2026-10-14" + "10:30" (IST) → an ISO timestamp (U-91-1: never offset-less). */
export function istToIso(date: string, time: string): string {
  return new Date(`${date}T${time || '00:00'}:00+05:30`).toISOString();
}
/** An ISO timestamp → its IST date and HH:mm, for date and time inputs (U-92-3). */
export function isoToIst(ts: string | null | undefined): { date: string; time: string } {
  if (!ts) return { date: '', time: '' };
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    time: d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}
/** Adds whole months to a YYYY-MM-DD date (the day kept, or the month's last day). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

// ── Clocks (U-80-2, U-84-3) ────────────────────────────────────────────────

export type ClockKind = 'reply' | 'due' | 'hearing' | 'appeal' | 'limitation' | 'attachment';

export interface MatterClock {
  kind: ClockKind;
  label: string;
  /** IST calendar date. */
  date: string;
  /** Hearings carry their time. */
  at?: string | null;
  days: number;
  basis?: string | null;
  detail?: string | null;
  noticeId?: string | null;
}

export interface ClockNotice {
  id: string; form_code: string | null; notice_type?: string | null; reference_number: string | null;
  is_open: boolean | null; is_replied: boolean | null; effective_due: string | null; hearing_date: string | null;
}
export type ClockDeadline = Pick<MatterDeadline, 'notice_id' | 'deadline_type' | 'deadline_date' | 'statutory_basis' | 'is_met'>;
export type ClockHearing = Pick<MatterHearing, 'id' | 'scheduled_at' | 'outcome' | 'venue'>;

const APPEAL_LABEL: Record<string, string> = {
  appeal_s107: 'Appeal (s.107)', appeal_s107_condonation: 'Appeal with condonation (s.107(4))',
  appeal_s112: 'Tribunal appeal (s.112)', appeal_s112_condonation: 'Tribunal appeal with condonation',
  attachment_expiry: 'Attachment lapses (s.83)',
};
const PRE_FILING: StageKey[] = ['new', 'triaged', 'evidence', 'waiting_client', 'draft', 'partner_review'];

/**
 * The clocks running on an open matter, earliest first: its notices' reply dues
 * and statutory clocks (an appeal clock past its base date is shown by its
 * condonation limit), upcoming hearings, the matter's own due date while the
 * reply is not filed (or a date staff set after filing), and its limitation.
 */
export function matterClocks(
  m: Pick<MatterRow, 'stage' | 'status' | 'override_due_date' | 'computed_due_date' | 'limitation_date' | 'hearing_at'>,
  src: { notices: ClockNotice[]; deadlines: ClockDeadline[]; hearings: ClockHearing[] },
  today: string = istToday(),
): MatterClock[] {
  if (!isMatterOpen(m)) return [];
  const out: MatterClock[] = [];
  const push = (c: Omit<MatterClock, 'days'>) => out.push({ ...c, days: daysBetween(today, c.date) });
  const stage = toStageKey(m.stage);
  const ownDue = PRE_FILING.includes(stage) ? (m.override_due_date ?? m.computed_due_date) : stage === 'filed' || stage === 'hearing' ? m.override_due_date : null;
  if (ownDue) push({ kind: 'due', label: m.override_due_date ? 'Due date' : 'Reply due', date: ownDue });

  const open = new Map(src.notices.filter((n) => n.is_open !== false).map((n) => [n.id, n]));
  open.forEach((n) => {
    if (!n.is_replied && n.effective_due) {
      push({ kind: 'reply', label: `Reply${n.form_code ? ` ${n.form_code}` : ''}`, date: n.effective_due, noticeId: n.id, detail: n.reference_number });
    }
    if (n.hearing_date && n.hearing_date >= today) {
      push({ kind: 'hearing', label: `Hearing${n.form_code ? ` · ${n.form_code}` : ''}`, date: n.hearing_date, noticeId: n.id, detail: n.reference_number });
    }
  });

  const byNotice = new Map<string, ClockDeadline[]>();
  src.deadlines.filter((d) => !d.is_met && open.has(d.notice_id) && APPEAL_LABEL[d.deadline_type]).forEach((d) => {
    byNotice.set(d.notice_id, [...(byNotice.get(d.notice_id) ?? []), d]);
  });
  byNotice.forEach((list, noticeId) => {
    const pick = (base: string) => {
      const b = list.find((d) => d.deadline_type === base);
      const c = list.find((d) => d.deadline_type === `${base}_condonation`);
      // Past the base date with condonation still open → the condonation limit is the clock.
      const use = b && (b.deadline_date >= today || !c) ? b : c;
      if (use) push({ kind: 'appeal', label: APPEAL_LABEL[use.deadline_type], date: use.deadline_date, basis: use.statutory_basis, noticeId, detail: open.get(noticeId)?.reference_number });
    };
    pick('appeal_s107');
    pick('appeal_s112');
    const att = list.find((d) => d.deadline_type === 'attachment_expiry');
    if (att && att.deadline_date >= today) push({ kind: 'attachment', label: APPEAL_LABEL.attachment_expiry, date: att.deadline_date, basis: att.statutory_basis, noticeId });
  });

  const upcoming = src.hearings.filter((h) => !h.outcome && istDate(h.scheduled_at) >= today);
  // A notice's hearing date that the matter already has as a hearing is one clock, not two.
  const hearingDays = new Set(upcoming.map((h) => istDate(h.scheduled_at)));
  for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === 'hearing' && hearingDays.has(out[i].date)) out.splice(i, 1);
  upcoming.forEach((h) => push({ kind: 'hearing', label: 'Hearing', date: istDate(h.scheduled_at), at: h.scheduled_at, detail: h.venue }));
  if (m.hearing_at && istDate(m.hearing_at) >= today && !upcoming.some((h) => new Date(h.scheduled_at).getTime() === new Date(m.hearing_at as string).getTime())) {
    push({ kind: 'hearing', label: 'Hearing', date: istDate(m.hearing_at), at: m.hearing_at });
  }
  if (m.limitation_date) push({ kind: 'limitation', label: stage === 'order' ? 'Appeal limitation' : 'Limitation', date: m.limitation_date });

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.at ?? '').localeCompare(b.at ?? ''));
}

// ── The Matters list (/litigation) ─────────────────────────────────────────

export interface MatterListRow extends MatterRow {
  client_name: string;
  client_gstin: string | null;
  notices: ClockNotice[];
  clocks: MatterClock[];
  next: MatterClock | null;
  money: MatterMoney;
  open: boolean;
  /** created_at as an IST date, and days since. */
  opened_on: string;
  age_days: number;
  search: string;
}

async function inChunks<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await load(ids.slice(i, i + 150))));
  return out;
}

/** Every matter with its client, linked notices and clocks (a firm has hundreds, not thousands). */
export async function loadMatterList(): Promise<MatterListRow[]> {
  const today = istToday();
  const [matters, notices, hearings] = await Promise.all([
    fetchAllRows<MatterRow & { clients: { name: string | null; gstin: string | null } | null }>('litigation_matters', '*, clients(name, gstin)', (q) => q.order('id')),
    fetchAllRows<ClockNotice & { matter_id: string; case_id: string | null }>('notice_facts',
      'id, matter_id, form_code, notice_type, reference_number, case_id, is_open, is_replied, effective_due, hearing_date',
      (q) => q.not('matter_id', 'is', null).order('id')),
    fetchAllRows<ClockHearing & { matter_id: string }>('matter_hearings', 'id, matter_id, scheduled_at, outcome, venue',
      (q) => q.is('outcome', null).gte('scheduled_at', istToIso(today, '00:00')).order('scheduled_at')),
  ]);
  const deadlines = await inChunks(notices.map((n) => n.id), async (chunk) => {
    const { data, error } = await supabase.from('matter_deadlines')
      .select('notice_id, deadline_type, deadline_date, statutory_basis, is_met').in('notice_id', chunk).eq('is_met', false);
    if (error) throw error;
    return data ?? [];
  });
  const noticesBy = new Map<string, typeof notices>();
  notices.forEach((n) => noticesBy.set(n.matter_id, [...(noticesBy.get(n.matter_id) ?? []), n]));
  const hearingsBy = new Map<string, typeof hearings>();
  hearings.forEach((h) => hearingsBy.set(h.matter_id, [...(hearingsBy.get(h.matter_id) ?? []), h]));

  return matters.map(({ clients, ...m }) => {
    const ns = noticesBy.get(m.id) ?? [];
    const ids = new Set(ns.map((n) => n.id));
    const clocks = matterClocks(m, { notices: ns, deadlines: deadlines.filter((d) => ids.has(d.notice_id)), hearings: hearingsBy.get(m.id) ?? [] }, today);
    const opened = istDate(m.created_at);
    return {
      ...m,
      client_name: clients?.name ?? 'Unknown client',
      client_gstin: clients?.gstin ?? null,
      notices: ns,
      clocks,
      next: clocks[0] ?? null,
      money: matterMoney(m),
      open: isMatterOpen(m),
      opened_on: opened,
      age_days: daysBetween(opened, today),
      search: [m.matter_no, m.title, clients?.name, clients?.gstin, m.section_of_law, m.officer, m.jurisdiction,
        ...ns.flatMap((n) => [n.reference_number, n.case_id, n.form_code])].filter(Boolean).join(' ').toLowerCase(),
    };
  });
}

// URL contract for /litigation (the Litigation MIS links here with these):
// status=open|closed|all (default open; stage=closed alone means closed),
// stage, client, owner=<user id>|none, lifecycle, priority, age=<bucket>,
// clock=overdue|hearing7|appeal30, q, sort=<MatterSort>&dir=asc|desc, page.
export type MatterStatusFilter = 'open' | 'closed' | 'all';
export type MatterSort = 'clock' | 'matter' | 'client' | 'stage' | 'exposure' | 'owner' | 'opened';
export type ClockFilter = 'overdue' | 'hearing7' | 'appeal30';
export const AGE_BUCKETS = ['0-30', '31-90', '91-180', '181-365', '365+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export interface MatterListParams {
  status: MatterStatusFilter;
  stage?: string;
  client?: string;
  owner?: string;
  lifecycle?: string;
  priority?: string;
  /** A financial year (any of the matter's), or 'none' (no year recorded): the master filter. */
  fy?: string;
  /** A form code of any of the matter's notices, or 'none': the master filter. */
  form?: string;
  age?: AgeBucket;
  clock?: ClockFilter;
  q?: string;
  sort?: MatterSort;
  dir?: 'asc' | 'desc';
  page: number;
}

export const MATTER_SORTS: Record<MatterSort, { label: string; asc: boolean }> = {
  clock: { label: 'Next clock', asc: true }, matter: { label: 'Matter', asc: true }, client: { label: 'Client', asc: true },
  stage: { label: 'Stage', asc: true }, exposure: { label: 'Outstanding', asc: false }, owner: { label: 'Owner', asc: true },
  opened: { label: 'Opened', asc: false },
};
export const CLOCK_FILTERS: { key: ClockFilter; label: string }[] = [
  { key: 'overdue', label: 'Overdue' }, { key: 'hearing7', label: 'Hearing in 7 days' }, { key: 'appeal30', label: 'Appeal clock in 30 days' },
];

const PARAM_KEYS = ['stage', 'client', 'owner', 'lifecycle', 'priority', 'fy', 'form', 'age', 'clock', 'q'] as const;

export function parseMatterParams(sp: URLSearchParams): MatterListParams {
  const stage = sp.get('stage') || undefined;
  const raw = sp.get('status');
  const status: MatterStatusFilter = raw === 'closed' || raw === 'all' || raw === 'open' ? raw : stage === 'closed' ? 'closed' : 'open';
  const out: MatterListParams = { status, page: Math.max(1, Number(sp.get('page')) || 1) };
  PARAM_KEYS.forEach((k) => { const v = sp.get(k); if (v) (out as unknown as Record<string, string>)[k] = v; });
  if (out.age && !AGE_BUCKETS.includes(out.age)) delete out.age;
  if (out.clock && !CLOCK_FILTERS.some((c) => c.key === out.clock)) delete out.clock;
  const sort = sp.get('sort') as MatterSort | null;
  if (sort && sort in MATTER_SORTS) out.sort = sort;
  const dir = sp.get('dir');
  if (dir === 'asc' || dir === 'desc') out.dir = dir;
  return out;
}

/** The query string for a list state (defaults left out). */
export function matterSearch(p: Partial<MatterListParams>): string {
  const sp = new URLSearchParams();
  const implied = p.stage === 'closed' ? 'closed' : 'open';
  if (p.status && p.status !== implied) sp.set('status', p.status);
  PARAM_KEYS.forEach((k) => { const v = p[k]; if (v) sp.set(k, String(v)); });
  if (p.sort) sp.set('sort', p.sort);
  if (p.dir) sp.set('dir', p.dir);
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
export const mattersHref = (p: Partial<MatterListParams> = {}) => `/litigation${matterSearch(p)}`;

export function ageBucket(days: number): AgeBucket {
  if (days <= 30) return '0-30';
  if (days <= 90) return '31-90';
  if (days <= 180) return '91-180';
  if (days <= 365) return '181-365';
  return '365+';
}

export function clockMatches(r: Pick<MatterListRow, 'clocks' | 'next'>, c: ClockFilter): boolean {
  if (c === 'overdue') return !!r.next && r.next.days < 0;
  if (c === 'hearing7') return r.clocks.some((k) => k.kind === 'hearing' && k.days >= 0 && k.days <= 7);
  return r.clocks.some((k) => (k.kind === 'appeal' || k.kind === 'limitation') && k.days >= 0 && k.days <= 30);
}

export function filterMatters(rows: MatterListRow[], p: MatterListParams, meId: string | null): MatterListRow[] {
  const q = (p.q ?? '').trim().toLowerCase();
  const owner = p.owner === 'me' ? meId : p.owner;
  return rows.filter((r) => {
    if (p.status === 'open' && !r.open) return false;
    if (p.status === 'closed' && r.open) return false;
    if (p.stage && r.stage !== p.stage) return false;
    if (p.client && r.client_id !== p.client) return false;
    if (p.owner === 'none' ? !!r.owner_user_id : owner && r.owner_user_id !== owner) return false;
    if (p.lifecycle && r.lifecycle !== p.lifecycle) return false;
    if (p.priority && r.priority !== p.priority) return false;
    if (p.fy && !(p.fy === 'none' ? !(r.financial_years ?? []).length : fyMatches(r.financial_years ?? [], p.fy))) return false;
    if (p.form && !formMatches(r.notices.length ? r.notices.map((n) => n.form_code ?? null) : [null], p.form)) return false;
    if (p.age && ageBucket(r.age_days) !== p.age) return false;
    if (p.clock && !clockMatches(r, p.clock)) return false;
    if (q && !q.split(/\s+/).every((t) => r.search.includes(t))) return false;
    return true;
  });
}

/** Default order: overdue first, then the nearest clock, then the largest exposure (U-80-1). */
export function sortMatters(rows: MatterListRow[], p: Pick<MatterListParams, 'sort' | 'dir'>, ownerName: (id: string | null) => string): MatterListRow[] {
  const key: MatterSort = p.sort ?? 'clock';
  const asc = p.dir ? p.dir === 'asc' : MATTER_SORTS[key].asc;
  const sign = asc ? 1 : -1;
  const byExposure = (a: MatterListRow, b: MatterListRow) => b.money.exposure - a.money.exposure;
  const cmp = (a: MatterListRow, b: MatterListRow): number => {
    switch (key) {
      case 'clock': {
        if (!a.next || !b.next) return a.next ? -1 : b.next ? 1 : byExposure(a, b);
        return sign * (a.next.date.localeCompare(b.next.date) || (a.next.at ?? '').localeCompare(b.next.at ?? '')) || byExposure(a, b);
      }
      case 'matter': return sign * a.matter_no.localeCompare(b.matter_no, 'en', { numeric: true });
      case 'client': return sign * a.client_name.localeCompare(b.client_name) || byExposure(a, b);
      case 'stage': return sign * (stageIndex(a.stage) - stageIndex(b.stage)) || byExposure(a, b);
      case 'exposure': return sign * (a.money.exposure - b.money.exposure) || sign * (a.money.demand - b.money.demand);
      case 'owner': return sign * ownerName(a.owner_user_id).localeCompare(ownerName(b.owner_user_id)) || byExposure(a, b);
      case 'opened': return sign * a.created_at.localeCompare(b.created_at);
      default: return 0;
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || a.matter_no.localeCompare(b.matter_no));
}

/** A client's matters for the duplicate warning and "Add to an existing matter". */
export async function fetchMatters(filters?: { clientId?: string; status?: string }): Promise<{ data: LitigationMatter[] | null; error: Error | null }> {
  let q = supabase.from('litigation_matters').select('*');
  if (filters?.clientId) q = q.eq('client_id', filters.clientId);
  if (filters?.status) q = q.eq('status', filters.status);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error || !data) return { data: null, error: error ? new Error(error.message) : null };
  return { data, error: null };
}

// ── One matter (/litigation/:id) ───────────────────────────────────────────

export interface MatterClient { id: string; name: string; gstin: string | null; email: string | null; assigned_accountant: string | null }
export type RelatedMatter = Pick<MatterRow, 'id' | 'matter_no' | 'title' | 'stage' | 'status' | 'lifecycle' | 'created_at'>;

export interface MatterWorkspace {
  matter: MatterRow;
  client: MatterClient | null;
  notices: NoticeFact[];
  hearings: MatterHearing[];
  payments: MatterPayment[];
  documents: MatterDocument[];
  events: MatterEvent[];
  history: MatterStageRow[];
  deadlines: MatterDeadline[];
  folder: CaseFolderItem[];
  noticeEvents: NoticeEventRow[];
  drc03: Drc03Filing[];
  /** DRC-03 ARNs already recorded on any of this client's matters. */
  usedArns: Set<string>;
  /** The client's open notices that are in no matter (to link). */
  unlinked: NoticeFact[];
  /** The client's other matters (duplicates, the appeal chain). */
  related: RelatedMatter[];
  rules: Map<string, number>;
  clocks: MatterClock[];
  money: MatterMoney;
}

export class MatterNotFound extends Error {}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function loadMatterWorkspace(id: string): Promise<MatterWorkspace> {
  const matter = must(await supabase.from('litigation_matters').select('*').eq('id', id).maybeSingle());
  if (!matter) throw new MatterNotFound('This matter is not on record — it may have been deleted, or the link is wrong.');
  const [client, notices, hearings, payments, events, history, drc03, unlinked, related, rules] = await Promise.all([
    supabase.from('clients').select('id, name, gstin, email, assigned_accountant').eq('id', matter.client_id).maybeSingle(),
    supabase.from('notice_facts').select('*').eq('matter_id', id).order('issue_date', { ascending: false }),
    supabase.from('matter_hearings').select('*').eq('matter_id', id).order('scheduled_at'),
    supabase.from('matter_payments').select('*').eq('matter_id', id).order('paid_on', { ascending: false, nullsFirst: false }),
    supabase.from('matter_events').select('*').eq('matter_id', id).order('created_at', { ascending: false }).limit(300),
    supabase.from('matter_stage_history').select('*').eq('matter_id', id).order('changed_at'),
    supabase.from('gst_drc03_filings')
      .select('id, arn, cause_of_payment, section, filed_date, igst_amount, cgst_amount, sgst_amount, cess_amount, interest_amount, penalty_amount, late_fee_amount, cash_amount, credit_amount, status, pdf_url')
      .eq('client_id', matter.client_id).is('deleted_at', null).order('filed_date', { ascending: false }).limit(100),
    supabase.from('notice_facts').select('*').eq('client_id', matter.client_id).is('matter_id', null).eq('is_open', true)
      .order('issue_date', { ascending: false }).limit(200),
    supabase.from('litigation_matters').select('id, matter_no, title, stage, status, lifecycle, created_at').eq('client_id', matter.client_id).order('created_at'),
    supabase.from('litigation_rules').select('key, value'),
  ]);
  const ns = must(notices) ?? [];
  const ids = ns.map((n) => n.id as string);
  const caseIds = [...new Set(ns.map((n) => n.case_id).filter(Boolean))] as string[];
  const relatedRows = must(related) ?? [];
  const [documents, deadlines, folder, noticeEvents, arns] = await Promise.all([
    ids.length
      ? supabase.from('matter_documents').select('*').or(`matter_id.eq.${id},notice_id.in.(${ids.join(',')})`).order('created_at', { ascending: false })
      : supabase.from('matter_documents').select('*').eq('matter_id', id).order('created_at', { ascending: false }),
    ids.length ? supabase.from('matter_deadlines').select('*').in('notice_id', ids).order('deadline_date') : Promise.resolve({ data: [] as MatterDeadline[], error: null }),
    caseIds.length
      ? supabase.from('gst_case_folder_items').select('*').eq('client_id', matter.client_id).in('case_id', caseIds).is('deleted_at', null)
      : Promise.resolve({ data: [] as CaseFolderItem[], error: null }),
    ids.length ? supabase.from('notice_events').select('*').in('notice_id', ids).order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] as NoticeEventRow[], error: null }),
    supabase.from('matter_payments').select('drc03_arn').in('matter_id', relatedRows.map((r) => r.id)).not('drc03_arn', 'is', null),
  ]);
  const hs = must(hearings) ?? [];
  const ps = must(payments) ?? [];
  const ds = must(deadlines) ?? [];
  const ruleMap = new Map<string, number>();
  (must(rules) ?? []).forEach((r) => ruleMap.set(r.key, Number(r.value)));
  return {
    matter,
    client: (must(client) as MatterClient | null) ?? null,
    notices: ns,
    hearings: hs,
    payments: ps,
    documents: must(documents) ?? [],
    events: must(events) ?? [],
    history: must(history) ?? [],
    deadlines: ds,
    folder: (must(folder) as CaseFolderItem[]) ?? [],
    noticeEvents: (must(noticeEvents) as NoticeEventRow[]) ?? [],
    drc03: (must(drc03) as Drc03Filing[]) ?? [],
    usedArns: new Set((must(arns) ?? []).map((a) => a.drc03_arn as string)),
    unlinked: must(unlinked) ?? [],
    related: relatedRows.filter((r) => r.id !== id),
    rules: ruleMap,
    clocks: matterClocks(matter, { notices: ns as ClockNotice[], deadlines: ds, hearings: hs }),
    money: matterMoney(matter, ps),
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

async function logEvent(matterId: string, type: string, payload: Record<string, unknown> | null, actor?: NoticeActor | null, noticeId?: string | null) {
  const { error } = await supabase.from('matter_events').insert({
    matter_id: matterId, notice_id: noticeId ?? null, event_type: type,
    actor_user_id: actor?.id ?? null, actor_name: actor?.firstName ?? null, payload: payload ? compact(payload) : null,
  });
  if (error) throw new Error(`Saved, but the activity log failed: ${error.message}`);
}

async function updateRow(id: string, payload: TablesUpdate<'litigation_matters'>) {
  const { error } = await supabase.from('litigation_matters').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** M-<IST year>-<seq>: the next number after the year's highest (U-95-4; a DB sequence would remove the race). */
export async function generateMatterNo(_clientId?: string): Promise<{ data: string | null; error: Error | null }> {
  const prefix = `M-${istToday().slice(0, 4)}-`;
  const { data, error } = await supabase.from('litigation_matters').select('matter_no').like('matter_no', `${prefix}%`);
  if (error) return { data: null, error: new Error(error.message) };
  const max = (data ?? []).reduce((hi, r) => Math.max(hi, parseInt(r.matter_no.slice(prefix.length), 10) || 0), 0);
  return { data: `${prefix}${String(max + 1).padStart(4, '0')}`, error: null };
}

export interface CreateMatterInput {
  client_id: string;
  lifecycle?: string;
  title?: string | null;
  section_of_law?: string | null;
  financial_years?: string[] | null;
  authority?: string | null;
  officer?: string | null;
  jurisdiction?: string | null;
  stage?: string;
  priority?: string | null;
  owner_user_id?: string | null;
  reviewer_user_id?: string | null;
  demand_tax?: number;
  demand_interest?: number;
  demand_penalty?: number;
  demand_cess?: number;
  next_action?: string | null;
  computed_due_date?: string | null;
  override_due_date?: string | null;
  limitation_date?: string | null;
}

/** Creates a matter at a stage key, logs "created" and its first stage (U-95-1, U-95-3). */
export async function createMatter(
  input: CreateMatterInput,
  actorId?: string | null,
  actorName?: string | null,
  origin?: { fromMatterId: string; fromMatterNo: string } | null,
): Promise<{ data: MatterRow | null; error: Error | null }> {
  try {
    const { data: matterNo, error: noErr } = await generateMatterNo(input.client_id);
    if (noErr || !matterNo) throw noErr ?? new Error('Could not number the matter');
    const stage = toStageKey(input.stage, 'new');
    const { data, error } = await supabase.from('litigation_matters')
      .insert({ ...input, stage, status: stage === 'closed' ? 'Closed' : 'Open', matter_no: matterNo })
      .select().single();
    if (error || !data) throw new Error(error?.message ?? 'The matter was not created');
    const actor = { id: actorId ?? null, firstName: actorName ?? null };
    const { error: hErr } = await supabase.from('matter_stage_history').insert({ matter_id: data.id, from_stage: null, to_stage: stage, changed_by: actorId ?? null, note: 'Matter opened' });
    if (hErr) throw new Error(`Created, but the stage history failed: ${hErr.message}`);
    await logEvent(data.id, 'created', {
      matter_no: matterNo, lifecycle: data.lifecycle, stage, from_matter_id: origin?.fromMatterId, from_matter_no: origin?.fromMatterNo,
    }, actor);
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Moves the stage (closing needs a reason; reopening clears it) and records history and the event. */
export async function changeMatterStage(
  m: Pick<MatterRow, 'id' | 'stage'>, to: StageKey, actor: NoticeActor, opts: { reason?: string | null; note?: string | null } = {},
) {
  const from = toStageKey(m.stage);
  if (from === to) return;
  const payload: TablesUpdate<'litigation_matters'> = { stage: to };
  if (to === 'closed') payload.closed_reason = opts.reason ?? null;
  if (from === 'closed') payload.closed_reason = null;
  await updateRow(m.id, payload);
  const { error } = await supabase.from('matter_stage_history').insert({
    matter_id: m.id, from_stage: from, to_stage: to, changed_by: actor.id ?? null, note: opts.note ?? opts.reason ?? null,
  });
  if (error) throw new Error(`Stage saved, but its history failed: ${error.message}`);
  if (to === 'closed') await logEvent(m.id, 'closed', { from, reason: opts.reason, note: opts.note }, actor);
  else if (from === 'closed') await logEvent(m.id, 'reopened', { to, reason: opts.note ?? opts.reason }, actor);
  else await logEvent(m.id, 'stage_changed', { from, to, note: opts.note }, actor);
}

/** Older callers: close with a reason. */
export async function closeMatter(id: string, reason: string, actorId?: string | null, actorName?: string | null): Promise<{ error: Error | null }> {
  try {
    const { data } = await supabase.from('litigation_matters').select('id, stage').eq('id', id).single();
    await changeMatterStage(data ?? { id, stage: 'new' }, 'closed', { id: actorId, firstName: actorName }, { reason });
    return { error: null };
  } catch (e) { return { error: e instanceof Error ? e : new Error(String(e)) }; }
}

/** Reopens at Triaged (the module's rule for reopening). */
export async function reopenMatter(id: string, actorId?: string | null, actorName?: string | null, reason?: string | null): Promise<{ error: Error | null }> {
  try {
    await changeMatterStage({ id, stage: 'closed' }, 'triaged', { id: actorId, firstName: actorName }, { note: reason ?? null });
    return { error: null };
  } catch (e) { return { error: e instanceof Error ? e : new Error(String(e)) }; }
}

export async function assignMatter(m: Pick<MatterRow, 'id' | 'owner_user_id' | 'reviewer_user_id'>, role: 'owner' | 'reviewer',
  person: { userId: string; name: string } | null, fromName: string | null, actor: NoticeActor) {
  await updateRow(m.id, role === 'owner' ? { owner_user_id: person?.userId ?? null } : { reviewer_user_id: person?.userId ?? null });
  await logEvent(m.id, role === 'owner' ? 'assigned' : 'reviewer_assigned', { from_name: fromName, to_name: person?.name ?? null }, actor);
}

export async function setMatterPriority(m: Pick<MatterRow, 'id' | 'priority'>, priority: 'High' | 'Medium' | 'Low', actor: NoticeActor) {
  if (m.priority === priority) return;
  await updateRow(m.id, { priority });
  await logEvent(m.id, 'priority_changed', { from: m.priority, to: priority }, actor);
}

export type MatterDetails = Pick<TablesUpdate<'litigation_matters'>, 'title' | 'lifecycle' | 'section_of_law' | 'financial_years' | 'authority'
  | 'officer' | 'jurisdiction' | 'computed_due_date' | 'override_due_date' | 'limitation_date' | 'next_action'>;

/** Edits descriptive fields; one event lists what changed (old → new). */
export async function editMatterDetails(m: MatterRow, changes: MatterDetails, actor: NoticeActor) {
  const diff = Object.entries(changes).filter(([k, v]) => JSON.stringify((m as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(v ?? null));
  if (!diff.length) return;
  await updateRow(m.id, Object.fromEntries(diff) as TablesUpdate<'litigation_matters'>);
  await logEvent(m.id, 'details_changed', { changes: diff.map(([field, to]) => ({ field, from: (m as unknown as Record<string, unknown>)[field] ?? null, to: to ?? null })) }, actor);
}

export interface DemandHeads { tax: number; interest: number; penalty: number; cess: number }

/** The demand by head, with where it comes from and why it changed (U-84-2). */
export async function editDemand(m: MatterRow, to: DemandHeads, source: string, reason: string | null, actor: NoticeActor) {
  await updateRow(m.id, { demand_tax: to.tax, demand_interest: to.interest, demand_penalty: to.penalty, demand_cess: to.cess });
  await logEvent(m.id, 'demand_changed', {
    from: { tax: num(m.demand_tax), interest: num(m.demand_interest), penalty: num(m.demand_penalty), cess: num(m.demand_cess) },
    to, source, reason,
  }, actor);
}

// Hearings — upcoming hearings feed /notices-hearings through
// notice_hearings_upcoming() (open matters, IST date ≥ today), so a cancelled
// hearing is removed rather than left with a future date.

async function syncHearingAt(matterId: string) {
  const { data, error } = await supabase.from('matter_hearings').select('scheduled_at').eq('matter_id', matterId).is('outcome', null)
    .gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(1);
  if (error) throw new Error(error.message);
  await updateRow(matterId, { hearing_at: data?.[0]?.scheduled_at ?? null });
}

export interface HearingInput {
  scheduled_at: string;
  mode: string | null;
  venue: string | null;
  officer: string | null;
  attended_by: string[] | null;
  notes: string | null;
}

export async function scheduleHearing(m: Pick<MatterRow, 'id' | 'stage'>, input: HearingInput, actor: NoticeActor, moveToHearing: boolean) {
  const { error } = await supabase.from('matter_hearings').insert({ ...input, matter_id: m.id });
  if (error) throw new Error(error.message);
  await syncHearingAt(m.id);
  await logEvent(m.id, 'hearing_scheduled', { at: input.scheduled_at, venue: input.venue, mode: input.mode, officer: input.officer }, actor);
  if (moveToHearing && toStageKey(m.stage) !== 'hearing') await changeMatterStage(m, 'hearing', actor, { note: 'Hearing fixed' });
}

export async function editHearing(h: MatterHearing, input: HearingInput, actor: NoticeActor, reason: string | null) {
  const { error } = await supabase.from('matter_hearings').update(input).eq('id', h.id);
  if (error) throw new Error(error.message);
  await syncHearingAt(h.matter_id);
  const moved = new Date(h.scheduled_at).getTime() !== new Date(input.scheduled_at).getTime();
  await logEvent(h.matter_id, moved ? 'hearing_rescheduled' : 'hearing_updated', { from: moved ? h.scheduled_at : null, to: input.scheduled_at, reason, venue: input.venue }, actor);
}

export async function cancelHearing(h: MatterHearing, reason: string, actor: NoticeActor) {
  const { error } = await supabase.from('matter_hearings').delete().eq('id', h.id);
  if (error) throw new Error(error.message);
  await syncHearingAt(h.matter_id);
  await logEvent(h.matter_id, 'hearing_cancelled', { at: h.scheduled_at, venue: h.venue, reason }, actor);
}

/** The outcome; an adjournment adds the next hearing with the same venue, officer and mode (U-85-2, U-92-*). */
export async function recordHearingOutcome(h: MatterHearing, input: { outcome: string; nextAt: string | null; notes: string | null; attended_by: string[] | null },
  actor: NoticeActor, adjournmentNo: number | null) {
  const adjourned = outcomeDef(input.outcome)?.next === 'hearing';
  const { error } = await supabase.from('matter_hearings').update({
    outcome: input.outcome, adjourned, next_date: adjourned ? input.nextAt : null, notes: input.notes, attended_by: input.attended_by,
  }).eq('id', h.id);
  if (error) throw new Error(error.message);
  if (adjourned && input.nextAt) {
    const { data: existing } = await supabase.from('matter_hearings').select('id').eq('matter_id', h.matter_id).eq('scheduled_at', input.nextAt).limit(1);
    if (!existing?.length) {
      const { error: insErr } = await supabase.from('matter_hearings').insert({
        matter_id: h.matter_id, scheduled_at: input.nextAt, mode: h.mode, venue: h.venue, officer: h.officer, attended_by: input.attended_by,
        notes: `Continued from the hearing of ${fmtDate(isoToIst(h.scheduled_at).date)}`,
      });
      if (insErr) throw new Error(`Outcome saved, but the next hearing was not added: ${insErr.message}`);
    }
  }
  await syncHearingAt(h.matter_id);
  await logEvent(h.matter_id, 'hearing_outcome', { at: h.scheduled_at, outcome: input.outcome, next_at: adjourned ? input.nextAt : null, adjournment_no: adjourned ? adjournmentNo : null, notes: input.notes }, actor);
}

// Payments — paid_total and pre_deposit_total are re-added from the rows after
// every change, by kind; a refund received never lowers what is outstanding (U-93-1).

async function recomputeTotals(matterId: string) {
  const { data, error } = await supabase.from('matter_payments').select('kind, tax, interest, penalty, cess').eq('matter_id', matterId);
  if (error) throw new Error(error.message);
  let paid = 0, pre = 0;
  (data ?? []).forEach((p) => {
    const eff = paymentKind(p.kind).effect;
    if (eff === 'paid') paid += paymentTotal(p);
    if (eff === 'pre_deposit') pre += paymentTotal(p);
  });
  await updateRow(matterId, { paid_total: paid, pre_deposit_total: pre });
}

export interface PaymentInput { kind: string; drc03_arn: string | null; tax: number; interest: number; penalty: number; cess: number; paid_on: string | null; remarks: string | null }

export async function recordPayment(matterId: string, input: PaymentInput, actor: NoticeActor) {
  const { error } = await supabase.from('matter_payments').insert({ ...input, matter_id: matterId });
  if (error) throw new Error(error.message);
  await recomputeTotals(matterId);
  await logEvent(matterId, 'payment_added', { kind: input.kind, total: paymentTotal(input), arn: input.drc03_arn, paid_on: input.paid_on }, actor);
}

export async function removePayment(p: MatterPayment, actor: NoticeActor) {
  const { error } = await supabase.from('matter_payments').delete().eq('id', p.id);
  if (error) throw new Error(error.message);
  await recomputeTotals(p.matter_id);
  await logEvent(p.matter_id, 'payment_removed', { kind: p.kind, total: paymentTotal(p), arn: p.drc03_arn, paid_on: p.paid_on }, actor);
}

// Documents — files go to the return-pdfs bucket under matters/<client>/<matter>/.
const BUCKET = 'return-pdfs';

export async function uploadMatterDocument(m: Pick<MatterRow, 'id' | 'client_id'>, file: File, input: { kind: string; noticeId: string | null },
  actor: NoticeActor) {
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `matters/${m.client_id}/${m.id}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.from('matter_documents').insert({
    matter_id: m.id, notice_id: input.noticeId, kind: input.kind, title: file.name, storage_path: path,
    mime: file.type || null, size_bytes: file.size, source: 'upload', uploaded_by: actor.id ?? null, uploaded_by_name: actor.firstName ?? null,
  });
  if (error) throw new Error(error.message);
  await logEvent(m.id, 'document_added', { title: file.name, kind: input.kind, source: 'upload' }, actor, input.noticeId);
}

// Notices

/** Links notices to the matter (each notice's own log records it too, by trigger). */
export async function linkNoticesToMatter(matterId: string, noticeIds: string[], actor?: NoticeActor | null, labels?: string[]): Promise<{ error: Error | null }> {
  const { error } = await updateNotices(noticeIds, { matter_id: matterId }, actor);
  if (error) return { error: new Error(error.message) };
  try {
    await logEvent(matterId, 'notices_linked', { notice_ids: noticeIds, labels, count: noticeIds.length }, actor);
    return { error: null };
  } catch (e) { return { error: e instanceof Error ? e : new Error(String(e)) }; }
}

export async function unlinkNotice(noticeId: string, actor?: NoticeActor | null, label?: string): Promise<{ error: Error | null }> {
  const { data: notice } = await supabase.from('gst_notices').select('matter_id').eq('id', noticeId).maybeSingle();
  const { error } = await updateNotices([noticeId], { matter_id: null }, actor);
  if (error) return { error: new Error(error.message) };
  try {
    if (notice?.matter_id) await logEvent(notice.matter_id, 'notice_unlinked', { notice_id: noticeId, label }, actor);
    return { error: null };
  } catch (e) { return { error: e instanceof Error ? e : new Error(String(e)) }; }
}

export async function addMatterNote(matterId: string, text: string, actor: NoticeActor) {
  await logEvent(matterId, 'note', { text }, actor);
}

/** The reply is on the portal: the matter moves to Filed with its date and ARN (U-89-3). */
export async function recordReply(m: Pick<MatterRow, 'id' | 'stage'>, v: { date: string; arn: string | null }, actor: NoticeActor) {
  await logEvent(m.id, 'reply_recorded', { date: v.date, arn: v.arn }, actor);
  if (toStageKey(m.stage) !== 'filed') await changeMatterStage(m, 'filed', actor, { note: `Reply filed on ${fmtDate(v.date)}${v.arn ? ` · ${v.arn}` : ''}` });
}

/**
 * The order: number, date and service date; the demand it confirms; the appeal
 * limitation from the date of communication (s.107(1): three months; an
 * Appellate Authority order runs to the Tribunal, s.112(1)); the matter moves to Order.
 */
export async function recordOrder(m: MatterRow, v: { number: string | null; date: string; servedOn: string | null; demand: DemandHeads | null; months: number | null },
  actor: NoticeActor) {
  const limitation = v.months ? addMonths(v.servedOn || v.date, v.months) : null;
  const payload: TablesUpdate<'litigation_matters'> = {
    next_action: limitation ? `Decide: accept and pay, rectify (s.161) or appeal by ${fmtDate(limitation)}` : 'Decide: accept and pay, rectify (s.161) or appeal',
  };
  if (limitation) payload.limitation_date = limitation;
  if (v.demand) Object.assign(payload, { demand_tax: v.demand.tax, demand_interest: v.demand.interest, demand_penalty: v.demand.penalty, demand_cess: v.demand.cess });
  await updateRow(m.id, payload);
  await logEvent(m.id, 'order_recorded', {
    number: v.number, date: v.date, served_on: v.servedOn, limitation,
    demand: v.demand ? v.demand.tax + v.demand.interest + v.demand.penalty + v.demand.cess : null,
  }, actor);
  if (toStageKey(m.stage) !== 'order') await changeMatterStage(m, 'order', actor, { note: `Order${v.number ? ` ${v.number}` : ''} dated ${fmtDate(v.date)}` });
}

/**
 * Starts the appeal as its own matter carrying the order's facts (U-86-4,
 * U-90-1). There is no parent column yet, so both matters' logs name the other.
 */
export async function startAppeal(parent: MatterRow, v: { title: string; forum: 'appellate' | 'tribunal'; limitation: string | null; ownerId: string | null },
  actor: NoticeActor): Promise<MatterRow> {
  const { data, error } = await createMatter({
    client_id: parent.client_id, lifecycle: v.forum === 'tribunal' ? 'tribunal' : 'appeal', title: v.title,
    section_of_law: parent.section_of_law, financial_years: parent.financial_years, authority: v.forum, jurisdiction: parent.jurisdiction,
    stage: 'triaged', priority: parent.priority, owner_user_id: v.ownerId ?? parent.owner_user_id, reviewer_user_id: parent.reviewer_user_id,
    demand_tax: num(parent.demand_tax), demand_interest: num(parent.demand_interest), demand_penalty: num(parent.demand_penalty), demand_cess: num(parent.demand_cess),
    limitation_date: v.limitation, next_action: v.limitation ? `File the appeal and pay the pre-deposit by ${fmtDate(v.limitation)}` : 'File the appeal and pay the pre-deposit',
  }, actor.id, actor.firstName, { fromMatterId: parent.id, fromMatterNo: parent.matter_no });
  if (error || !data) throw error ?? new Error('The appeal matter was not created');
  await logEvent(parent.id, 'appeal_started', { child_id: data.id, child_no: data.matter_no, forum: v.forum }, actor);
  return data;
}

// ── Portal cases with no matter (U-80-3) ───────────────────────────────────

export interface SuggestedMatter {
  key: string;
  client_id: string;
  case_id: string;
  notices: Pick<NoticeFact, 'id' | 'form_code' | 'notice_type' | 'reference_number' | 'issue_date' | 'effective_due' | 'amount_of_demand' | 'financial_year' | 'stage'>[];
  title: string;
  lifecycle: string;
}

/** The lifecycle a notice's form usually opens (keys, so filters find them). */
export function lifecycleForForm(text: string): string {
  if (/APL-0[45]|GSTAT|tribunal/i.test(text)) return 'tribunal';
  if (/APL|appeal/i.test(text)) return 'appeal';
  if (/RFD|refund/i.test(text)) return 'refund';
  if (/REG|registration/i.test(text)) return 'registration';
  if (/ASMT-1[03]|scrutiny/i.test(text)) return 'scrutiny';
  if (/ADT|audit/i.test(text)) return 'audit';
  if (/DRC-1[36]|DRC-22|recovery|attachment/i.test(text)) return 'recovery';
  if (/MOV|e-?way/i.test(text)) return 'ewaybill';
  if (/summon/i.test(text)) return 'summons';
  if (/GSTR-3A|non.?fil/i.test(text)) return 'non_filer';
  return 'demand';
}

/** Open notices in no matter, grouped by portal case (two or more notices of one case). */
export async function suggestMatters(): Promise<SuggestedMatter[]> {
  const rows = await fetchAllRows<SuggestedMatter['notices'][number] & { client_id: string; case_id: string }>('notice_facts',
    'id, client_id, case_id, form_code, notice_type, reference_number, issue_date, effective_due, amount_of_demand, financial_year, stage',
    (q) => q.is('matter_id', null).eq('is_open', true).not('case_id', 'is', null).order('issue_date'));
  const groups = new Map<string, typeof rows>();
  rows.forEach((n) => { const k = `${n.client_id}::${n.case_id}`; groups.set(k, [...(groups.get(k) ?? []), n]); });
  return [...groups.entries()].filter(([, g]) => g.length > 1).map(([key, g]) => {
    const forms = [...new Set(g.map((n) => n.form_code).filter(Boolean))];
    const fy = g.find((n) => n.financial_year)?.financial_year;
    return {
      key, client_id: g[0].client_id, case_id: g[0].case_id, notices: g,
      title: `${forms.join(' / ') || 'Portal case'} · case ${g[0].case_id}${fy ? ` · FY ${fy}` : ''}`,
      lifecycle: lifecycleForForm(forms.join(' ')),
    };
  });
}
