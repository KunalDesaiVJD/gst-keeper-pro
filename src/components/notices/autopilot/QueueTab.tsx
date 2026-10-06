// The office agent's queue (roadmap Phase 3; audit U-07-1, U-50-4: each client
// says queued · waiting for a CAPTCHA · running · done, live): today's jobs and
// every job still active, with why a job failed, its tries and timings, who
// typed its CAPTCHA, and Retry / Cancel. Filters live in the URL; the status
// line's counts open this list with the same filter and the same count.
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { Pager } from '@/components/notices/Pager';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  ACTIVE_STATUSES, ORIGIN_LABELS, cancelJob, fmtWhen, istDayStart, jobStatusDef, jobWhat, originLabel, reasonLabel, retryJob,
  type PortalJob,
} from '@/lib/autopilot';
import { plural } from '@/lib/noticeFormat';
import { EmptyBox, LoadError, ToneBadge } from './parts';
import { cn } from '@/lib/utils';

const PAGE = 50;

export type QueueFilter = 'all' | 'captcha' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
const FILTERS: { key: QueueFilter; label: string; match: (s: string) => boolean }[] = [
  { key: 'all', label: 'Every job today', match: () => true },
  { key: 'captcha', label: 'Waiting for a CAPTCHA', match: (s) => s === 'needs_human' || s === 'waiting_captcha' },
  { key: 'queued', label: 'Queued', match: (s) => s === 'queued' },
  { key: 'running', label: 'Running', match: (s) => s === 'claimed' || s === 'running' },
  { key: 'succeeded', label: 'Done', match: (s) => s === 'succeeded' },
  { key: 'failed', label: 'Failed', match: (s) => s === 'failed' },
  { key: 'cancelled', label: 'Cancelled', match: (s) => s === 'cancelled' },
];

type QueueJob = Pick<PortalJob,
  'id' | 'client_id' | 'job_type' | 'status' | 'payload' | 'origin' | 'priority' | 'reason_class' | 'error' | 'attempts' |
  'not_before' | 'created_at' | 'started_at' | 'finished_at' | 'captcha_count' | 'answered_by_name' | 'session_reused' |
  'requested_by_name' | 'updated_at'> & { clients: { name: string; gstin: string | null } | null };

const SELECT = 'id, client_id, job_type, status, payload, origin, priority, reason_class, error, attempts, not_before, created_at, '
  + 'started_at, finished_at, captcha_count, answered_by_name, session_reused, requested_by_name, updated_at, clients(name, gstin)';

/** Active jobs (any day) and jobs that finished today (IST): exactly what the status line counts. */
async function loadQueue(): Promise<QueueJob[]> {
  return fetchAllRows<QueueJob>('portal_jobs', SELECT, (q) => q
    .or(`status.in.(${ACTIVE_STATUSES.join(',')}),finished_at.gte.${istDayStart()}`)
    .order('created_at', { ascending: false }).order('id'));
}

const RANK: Record<string, number> = { needs_human: 0, waiting_captcha: 1, claimed: 2, running: 2, queued: 3 };
const order = (a: QueueJob, b: QueueJob) => {
  const ra = RANK[a.status] ?? 9; const rb = RANK[b.status] ?? 9;
  if (ra !== rb) return ra - rb;
  if (ra === 9) return (b.finished_at ?? '').localeCompare(a.finished_at ?? '');
  return b.priority - a.priority || (a.created_at ?? '').localeCompare(b.created_at ?? '');
};

const isActive = (s: string) => (ACTIVE_STATUSES as string[]).includes(s);
const retrying = (j: QueueJob) => j.status === 'queued' && !!j.not_before && Date.parse(j.not_before) > Date.now();

function timing(j: QueueJob): string {
  if (retrying(j)) return `next try ${fmtWhen(j.not_before)}`;
  if (j.finished_at) return `${j.started_at ? `started ${fmtWhen(j.started_at)} · ` : ''}finished ${fmtWhen(j.finished_at)}`;
  if (j.started_at) return `started ${fmtWhen(j.started_at)}`;
  return `queued ${fmtWhen(j.created_at)}`;
}

const StatusCell: React.FC<{ j: QueueJob }> = ({ j }) => {
  const def = jobStatusDef(j.status);
  const showReason = (j.status === 'failed' || j.status === 'cancelled' || retrying(j)) && j.reason_class && j.reason_class !== 'cancelled';
  return (
    <div className="space-y-0.5">
      <ToneBadge tone={def.tone}>{retrying(j) ? 'Retrying' : def.label}</ToneBadge>
      {showReason && <div className="text-xs font-medium">{reasonLabel(j.reason_class)}</div>}
      {j.error && j.status !== 'succeeded' && <div className="line-clamp-2 break-words text-[11px] text-muted-foreground" title={j.error}>{j.error}</div>}
    </div>
  );
};

