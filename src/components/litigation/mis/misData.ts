// Litigation MIS: data and definitions (audit U-100-2, U-101-1, U-101-4,
// U-102-2, U-103-1, U-103-3, U-104-1/2, U-105-1/2, U-106-1/2; cross-cutting
// ui-c "money is computed four ways", "four definitions of closed", "raw codes
// reach the screen", "day counts use browser time"). The rows are the Matters
// list's own (lib/litigationData: loadMatterList — open rule, money, clocks
// and age), so a count that the list can filter by links there with the same
// parameters and shows the same number; any other count opens the page's own
// list of the matters behind it (drillView). Refund matters are reported as
// refund at stake, apart from demand.
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { STAGES, stageLabel } from '@/lib/noticeStages';
import { fmtDate, plural } from '@/lib/noticeFormat';
import {
  ageBucket, clockMatches, forumKey, hearingModeLabel, istDate, istToIso, lifecycleLabel, LIFECYCLES, matterCloseText,
  mattersHref as listHref, type AgeBucket, type MatterClock, type MatterListParams, type MatterListRow,
} from '@/lib/litigationData';

export { lifecycleLabel, LIFECYCLES };
export type { AgeBucket };

// ── Vocabulary ─────────────────────────────────────────────────────────────
export type Tone = 'info' | 'warning' | 'success' | 'destructive' | 'secondary' | 'primary';

export const PRIORITIES = ['High', 'Medium', 'Low'] as const;

export const ROLE_LABEL: Record<string, string> = { superadmin: 'Admin', gst_manager: 'GST manager', employee: 'Staff' };

/**
 * Where a dispute sits (U-102-2): the matter's forum (lib/litigationData
 * forumKey — stored, else from the lifecycle), with the adjudicating step split
 * into before and after the order, and recovery apart.
 */
export type ForumKey = 'notice' | 'order' | 'first_appeal' | 'tribunal' | 'high_court' | 'supreme_court' | 'recovery';

export const FORUMS: { key: ForumKey; label: string; description: string; tone: Tone; always?: boolean }[] = [
  { key: 'notice', label: 'Notice & reply', description: 'Before the adjudicating officer, no order yet', tone: 'warning', always: true },
  { key: 'order', label: 'Order passed', description: 'Order received: accept, rectify or appeal', tone: 'destructive', always: true },
  { key: 'first_appeal', label: 'First appeal', description: 'Before the Appellate Authority (s.107)', tone: 'primary', always: true },
  { key: 'tribunal', label: 'Tribunal (GSTAT)', description: 'Before the GST Appellate Tribunal (s.112)', tone: 'info', always: true },
  { key: 'high_court', label: 'High Court', description: 'Writ or appeal (s.117)', tone: 'primary' },
  { key: 'supreme_court', label: 'Supreme Court', description: 'Appeal (s.118)', tone: 'primary' },
  { key: 'recovery', label: 'Recovery', description: 'Recovery proceedings on a confirmed demand', tone: 'destructive', always: true },
];

export const forumLabel = (k: ForumKey): string => FORUMS.find((f) => f.key === k)?.label ?? k;

export function forumOf(m: Pick<MatterListRow, 'authority' | 'lifecycle' | 'stage'>): ForumKey {
  const f = forumKey(m);
  if (f === 'tribunal' || f === 'high_court' || f === 'supreme_court') return f;
  if (f === 'appellate') return 'first_appeal';
  if (m.lifecycle === 'recovery') return 'recovery';
  if (m.stage === 'appeal') return 'first_appeal';
  if (m.stage === 'order') return 'order';
  return 'notice';
}

/** What a hearing is for, from the matter's forum (matter_hearings has no purpose column). */
export const HEARING_PURPOSE: Record<ForumKey, string> = {
  notice: 'Personal hearing',
  order: 'Hearing after the order',
  first_appeal: 'Appeal hearing',
  tribunal: 'Tribunal hearing',
  high_court: 'Court hearing',
  supreme_court: 'Court hearing',
  recovery: 'Recovery hearing',
};

// ── Buckets (age uses the Matters list's own ageBucket, so age= counts match) ──
export const AGE_BUCKETS: { key: AgeBucket; label: string; tone: Tone }[] = [
  { key: '0-30', label: '0–30 days', tone: 'primary' },
  { key: '31-90', label: '31–90 days', tone: 'primary' },
  { key: '91-180', label: '91–180 days', tone: 'primary' },
  { key: '181-365', label: '181–365 days', tone: 'primary' },
  { key: '365+', label: 'Over a year', tone: 'primary' },
];

