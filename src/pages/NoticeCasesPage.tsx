// Notices & Litigation · Cases (the firm's request of 9 October 2026): one row
// per issue instead of one per notice, a tab per kind of portal service, and
// what came in since anyone last opened the case. Every figure comes from the
// view notice_cases (migration 20261011100000).
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { Pager } from '@/components/notices/Pager';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { KindCards } from '@/components/notices/cases/HomeParts';
import { CasesTable } from '@/components/notices/cases/CasesTable';
import { LinkReviewPanel } from '@/components/notices/cases/LinkReviewPanel';
import { useAuth } from '@/contexts/AuthContext';
import { masterForRpc, useMaster } from '@/lib/masterFilters';
import {
  CASE_SHOWS, chainsOf, isCaseView, isTrack, loadCases, loadChainLinks, trackDef, useCaseCounts, useReviewQueue, type CaseShow, type CaseView, type Track,
} from '@/lib/noticeCases';

const PAGE = 50;

const NoticeCasesPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { m } = useMaster();
  const kindParam = sp.get('kind');
  const track: Track = isTrack(kindParam) ? kindParam : 'litigation';
  const showParam = sp.get('show');
  const show: CaseShow = (CASE_SHOWS as readonly string[]).includes(showParam ?? '') && showParam !== 'open'
    && !(track === 'other' && !['all', 'new'].includes(showParam ?? ''))
    ? showParam as CaseShow : track === 'other' ? 'all' : 'open';
  const page = Math.max(1, Number(sp.get('p')) || 1);
  // Linked: an order and its appeal are one row. Apart: every portal case its own row.
  const viewParam = sp.get('view');
  const view: CaseView = isCaseView(viewParam) ? viewParam : 'linked';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const meId = user?.id ?? null;
  const query = useMemo(() => ({ track, show, q: sp.get('q') ?? '', master: m, meId }), [track, show, sp, m, meId]);
  const list = useQuery({ queryKey: ['notice-cases', query, page, view], queryFn: () => loadCases(query, page, PAGE, view) });
  const counts = useCaseCounts(masterForRpc(m, meId), view);
  const clientIds = useMemo(() => [...new Set((list.data?.rows ?? []).map((r) => r.client_id as string))].sort(), [list.data]);
  const links = useQuery({ queryKey: ['notice-chain-links', clientIds], queryFn: () => loadChainLinks(clientIds), enabled: clientIds.length > 0, staleTime: 60_000 });
  const chains = useMemo(() => (links.data ? chainsOf(links.data) : undefined), [links.data]);
  // Links the system was under 90% sure of, appeals linked to no order and likely
  // twins wait for a person (20261025100000); the list opens with ?review=1.
  const review = useReviewQueue(m.client ?? null, isStaffRole());
  const reviewN = review.data?.length ?? 0;
  const reviewOpen = sp.get('review') === '1';

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') n.delete(k); else n.set(k, v); });
    if (!('p' in patch)) n.delete('p');
    setSp(n, { replace: true });
  };
  const def = trackDef(track);
  const c = counts.data?.[track];
  const segs: { key: CaseShow; label: string; n?: number; tone?: string }[] = track === 'other'
    ? [{ key: 'all', label: 'All', n: c?.cases }, { key: 'new', label: 'New correspondence', n: c?.new }]
    : [
        { key: 'open', label: 'Open', n: c?.open },
        { key: 'with_us', label: 'With us', n: c?.with_us, tone: c?.with_us ? 'text-warning' : '' },
        { key: 'with_dept', label: 'With the department', n: c?.with_dept, tone: c?.with_dept ? 'text-info' : '' },
        { key: 'overdue', label: 'Overdue', n: c?.overdue, tone: c?.overdue ? 'text-destructive-strong' : '' },
        { key: 'due7', label: 'Due this week', n: c?.due7 },
        { key: 'new', label: 'New', n: c?.new },
        { key: 'closed', label: 'Closed', n: c?.closed },
        { key: 'all', label: 'All', n: c?.cases },
      ];
  const rows = list.data?.rows ?? [];

  return (
    <NoticesShell section="Cases" master>
      <KindCards value={track} counts={counts.data} onChange={(t) => set({ kind: t === 'litigation' ? null : t, show: null })} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Which cases">
          {segs.map((sg) => (
            <button key={sg.key} type="button" onClick={() => set({ show: sg.key === (track === 'other' ? 'all' : 'open') ? null : sg.key })} aria-pressed={show === sg.key}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                show === sg.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}>
              {sg.label}
              {sg.n !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', show === sg.key ? 'bg-primary-foreground/20' : cn('bg-muted', sg.tone))}>{sg.n}</span>}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="Linked or apart">
          {([['linked', 'Linked', 'An order and its appeal (or a refund and its appeal) show as one case'], ['apart', 'Apart', 'Every portal case on its own row, each saying what it is linked to']] as const).map(([k, label, hint]) => (
            <button key={k} type="button" title={hint} aria-pressed={view === k} onClick={() => set({ view: k === 'linked' ? null : k })}
              className={cn('rounded px-2.5 py-0.5 text-xs font-medium transition-colors', view === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q }); }} onBlur={() => q !== (sp.get('q') ?? '') && set({ q })}
            placeholder="Client, GSTIN, case or reference" aria-label="Search cases" className="h-8 pl-7 text-xs" />
        </div>
        <button type="button" onClick={() => set({ review: reviewOpen ? null : '1', p: sp.get('p') })} aria-pressed={reviewOpen}
          title="Links the system was not at least 90% sure of, and cases that look missed or doubled, wait here for a person"
          className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            reviewOpen ? 'border-primary bg-primary text-primary-foreground'
              : reviewN ? 'border-warning bg-warning/10 text-warning hover:bg-warning/20' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}>
          <ShieldQuestion className="h-3.5 w-3.5" aria-hidden /> Needs a person
          <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', reviewOpen ? 'bg-primary-foreground/20' : 'bg-muted')}>{review.isLoading ? '…' : reviewN}</span>
        </button>
        <span className="text-xs text-muted-foreground">{def.blurb}</span>
        {track === 'refund' && (
          <Link to="/refunds-all" className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
            Every refund with its amounts, steps and appeals: the Refunds page <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {reviewOpen && (
        <LinkReviewPanel items={review.data} loading={review.isLoading} error={review.error} onRetry={() => review.refetch()} showClient={!m.client} />
      )}
      {list.error ? <LoadError what="the cases" error={list.error} onRetry={() => list.refetch()} />
        : list.isLoading ? <Skeleton className="h-96 w-full" />
        : !rows.length ? <EmptyBox className="p-6">{show === 'new' ? 'Nothing new has come in on these cases.' : 'No case matches.'}</EmptyBox>
        : <CasesTable rows={rows} track={track} view={view} chains={chains} />}
      <Pager page={page} pageSize={PAGE} total={list.data?.total ?? 0} onPage={(p) => set({ p: String(p) })} />
    </NoticesShell>
  );
};

export default NoticeCasesPage;
