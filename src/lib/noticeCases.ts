// Notice cases (the firm's request of 9 October 2026): one case per issue, its
// notices and every document of its portal case folder merged into one
// correspondence, a dashboard per kind of portal service, and the overview the
// AI keeps filled from every document of the case. Everything is computed in
// the database (migration 20261011100000_notice_cases.sql): the view
// notice_cases, notice_case_items(), notice_case_overview() and
// notice_cases_counts(); this file only loads it and names things.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { applyMasterToQuery, type Master } from '@/lib/masterFilters';
import type { WorkspaceTab } from '@/lib/noticeStages';

export type CaseRow = Database['public']['Views']['notice_cases']['Row'];
/** A case on its own (notice_cases_flat, 20261024100000): the same row, with the chain it belongs to. */
export type FlatCaseRow = Database['public']['Views']['notice_cases_flat']['Row'];
/** Linked: one row per chain (an order and its appeal together). Apart: every portal case on its own. */
export type CaseView = 'linked' | 'apart';
export const isCaseView = (v: string | null | undefined): v is CaseView => v === 'linked' || v === 'apart';
export type Track = 'litigation' | 'refund' | 'registration' | 'other';

export interface TrackDef { key: Track; label: string; short: string; blurb: string }

/** The four dashboards, in the order the tabs show them (public.notice_track). */
export const TRACKS: TrackDef[] = [
  { key: 'litigation', label: 'Notices & demands', short: 'Notices', blurb: 'Show cause notices, scrutiny, audit, demands, recovery and appeals' },
  { key: 'refund', label: 'Refunds', short: 'Refunds', blurb: 'Refund applications, deficiency memos, provisional and final orders, payments' },
  { key: 'registration', label: 'Registration', short: 'Registration', blurb: 'Applications, queries, amendments, cancellation and revocation' },
  { key: 'other', label: 'Other', short: 'Other', blurb: 'LUT, voluntary payments and approvals: for the record, no action' },
];
export const trackDef = (t: string | null | undefined): TrackDef => TRACKS.find((x) => x.key === t) ?? TRACKS[0];
export const isTrack = (v: string | null | undefined): v is Track => TRACKS.some((t) => t.key === v);

/** public.notice_track, for a notice already on screen (its category from notice_facts). */
export function trackOfCategory(category: string | null | undefined): Track {
  if (category === 'Refunds') return 'refund';
  if (category === 'Registration') return 'registration';
  if (!category || category === 'LUT' || category === 'Voluntary Payment' || category === 'Others') return 'other';
  return 'litigation';
}

/** public.notice_case_key. */
export function caseKeyOf(caseId: string | null | undefined, category: string | null | undefined, id: string): string {
  const c = (caseId ?? '').trim();
  if (c) return c;
  return category === 'Registration' ? 'REG' : `N:${id}`;
}

export const caseHref = (clientId: string, caseKey: string) => `/notices-case/${clientId}/${encodeURIComponent(caseKey)}`;

/**
 * Where a notice opens from a list (the firm, 25 October 2026): its case, with
 * the case's timeline, the notice marked on it. Only "Work on it" opens the
 * notice's own workspace (/notices/:id). Pass the case when the row has it;
 * with an id alone the page /notices-open/:id finds the case first.
 */
export function noticeCaseHref(n: { id: string; client_id?: string | null; case_id?: string | null; category?: string | null }): string {
  if (!n.client_id) return `/notices-open/${n.id}`;
  return `${caseHref(n.client_id, caseKeyOf(n.case_id, n.category, n.id))}?notice=${n.id}`;
}

// ── Lists and counts ───────────────────────────────────────────────────────
export type CaseShow = 'open' | 'new' | 'all' | 'overdue' | 'due7' | 'with_us' | 'with_dept' | 'closed';
export const CASE_SHOWS: readonly CaseShow[] = ['open', 'new', 'all', 'overdue', 'due7', 'with_us', 'with_dept', 'closed'];