export type ClockBucket = 'expired' | '0-7' | '8-30' | '31-90' | '90+' | 'none';
export const CLOCK_BUCKETS: { key: ClockBucket; label: string; tone: Tone; test: (d: number | null) => boolean }[] = [
  { key: 'expired', label: 'Already past', tone: 'destructive', test: (d) => d !== null && d < 0 },
  { key: '0-7', label: '0–7 days', tone: 'destructive', test: (d) => d !== null && d >= 0 && d <= 7 },
  { key: '8-30', label: '8–30 days', tone: 'warning', test: (d) => d !== null && d > 7 && d <= 30 },
  { key: '31-90', label: '31–90 days', tone: 'info', test: (d) => d !== null && d > 30 && d <= 90 },
  { key: '90+', label: 'Over 90 days', tone: 'success', test: (d) => d !== null && d > 90 },
  { key: 'none', label: 'No clock on record', tone: 'secondary', test: (d) => d === null },
];

export type IdleBucket = '0-29' | '30-59' | '60-89' | '90+';
export const IDLE_BUCKETS: { key: IdleBucket; label: string; tone: Tone; test: (d: number) => boolean }[] = [
  { key: '0-29', label: 'Under 30 days', tone: 'success', test: (d) => d < 30 },
  { key: '30-59', label: '30–59 days', tone: 'warning', test: (d) => d >= 30 && d < 60 },
  { key: '60-89', label: '60–89 days', tone: 'destructive', test: (d) => d >= 60 && d < 90 },
  { key: '90+', label: '90 days or more', tone: 'destructive', test: (d) => d >= 90 },
];

// ── Rows ───────────────────────────────────────────────────────────────────
type HearingDetail = Pick<Tables<'matter_hearings'>, 'id' | 'matter_id' | 'scheduled_at' | 'mode' | 'venue' | 'officer' | 'notes' | 'attended_by'>;

export interface StaffInfo { userId: string; name: string; role: string | null }

/** A clock on a matter: the Matters list's own (reply, due, hearing, appeal, limitation, attachment). */
export type Clock = MatterClock;

export interface MisHearing {
  key: string;
  /** IST calendar date; the time when the hearing has one. */
  on: string;
  time: string | null;
  days: number;
  /** "Hearing", or "Hearing · ASMT-10" for a date taken from a linked notice. */
  label: string;
  noticeId: string | null;
  /** The linked notice's reference, for a date taken from it. */
  reference: string | null;
  mode: string | null;
  venue: string | null;
  officer: string | null;
  notes: string | null;
  /** Staff going to the hearing. */
  attendees: string[];
}

export interface MisMatter {
  id: string;
  clientId: string;
  clientName: string;
  clientGstin: string | null;
  matterNo: string;
  title: string;
  lifecycle: string;
  stage: string;
  priority: string | null;
  ownerId: string | null;
  ownerName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  nextAction: string | null;
  closedReason: string | null;
  open: boolean;
  /** A refund matter's amount is a refund at stake, never a demand (U-100-2, U-103-1). */
  isRefund: boolean;
  tax: number;
  interest: number;
  penalty: number;
  cess: number;
  demand: number;
  preDeposit: number;
  paid: number;
  /** Demand − pre-deposit − paid, never below zero (U-101-1). */
  outstanding: number;
  refundAtStake: number;
  /** Any amount typed on the matter (U-101-4: none prints "—", not ₹0). */
  recorded: boolean;
  forum: ForumKey;
  /** IST dates (U-104-1: calendar days in IST, not the browser's clock). */
  openedOn: string;
  ageDays: number;
  idleDays: number;
  closedOn: string | null;
  clocks: Clock[];
  nextClock: Clock | null;
  /** Upcoming hearings (from today, IST), soonest first: the hearing clocks of the matter. */
  hearings: MisHearing[];
}

export interface MisExtras {
  staff: StaffInfo[];
  details: HearingDetail[];
  /** Every upcoming hearing, notices and matters: the Hearings page's row count. */
  allHearings: number;
}

export interface MisData {
  today: string;
  matters: MisMatter[];
  staff: StaffInfo[];
  clients: { id: string; name: string }[];
  allHearings: number;
}

