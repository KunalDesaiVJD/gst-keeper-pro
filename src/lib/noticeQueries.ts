// Notice lists: the URL is the one source of truth for every filter
// (audit cross-cutting "filter state is scattered", U-10-1, U-22-3), and the
// database does the filtering, sorting and paging, so a list stays fast at
// 5,000 notices and a dashboard number opens a list with the same count.
// Each filter below is the same predicate the command centre counts with
// (migration 20261006122000_notice_command_centre.sql). A list opened from the
// command centre carries dash=1 and shows only the notice types on the
// dashboard (notice_facts.on_dashboard), because the dashboard counts only
// those (contract §A, migration 20261008150000_notice_types.sql).
import { fyVariants } from '@/lib/masterFilters';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import type { NoticeFact, NoticePlanRow } from '@/lib/noticeFacts';
import { isResponseNeed, type ResponseNeed } from '@/lib/noticeTypes';

export type ListFilter =
  | 'open' | 'overdue' | 'due7' | 'new' | 'unassigned' | 'exposure' | 'issued15'
  | 'replied' | 'submitted' | 'nodue' | 'closed' | 'auto_closed' | 'all';

export const LIST_FILTERS: { key: ListFilter; label: string; title: string }[] = [
  { key: 'open', label: 'Open', title: 'Open notices' },
  { key: 'overdue', label: 'Overdue', title: 'Overdue and still open' },
  { key: 'due7', label: 'Due in 7 days', title: 'Due in the next 7 days, not yet replied' },
  { key: 'new', label: 'New in 24 h', title: 'First seen in the last 24 hours' },
  { key: 'unassigned', label: 'Unassigned', title: 'Open, without an owner' },
  { key: 'exposure', label: 'With demand', title: 'Open notices carrying a demand (each dispute counted once)' },
  { key: 'nodue', label: 'No due date', title: 'Open notices without any due date' },
  { key: 'issued15', label: 'Issued in last 15 days', title: 'Issued in the last 15 days' },
  { key: 'replied', label: 'Reply logged', title: 'Notices with a reply logged' },
  { key: 'submitted', label: 'Submission logged', title: 'Notices with a submission logged' },
  { key: 'closed', label: 'Closed', title: 'Closed notices' },
  { key: 'auto_closed', label: 'Closed automatically', title: 'Closed by the closing sweep' },
  { key: 'all', label: 'All', title: 'All notices' },
];

export const filterDef = (key: string | null | undefined) =>
  LIST_FILTERS.find((f) => f.key === key) ?? LIST_FILTERS[0];

export type SortKey = 'due' | 'issued' | 'client' | 'demand' | 'stage' | 'age' | 'score' | 'seen';

export const SORTS: Record<SortKey, { column: string; ascending: boolean; label: string }> = {
  due: { column: 'effective_due', ascending: true, label: 'Due date' },
  issued: { column: 'issue_date', ascending: false, label: 'Issue date' },
  client: { column: 'client_name', ascending: true, label: 'Client' },
  demand: { column: 'amount_of_demand', ascending: false, label: 'Demand' },
  stage: { column: 'stage_ord', ascending: true, label: 'Stage' },
  age: { column: 'days_in_stage', ascending: false, label: 'Days in stage' },
  score: { column: 'plan_score', ascending: false, label: 'Rank' },
  seen: { column: 'first_seen_at', ascending: false, label: 'First seen' },
};

export type QueueTab = 'mine' | 'team' | 'unassigned' | 'review';

export interface NoticeListParams {
  filter: ListFilter;
  stage?: string;
  client?: string;
  /** 'me', 'none' or a staff user id. */
  owner?: string;
  category?: string;
  /** A form code, or 'none' for notices with no form recognised. */
  form?: string;
  fy?: string;
  priority?: string;
  q?: string;
  /** Effective due date on this day (YYYY-MM-DD). */
  due?: string;
  /** Reply need of the notice's type. */
  need?: ResponseNeed;
  /** '1' = only the notice types on the dashboard (lists opened from it); '0' = only those taken off it. */
  dash?: '1' | '0';
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  page: number;
}

const KEYS = ['stage', 'client', 'owner', 'category', 'form', 'fy', 'priority', 'q', 'due'] as const;