/** Whose move it is on a case (notice_cases.waiting_on, migration 20261013110000). */
export type WaitingOn = 'us' | 'department' | 'closed';
export const WAITING: Record<WaitingOn, { label: string; short: string; tone: 'warning' | 'info' | 'secondary'; hint: string }> = {
  us: { label: 'With us', short: 'With us', tone: 'warning', hint: 'The next move is the firm\'s: reply, pay, file or decide.' },
  department: { label: 'With the department', short: 'With dept', tone: 'info', hint: 'We have replied, filed or appealed: waiting for the officer.' },
  closed: { label: 'Closed', short: 'Closed', tone: 'secondary', hint: 'Nothing more to do.' },
};
export const waitingOf = (r: { waiting_on?: string | null; is_open?: boolean | null }): WaitingOn =>
  r.waiting_on === 'department' || r.waiting_on === 'closed' || r.waiting_on === 'us' ? r.waiting_on : r.is_open === false ? 'closed' : 'us';
/** track 'work': every kind the firm acts on (all but Other, which is kept for the record). */
export interface CaseQuery { track: Track | 'all' | 'work'; show: CaseShow; q: string; master: Master; meId: string | null }

export async function loadCases(c: CaseQuery, page: number, pageSize: number, view: CaseView = 'linked'): Promise<{ rows: FlatCaseRow[]; total: number }> {
  // Both views have the same columns (the apart one four more), so one query serves.
  let q = supabase.from((view === 'apart' ? 'notice_cases_flat' : 'notice_cases') as 'notice_cases').select('*', { count: 'exact' });
  if (c.track === 'work') q = q.neq('track', 'other');
  else if (c.track !== 'all') q = q.eq('track', c.track);
  if (c.show === 'open') q = q.eq('is_open', true);
  if (c.show === 'new') q = q.gt('new_items', 0);
  if (c.show === 'overdue') q = q.eq('is_overdue', true);
  if (c.show === 'due7') q = q.eq('is_due_in_7', true);
  if (c.show === 'with_us') q = q.eq('waiting_on', 'us');
  if (c.show === 'with_dept') q = q.eq('waiting_on', 'department');
  if (c.show === 'closed') q = q.eq('waiting_on', 'closed');
  q = applyMasterToQuery(q, c.master, c.meId);
  const t = c.q.trim().replace(/[%,()]/g, ' ');
  if (t) q = q.or(`client_name.ilike.%${t}%,client_gstin.ilike.%${t}%,case_key.ilike.%${t}%,reference_number.ilike.%${t}%,title.ilike.%${t}%`);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await q
    .order('new_items', { ascending: false })
    .order('is_overdue', { ascending: false })
    .order('next_due', { ascending: true, nullsFirst: false })
    .order('last_activity_date', { ascending: false, nullsFirst: false })
    .order('case_key')
    .range(from, from + pageSize - 1);
  if (error) {
    if (view === 'apart' && /notice_cases_flat/.test(error.message)) throw new Error('Seeing cases apart needs migration 20261024100000_notice_case_chains.sql on the database.');
    if (/notice_cases/.test(error.message)) throw new Error('Cases need migration 20261011100000_notice_cases.sql on the database.');
    throw error;
  }
  return { rows: (data ?? []) as FlatCaseRow[], total: count ?? 0 };
}

export interface TrackCounts {
  cases: number; open: number; new: number; new_items: number; overdue: number; due7: number; hearings: number; unassigned: number; exposure: number;
  /** 20261012110000 */
  in_appeal: number; next_due: string | null; next_hearing: string | null; oldest_overdue_days: number | null;
  overdue_age: { d30: number; d90: number; d365: number; older: number };
  /** 20261013110000: whose move it is. */
  with_us: number; with_dept: number; closed: number;
  /** 20261024100000, cases apart only: those linked into another case. */
  linked?: number;
}
const ZERO: TrackCounts = {
  cases: 0, open: 0, new: 0, new_items: 0, overdue: 0, due7: 0, hearings: 0, unassigned: 0, exposure: 0,
  in_appeal: 0, next_due: null, next_hearing: null, oldest_overdue_days: null, overdue_age: { d30: 0, d90: 0, d365: 0, older: 0 },
  with_us: 0, with_dept: 0, closed: 0,
};

export async function loadCaseCounts(filters: Record<string, string> | null, view: CaseView = 'linked'): Promise<Record<Track, TrackCounts>> {
  const { data, error } = view === 'apart'
    ? await supabase.rpc('notice_cases_counts_flat', { p_filters: filters })
    : await supabase.rpc('notice_cases_counts', { p_filters: filters });
  if (error) throw error;
  const d = (data ?? {}) as Partial<Record<Track, Partial<TrackCounts>>>;
  const out = {} as Record<Track, TrackCounts>;
  for (const t of TRACKS) out[t.key] = { ...ZERO, ...(d[t.key] ?? {}) } as TrackCounts;
  return out;
}