const IST = 'Asia/Kolkata';
export const istTime = (ts: string): string =>
  new Date(ts).toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false });

/** What the Matters list does not load: staff names, hearing details and the Hearings page's count. */
export async function loadMisExtras(): Promise<MisExtras> {
  const [details, profiles, roles, upcoming] = await Promise.all([
    fetchAllRows<HearingDetail>('matter_hearings', 'id, matter_id, scheduled_at, mode, venue, officer, notes, attended_by',
      (q) => q.is('outcome', null).gte('scheduled_at', istToIso(istToday(), '00:00')).order('scheduled_at')),
    supabase.from('profiles').select('user_id, first_name, email'),
    supabase.from('user_roles').select('user_id, role'),
    supabase.rpc('notice_hearings_upcoming', { p_from: null }),
  ]);
  if (profiles.error) throw profiles.error;
  if (roles.error) throw roles.error;
  if (upcoming.error) throw upcoming.error;
  const roleOf = new Map((roles.data ?? []).map((r) => [r.user_id, r.role as string]));
  const staff: StaffInfo[] = (profiles.data ?? [])
    .filter((p) => (roleOf.get(p.user_id) ?? 'client') !== 'client')
    .map((p) => ({ userId: p.user_id, name: p.first_name || p.email?.split('@')[0] || 'Staff member', role: roleOf.get(p.user_id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { staff, details, allHearings: (upcoming.data ?? []).length };
}

/** The MIS view of the Matters list's rows. */
export function buildMisData(rows: MatterListRow[], x: MisExtras, today: string = istToday()): MisData {
  const nameOf = new Map(x.staff.map((s) => [s.userId, s.name]));
  const staffName = (id: string | null) => (id ? nameOf.get(id) ?? 'Former staff member' : null);
  const detailsOf = new Map<string, HearingDetail[]>();
  x.details.forEach((d) => detailsOf.set(d.matter_id, [...(detailsOf.get(d.matter_id) ?? []), d]));

  const matters = rows.map((r): MisMatter => {
    const forum = forumOf(r);
    const isRefund = r.lifecycle === 'refund';
    const mm = r.money;
    const details = detailsOf.get(r.id) ?? [];
    const hearings: MisHearing[] = r.clocks.filter((c) => c.kind === 'hearing').map((c, i) => {
      const d = c.at ? details.find((h) => new Date(h.scheduled_at).getTime() === new Date(c.at as string).getTime()) : undefined;
      return {
        key: d?.id ?? `${r.id}-${c.noticeId ?? 'h'}-${i}`, on: c.date, time: c.at ? istTime(c.at) : null, days: c.days,
        label: c.label, noticeId: c.noticeId ?? null, reference: c.noticeId ? c.detail ?? null : null,
        mode: d?.mode ? hearingModeLabel(d.mode) : null, venue: d?.venue ?? (c.noticeId ? null : c.detail ?? null),
        officer: d?.officer ?? null, notes: d?.notes ?? null,
        attendees: (d?.attended_by ?? []).map((id) => staffName(id) as string),
      };
    });
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      clientGstin: r.client_gstin,
      matterNo: r.matter_no,
      title: r.title?.trim() || r.matter_no,
      lifecycle: r.lifecycle,
      stage: r.stage,
      priority: r.priority,
      ownerId: r.owner_user_id,
      ownerName: staffName(r.owner_user_id),
      reviewerId: r.reviewer_user_id,
      reviewerName: staffName(r.reviewer_user_id),
      nextAction: r.next_action?.trim() || null,
      closedReason: r.closed_reason ? matterCloseText(r.closed_reason) : null,
      open: r.open,
      isRefund,
      tax: isRefund ? 0 : mm.tax,
      interest: isRefund ? 0 : mm.interest,
      penalty: isRefund ? 0 : mm.penalty,
      cess: isRefund ? 0 : mm.cess,
      demand: isRefund ? 0 : mm.demand,
      // A refund matter's "paid" is not a payment against a demand.
      preDeposit: isRefund ? 0 : mm.preDeposit,
      paid: isRefund ? 0 : mm.paid,
      outstanding: isRefund ? 0 : mm.outstanding,
      refundAtStake: isRefund ? mm.demand : 0,
      recorded: mm.recorded,
      forum,
      openedOn: r.opened_on,
      ageDays: r.age_days,
      idleDays: daysBetween(istDate(r.updated_at), today),
      closedOn: r.closed_at ? istDate(r.closed_at) : null,
      clocks: r.clocks,
      nextClock: r.next,
      hearings,
    };
  });

  const clients = new Map<string, string>();
  matters.forEach((m) => clients.set(m.clientId, m.clientName));
  return {
    today,
    matters,
    staff: x.staff,
    clients: [...clients.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    allHearings: x.allHearings,
  };
}

// ── Filters and links ──────────────────────────────────────────────────────
export interface MisFilters { client?: string; owner?: string; lifecycle?: string; priority?: string }
export const FILTER_KEYS = ['client', 'owner', 'lifecycle', 'priority'] as const;

export function readFilters(sp: URLSearchParams): MisFilters {
  const f: MisFilters = {};
  FILTER_KEYS.forEach((k) => { const v = sp.get(k); if (v) f[k] = v; });
  return f;
}

/** The Matters list's own owner, client, lifecycle and priority rules (lib/litigationData filterMatters). */
export function applyFilters(ms: MisMatter[], f: MisFilters): MisMatter[] {
  return ms.filter((m) =>
    (!f.client || m.clientId === f.client)
    && (!f.owner || (f.owner === 'none' ? !m.ownerId : m.ownerId === f.owner))
    && (!f.lifecycle || m.lifecycle === f.lifecycle)
    && (!f.priority || m.priority === f.priority));
}

export type MattersLink = Partial<MatterListParams>;

/** The Matters list with the same filter (its URL contract, lib/litigationData mattersHref). */
export const mattersHref = (p: MattersLink): string => listHref(p);

/** The list's clock filters, on the same rows (lib/litigationData clockMatches). */
export const isOverdue = (m: MisMatter) => clockMatches({ clocks: m.clocks, next: m.nextClock }, 'overdue');
export const hasAppealClock30 = (m: MisMatter) => clockMatches({ clocks: m.clocks, next: m.nextClock }, 'appeal30');
export const isAppealClock30 = (c: Clock) => (c.kind === 'appeal' || c.kind === 'limitation') && c.days >= 0 && c.days <= 30;

// ── The report ─────────────────────────────────────────────────────────────
export interface Money {
  matters: number;
  demand: number; tax: number; interest: number; penalty: number; cess: number;
  preDeposit: number; paid: number; outstanding: number;
  /** Outstanding still at the notice stage vs after an order (U-100-2). */
  proposed: number; confirmed: number;
  refund: number;
  /** Matters with any amount typed. */
  recorded: number;
}

export function sumMoney(ms: MisMatter[]): Money {
  const t: Money = { matters: ms.length, demand: 0, tax: 0, interest: 0, penalty: 0, cess: 0, preDeposit: 0, paid: 0, outstanding: 0, proposed: 0, confirmed: 0, refund: 0, recorded: 0 };
  ms.forEach((m) => {
    t.demand += m.demand; t.tax += m.tax; t.interest += m.interest; t.penalty += m.penalty; t.cess += m.cess;
    t.preDeposit += m.preDeposit; t.paid += m.paid; t.outstanding += m.outstanding; t.refund += m.refundAtStake;
    if (m.forum === 'notice') t.proposed += m.outstanding; else t.confirmed += m.outstanding;
    if (m.recorded) t.recorded += 1;
  });
  return t;
}

export interface Bucket { key: string; label: string; description?: string; tone: Tone; rows: MisMatter[]; money: Money }

export interface ClientRow {
  clientId: string; name: string; gstin: string | null;
  rows: MisMatter[]; money: Money; share: number;
  next: { clock: Clock; matter: MisMatter } | null;
  overdue: number; hearings14: number;
}

export interface StaffRow {
  key: string; userId: string | null; name: string; role: string | null;
  rows: MisMatter[]; money: Money;
  overdue: number; due7: number; hearings14: number; noAction: number;
  reviews: MisMatter[];
  stalest: MisMatter | null;
}

export interface HearingItem { hearing: MisHearing; matter: MisMatter }
export interface AgendaItem { key: string; date: string; days: number; kind: Clock['kind']; label: string; time?: string; matter: MisMatter }

export type StaticSet = 'demand' | 'predeposit' | 'paid' | 'outstanding' | 'proposed' | 'confirmed' | 'nodemand'
  | 'clocks30' | 'overdue' | 'due7' | 'noaction' | 'idle30' | 'closed30' | 'unassigned' | 'refund' | 'review';

export interface MisReport {
  today: string;
  scope: MisMatter[];
  open: MisMatter[];
  money: Money;
  sets: Record<StaticSet, MisMatter[]>;
  opened30: MisMatter[];
  hearings: { next14: HearingItem[]; later: HearingItem[] };
  agenda: AgendaItem[];
  byClient: ClientRow[];
  byForum: Bucket[];
  byStage: Bucket[];
  byLifecycle: Bucket[];
  byClock: Bucket[];
  byIdle: Bucket[];
  byAge: Bucket[];
  byStaff: StaffRow[];
}

const isDue7 = (m: MisMatter) => !!m.nextClock && m.nextClock.days >= 0 && m.nextClock.days <= 7;
const hearings14 = (m: MisMatter) => m.hearings.filter((h) => h.days <= 13).length;
const byRisk = (a: MisMatter, b: MisMatter) =>
  (a.nextClock?.date ?? '9999').localeCompare(b.nextClock?.date ?? '9999') || b.outstanding - a.outstanding || a.matterNo.localeCompare(b.matterNo);

const bucket = (key: string, label: string, tone: Tone, rows: MisMatter[], description?: string): Bucket =>
  ({ key, label, tone, rows, money: sumMoney(rows), description });

export function buildReport(data: MisData, filters: MisFilters): MisReport {
  const { today } = data;
  const scope = applyFilters(data.matters, filters);
  const open = scope.filter((m) => m.open).sort(byRisk);
  const money = sumMoney(open);

  const sets: Record<StaticSet, MisMatter[]> = {
    demand: open.filter((m) => m.demand > 0),
    predeposit: open.filter((m) => m.preDeposit > 0),
    paid: open.filter((m) => m.paid > 0),
    outstanding: open.filter((m) => m.outstanding > 0),
    proposed: open.filter((m) => m.forum === 'notice' && m.outstanding > 0),
    confirmed: open.filter((m) => m.forum !== 'notice' && m.outstanding > 0),
    nodemand: open.filter((m) => !m.recorded),
    clocks30: open.filter(hasAppealClock30),
    overdue: open.filter(isOverdue),
    due7: open.filter(isDue7),
    noaction: open.filter((m) => !m.nextAction),
    idle30: open.filter((m) => m.idleDays >= 30).sort((a, b) => b.idleDays - a.idleDays),
    closed30: scope.filter((m) => !m.open && m.closedOn && daysBetween(m.closedOn, today) <= 30)
      .sort((a, b) => (b.closedOn ?? '').localeCompare(a.closedOn ?? '')),
    unassigned: open.filter((m) => !m.ownerId),
    refund: open.filter((m) => m.isRefund),
    review: open.filter((m) => m.stage === 'partner_review'),
  };

  const allHearings: HearingItem[] = open.flatMap((m) => m.hearings.map((hearing) => ({ hearing, matter: m })))
    .sort((a, b) => a.hearing.on.localeCompare(b.hearing.on) || (a.hearing.time ?? '').localeCompare(b.hearing.time ?? ''));

  // Every clock in the next 14 days, hearings included (the list's own clocks).
  const agenda: AgendaItem[] = open.flatMap((m) => m.clocks.filter((c) => c.days >= 0 && c.days <= 13).map((c, i): AgendaItem => ({
    key: `${m.id}-${i}`, date: c.date, days: c.days, kind: c.kind,
    label: c.kind === 'hearing' && !c.noticeId ? HEARING_PURPOSE[m.forum] : c.label,
    time: c.at ? istTime(c.at) : undefined, matter: m,
  }))).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));

  // By client (U-101-*): outstanding first, with share, next clock, overdue and hearings.
  const clientMap = new Map<string, MisMatter[]>();
  open.forEach((m) => clientMap.set(m.clientId, [...(clientMap.get(m.clientId) ?? []), m]));
  const byClient: ClientRow[] = [...clientMap.entries()].map(([clientId, rows]) => {
    const m = sumMoney(rows);
    const nextMatter = rows.filter((r) => r.nextClock).sort((a, b) => a.nextClock!.date.localeCompare(b.nextClock!.date))[0];
    return {
      clientId, name: rows[0].clientName, gstin: rows[0].clientGstin, rows, money: m,
      share: money.outstanding > 0 ? m.outstanding / money.outstanding : 0,
      next: nextMatter ? { clock: nextMatter.nextClock!, matter: nextMatter } : null,
      overdue: rows.filter(isOverdue).length,
      hearings14: rows.reduce((s, r) => s + hearings14(r), 0),
    };
  }).sort((a, b) => b.money.outstanding - a.money.outstanding || b.rows.length - a.rows.length || a.name.localeCompare(b.name));

  const byForum = FORUMS.map((f) => bucket(f.key, f.label, f.tone, open.filter((m) => m.forum === f.key), f.description))
    .filter((b) => b.rows.length > 0 || FORUMS.find((f) => f.key === b.key)?.always);
  const byStage = STAGES.filter((s) => s.key !== 'closed').map((s) =>
    bucket(s.key, s.label, s.tone, open.filter((m) => m.stage === s.key), s.description));
  const lifecycleKeys = [...new Set(open.map((m) => m.lifecycle))];
  const byLifecycle = lifecycleKeys.map((k) => bucket(k, lifecycleLabel(k), 'primary', open.filter((m) => m.lifecycle === k)))
    .sort((a, b) => b.money.outstanding - a.money.outstanding || b.money.refund - a.money.refund || b.rows.length - a.rows.length);
  const byClock = CLOCK_BUCKETS.map((b) => bucket(b.key, b.label, b.tone, open.filter((m) => b.test(m.nextClock ? m.nextClock.days : null))));
  const byIdle = IDLE_BUCKETS.map((b) => bucket(b.key, b.label, b.tone, open.filter((m) => b.test(m.idleDays))));
  const byAge = AGE_BUCKETS.map((b) => bucket(b.key, b.label, b.tone, open.filter((m) => ageBucket(m.ageDays) === b.key)));

  // Per staff (U-105-*): keyed by user id, riskiest first; reviews are matters
  // in Partner review where the person is the reviewer.
  const people = new Map<string, StaffInfo | null>();
  const filtered = Object.values(filters).some(Boolean);
  if (!filtered) data.staff.forEach((s) => people.set(s.userId, s));
  open.forEach((m) => {
    if (m.ownerId && !people.has(m.ownerId)) people.set(m.ownerId, data.staff.find((s) => s.userId === m.ownerId) ?? null);
    if (m.stage === 'partner_review' && m.reviewerId && !people.has(m.reviewerId)) people.set(m.reviewerId, data.staff.find((s) => s.userId === m.reviewerId) ?? null);
  });
  if (sets.unassigned.length) people.set('none', null);
  const byStaff: StaffRow[] = [...people.entries()].map(([key, info]) => {
    const rows = open.filter((m) => (key === 'none' ? !m.ownerId : m.ownerId === key));
    const stalest = [...rows].sort((a, b) => b.idleDays - a.idleDays)[0] ?? null;
    return {
      key, userId: key === 'none' ? null : key,
      name: key === 'none' ? 'Unassigned' : info?.name ?? rows[0]?.ownerName ?? 'Former staff member',
      role: info?.role ?? null,
      rows, money: sumMoney(rows),
      overdue: rows.filter(isOverdue).length,
      due7: rows.filter(isDue7).length,
      hearings14: rows.reduce((s, r) => s + hearings14(r), 0),
      noAction: rows.filter((m) => !m.nextAction).length,
      reviews: key === 'none' ? [] : sets.review.filter((m) => m.reviewerId === key),
      stalest,
    };
  }).sort((a, b) => b.overdue - a.overdue || b.due7 - a.due7 || b.hearings14 - a.hearings14 || b.reviews.length - a.reviews.length
    || b.money.outstanding - a.money.outstanding || b.rows.length - a.rows.length || (a.key === 'none' ? 1 : 0) - (b.key === 'none' ? 1 : 0) || a.name.localeCompare(b.name));

  return {
    today, scope, open, money, sets,
    opened30: scope.filter((m) => ageBucket(m.ageDays) === '0-30'),
    hearings: { next14: allHearings.filter((h) => h.hearing.days <= 13), later: allHearings.filter((h) => h.hearing.days > 13) },
    agenda,
    byClient, byForum, byStage, byLifecycle, byClock, byIdle, byAge, byStaff,
  };
}

// ── The page's own lists (every count the Matters list cannot filter by) ────
export interface DrillView {
  key: string;
  title: string;
  description: string;
  rows: MisMatter[];
  amountLabel: string;
  amount: (m: MisMatter) => number;
  /** One line on why the matter is in the list. */
  note?: (m: MisMatter) => string;
}

export function drillView(key: string | null, r: MisReport, staff: StaffInfo[]): DrillView | null {
  if (!key) return null;
  const out = (title: string, description: string, rows: MisMatter[], extra: Partial<DrillView> = {}): DrillView => ({
    key, title, description, rows, amountLabel: 'Outstanding', amount: (m) => m.outstanding, ...extra,
  });
  switch (key) {
    case 'demand': return out('Demand under dispute', 'Open matters with a demand recorded (refund matters excluded)', r.sets.demand,
      { amountLabel: 'Demand', amount: (m) => m.demand, note: (m) => `Tax ${m.tax.toLocaleString('en-IN')} · interest ${m.interest.toLocaleString('en-IN')} · penalty ${m.penalty.toLocaleString('en-IN')}` });
    case 'predeposit': return out('Pre-deposit made', 'Open matters with a pre-deposit recorded', r.sets.predeposit, { amountLabel: 'Pre-deposit', amount: (m) => m.preDeposit });
    case 'paid': return out('Paid against demand', 'Open matters with a payment recorded (pre-deposit not included)', r.sets.paid, { amountLabel: 'Paid', amount: (m) => m.paid });
    case 'outstanding': return out('Outstanding', 'Open matters where demand is more than pre-deposit and payments', r.sets.outstanding);
    case 'proposed': return out('Proposed: still at the notice stage', 'Outstanding on matters before any order', r.sets.proposed);
    case 'confirmed': return out('Confirmed: order passed or later', 'Outstanding on matters with an order, in appeal, at the tribunal or in recovery', r.sets.confirmed);
    case 'nodemand': return out('Amount not recorded', 'Open matters with no demand or refund amount typed', r.sets.nodemand, { note: (m) => lifecycleLabel(m.lifecycle) });
    case 'due7': return out('Next clock within 7 days', 'Open matters whose next clock falls today or in the next 7 days', r.sets.due7);
    case 'noaction': return out('No next action written', 'Open matters with an empty next action', r.sets.noaction);
    case 'idle30': return out('Untouched for 30 days or more', 'Open matters with no change for 30 days or more', r.sets.idle30, { note: (m) => `Untouched ${plural(m.idleDays, 'day')}` });
    case 'closed30': return out('Closed in the last 30 days', 'Matters closed in the last 30 days, with their demand', r.sets.closed30,
      { amountLabel: 'Demand', amount: (m) => m.demand, note: (m) => `Closed ${fmtDate(m.closedOn)}${m.closedReason ? ` · ${m.closedReason}` : ''}` });
    default: break;
  }
  const [kind, value] = key.split(':');
  if (kind === 'forum') {
    const b = r.byForum.find((x) => x.key === value);
    return b ? out(`Forum: ${b.label}`, b.description ?? '', b.rows, { note: (m) => `${stageLabel(m.stage)} · ${lifecycleLabel(m.lifecycle)}` }) : null;
  }
  if (kind === 'clock') {
    const b = r.byClock.find((x) => x.key === value);
    return b ? out(`Next clock: ${b.label.toLowerCase()}`, 'Open matters by the time left on their next clock', b.rows) : null;
  }
  if (kind === 'idle') {
    const b = r.byIdle.find((x) => x.key === value);
    return b ? out(`Untouched for ${b.label.toLowerCase()}`, 'Open matters by days since the matter last changed', b.rows, { note: (m) => `Untouched ${plural(m.idleDays, 'day')}` }) : null;
  }
  if (kind === 'review' && value) {
    const who = staff.find((s) => s.userId === value)?.name ?? 'this reviewer';
    return out(`Awaiting review by ${who}`, 'Open matters in Partner review with this person as the reviewer', r.sets.review.filter((m) => m.reviewerId === value),
      { note: (m) => `Owner ${m.ownerName ?? 'unassigned'}` });
  }
  return null;
}

/** Links every MIS number uses: the page's own list, another tab, or the Matters list (page filters kept). */
export interface MisLinks {
  drill: (show: string, patch?: Partial<Record<'client' | 'owner', string>>) => string;
  tab: (tab: string, patch?: Partial<Record<'client' | 'owner' | 'by', string>>) => string;
  matters: (extra?: MattersLink) => string;
}
