// The Notices home's work (the UX audit of 25 October 2026): four figures that
// each filter the list beneath them, and the list itself, "My work", one row
// per case over every kind the firm acts on, split by whose it is (Mine, Team,
// Unassigned, and drafts waiting for a partner). It replaces the kind cards,
// the six figures and the work list's own pills, which said the same numbers
// three times, and the separate Work queue page. Since 25 October 2026 (Meet)
// the list runs newest notice first, with the notice's form and its year in
// their own columns.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, ChevronRight, UserRound, UserX, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Panel } from '@/components/notices/ui/Panel';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { NextStepLine } from '@/components/notices/cases/NextStepLine';
import { adviceOf, useAdviceMap } from '@/lib/noticeAdvice';
import { DisputeYearCell } from '@/components/notices/DisputeYearCell';
import { caseYearKey, useCaseDisputeYears } from '@/lib/noticeDisputeYears';
import { supabase } from '@/integrations/supabase/client';
import { applyMasterToQuery, hrefWithMaster, type Master } from '@/lib/masterFilters';
import { caseHref, loadCases, trackDef, type CaseRow, type CaseShow, type Track, type TrackCounts } from '@/lib/noticeCases';
import { fmtDate, fmtInrShort, noticeTitle, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

/** The kinds the firm acts on; Other (LUT, approvals) is kept for the record only. */
export const WORK_TRACKS: Track[] = ['litigation', 'refund', 'registration'];

export type Who = 'mine' | 'team' | 'unassigned' | 'review';
export type When = 'all' | 'overdue' | 'due7';
export const isWho = (v: string | null): v is Who => v === 'mine' || v === 'team' || v === 'unassigned' || v === 'review';
export const isWhen = (v: string | null): v is When => v === 'all' || v === 'overdue' || v === 'due7';

/** One kind's figures summed over the kinds the firm acts on. */
export function sumCounts(counts: Record<Track, TrackCounts> | undefined): TrackCounts | undefined {
  if (!counts) return undefined;
  const list = WORK_TRACKS.map((t) => counts[t]).filter(Boolean);
  const n = (k: keyof TrackCounts) => list.reduce((s, c) => s + Number(c[k] ?? 0), 0);
  const dates = (k: 'next_due' | 'next_hearing') => list.map((c) => c[k]).filter((d): d is string => !!d).sort()[0] ?? null;
  return {
    cases: n('cases'), open: n('open'), new: n('new'), new_items: n('new_items'), overdue: n('overdue'), due7: n('due7'), hearings: n('hearings'),
    unassigned: n('unassigned'), exposure: n('exposure'), in_appeal: n('in_appeal'), next_due: dates('next_due'), next_hearing: dates('next_hearing'),
    oldest_overdue_days: Math.max(0, ...list.map((c) => c.oldest_overdue_days ?? 0)) || null,
    overdue_age: {
      d30: list.reduce((s, c) => s + (c.overdue_age?.d30 ?? 0), 0), d90: list.reduce((s, c) => s + (c.overdue_age?.d90 ?? 0), 0),
      d365: list.reduce((s, c) => s + (c.overdue_age?.d365 ?? 0), 0), older: list.reduce((s, c) => s + (c.overdue_age?.older ?? 0), 0),
    },
    with_us: n('with_us'), with_dept: n('with_dept'), closed: n('closed'),
  };
}

/** Whose open cases: the master filters with the owner the tab names. */
function masterFor(who: Who, m: Master): Master {
  if (who === 'mine') return { ...m, owner: 'me' };
  if (who === 'unassigned') return { ...m, owner: 'none' };
  return m;
}

const showOf = (when: When): CaseShow => (when === 'all' ? 'open' : when);

/** Open cases that are mine, and drafts waiting for a partner, under the master filters. */
export function useWhoCounts(m: Master, meId: string | null) {
  return useQuery({
    queryKey: ['notice-home-who', m, meId],
    staleTime: 60_000,
    queryFn: async () => {
      const [mine, review] = await Promise.all([
        loadCases({ track: 'work', show: 'open', q: '', master: masterFor('mine', m), meId }, 1, 1),
        applyMasterToQuery(supabase.from('notice_plan').select('id', { count: 'exact', head: true }).eq('in_plan', true).eq('next_action', 'review_draft'), m, meId),
      ]);
      if (review.error) throw review.error;
      return { mine: mine.total, review: review.count ?? 0 };
    },
  });
}

// ── Four figures, each a filter on the list ─────────────────────────────────
interface Tile { key: string; label: string; value: number | undefined; sub: string; icon: LucideIcon; tone: string; on: boolean; pick: () => void; hot?: boolean }

export const AttentionTiles: React.FC<{
  c: TrackCounts | undefined; mine: number | undefined; who: Who; when: When; onPick: (who: Who, when: When) => void;
}> = ({ c, mine, who, when, onPick }) => {
  const tiles: Tile[] = [
    { key: 'overdue', label: 'Overdue', value: c?.overdue, icon: AlarmClock, tone: 'bg-destructive/10 text-destructive-strong',
      sub: c?.oldest_overdue_days ? `oldest ${c.oldest_overdue_days > 365 ? `${Math.floor(c.oldest_overdue_days / 365)} y` : `${c.oldest_overdue_days} d`}` : 'nothing late',
      on: when === 'overdue' && who === 'team', pick: () => onPick('team', 'overdue'), hot: (c?.overdue ?? 0) > 0 },
    { key: 'due7', label: 'Due in 7 days', value: c?.due7, icon: CalendarClock, tone: 'bg-warning/15 text-warning',
      sub: c?.next_due ? `next ${fmtDate(c.next_due)}` : 'nothing this week', on: when === 'due7' && who === 'team', pick: () => onPick('team', 'due7') },
    { key: 'mine', label: 'Mine', value: mine, icon: UserRound, tone: 'bg-primary/10 text-primary',
      sub: 'open cases you own', on: who === 'mine' && when === 'all', pick: () => onPick('mine', 'all') },
    { key: 'unassigned', label: 'Unassigned', value: c?.unassigned, icon: UserX, tone: 'bg-muted text-foreground/70',
      sub: c?.unassigned ? 'open cases with no owner' : 'every case has an owner', on: who === 'unassigned' && when === 'all', pick: () => onPick('unassigned', 'all') },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Filter the work list">
      {tiles.map((t) => (
        <button key={t.key} type="button" onClick={t.pick} aria-pressed={t.on}
          className={cn('group rounded-xl border bg-card p-3 text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            t.on && 'border-primary ring-1 ring-primary/30')}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-muted-foreground">{t.label}</span>
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', t.tone)}><t.icon className="h-4 w-4" aria-hidden /></span>
          </div>
          {t.value === undefined ? <Skeleton className="mt-1 h-7 w-12" />
            : <div className={cn('mt-1 text-2xl font-bold tabular-nums leading-none', t.hot && 'text-destructive-strong')}>{t.value}</div>}
          <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{t.sub}</div>
        </button>
      ))}
    </div>
  );
};

// ── My work ────────────────────────────────────────────────────────────────
function urgency(r: CaseRow): string {
  if (r.is_overdue) return 'bg-destructive';
  if (r.is_due_in_7) return 'bg-warning';
  return 'bg-border';
}

function DueText({ r }: { r: CaseRow }) {
  if (r.stage === 'appeal') return <span className="text-xs font-medium text-info">in appeal</span>;
  if (!r.next_due) return <span className="text-xs text-muted-foreground">no date</span>;
  const days = r.today_ist ? Math.round((Date.parse(r.next_due) - Date.parse(r.today_ist)) / 86_400_000) : null;
  return (
    <span className={cn('text-xs tabular-nums', r.is_overdue ? 'font-semibold text-destructive-strong' : r.is_due_in_7 ? 'font-semibold text-warning' : 'text-foreground/80')}>
      {fmtDate(r.next_due)}
      {days !== null && <span className="block text-[10px] font-normal text-muted-foreground">{days < 0 ? `${-days} d late` : days === 0 ? 'today' : `in ${days} d`}</span>}
    </span>
  );
}

const WHO: { key: Who; label: string; empty: string }[] = [
  { key: 'mine', label: 'Mine', empty: 'Nothing open is assigned to you.' },
  { key: 'team', label: 'Team', empty: 'No open case.' },
  { key: 'unassigned', label: 'Unassigned', empty: 'Every open case has an owner.' },
  { key: 'review', label: 'Review', empty: 'No draft is waiting for a partner.' },
];

interface ReviewRow { id: string; client_id: string; client_name: string | null; case_id: string | null; category: string | null; form_code: string | null; form_label: string | null; notice_type: string | null; financial_year: string | null; assign_to: string | null; effective_due: string | null; issue_date: string | null }

/** The form a notice is on (DRC-07, ASMT-10), else its category. */
function TypeCell({ form, fallback }: { form: string | null | undefined; fallback?: string | null }) {
  if (form) return <span className="whitespace-nowrap text-xs font-semibold text-foreground/90">{form}</span>;
  return <span className="truncate text-xs text-muted-foreground">{fallback || '—'}</span>;
}

const COL = {
  type: 'w-24 shrink-0',
  fy: 'hidden w-24 shrink-0 sm:block',
  owner: 'hidden w-8 shrink-0 md:flex md:justify-center',
  stage: 'hidden w-24 shrink-0 lg:block',
  amount: 'hidden w-16 shrink-0 text-right sm:block',
  date: 'hidden w-20 shrink-0 text-right md:block',
  due: 'w-20 shrink-0 text-right',
};

function NoticeDate({ d }: { d: string | null | undefined }) {
  return <span className="text-xs tabular-nums text-foreground/80">{d ? fmtDate(d) : '—'}</span>;
}

export const MyWork: React.FC<{
  who: Who; when: When; master: Master; meId: string | null; counts: { mine?: number; review?: number; team?: number; unassigned?: number };
  onPick: (who: Who, when: When) => void; limit?: number;
}> = ({ who, when, master, meId, counts, onPick, limit = 12 }) => {
  const m = masterFor(who, master);
  const cases = useQuery({
    queryKey: ['notice-cases', { track: 'work', show: showOf(when), q: '', master: m, meId, sort: 'newest' }, 1, limit],
    queryFn: () => loadCases({ track: 'work', show: showOf(when), q: '', master: m, meId, sort: 'newest' }, 1, limit),
    enabled: who !== 'review',
    staleTime: 60_000,
  });
  const review = useQuery({
    queryKey: ['notice-home-review', master, meId, limit],
    enabled: who === 'review',
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await applyMasterToQuery(supabase.from('notice_plan')
        .select('id, client_id, client_name, case_id, category, form_code, form_label, notice_type, financial_year, assign_to, effective_due, issue_date')
        .eq('in_plan', true).eq('next_action', 'review_draft'), master, meId).order('issue_date', { ascending: false, nullsFirst: false }).order('id').limit(limit);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });
  const advice = useAdviceMap(cases.data?.rows);
  const years = useCaseDisputeYears(who === 'review' ? undefined : cases.data?.rows);
  const total = who === 'review' ? counts.review ?? 0 : cases.data?.total ?? 0;
  const allHref = hrefWithMaster(`/notices-cases?${new URLSearchParams({ ...(when === 'all' ? {} : { show: when }), ...(who === 'mine' ? { owner: 'me' } : who === 'unassigned' ? { owner: 'none' } : {}) })}`, master);
  const q = who === 'review' ? review : cases;
  const label = WHO.find((w) => w.key === who);
  return (
    <Panel title="My work" bodyClassName="px-0 pb-0"
      info="One row per case over notices and demands, refunds and registration (Other, which needs no action, stays on Cases), newest notice first. The figures above filter this list."
      actions={who !== 'review' && total > limit && <Link to={allHref} className="text-xs font-medium text-primary hover:underline">All {total} on Cases →</Link>}>
      <div className="flex flex-wrap items-center gap-1 border-b px-3.5 pb-2">
        {WHO.map((w) => (
          <button key={w.key} type="button" onClick={() => onPick(w.key, w.key === 'review' ? 'all' : when)} aria-pressed={who === w.key}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              who === w.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            {w.label}
            {counts[w.key] !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', who === w.key ? 'bg-primary-foreground/20' : 'bg-muted')}>{counts[w.key]}</span>}
          </button>
        ))}
        {when !== 'all' && who !== 'review' && (
          <button type="button" onClick={() => onPick(who, 'all')} className="ml-auto rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10">
            {when === 'overdue' ? 'Overdue only' : 'Due in 7 days only'} ✕
          </button>
        )}
      </div>
      {!q.error && !q.isLoading && (
        <div className="hidden items-center gap-3 border-b bg-muted/30 py-1.5 pl-4 pr-3.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:flex" aria-hidden>
          <span className="min-w-0 flex-1">{who === 'review' ? 'Client and notice' : 'Client and case'}</span>
          <span className={COL.type}>Type</span>
          <span className={COL.fy}>FY</span>
          <span className={COL.owner}>Owner</span>
          {who !== 'review' && <span className={COL.stage}>Stage</span>}
          {who !== 'review' && <span className={COL.amount}>Amount</span>}
          <span className={COL.date}>Notice date</span>
          <span className={COL.due}>Due</span>
          {who === 'review' && <span className="w-4 shrink-0" />}
        </div>
      )}
      {q.error ? <div className="p-3"><LoadError what="the work" error={q.error} onRetry={() => q.refetch()} /></div>
        : q.isLoading ? <div className="p-3"><Skeleton className="h-72 w-full" /></div>
        : who === 'review' ? (
          !review.data?.length ? <div className="p-3"><EmptyBox className="p-6">{label?.empty}</EmptyBox></div> : (
            <ul className="divide-y">
              {review.data.map((r) => (
                <li key={r.id}>
                  <Link to={`/notices/${r.id}?tab=draft`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{r.client_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{noticeTitle(r)} · draft waiting for a partner</div>
                    </div>
                    <span className={COL.type}><TypeCell form={r.form_code} fallback={r.category} /></span>
                    <span className={cn(COL.fy, 'text-sm font-semibold tabular-nums')}>{r.financial_year ? `FY ${r.financial_year}` : <span className="text-xs font-normal text-muted-foreground">—</span>}</span>
                    <span className={COL.owner}><OwnerChip name={r.assign_to} /></span>
                    <span className={COL.date}><NoticeDate d={r.issue_date} /></span>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums">{r.effective_due ? fmtDate(r.effective_due) : ''}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ))
        : !cases.data?.rows.length ? <div className="p-3"><EmptyBox className="p-6">{when === 'overdue' ? 'Nothing overdue here.' : when === 'due7' ? 'Nothing due in the next 7 days here.' : label?.empty}</EmptyBox></div>
        : (
          <ul className="divide-y">
            {cases.data.rows.map((r) => {
              const track = (r.track ?? 'litigation') as Track;
              return (
                <li key={`${r.client_id}:${r.case_key}`}>
                  <Link to={caseHref(r.client_id as string, r.case_key as string)}
                    className="group flex items-center gap-3 py-2.5 pl-0 pr-3.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className={cn('h-12 w-1 shrink-0 rounded-r', urgency(r))} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{r.client_name}</span>
                        {track !== 'litigation' && <Badge variant="secondary" className="shrink-0 text-[10px]">{trackDef(track).short}</Badge>}
                        {(r.new_items ?? 0) > 0 && <Badge variant="info" className="shrink-0 text-[10px]">{r.new_items} new</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{r.title}</div>
                      <NextStepLine r={r} advice={adviceOf(advice.data, r.client_id as string, r.case_key as string)} className="mt-0.5" />
                    </div>
                    <span className={COL.type}><TypeCell form={r.form_code} fallback={r.category} /></span>
                    <span className={COL.fy}><DisputeYearCell d={years.data?.get(caseYearKey(r.client_id as string, r.case_key as string))} loading={years.isLoading} /></span>
                    <span className={COL.owner}>{who !== 'mine' && <OwnerChip name={r.assign_to} />}</span>
                    <span className={COL.stage}>{track === 'litigation' && <StageBadge stage={r.stage} />}</span>
                    <span className={cn(COL.amount, 'text-xs tabular-nums text-foreground/80')}>{Number(r.exposure) > 0 ? fmtInrShort(r.exposure) : ''}</span>
                    <span className={COL.date}><NoticeDate d={r.last_issue_date} /></span>
                    <span className={COL.due}><DueText r={r} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </Panel>
  );
};

/** One quiet line under the work: what the firm holds but does not act on today. */
export const HomeFooter: React.FC<{ counts: Record<Track, TrackCounts> | undefined; master: Master }> = ({ counts, master }) => {
  if (!counts) return null;
  const lit = counts.litigation;
  const other = counts.other;
  const closed = WORK_TRACKS.reduce((s, t) => s + (counts[t]?.closed ?? 0), 0);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
      {lit && Number(lit.exposure) > 0 && <span><span className="font-semibold tabular-nums text-foreground">{fmtInrShort(lit.exposure)}</span> open exposure on notices and demands</span>}
      <span><span className="font-semibold tabular-nums text-foreground">{closed.toLocaleString('en-IN')}</span> cases closed</span>
      {other && <Link to={hrefWithMaster('/notices-cases?kind=other', master)} className="hover:text-foreground hover:underline">{plural(other.cases, 'record')} on file (LUT, approvals, payments) →</Link>}
    </p>
  );
};