export function useCaseCounts(filters: Record<string, string> | null, view: CaseView = 'linked') {
  return useQuery({ queryKey: ['notice-case-counts', filters, view], queryFn: () => loadCaseCounts(filters, view), staleTime: 60_000 });
}

// ── One case ───────────────────────────────────────────────────────────────
export async function loadCase(clientId: string, caseKey: string): Promise<CaseRow | null> {
  const { data, error } = await supabase.from('notice_cases').select('*').eq('client_id', clientId).eq('case_key', caseKey).maybeSingle();
  if (error) throw error;
  if (data) return data as CaseRow;
  // A case linked into another is shown as part of the chain it belongs to.
  const root = await supabase.rpc('notice_case_root', { p_client_id: clientId, p_key: caseKey });
  if (root.error || !root.data || root.data === caseKey) return null;
  const r = await supabase.from('notice_cases').select('*').eq('client_id', clientId).eq('case_key', root.data).maybeSingle();
  if (r.error) throw r.error;
  return (r.data as CaseRow | null) ?? null;
}

export interface CaseItem {
  /** application: filed on the portal, with no case folder or notice of its own yet (20261024120000). */
  kind: 'notice' | 'document' | 'application';
  id: string;
  from: 'department' | 'taxpayer';
  date: string | null;
  arrived_at: string | null;
  label: string;
  reference: string | null;
  section: string | null;
  is_new: boolean;
  /** The portal case the item itself is in (20261024100000); differs from the page's case when cases are linked. */
  own_key?: string | null;
  stage: string | null;
  stage_label: string | null;
  is_open: boolean | null;
  pdf_url: string | null;
  attachments: { label?: string; url?: string }[] | null;
  ai: { title: string | null; summary: string | null; doc_kind: string | null; outcome: string | null; doc_date: string | null; status: string; reason_class: string | null; usage?: unknown; model?: string | null } | null;
  notice_read: { status: string; outcome: string | null; summary: string | null; usage?: unknown; model?: string | null } | null;
  /** What the portal's own record of the item says (20261025140000). */
  facts?: CaseItemFacts | null;
}

export interface CaseItemFacts {
  hearing?: { date: string; time?: string; venue?: string };
  due?: string; section_of_law?: string; fy?: string; type?: string;
  /** An appeal's application (APL-01). */
  form?: string; order_ref?: string; order_date?: string; order_comm_date?: string;
  disputed_tax?: number; disputed_total?: number; predeposit?: number; predeposit_pct?: number;
  /** The pre-deposit's payment reference (PRN), 20261025170000. */
  predeposit_prn?: string;
  filed_on?: string; second_appeal?: boolean; issues?: string[]; portal_status?: string;
  /** Every document the record lists, downloaded or not. */
  portal_docs?: { id: string; name?: string; file?: string }[];
}

/** A date the law attaches to the case's papers (notice_case_key_dates, 20261025140000). */
export type KeyDateKind = 'hearing' | 'adjournment' | 'reply_due' | 'pay_to_close' | 'appeal_window' | 'appeal_filed' | 'predeposit' | 'payment_due';
export interface KeyDate {
  date: string; kind: KeyDateKind; title: string; detail?: string | null;
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; law?: string | null;
  own_key?: string | null; item_id?: string | null; upcoming: boolean;
}

export async function loadKeyDates(clientId: string, caseKey: string): Promise<KeyDate[]> {
  const { data, error } = await supabase.rpc('notice_case_key_dates', { p_client_id: clientId, p_case_key: caseKey });
  if (error) {
    // Before 20261025140000 the timeline has no key dates; it still shows the papers.
    if (/notice_case_key_dates/.test(error.message)) return [];
    throw error;
  }
  return (Array.isArray(data) ? data : []) as unknown as KeyDate[];
}

export async function loadCaseItems(clientId: string, caseKey: string): Promise<CaseItem[]> {
  const { data, error } = await supabase.rpc('notice_case_items', { p_client_id: clientId, p_case_key: caseKey });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as CaseItem[];
}

export interface OverviewValue { value: string; source: 'notice' | 'ai'; notice_id?: string; document_id?: string; label: string | null; date: string | null }
export type OverviewKey = 'section_of_law' | 'financial_year' | 'period_from' | 'period_to' | 'din' | 'reply_due'
  | 'hearing_date' | 'hearing_note' | 'officer' | 'amount_of_demand';
