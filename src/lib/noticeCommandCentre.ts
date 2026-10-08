// The command centre's data (roadmap Phase 2 task 2): one RPC for every figure
// (public.notices_command_centre), the ranked plan (public.notice_plan), the
// calendar (public.notice_calendar) and Ctrl K search (public.notices_search).
// Each figure is defined in the database over the same views the lists read,
// so a number opens a list with the same count
// (supabase/tests/notices/test_95_command_centre.sql). Since the notice types
// (contract §A) the dashboard counts only the types shown on it
// (on_dashboard); the lists it opens carry dash=1 to match. The top-nav counts
// (nav) and the sync health stay over every notice.
import { useQuery } from '@tanstack/react-query';
import { applyMasterToQuery, type Master } from '@/lib/masterFilters';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import type { NoticePlanRow } from '@/lib/noticeFacts';
import { applyQueueTab, type QueueTab } from '@/lib/noticeQueries';

export interface PipelineStage { stage: string; label: string; count: number; median_days: number | null }
export interface DayLoad { date: string; reply: number; hearing: number; clock: number; total: number }
export interface StageExposure { stage: string; label: string; notices: number; matters: number; total: number }
export interface ClientAttention { client_id: string; name: string; gstin: string | null; open: number; overdue: number; exposure: number }

export interface CommandCentre {
  generated_at: string;
  today: string;
  tiles: {
    open: number;
    overdue: { count: number; amount: number; oldest_days: number | null };
    due7: { count: number; next_date: string | null; next_client: string | null; hearings: number; clocks: number };
    new: { count: number; with_demand: number; unassigned: number };
    unassigned: number;
    review: { count: number; approved: number };
    waiting_client: number;
    exposure: { total: number; notices: number; notices_amount: number; matters: number; matters_amount: number };
  };
  nav: { queue: number; open: number; matters: number; hearings: number };
  plan_counts: Record<QueueTab, number>;
  pipeline: PipelineStage[];
  replies: { this_month: number; median_days_this_month: number | null; median_days_last_month: number | null };
  health: {
    eligible: number;
    fresh: number;
    never: number;
    failing: Record<string, number>;
    last_run: {
      started_at: string; finished_at: string | null; status: string;
      clients_total: number | null; clients_done: number; ext_version: string | null;
    } | null;
    last_success_at: string | null;
    new_today: number;
    auto_closed_today: number;
    ext_versions: string[];
    alerts_mode: 'off' | 'preview' | 'live' | null;
    alerts_today: number;
  };
  next14: DayLoad[];
  exposure_by_stage: StageExposure[];
  clients: ClientAttention[];
  /** What the dashboard leaves out: notice types taken off it and their notices (absent on an older database). */
  dashboard?: { hidden_types: number; hidden_open: number; hidden_overdue: number };
}

/** filters: the master filters (lib/masterFilters, masterForRpc); null counts everything. */
export async function loadCommandCentre(userId: string | null, filters: Record<string, string> | null = null): Promise<CommandCentre> {
  const { data, error } = await supabase.rpc('notices_command_centre', filters ? { p_user_id: userId, p_filters: filters } : { p_user_id: userId });
  if (error) {
    if (filters && (error.code === 'PGRST202' || /function .*does not exist|could not find the function/i.test(error.message))) {
      throw new Error('Filtering the command centre needs migration 20261009110000_master_filters.sql on the database.');
    }
    throw error;
  }
  return data as unknown as CommandCentre;
}

export function useCommandCentre(userId: string | null, filters: Record<string, string> | null = null) {
  return useQuery({
    queryKey: ['notices-command-centre', userId, filters],
    queryFn: () => loadCommandCentre(userId, filters),
    staleTime: 60_000,
    // While a sync run is going, the figures follow it (audit U-07-1).
    refetchInterval: (q) => (q.state.data?.health?.last_run?.status === 'running' ? 15_000 : false),
  });
}

/** Counts for the module's tab bar, shared by every Notices page (one call a minute). */
export function useNoticesNavCounts(userId: string | null) {
  const q = useCommandCentre(userId);
  return q.data?.nav ?? null;
}