const captchaText = (j: QueueJob) => j.captcha_count
  ? `${plural(j.captcha_count, 'CAPTCHA')}${j.answered_by_name ? ` · typed by ${j.answered_by_name}` : ''}`
  : j.session_reused ? 'none: session reused' : '—';

const Actions: React.FC<{ j: QueueJob; canAct: boolean; onRetry: (j: QueueJob) => void; onCancel: (j: QueueJob) => void; busy: boolean }> = ({ j, canAct, onRetry, onCancel, busy }) => {
  if (!canAct) return null;
  if (j.status === 'failed' || j.status === 'cancelled') {
    return <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => onRetry(j)}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry<span className="sr-only"> {j.clients?.name}</span></Button>;
  }
  if (isActive(j.status)) {
    return <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => onCancel(j)}><X className="h-3.5 w-3.5" aria-hidden /> Cancel<span className="sr-only"> {j.clients?.name}</span></Button>;
  }
  return null;
};

export const QueueTab: React.FC = () => {
  const { user, canEditNoticeStatus } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['autopilot-queue'], queryFn: loadQueue, refetchInterval: 10_000 });

  const status = (FILTERS.find((f) => f.key === sp.get('status'))?.key ?? 'all') as QueueFilter;
  const origin = sp.get('origin');
  const search = (sp.get('q') ?? '').trim().toLowerCase();
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const set = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') next.delete(k); else next.set(k, v); });
    if (!keepPage) next.delete('page');
    setSp(next);
  };

  const all = useMemo(() => [...(q.data ?? [])].sort(order), [q.data]);
  const base = useMemo(() => all.filter((j) => (!origin || j.origin === origin)
    && (!search || `${j.clients?.name ?? ''} ${j.clients?.gstin ?? ''}`.toLowerCase().includes(search))), [all, origin, search]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, base.filter((j) => f.match(j.status)).length])) as Record<QueueFilter, number>, [base]);
  const rows = base.filter((j) => FILTERS.find((f) => f.key === status)!.match(j.status));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const actor = user ? { id: user.id, firstName: user.firstName } : null;
  const canAct = canEditNoticeStatus();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['autopilot-queue'] });
    qc.invalidateQueries({ queryKey: ['autopilot-status'] });
    qc.invalidateQueries({ queryKey: ['autopilot-badge'] });
  };
  const onRetry = async (j: QueueJob) => {
    setBusy(j.id);
    const res = await retryJob(j.id, actor);
    setBusy(null);
    if (!res.ok) { toast.error(`Couldn't queue it again: ${res.error}`); return; }
    toast[res.tone === 'warning' ? 'warning' : 'success'](`${j.clients?.name ?? 'Client'}: ${res.text}`);
    refresh();
  };
  const onCancel = async (j: QueueJob) => {
    const ok = await confirm({
      title: `Cancel this job for ${j.clients?.name ?? 'the client'}?`,
      description: `${jobWhat(j)}. A job the agent is running stops at its next check; Retry queues it again.`,
      confirmText: 'Cancel the job', cancelText: 'Keep it', destructive: true,
    });
    if (!ok) return;
    setBusy(j.id);
    const res = await cancelJob(j.id, actor);
    setBusy(null);
    (res.ok ? toast.success : toast.info)(res.text);
    refresh();
  };

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (status !== 'all') chips.push({ key: 'status', label: `Status: ${FILTERS.find((f) => f.key === status)!.label}`, clear: { status: null } });
  if (origin) chips.push({ key: 'origin', label: `Run: ${originLabel(origin)}`, clear: { origin: null } });
  if (search) chips.push({ key: 'q', label: `Search: ${sp.get('q')}`, clear: { q: null } });

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input defaultValue={sp.get('q') ?? ''} key={sp.get('q') ?? ''} placeholder="Client or GSTIN" aria-label="Search the queue"
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value.trim() || null }); }}
              onBlur={(e) => { if ((e.target.value.trim() || null) !== (sp.get('q') || null)) set({ q: e.target.value.trim() || null }); }}
              className="h-8 pl-7 text-xs" />
          </div>
          <FilterPill label="Status" allLabel={`Every job today (${counts.all})`} value={status}
            onChange={(v) => set({ status: v === 'all' ? null : v })} options={[]}
            extraOptions={FILTERS.filter((f) => f.key !== 'all').map((f) => ({ value: f.key, label: `${f.label} (${counts[f.key]})` }))} />
          <FilterPill label="Run" allLabel="Any" value={origin ?? 'all'} onChange={(v) => set({ origin: v === 'all' ? null : v })} options={[]}
            extraOptions={Object.entries(ORIGIN_LABELS).map(([k, label]) => ({ value: k, label }))} />
          <div className="ml-auto">
            <Button size="sm" variant="outline" className={WS_BTN} onClick={refresh} disabled={q.isFetching}>
              <RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} aria-hidden /> Refresh
            </Button>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {chips.map((ch) => (
              <button key={ch.key} type="button" onClick={() => set(ch.clear)} aria-label={`Remove filter ${ch.label}`}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {ch.label} <X className="h-3 w-3" aria-hidden />
              </button>
            ))}
            <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => set({ status: null, origin: null, q: null })}>
              Clear all
            </button>
          </div>
        )}
      </div>

      {q.error ? <LoadError what="the queue" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        : rows.length === 0 ? (
          <EmptyBox>
            {status === 'all' && !origin && !search ? 'Nothing on the queue today. The schedule, Sync now, Fetch a report and portal e-mails put clients here.' : 'No job matches these filters.'}
          </EmptyBox>
        ) : (
          <>
            <h3 className="sr-only" aria-live="polite">{FILTERS.find((f) => f.key === status)!.label} · {plural(rows.length, 'job')}</h3>
            {/* Phones: cards. */}
            <ul className="space-y-2 md:hidden">
              {pageRows.map((j) => (
                <li key={j.id} className={cn('space-y-1.5 rounded-lg border bg-card p-3', j.status === 'failed' && 'border-destructive/50')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/notices-company/${j.client_id}`} className="block truncate text-sm font-semibold hover:underline">{j.clients?.name ?? 'Client'}</Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{j.clients?.gstin}</div>
                    </div>
                    <StatusCell j={j} />
                  </div>
                  <div className="text-xs">{jobWhat(j)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {originLabel(j.origin)}{j.requested_by_name && j.origin !== 'email' ? ` · ${j.requested_by_name}` : ''} · {timing(j)}
                    {j.attempts > 0 ? ` · ${plural(j.attempts, 'try', 'tries')}` : ''} · {captchaText(j)}
                  </div>
                  <div className="flex justify-end"><Actions j={j} canAct={canAct} busy={busy === j.id} onRetry={onRetry} onCancel={onCancel} /></div>
                </li>
              ))}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden md:block')} tabIndex={0} role="region" aria-label="Jobs">
              <table className={WS_TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={WS_TH}>Client</th>
                    <th scope="col" className={WS_TH}>What</th>
                    <th scope="col" className={WS_TH}>Run</th>
                    <th scope="col" className={WS_TH}>Status</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Tries</th>
                    <th scope="col" className={WS_TH}>When</th>
                    <th scope="col" className={WS_TH}>CAPTCHAs</th>
                    <th scope="col" className={WS_TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((j) => (
                    <tr key={j.id} className={cn(WS_TR, j.status === 'failed' && 'bg-destructive/[0.03]')}>
                      <td className={cn(WS_TD, 'max-w-[14rem]')}>
                        <Link to={`/notices-company/${j.client_id}`} className="block truncate font-medium hover:underline">{j.clients?.name ?? 'Client'}</Link>
                        <div className="font-mono text-[11px] text-muted-foreground">{j.clients?.gstin}</div>
                      </td>
                      <td className={cn(WS_TD, 'min-w-[12rem] text-xs')}>{jobWhat(j)}</td>
                      <td className={cn(WS_TD, 'text-xs')}>
                        <div className="whitespace-nowrap">{originLabel(j.origin)}</div>
                        {j.requested_by_name && j.origin !== 'email' && <div className="text-[11px] text-muted-foreground">{j.requested_by_name}</div>}
                      </td>
                      <td className={cn(WS_TD, 'min-w-[11rem] max-w-[18rem]')}><StatusCell j={j} /></td>
                      <td className={cn(WS_TD, 'text-right text-xs tabular-nums')}>{j.attempts}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{timing(j)}</td>
                      <td className={cn(WS_TD, 'text-xs')}>{captchaText(j)}</td>
                      <td className={cn(WS_TD, 'text-right')}><Actions j={j} canAct={canAct} busy={busy === j.id} onRetry={onRetry} onCancel={onCancel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={PAGE} total={rows.length} onPage={(p) => set({ page: String(p) }, true)} />
          </>
        )}
    </div>
  );
};

export default QueueTab;