export interface AmountRead { value: number; document_id: string; label: string | null; date: string | null }
export interface RefundFacts {
  arn?: string; reason?: string; period_from?: string; period_to?: string; claimed?: number; filed_on?: string; status?: string;
  refund_claimed?: AmountRead; refund_provisional?: AmountRead; refund_sanctioned?: AmountRead; refund_rejected?: AmountRead;
  refund_net_payable?: AmountRead; refund_paid?: AmountRead;
}
export interface RegistrationFacts { application_type?: string; application_arn?: string; application_date?: string; document_id?: string; label?: string }
export interface CaseOverview {
  fields: Partial<Record<OverviewKey, OverviewValue>>;
  /** Every form the case holds: its notices' and those its portal case folder files name. */
  forms: string[];
  refund: RefundFacts | null;
  registration: RegistrationFacts | null;
  reading: { documents: number; done: number; queued: number; failed: number } | null;
  summaries: { document_id: string; title: string | null; summary: string; doc_kind: string | null; outcome: string | null; date: string | null; from: string }[];
}

export async function loadCaseOverview(clientId: string, caseKey: string, noticeId: string | null = null): Promise<CaseOverview> {
  const { data, error } = await supabase.rpc('notice_case_overview', { p_client_id: clientId, p_case_key: caseKey, p_notice_id: noticeId });
  if (error) throw error;
  const d = (data ?? {}) as Partial<CaseOverview>;
  return { fields: d.fields ?? {}, forms: d.forms ?? [], refund: d.refund ?? null, registration: d.registration ?? null, reading: d.reading ?? null, summaries: d.summaries ?? [] };
}

export function useCaseOverview(clientId: string | null | undefined, caseKey: string | null | undefined, noticeId: string | null = null) {
  return useQuery({
    queryKey: ['notice-case-overview', clientId, caseKey, noticeId],
    queryFn: () => loadCaseOverview(clientId as string, caseKey as string, noticeId),
    enabled: !!clientId && !!caseKey,
    staleTime: 30_000,
    // While the case's documents are being read, the overview fills in.
    refetchInterval: (q) => ((q.state.data?.reading?.queued ?? 0) > 0 ? 30_000 : false),
  });
}

export async function markCaseSeen(clientId: string, caseKey: string, by: string | null): Promise<void> {
  const { error } = await supabase.rpc('notice_case_mark_seen', { p_client_id: clientId, p_case_key: caseKey, p_by_name: by });
  if (error) throw error;
}

// ── What each kind of service needs on a notice's page ─────────────────────
// A refund, registration or record-only notice has no demand, no evidence to
// build and no hearing: its page shows the facts of its own kind and only the
// tabs that apply.
export function tabsFor(track: Track, needsReply: boolean): WorkspaceTab[] {
  switch (track) {
    case 'litigation': return ['issues', 'evidence', 'assistant', 'draft', 'documents', 'activity', 'payments', 'hearings', 'deadlines'];
    case 'refund': return needsReply ? ['assistant', 'draft', 'documents', 'activity', 'deadlines'] : ['documents', 'activity', 'deadlines'];
    case 'registration': return needsReply ? ['assistant', 'draft', 'documents', 'activity', 'deadlines'] : ['documents', 'activity'];
    default: return ['documents', 'activity'];
  }
}

/** Refund reasons as the portal codes them (RFD-01 "refundRsn"). */
export const REFUND_REASONS: Record<string, string> = {
  EXPWP: 'Export of services or goods with payment of tax',
  EXPWOP: 'Export without payment of tax (accumulated ITC)',
  SEZWP: 'Supplies to SEZ with payment of tax',
  SEZWOP: 'Supplies to SEZ without payment of tax (accumulated ITC)',
  INVITC: 'Inverted duty structure (accumulated ITC)',
  XSPAY: 'Excess payment of tax',
  EXBCL: 'Excess balance in the electronic cash ledger',
  ASSESS: 'On account of an assessment, provisional assessment, appeal or other order',
  INTRA: 'Tax paid as intra-State, held inter-State (or the reverse)',
  DEEMEXP: 'Deemed exports',
  UNJUST: 'Tax on a supply not provided',
  ANYOTH: 'Any other reason',
};