/** The list's parameters from the URL (the old Phase 1 drill-down params still work). */
export function parseListParams(sp: URLSearchParams, defaultFilter: ListFilter = 'open'): NoticeListParams {
  // Phase 1 drill-down names still in old links and e-mails.
  const LEGACY: Record<string, ListFilter> = { last15: 'issued15', last24h: 'new' };
  let filter = (LEGACY[sp.get('filter') || ''] ?? sp.get('filter') ?? '') as ListFilter;
  const legacyStatus = (sp.get('status') || '').toLowerCase();
  if (!LIST_FILTERS.some((f) => f.key === filter)) {
    filter = legacyStatus === 'closed' ? 'closed' : legacyStatus === 'all' ? 'all' : defaultFilter;
  }
  const out: NoticeListParams = { filter, page: Math.max(1, Number(sp.get('page')) || 1) };
  KEYS.forEach((k) => { const v = sp.get(k); if (v) out[k] = v; });
  if (!out.due && sp.get('date')) out.due = sp.get('date') || undefined;
  const need = sp.get('need');
  if (isResponseNeed(need)) out.need = need;
  const dash = sp.get('dash');
  if (dash === '1' || dash === '0') out.dash = dash;
  if (!out.priority && sp.get('filter') === 'priority') out.priority = 'High';
  const sort = sp.get('sort') as SortKey | null;
  if (sort && sort in SORTS) out.sort = sort;
  const dir = sp.get('dir');
  if (dir === 'asc' || dir === 'desc') out.dir = dir;
  return out;
}

