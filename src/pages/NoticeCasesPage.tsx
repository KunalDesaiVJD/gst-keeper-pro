// Notices & Litigation · Cases (the firm's request of 9 October 2026): one row
// per issue instead of one per notice, a tab per kind of portal service, and
// what came in since anyone last opened the case. Every figure comes from the
// view notice_cases (migration 20261011100000).
import React, { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { Pager } from '@/components/notices/Pager';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { KindTabs } from '@/components/notices/cases/KindTabs';
import { CasesTable } from '@/components/notices/cases/CasesTable';
import { useAuth } from '@/contexts/AuthContext';
import { masterForRpc, useMaster } from '@/lib/masterFilters';
import { isTrack, loadCases, trackDef, useCaseCounts, type CaseShow, type Track } from '@/lib/noticeCases';

const PAGE = 50;

const NoticeCasesPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { m } = useMaster();
  const kindParam = sp.get('kind');
  const track: Track = isTrack(kindParam) ? kindParam : 'litigation';
  const showParam = sp.get('show');
  const show: CaseShow = showParam === 'new' || showParam === 'all' ? showParam : track === 'other' ? 'all' : 'open';
  const page = Math.max(1, Number(sp.get('p')) || 1);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const meId = user?.id ?? null;
  const query = useMemo(() => ({ track, show, q: sp.get('q') ?? '', master: m, meId }), [track, show, sp, m, meId]);
  const list = useQuery({ queryKey: ['notice-cases', query, page], queryFn: () => loadCases(query, page, PAGE) });
  const counts = useCaseCounts(masterForRpc(m, meId));

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') n.delete(k); else n.set(k, v); });
    if (!('p' in patch)) n.delete('p');
    setSp(n, { replace: true });
  };
  const def = trackDef(track);
  const rows = list.data?.rows ?? [];

  return (
    <NoticesShell section="Cases" master>
      <KindTabs value={track} counts={counts.data} onChange={(t) => set({ kind: t === 'litigation' ? null : t, show: null })} />
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={show} onValueChange={(v) => v && set({ show: v })} className="rounded-md border p-0.5" aria-label="Which cases">
          {([['open', 'Open'], ['new', 'New correspondence'], ['all', 'All']] as const).map(([k, label]) => (
            <ToggleGroupItem key={k} value={k} className="h-7 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q }); }} onBlur={() => q !== (sp.get('q') ?? '') && set({ q })}
            placeholder="Client, GSTIN, case or reference" aria-label="Search cases" className="h-8 pl-7 text-xs" />
        </div>
        <span className="text-xs text-muted-foreground">{def.blurb}</span>
      </div>
      {list.error ? <LoadError what="the cases" error={list.error} onRetry={() => list.refetch()} />
        : list.isLoading ? <Skeleton className="h-96 w-full" />
        : !rows.length ? <EmptyBox className="p-6">{show === 'new' ? 'Nothing new has come in on these cases.' : 'No case matches.'}</EmptyBox>
        : <CasesTable rows={rows} track={track} />}
      <Pager page={page} pageSize={PAGE} total={list.data?.total ?? 0} onPage={(p) => set({ p: String(p) })} />
    </NoticesShell>
  );
};

export default NoticeCasesPage;