/** "042024" (MMYYYY) → "Apr 2024". */
export function fmtReturnPeriod(p: string | null | undefined): string {
  // The portal writes MMYYYY (012024) in some places and YYYYMM (202401) in others.
  const v = p ?? '';
  const ym = /^(20\d{2})(0[1-9]|1[0-2])$/.exec(v);
  const my = /^(0[1-9]|1[0-2])(\d{4})$/.exec(v);
  if (!ym && !my) return v;
  const d = ym ? new Date(Number(ym[1]), Number(ym[2]) - 1, 1) : new Date(Number(my![2]), Number(my![1]) - 1, 1);
  return Number.isNaN(d.getTime()) ? p ?? '' : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export interface KindStep { key: string; label: string; forms: string[] }

/** The steps of a refund and of a registration matter, each done when one of its forms is in the case. */
export const KIND_STEPS: Partial<Record<Track, KindStep[]>> = {
  refund: [
    { key: 'filed', label: 'Applied (RFD-01)', forms: ['RFD-01', '__APPLICATION'] },
    { key: 'ack', label: 'Acknowledged (RFD-02)', forms: ['RFD-02'] },
    { key: 'query', label: 'Deficiency or show cause (RFD-03 / RFD-08)', forms: ['RFD-03', 'RFD-08'] },
    { key: 'provisional', label: 'Provisional (RFD-04)', forms: ['RFD-04'] },
    { key: 'order', label: 'Order (RFD-06)', forms: ['RFD-06', 'PMT-03'] },
    { key: 'paid', label: 'Paid (RFD-05)', forms: ['RFD-05'] },
  ],
  registration: [
    { key: 'query', label: 'Query or show cause (REG-03 / REG-17 / REG-23)', forms: ['REG-03', 'REG-17', 'REG-23', 'REG-SCN'] },
    { key: 'order', label: 'Order (REG-05 / REG-06 / REG-15 / REG-19 / REG-22)', forms: ['REG-05', 'REG-06', 'REG-15', 'REG-19', 'REG-22', 'REG-CANCEL-REJ'] },
  ],
};

// ── Links that are not certain: suggestions a person accepts (20261012100000) ──
export interface Drc03Suggestion { arn: string; filed_date: string | null; amount: number; cause: string | null; financial_year: string | null; score: number; reasons: string[] }
export interface CaseSuggestion { notice_id: string; form_code: string | null; reference: string | null; case_id: string; issue_date: string | null; financial_year: string | null; amount: number | null; score: number; reasons: string[] }
export interface LinkSuggestions { drc03: Drc03Suggestion[]; cases: CaseSuggestion[]; case_key: string | null }

export async function loadLinkSuggestions(noticeId: string): Promise<LinkSuggestions> {
  const { data, error } = await supabase.rpc('notice_link_suggestions', { p_notice_id: noticeId });
  if (error) throw error;
  const d = (data ?? {}) as Partial<LinkSuggestions>;
  return { drc03: d.drc03 ?? [], cases: d.cases ?? [], case_key: d.case_key ?? null };
}

export function useLinkSuggestions(noticeId: string | null | undefined) {
  return useQuery({ queryKey: ['notice-link-suggestions', noticeId], queryFn: () => loadLinkSuggestions(noticeId as string), enabled: !!noticeId, staleTime: 60_000 });
}

/** A person links a case into the case it belongs to (kind: appeal, waiver, rectification, related). */
export async function setCaseLink(clientId: string, childKey: string, parentKey: string | null, kind: string | null, by: string | null): Promise<void> {
  const { error } = await supabase.rpc('notice_case_link_set', { p_client_id: clientId, p_child_key: childKey, p_parent_key: parentKey, p_kind: kind, p_by: by });
  if (error) throw error;
}

// ── Chains: cases linked into one, seen linked or apart (20261024100000) ──
export type LinkKind = 'appeal' | 'waiver' | 'rectification' | 'reapplication' | 'related';
export const LINK_KINDS: { key: LinkKind; label: string; child: string; parent: string }[] = [
  { key: 'appeal', label: 'Appeal', child: 'is an appeal against', parent: 'is appealed in' },
  { key: 'waiver', label: 'Waiver (s.128A)', child: 'is a waiver application against', parent: 'has a waiver application in' },
  { key: 'rectification', label: 'Rectification', child: 'is a rectification of', parent: 'is rectified in' },
  { key: 'reapplication', label: 'Fresh application', child: 'is a fresh application after', parent: 'was applied for again in' },
  { key: 'related', label: 'Related', child: 'is related to', parent: 'is related to' },
];
export const linkKindDef = (k: string | null | undefined) => LINK_KINDS.find((x) => x.key === k) ?? LINK_KINDS[LINK_KINDS.length - 1];

export interface CaseOrder { form: string | null; ref: string | null; date: string | null }
export interface CaseRefund { sanctioned: number | null; rejected: number | null }
export interface ChainMember {
  case_key: string; case_id: string | null;
  parent_key: string | null; kind: LinkKind | null; source: 'auto' | 'manual' | null; reason: string | null; via_ref: string | null;
  linked_by: string | null; linked_at: string | null;
  /** What the case itself is: an appeal, a waiver, a rectification (null: an original case). */
  marker: 'appeal' | 'waiver' | 'rectification' | null;
  track: Track; title: string | null; form_code: string | null; forms: string[] | null; lead_notice_id: string | null;
  stage: string | null; is_open: boolean; notices: number; documents: number;
  first_date: string | null; last_date: string | null; financial_year: string | null; amount: number | null;
  order: CaseOrder | null; refund: CaseRefund | null;
  /** The application filed on the portal under this ARN (20261024120000); an appeal only submitted has nothing else yet. */
  application?: { form: string | null; status: string | null; filed_date: string | null; against: string | null } | null;
}
export interface CaseChain {
  root_key: string;
  members: ChainMember[];
  unlinked: { child_key: string; parent_key: string; by: string | null; at: string }[];
}

export async function loadCaseChain(clientId: string, caseKey: string): Promise<CaseChain> {
  const { data, error } = await supabase.rpc('notice_case_chain', { p_client_id: clientId, p_case_key: caseKey });
  if (error) {
    if (/notice_case_chain/.test(error.message)) throw new Error('Linked cases need migration 20261024100000_notice_case_chains.sql on the database.');
    throw error;
  }
  const d = (data ?? {}) as Partial<CaseChain>;
  return { root_key: d.root_key ?? caseKey, members: d.members ?? [], unlinked: d.unlinked ?? [] };
}

export function useCaseChain(clientId: string | null | undefined, caseKey: string | null | undefined) {
  return useQuery({ queryKey: ['notice-case-chain', clientId, caseKey], queryFn: () => loadCaseChain(clientId as string, caseKey as string), enabled: !!clientId && !!caseKey, staleTime: 30_000 });
}

export interface LinkCandidate {
  /** The case of this chain the suggestion is for, and the other case (another chain's root). */
  member_key: string; other_key: string;
  /** Which way it would be linked: the child belongs to the parent. */
  child_key: string; parent_key: string;
  kind: LinkKind; score: number; reasons: string[];
  other: Pick<ChainMember, 'case_key' | 'case_id' | 'title' | 'form_code' | 'forms' | 'track' | 'marker' | 'is_open' | 'lead_notice_id'
    | 'first_date' | 'last_date' | 'financial_year' | 'amount' | 'order' | 'refund'>
    /** A refund application's type and period (YYYY-MM), 20261025150000. */
    & { refund_type?: string | null; period_from?: string | null; period_to?: string | null };
}

/** The client's other cases that may belong with this chain, best first (min: lowest score; a low one lists them all). */
export async function loadLinkCandidates(clientId: string, caseKey: string, min = 40): Promise<LinkCandidate[]> {
  const { data, error } = await supabase.rpc('notice_case_link_candidates', { p_client_id: clientId, p_case_key: caseKey, p_min: min });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as LinkCandidate[];
}

export function useLinkCandidates(clientId: string | null | undefined, caseKey: string | null | undefined, min = 40, enabled = true) {
  return useQuery({
    queryKey: ['notice-case-candidates', clientId, caseKey, min],
    queryFn: () => loadLinkCandidates(clientId as string, caseKey as string, min),
    enabled: enabled && !!clientId && !!caseKey, staleTime: 60_000,
  });
}

/** Hand a case back to the system: a person's link or unlink of it goes; it is linked again only when certain. */
export async function resetCaseLink(clientId: string, childKey: string): Promise<void> {
  const { error } = await supabase.rpc('notice_case_link_reset', { p_client_id: clientId, p_child_key: childKey });
  if (error) throw error;
}

export interface ChainLink { client_id: string; child_key: string; parent_key: string; kind: string; source: string }

/** The links of these clients, for the chains on a page of cases. */
export async function loadChainLinks(clientIds: string[]): Promise<ChainLink[]> {
  if (!clientIds.length) return [];
  const { data, error } = await supabase.from('notice_case_links').select('client_id, child_key, parent_key, kind, source').in('client_id', clientIds);
  if (error) throw error;
  return (data ?? []) as ChainLink[];
}

/** The root of a case within its client's links (notice_case_root, in the browser). */
export function rootOf(links: ChainLink[], clientId: string, key: string): string {
  const up = new Map(links.filter((l) => l.client_id === clientId).map((l) => [l.child_key, l.parent_key]));
  let k = key;
  for (let i = 0; i < 12 && up.has(k); i += 1) {
    const next = up.get(k) as string;
    if (next === key) break;
    k = next;
  }
  return k;
}

/** The cases linked under each chain on the page: (client:root) → links below it. */
export function chainsOf(links: ChainLink[]): Map<string, ChainLink[]> {
  const out = new Map<string, ChainLink[]>();
  for (const l of links) {
    const id = `${l.client_id}:${rootOf(links, l.client_id, l.child_key)}`;
    out.set(id, [...(out.get(id) ?? []), l]);
  }
  return out;
}

// ── Linking checked by a person (20261025100000) ──────────────────────────
/** The system links by itself only at or above this confidence; below it a person decides. */
export const MIN_LINK_CONFIDENCE = 90;
export type ReviewIssue = 'low_confidence' | 'unlinked' | 'duplicate';
export interface ReviewCase {
  case_key: string; case_id: string | null; marker: ChainMember['marker']; track: Track; title: string | null; form_code: string | null;
  forms: string[] | null; lead_notice_id: string | null; is_open: boolean; first_date: string | null; last_date: string | null;
  financial_year: string | null; amount: number | null; order: CaseOrder | null;
}
export interface ReviewItem {
  issue: ReviewIssue;
  client_id: string; client_name: string | null;
  child_key: string; parent_key: string | null; kind: LinkKind | null;
  /** How sure the system was, 0 to 99 (null: nothing to score). */
  confidence: number | null;
  reasons: string[];
  via_ref?: string | null;
  child: ReviewCase | null; parent: ReviewCase | null;
}
export const REVIEW_ISSUES: Record<ReviewIssue, { label: string; blurb: string }> = {
  low_confidence: { label: 'Not sure enough to link', blurb: `The papers suggest these belong together, but the system is under ${MIN_LINK_CONFIDENCE}% sure, so it did not link them.` },
  unlinked: { label: 'Linked to no order', blurb: 'An appeal, waiver or rectification that is not linked to the case it is against.' },
  duplicate: { label: 'Looks like the same case twice', blurb: 'Two cases with the same order, or the same order form, year and amount.' },
};

export async function loadReviewQueue(clientId: string | null): Promise<ReviewItem[]> {
  const { data, error } = await supabase.rpc('notice_case_review_queue', { p_client_id: clientId });
  if (error) {
    if (/notice_case_review_queue/.test(error.message)) throw new Error('The review list needs migration 20261025100000_notice_case_link_review.sql on the database.');
    throw error;
  }
  return (Array.isArray(data) ? data : []) as unknown as ReviewItem[];
}

export function useReviewQueue(clientId: string | null, enabled = true) {
  return useQuery({ queryKey: ['notice-case-review', clientId], queryFn: () => loadReviewQueue(clientId), enabled, staleTime: 60_000 });
}

export type ReviewDecision = 'link' | 'not_linked' | 'dismissed';
export async function decideReview(item: Pick<ReviewItem, 'client_id' | 'issue' | 'child_key'>, parentKey: string | null,
  decision: ReviewDecision, kind: LinkKind | null, by: string | null): Promise<void> {
  const { error } = await supabase.rpc('notice_case_review_decide', {
    p_client_id: item.client_id, p_issue: item.issue, p_child_key: item.child_key, p_parent_key: parentKey,
    p_decision: decision, p_kind: kind, p_by: by,
  });
  if (error) throw error;
}

/** What a case is, in a few words (an order's form and number, or its lead notice). */
export function caseLabel(m: Pick<ChainMember, 'case_id' | 'case_key' | 'form_code' | 'title' | 'marker' | 'track'>): string {
  const what = m.marker === 'appeal' ? 'Appeal' : m.marker === 'waiver' ? 'Waiver application' : m.marker === 'rectification' ? 'Rectification'
    : m.track === 'refund' ? 'Refund' : m.track === 'registration' ? 'Registration' : 'Case';
  return `${what}${m.form_code ? ` · ${m.form_code}` : m.title ? ` · ${m.title}` : ''}`;
}

/** A refund order's outcome, from the amounts the AI read in it. */
export function refundOutcome(r: CaseRefund | null | undefined): string | null {
  if (!r) return null;
  const s = Number(r.sanctioned ?? 0);
  const x = Number(r.rejected ?? 0);
  // The AI sometimes reads the amount claimed as the amount rejected (live, 24 October
  // 2026: "rejected" equal to or above "sanctioned" on most refunds): say nothing then.
  if (x > 0 && s > 0) return x < s ? 'partly rejected' : null;
  if (x > 0) return 'rejected';
  if (s > 0) return 'sanctioned';
  return null;
}

/** How a case is linked to its parent, in a sentence: "Appeal against the RFD-06 order ZF… of 12 Mar 2025 (partly rejected)". */
export function describeLink(m: ChainMember, parent: ChainMember | undefined, fmt: (d: string) => string): string {
  const def = linkKindDef(m.kind);
  if (!parent) return `${def.label}`;
  const o = parent.order;
  const against = o?.form || o?.ref
    ? `the ${o.form && o.form !== 'Order' ? `${o.form} ` : ''}order${o.ref ? ` ${o.ref}` : ''}${o.date ? ` of ${fmt(o.date)}` : ''}`
    : `case ${parent.case_id ?? parent.case_key}`;
  const out = parent.track === 'refund' ? refundOutcome(parent.refund) : null;
  switch (m.kind) {
    case 'appeal': return `Appeal against ${against}${out ? ` (refund ${out})` : ''}`;
    case 'waiver': return `Waiver application against ${against}`;
    case 'rectification': return `Rectification of ${against}`;
    case 'reapplication': return `Fresh application after case ${parent.case_id ?? parent.case_key}${out ? ` (refund ${out})` : ''}`;
    default: return `Related to case ${parent.case_id ?? parent.case_key}`;
  }
}

// ── Closing, reopening, handled elsewhere (superadmin and GST manager) ────
interface Actor { id: string; firstName?: string | null }
const rpcResult = (data: unknown) => (data && typeof data === 'object' ? data : {}) as { error?: string };

export async function closeCase(clientId: string, caseKey: string, reason: string, actor: Actor): Promise<void> {
  const { data, error } = await supabase.rpc('notice_case_close', { p_client_id: clientId, p_case_key: caseKey, p_reason: reason, p_actor_id: actor.id, p_actor_name: actor.firstName ?? null });
  if (error) throw error;
  if (rpcResult(data).error) throw new Error(rpcResult(data).error);
}
export async function reopenCase(clientId: string, caseKey: string, actor: Actor): Promise<void> {
  const { data, error } = await supabase.rpc('notice_case_reopen', { p_client_id: clientId, p_case_key: caseKey, p_actor_id: actor.id, p_actor_name: actor.firstName ?? null });
  if (error) throw error;
  if (rpcResult(data).error) throw new Error(rpcResult(data).error);
}
export async function excludeCase(clientId: string, caseKey: string, exclude: boolean, reason: string | null, actor: Actor): Promise<void> {
  const { data, error } = await supabase.rpc('notice_case_exclude', { p_client_id: clientId, p_case_key: caseKey, p_exclude: exclude, p_reason: reason, p_actor_id: actor.id, p_actor_name: actor.firstName ?? null });
  if (error) throw error;
  if (rpcResult(data).error) throw new Error(rpcResult(data).error);
}
export interface ExcludedCase {
  client_id: string; client_name: string; client_gstin: string; case_key: string; excluded_at: string;
  excluded_by_name: string | null; excluded_reason: string | null; notices: number; forms: string | null;
  /** Only single notices hidden (not the whole case), and their references. */
  single_notices?: boolean; references?: string | null;
}
export async function loadExcludedCases(): Promise<ExcludedCase[]> {
  const { data, error } = await supabase.rpc('notice_cases_excluded');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as ExcludedCase[];
}

/** One notice that is not required: out of every list, the rest of its case stays (20261014110000). */
export async function excludeNotice(noticeId: string, exclude: boolean, reason: string | null, actor: Actor): Promise<void> {
  const { data, error } = await supabase.rpc('notice_exclude', { p_notice_id: noticeId, p_exclude: exclude, p_reason: reason, p_actor_id: actor.id, p_actor_name: actor.firstName ?? null });
  if (error) throw error;
  if (rpcResult(data).error) throw new Error(rpcResult(data).error);
}
