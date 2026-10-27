// Notices & Litigation · Cases (the firm's request of 9 October 2026): one row
// per issue instead of one per notice, and what came in since anyone last
// opened the case. Every figure comes from the view notice_cases (migration
// 20261011100000). One control row (the UX audit of 25 October 2026): the kind
// (All is notices and demands and registration; Other, the papers kept for the
// record, sits last; refunds are not cases, 27 October 2026, and an old
// ?kind=refund link lands on the Refunds tab), which cases, linked or apart, and search; links
// the system was unsure of show as a banner only while there are any.
import React, { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { Pager } from '@/components/notices/Pager';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { CasesTable } from '@/components/notices/cases/CasesTable';
import { LinkReviewPanel } from '@/components/notices/cases/LinkReviewPanel';
import { sumCounts } from '@/components/notices/cases/HomeWork';
import { useAuth } from '@/contexts/AuthContext';
import { masterForRpc, useMaster } from '@/lib/masterFilters';
import {
  CASE_SHOWS, CASE_TRACKS, chainsOf, isCaseView, isTrack, loadCases, loadChainLinks, useCaseCounts, useReviewQueue, type CaseShow, type CaseView, type Track,
} from '@/lib/noticeCases';

const PAGE = 50;
type Kind = Track | 'work';

const SEG = 'inline-flex rounded-md border bg-card p-0.5';
const segBtn = (on: boolean) => cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
  on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground');

const NoticeCasesPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { m } = useMaster();
  const kindParam = sp.get('kind');
  const kind: Kind = isTrack(kindParam) && kindParam !== 'refund' ? kindParam : 'work';
  const other = kind === 'other';
  const showParam = sp.get('show');
  const show: CaseShow = (CASE_SHOWS as readonly string[]).includes(showParam ?? '') && showParam !== 'open'
    && !(other && !['all', 'new'].includes(showParam ?? ''))
    ? showParam as CaseShow : other ? 'all' : 'open';
  const page = Math.max(1, Number(sp.get('p')) || 1);
  // Linked: an order and its appeal are one row. Apart: every portal case its own row.
  const viewParam = sp.get('view');
  const view: CaseView = isCaseView(viewParam) ? viewParam : 'linked';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const meId = user?.id ?? null;
  const query = useMemo(() => ({ track: kind, show, q: sp.get('q') ?? '', master: m, meId }), [kind, show, sp, m, meId]);
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
  if (kindParam === 'refund') return <Navigate to={m.client ? `/refunds-all?client=${m.client}` : '/refunds-all'} replace />;

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') n.delete(k); else n.set(k, v); });
    if (!('p' in patch)) n.delete('p');
    setSp(n, { replace: true });
  };
  const c = kind === 'work' ? sumCounts(counts.data) : counts.data?.[kind];
  const kinds: { key: Kind; label: string; n?: number }[] = [
    { key: 'work', label: 'All', n: sumCounts(counts.data)?.open },
    ...CASE_TRACKS.map((t) => ({ key: t.key as Kind, label: t.short, n: t.key === 'other' ? counts.data?.other?.cases : counts.data?.[t.key]?.open })),
  ];
  const shows: { key: CaseShow; label: string; n?: number }[] = other
    ? [{ key: 'all', label: 'All on record', n: c?.cases }, { key: 'new', label: 'New correspondence', n: c?.new }]
    : [
        { key: 'open', label: 'Open', n: c?.open },
        { key: 'with_us', label: 'With us', n: c?.with_us },
        { key: 'with_dept', label: 'With the department', n: c?.with_dept },
        { key: 'overdue', label: 'Overdue', n: c?.overdue },
        { key: 'due7', label: 'Due this week', n: c?.due7 },
        { key: 'new', label: 'New correspondence', n: c?.new },
        { key: 'closed', label: 'Closed', n: c?.closed },
        { key: 'all', label: 'All', n: c?.cases },
      ];
  const rows = list.data?.rows ?? [];
  const n = (v?: number) => (v === undefined ? '' : ` (${v.toLocaleString('en-IN')})`);

  return (
    <NoticesShell section="Cases" master>
      <div className="flex flex-wrap items-center gap-2">
        <div className={SEG} role="group" aria-label="Kind of case">
          {kinds.map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => set({ kind: k.key === 'work' ? null : k.key, show: null })}
              title={k.key === 'other' ? 'LUT, voluntary payments and approvals: for the record, no action' : k.key === 'work' ? 'Notices and demands, and registration (refunds are on the Refunds tab)' : undefined}
              className={cn(segBtn(kind === k.key), k.key === 'other' && kind !== k.key && 'opacity-70')}>
              {k.label}
              {k.n !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', kind === k.key ? 'bg-primary-foreground/20' : 'bg-muted')}>{k.n}</span>}
            </button>
          ))}
        </div>
        <Select value={show} onValueChange={(v) => set({ show: v === (other ? 'all' : 'open') ? null : v })}>
          <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs" aria-label="Which cases"><SelectValue /></SelectTrigger>
          <SelectContent>
            {shows.map((s) => <SelectItem key={s.key} value={s.key} className="text-xs">{s.label}{n(s.n)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className={SEG} role="group" aria-label="Linked or apart">
          {([['linked', 'Linked', 'An order and its appeal show as one case'], ['apart', 'Apart', 'Every portal case on its own row, each saying what it is linked to']] as const).map(([k, label, hint]) => (
            <button key={k} type="button" title={hint} aria-pressed={view === k} onClick={() => set({ view: k === 'linked' ? null : k })} className={segBtn(view === k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q }); }} onBlur={() => q !== (sp.get('q') ?? '') && set({ q })}
            placeholder="Client, GSTIN, case or reference" aria-label="Search cases" className="h-8 pl-7 text-xs" />
        </div>
      </div>
      {(reviewN > 0 || reviewOpen) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
          <ShieldQuestion className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span className="flex-1">
            <span className="font-semibold">{reviewN} {reviewN === 1 ? 'link' : 'links'} to check:</span>{' '}
            cases the system was not at least 90% sure belong together, appeals linked to no order, and cases that look doubled.
          </span>
          <button type="button" onClick={() => set({ review: reviewOpen ? null : '1', p: sp.get('p') })} aria-expanded={reviewOpen}
            className="font-medium text-primary hover:underline">{reviewOpen ? 'Hide' : 'Check them'}</button>
        </div>
      )}
      {reviewOpen && (
        <LinkReviewPanel items={review.data} loading={review.isLoading} error={review.error} onRetry={() => review.refetch()} showClient={!m.client} />
      )}
      {list.error ? <LoadError what="the cases" error={list.error} onRetry={() => list.refetch()} />
        : list.isLoading ? <Skeleton className="h-96 w-full" />
        : !rows.length ? <EmptyBox className="p-6">{show === 'new' ? 'Nothing new has come in on these cases.' : 'No case matches.'}</EmptyBox>
        : <CasesTable rows={rows} track={kind === 'work' ? 'all' : kind} view={view} chains={chains} showKind={kind === 'work'} />}
      <Pager page={page} pageSize={PAGE} total={list.data?.total ?? 0} onPage={(p) => set({ p: String(p) })} />
    </NoticesShell>
  );
};

export default NoticeCasesPage;
