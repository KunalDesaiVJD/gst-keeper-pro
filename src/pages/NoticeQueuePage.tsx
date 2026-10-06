// Notices & Litigation · Work queue: "Today's plan" in full (roadmap Phase 2;
// audit U-20-4 "route Work queue to the open queue"). Open notices with a next
// step, ranked by deadline × exposure × readiness (public.notice_plan), split
// Mine / Team / Unassigned / Review. Each tab's count is taken under the list's
// own filters, so it is the length of its list: opened from the command centre
// (dash=1, the dashboard's notice types only) it equals the plan's count there.
import React, { useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/gstr9/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { NoticeFilterBar } from '@/components/notices/NoticeFilterBar';
import { Pager } from '@/components/notices/Pager';
import { PlanRows } from '@/components/notices/command/TodaysPlan';
import {
  fetchQueueCounts, fetchQueuePage, listSearch, parseListParams, PAGE_SIZE, type NoticeListParams, type QueueTab, type SortKey,
} from '@/lib/noticeQueries';
import { cn } from '@/lib/utils';

const TABS: { key: QueueTab; label: string; empty: string }[] = [
  { key: 'mine', label: 'Mine', empty: 'Nothing assigned to you needs action.' },
  { key: 'team', label: 'Team', empty: 'Nothing needs action.' },
  { key: 'unassigned', label: 'Unassigned', empty: 'Every open notice has an owner.' },
  { key: 'review', label: 'Review', empty: 'No draft is waiting for a partner.' },
];
const SORT_CHOICES: { key: SortKey; label: string }[] = [
  { key: 'score', label: 'Rank (deadline × exposure × readiness)' },
  { key: 'due', label: 'Due date' },
  { key: 'demand', label: 'Demand' },
  { key: 'age', label: 'Days in stage' },
];

const NoticeQueuePage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const meId = user?.id ?? null;
  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'team') as QueueTab;
  const params = useMemo(() => parseListParams(sp, 'all'), [sp]);
  // The tab counts ignore the page and the order, nothing else.
  const countKey = listSearch({ ...params, page: 1, sort: undefined, dir: undefined }, 'all');
  const tabCounts = useQuery({
    queryKey: ['notice-queue-counts', countKey, meId],
    queryFn: () => fetchQueueCounts(params, meId),
    placeholderData: (prev) => prev,
  });
  const q = useQuery({
    queryKey: ['notice-queue', tab, listSearch(params, 'all'), meId],
    queryFn: () => fetchQueuePage(tab, params, meId),
    placeholderData: (prev) => prev,
  });

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const go = (nextTab: QueueTab, patch: Partial<NoticeListParams> = {}) => {
    const next = { ...params, ...patch };
    const s = new URLSearchParams(listSearch(next, 'all').slice(1));
    s.set('tab', nextTab);
    setSp(s);
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notice-queue'] });
    qc.invalidateQueries({ queryKey: ['notice-queue-counts'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
  };
  const counts = tabCounts.data;
  const total = q.data?.total ?? 0;
  const empty = TABS.find((t) => t.key === tab)?.empty;

  return (
    <NoticesShell section="Work queue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Whose work" className={WS_TABS_LIST}>
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => go(t.key, { page: 1 })}
              className={cn(WS_TAB, 'h-8 px-3', tab === t.key && WS_TAB_ACTIVE)}>
              {t.label}
              {counts && <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums">{counts[t.key].toLocaleString('en-IN')}</span>}
            </button>
          ))}
        </div>
        <Select value={params.sort ?? 'score'} onValueChange={(v) => go(tab, { sort: v === 'score' ? undefined : (v as SortKey), dir: undefined, page: 1 })}>
          <SelectTrigger className="h-8 w-auto gap-1 text-xs" aria-label="Order"><SelectValue /></SelectTrigger>
          <SelectContent>{SORT_CHOICES.map((s) => <SelectItem key={s.key} value={s.key} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <NoticeFilterBar params={params} onChange={(patch) => go(tab, patch)} showFilter={false} />
      {q.error ? (
        <Note tone="warn">Couldn't load the queue: {q.error instanceof Error ? q.error.message : String(q.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => q.refetch()}>Retry</Button></Note>
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <>
          <PlanRows rows={q.data?.rows ?? []} onChanged={refresh} />
          <Pager page={params.page} pageSize={PAGE_SIZE} total={total} onPage={(p) => go(tab, { page: p })} />
        </>
      )}
    </NoticesShell>
  );
};

export default NoticeQueuePage;