/** The top of Today's plan: the dashboard's notice types only, like its counts. */
/** The dashboard's plan: 'newest' (the default, by issue date) or 'urgent' (deadline × exposure × readiness). */
export type PlanOrder = 'newest' | 'urgent';

export async function loadPlanTop(tab: QueueTab, userId: string | null, limit = 8, order: PlanOrder = 'newest', master: Master = {}): Promise<NoticePlanRow[]> {
  let q = supabase.from('notice_plan').select('*').eq('on_dashboard', true);
  q = applyQueueTab(q, tab, userId);
  q = applyMasterToQuery(q, master, userId);
  q = order === 'urgent'
    ? q.order('plan_score', { ascending: false })
    : q.order('issue_date', { ascending: false, nullsFirst: false }).order('first_seen_at', { ascending: false, nullsFirst: false });
  const { data, error } = await q.order('id').limit(limit);
  if (error) throw error;
  return (data ?? []) as NoticePlanRow[];
}

export interface HearingItem {
  kind: 'notice' | 'matter';
  ref_id: string;
  notice_id: string | null;
  matter_id: string | null;
  client_id: string;
  client_name: string;
  hearing_on: string;
  hearing_at: string | null;
  title: string | null;
  reference: string | null;
  stage: string;
  owner_id: string | null;
  owner: string | null;
  venue: string | null;
  note: string | null;
}

export async function loadUpcomingHearings(): Promise<HearingItem[]> {
  const { data, error } = await supabase.rpc('notice_hearings_upcoming', { p_from: null });
  if (error) throw error;
  return ((data ?? []) as HearingItem[]).sort((a, b) => (a.hearing_at || a.hearing_on).localeCompare(b.hearing_at || b.hearing_on));
}

export interface CalendarItem {
  day: string;
  kind: 'reply' | 'hearing' | 'appeal' | 'attachment';
  notice_id: string | null;
  client_id: string;
  client_name: string;
  form_code: string | null;
  reference: string | null;
  title: string | null;
  stage: string;
  owner_id: string | null;
  owner: string | null;
  detail: string | null;
}

/**
 * Reply dues, hearings and clocks by day. dashboardOnly (a day opened from the
 * command centre's 14-day strip, dash=1) leaves out the notices of types taken
 * off the dashboard, as the strip's counts do.
 */
export async function loadCalendar(from: string, to: string, opts: { dashboardOnly?: boolean } = {}): Promise<CalendarItem[]> {
  const [cal, hidden] = await Promise.all([
    supabase.rpc('notice_calendar', { p_from: from, p_to: to }),
    opts.dashboardOnly
      ? fetchAllRows<{ id: string }>('notice_facts', 'id', (q) => q.eq('is_open', true).eq('on_dashboard', false).order('id'))
      : Promise.resolve([] as { id: string }[]),
  ]);
  if (cal.error) throw cal.error;
  const items = (cal.data ?? []) as CalendarItem[];
  if (!hidden.length) return items;
  const off = new Set(hidden.map((r) => r.id));
  return items.filter((it) => !it.notice_id || !off.has(it.notice_id));
}

export const CALENDAR_KIND_LABEL: Record<CalendarItem['kind'], string> = {
  reply: 'Reply due',
  hearing: 'Hearing',
  appeal: 'Appeal clock',
  attachment: 'Attachment lapses',
};

export interface SearchResult {
  clients: { id: string; name: string; gstin: string | null; open: number; overdue: number }[];
  notices: {
    id: string; client_id: string; client_name: string; gstin: string | null; form_code: string | null;
    notice_type: string | null; reference_number: string | null; case_id: string | null; stage: string;
    issue_date: string | null; matched_on: string;
  }[];
}

export async function searchNotices(q: string): Promise<SearchResult> {
  const { data, error } = await supabase.rpc('notices_search', { p_q: q, p_limit: 8 });
  if (error) throw error;
  return (data ?? { clients: [], notices: [] }) as unknown as SearchResult;
}
