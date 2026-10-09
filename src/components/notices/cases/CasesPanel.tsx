// The command centre's list (the firm's request of 9 October 2026): the cases of
// one kind that need attention, one row per issue, not one per notice. New
// correspondence first, then overdue, then by the next due date.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/notices/ui/Panel';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { WS_BTN } from '@/components/workspace/theme';
import { CasesTable } from './CasesTable';
import { useAuth } from '@/contexts/AuthContext';
import { hrefWithMaster, type Master } from '@/lib/masterFilters';
import { loadCases, trackDef, type CaseShow, type Track } from '@/lib/noticeCases';

export const CasesPanel: React.FC<{ track: Track; master: Master; show?: CaseShow; limit?: number; title?: string }> = ({ track, master, show = 'open', limit = 10, title }) => {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const q = useQuery({
    queryKey: ['notice-cases', { track, show, q: '', master, meId }, 1, limit],
    queryFn: () => loadCases({ track, show, q: '', master, meId }, 1, limit),
    staleTime: 60_000,
  });
  const all = hrefWithMaster(`/notices-cases?${new URLSearchParams({ ...(track === 'litigation' ? {} : { kind: track }), ...(show === 'open' ? {} : { show }) })}`, master);
  const total = q.data?.total ?? 0;
  return (
    <Panel title={title ?? `${trackDef(track).label} needing attention`}
      info="One row per case: a case holds every notice of the same issue and every document in its portal case folder. New correspondence comes first."
      actions={total > limit && <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to={all}>All {total}</Link></Button>}>
      {q.error ? <LoadError what="the cases" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-64 w-full" />
        : !(q.data?.rows.length) ? <EmptyBox className="p-4">{show === 'open' ? 'No open case.' : 'Nothing here.'}</EmptyBox>
        : <CasesTable rows={q.data.rows} track={track} compact />}
    </Panel>
  );
};

export default CasesPanel;
