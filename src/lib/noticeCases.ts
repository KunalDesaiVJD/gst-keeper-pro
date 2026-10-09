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

// ── Lists and counts ───────────────────────────────────────────────────────
export type CaseShow = 'open' | 'new' | 'all';
export interface CaseQuery { track: Track | 'all'; show: CaseShow; q: string; master: Master; meId: string | null }

export async function loadCases(c: CaseQuery, page: number, pageSize: number): Promise<{ rows: CaseRow[]; total: number }> {
  let q = supabase.from('notice_cases').select('*', { count: 'exact' });
  if (c.track !== 'all') q = q.eq('track', c.track);
  if (c.show === 'open') q = q.eq('is_open', true);
  if (c.show === 'new') q = q.gt('new_items', 0);
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
    if (/notice_cases/.test(error.message)) throw new Error('Cases need migration 20261011100000_notice_cases.sql on the database.');
    throw error;
  }
  return { rows: (data ?? []) as CaseRow[], total: count ?? 0 };
}

export interface TrackCounts { cases: number; open: number; new: number; new_items: number; overdue: number; due7: number; hearings: number; unassigned: number; exposure: number }
const ZERO: TrackCounts = { cases: 0, open: 0, new: 0, new_items: 0, overdue: 0, due7: 0, hearings: 0, unassigned: 0, exposure: 0 };

export async function loadCaseCounts(filters: Record<string, string> | null): Promise<Record<Track, TrackCounts>> {
  const { data, error } = await supabase.rpc('notice_cases_counts', { p_filters: filters });
  if (error) throw error;
  const d = (data ?? {}) as Partial<Record<Track, Partial<TrackCounts>>>;
  const out = {} as Record<Track, TrackCounts>;
  for (const t of TRACKS) out[t.key] = { ...ZERO, ...(d[t.key] ?? {}) } as TrackCounts;
  return out;
}

export function useCaseCounts(filters: Record<string, string> | null) {
  return useQuery({ queryKey: ['notice-case-counts', filters], queryFn: () => loadCaseCounts(filters), staleTime: 60_000 });
}

// ── One case ───────────────────────────────────────────────────────────────
export async function loadCase(clientId: string, caseKey: string): Promise<CaseRow | null> {
  const { data, error } = await supabase.from('notice_cases').select('*').eq('client_id', clientId).eq('case_key', caseKey).maybeSingle();
  if (error) throw error;
  return (data as CaseRow | null) ?? null;
}

export interface CaseItem {
  kind: 'notice' | 'document';
  id: string;
  from: 'department' | 'taxpayer';
  date: string | null;
  arrived_at: string | null;
  label: string;
  reference: string | null;
  section: string | null;
  is_new: boolean;
  stage: string | null;
  stage_label: string | null;
  is_open: boolean | null;
  pdf_url: string | null;
  attachments: { label?: string; url?: string }[] | null;
  ai: { title: string | null; summary: string | null; doc_kind: string | null; outcome: string | null; doc_date: string | null; status: string; reason_class: string | null } | null;
  notice_read: { status: string; outcome: string | null; summary: string | null } | null;
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
  const m = /^(\d{2})(\d{4})$/.exec(p ?? '');
  if (!m) return p ?? '';
  const d = new Date(Number(m[2]), Number(m[1]) - 1, 1);
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