/** URL parameters for a list state (defaults left out, so links stay short). */
export function listSearch(p: Partial<NoticeListParams>, defaultFilter: ListFilter = 'open'): string {
  const sp = new URLSearchParams();
  if (p.filter && p.filter !== defaultFilter) sp.set('filter', p.filter);
  KEYS.forEach((k) => { const v = p[k]; if (v) sp.set(k, v); });
  if (p.need) sp.set('need', p.need);
  if (p.dash) sp.set('dash', p.dash);
  if (p.sort) sp.set('sort', p.sort);
  if (p.dir) sp.set('dir', p.dir);
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** A link to the All notices list with these filters. */
export const noticesListHref = (p: Partial<NoticeListParams>) => `/notices-all${listSearch(p)}`;
/** A list opened from the command centre: only the notice types on the dashboard, as it counts them. */
export const dashListHref = (p: Partial<NoticeListParams>) => noticesListHref({ ...p, dash: '1' });
/** A link to the Work queue with these filters. */
export const queueHref = (tab: QueueTab, p: Partial<NoticeListParams> = {}) => {
  const s = listSearch(p);
  return `/notices-queue${s ? `${s}&tab=${tab}` : `?tab=${tab}`}`;
};

/** Search text safe inside a PostgREST or() filter. */
export function searchTerm(q: string | undefined): string {
  return (q || '').replace(/[,()"\\*%:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The builder's generic type for these views is not worth spelling out here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

export function applyListFilters(q: Q, p: NoticeListParams, meId: string | null): Q {
  switch (p.filter) {
    case 'open': q = q.eq('is_open', true); break;
    case 'overdue': q = q.eq('is_overdue', true); break;
    case 'due7': q = q.eq('is_due_in_7', true); break;
    case 'new': q = q.eq('is_new', true); break;
    case 'unassigned': q = q.eq('is_unassigned', true); break;
    case 'exposure': q = q.eq('is_open', true).gt('exposure_amount', 0); break;
    case 'nodue': q = q.eq('is_open', true).is('effective_due', null); break;
    case 'issued15': {
      const d = new Date(Date.now() - 15 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      q = q.gte('issue_date', d);
      break;
    }
    case 'replied': q = q.eq('is_replied', true); break;
    case 'submitted': q = q.or('submission_date.not.is.null,submission_arn.not.is.null'); break;
    case 'closed': q = q.eq('is_open', false); break;
    case 'auto_closed': q = q.eq('is_open', false).like('close_reason', 'auto:%'); break;
    default: break;
  }
  if (p.stage) q = q.eq('stage', p.stage);
  if (p.client) q = q.eq('client_id', p.client);
  if (p.owner === 'me') q = q.eq(meId ? 'assign_to_user_id' : 'id', meId ?? '00000000-0000-0000-0000-000000000000');
  else if (p.owner === 'none') q = q.is('assign_to_user_id', null);
  else if (p.owner) q = q.eq('assign_to_user_id', p.owner);
  if (p.category) q = q.eq('category', p.category);
  if (p.form === 'none') q = q.is('form_code', null);
  else if (p.form) q = q.eq('form_code', p.form);
  if (p.fy === 'none') q = q.is('financial_year', null);
  else if (p.fy) q = q.in('financial_year', fyVariants(p.fy));
  if (p.priority) q = q.eq('effective_priority', p.priority);
  if (p.due) q = q.eq('effective_due', p.due);
  if (p.need) q = q.eq('response_need', p.need);
  if (p.dash === '1') q = q.eq('on_dashboard', true);
  else if (p.dash === '0') q = q.eq('on_dashboard', false);
  const term = searchTerm(p.q);
  if (term) {
    const t = `*${term}*`;
    q = q.or([
      `client_name.ilike.${t}`, `client_gstin.ilike.${t}`, `reference_number.ilike.${t}`, `case_id.ilike.${t}`,
      `form_code.ilike.${t}`, `notice_type.ilike.${t}`, `description.ilike.${t}`, `assign_to.ilike.${t}`,
    ].join(','));
  }
  return q;
}

function applySort(q: Q, p: NoticeListParams, fallback: SortKey): Q {
  const key: SortKey = p.sort ?? fallback;
  const def = SORTS[key];
  const ascending = p.dir ? p.dir === 'asc' : def.ascending;
  q = q.order(def.column, { ascending, nullsFirst: false });
  // Notices issued the same day: the one the portal sync brought in last comes first.
  if (key === 'issued') q = q.order('first_seen_at', { ascending, nullsFirst: false });
  return q.order('id', { ascending: true });
}

/**
 * Every list opens newest first, by issue date (the firm's choice of 7 October
 * 2026: notices run from new to old, on the dashboard and in every list). A
 * column header or the order picker still sorts by due date, demand, rank …
 */
export function defaultSort(_filter?: ListFilter): SortKey {
  return 'issued';
}

export const PAGE_SIZE = 50;

export async function fetchNoticePage(p: NoticeListParams, meId: string | null, pageSize = PAGE_SIZE):
  Promise<{ rows: NoticeFact[]; total: number }> {
  let q = supabase.from('notice_facts').select('*', { count: 'exact' });
  q = applyListFilters(q, p, meId);
  q = applySort(q, p, defaultSort(p.filter));
  const from = (p.page - 1) * pageSize;
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as NoticeFact[], total: count ?? 0 };
}

/** Every row of a list (Excel export), same filters and order. */
export async function fetchNoticeRows(p: NoticeListParams, meId: string | null): Promise<NoticeFact[]> {
  return fetchAllRows<NoticeFact>('notice_facts', '*', (q: Q) => applySort(applyListFilters(q, p, meId), p, defaultSort(p.filter)));
}

/** The sum of one money column over a whole filter (the exposure list's total, U-24-1). */
export async function fetchNoticeSum(p: NoticeListParams, meId: string | null, column: 'exposure_amount' | 'amount_of_demand'): Promise<number> {
  const rows = await fetchAllRows<Record<string, number | null>>('notice_facts', column, (q: Q) => applyListFilters(q, p, meId).order('id'));
  return rows.reduce((s, r) => s + Number(r[column] ?? 0), 0);
}

export function applyQueueTab(q: Q, tab: QueueTab, meId: string | null): Q {
  q = q.eq('in_plan', true);
  if (tab === 'mine') q = meId ? q.eq('assign_to_user_id', meId) : q.eq('id', '00000000-0000-0000-0000-000000000000');
  if (tab === 'unassigned') q = q.is('assign_to_user_id', null);
  if (tab === 'review') q = q.eq('next_action', 'review_draft');
  return q;
}

export const QUEUE_TABS: QueueTab[] = ['mine', 'team', 'unassigned', 'review'];

/**
 * Each queue tab's count under the list's own filters (dash, reply need,
 * stage, owner, search…), so a tab's number is always the length of its list.
 */
export async function fetchQueueCounts(p: NoticeListParams, meId: string | null): Promise<Record<QueueTab, number>> {
  const counts = await Promise.all(QUEUE_TABS.map(async (tab) => {
    let q = supabase.from('notice_plan').select('id', { count: 'exact', head: true });
    q = applyQueueTab(q, tab, meId);
    q = applyListFilters(q, { ...p, filter: 'all' }, meId);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }));
  return Object.fromEntries(QUEUE_TABS.map((t, i) => [t, counts[i]])) as Record<QueueTab, number>;
}

/** The Work queue (Today's plan in full): open notices with their next action, newest first unless ordered otherwise. */
export async function fetchQueuePage(tab: QueueTab, p: NoticeListParams, meId: string | null, pageSize = PAGE_SIZE):
  Promise<{ rows: NoticePlanRow[]; total: number }> {
  let q = supabase.from('notice_plan').select('*', { count: 'exact' });
  q = applyQueueTab(q, tab, meId);
  q = applyListFilters(q, { ...p, filter: 'all' }, meId);
  q = applySort(q, p, defaultSort());
  const from = (p.page - 1) * pageSize;
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as NoticePlanRow[], total: count ?? 0 };
}
