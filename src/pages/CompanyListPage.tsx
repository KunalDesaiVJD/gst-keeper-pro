// Notices & Litigation · Clients: portal sync health per client (roadmap Phase 2;
// target-sync.png "Freshness by client"). Fixes audit U-50-1..6, U-51-1..3,
// U-52-1..3, U-53-1..3, U-54-2..4 and the cross-cutting house-style, wording,
// machine-text and number findings for this screen. Every count is the command
// centre's (components/notices/clients/syncHealth.ts mirrors its SQL), the
// filters live in the URL (?status=fresh|stale|never|failed|off&reason=…), a
// failure says what went wrong with its one fix, and the sync log is a tab.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { SyncNowButton } from '@/components/notices/SyncNowButton';
import { FilterPill } from '@/components/notices/FilterPill';
import { Pager } from '@/components/notices/Pager';
import { FilterTile } from '@/components/notices/clients/FilterTile';
import { ClientSyncTable, type ClientSort, type RowHandlers } from '@/components/notices/clients/ClientSyncTable';
import { SyncLogTab } from '@/components/notices/clients/SyncLogTab';
import { SyncSettingDialog } from '@/components/notices/clients/SyncSettingDialog';
import { DeleteClientDialog } from '@/components/notices/clients/DeleteClientDialog';
import { ImportPortalIdsDialog } from '@/components/notices/clients/ImportPortalIdsDialog';
import { useClientSync } from '@/components/notices/clients/useClientSync';
import {
  REASONS, countHealth, isRetryable, loadClientHealth, loadFailureRuns, loadOpenCounts, loadRuns, matchesStatus, reasonDef, tsCmp,
  type ClientHealth, type HealthCounts, type StatusFilter, type SyncRun, type SyncState,
} from '@/components/notices/clients/syncHealth';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const PAGE = 50;
const STATUSES: StatusFilter[] = ['all', 'fresh', 'stale', 'never', 'failed', 'off'];
const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'Every synced client', fresh: 'Synced in 24 h', stale: 'Not synced in 24 h', never: 'Never synced', failed: 'Failing',
  off: 'Not synced by the app',
};
const RANK: Record<SyncState, number> = { failed: 0, never: 1, stale: 2, fresh: 3, off: 4 };
const DEFAULT_DIR: Record<ClientSort, 'asc' | 'desc'> = { attention: 'asc', client: 'asc', pull: 'asc', open: 'desc' };

function parseStatus(v: string | null): StatusFilter {
  if (v === 'success') return 'fresh';
  return STATUSES.includes(v as StatusFilter) ? (v as StatusFilter) : 'all';
}

/** "8 of 12 GSTINs synced in 24 h · last run …" — the command centre's line, for this page (U-50-2). */
const SyncLine: React.FC<{ c: HealthCounts; run: SyncRun | undefined; polling: boolean }> = ({ c, run, polling }) => {
  const share = c.all ? c.fresh / c.all : 1;
  const tone = share >= 0.9 && c.failed === 0 ? 'bg-success' : share >= 0.5 ? 'bg-warning' : 'bg-destructive';
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" aria-live="polite">
      <span className={cn('inline-block h-2 w-2 rounded-full', tone)} aria-hidden />
      <span className="font-medium text-foreground">{c.fresh} of {c.all} GSTINs synced in 24 h</span>
      {run && (
        <span>· last run {run.status === 'running' ? 'running' : run.status} {fmtAgo(run.started_at)}
          {run.clients_total ? ` (${run.clients_done} of ${plural(run.clients_total, 'client')}${run.ext_version ? `, extension v${run.ext_version}` : ''})` : ''}</span>
      )}
      {polling && <span>· updating every 10 s</span>}
      {c.failed > 0 && (
        <Link to="/notices-company-list?status=failed" className="font-medium text-destructive-strong underline-offset-2 hover:underline">· {c.failed} failing →</Link>
      )}
    </p>
  );
};

const CompanyListPage: React.FC = () => {
  const { isStaffRole, canAddEditClients, canDeleteClients, canEditNoticeStatus, canExportData } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const sync = useClientSync();
  const [pollFrom, setPollFrom] = useState<number | null>(null);
  const [settingFor, setSettingFor] = useState<ClientHealth[] | null>(null);
  const [deleting, setDeleting] = useState<ClientHealth | null>(null);

  const tab = sp.get('tab') === 'log' ? 'log' : 'clients';
  const status = parseStatus(sp.get('status'));
  const reason = status === 'failed' ? sp.get('reason') : null;
  const q = sp.get('q') ?? '';
  const owner = sp.get('owner');
  const sort: ClientSort = (['attention', 'client', 'pull', 'open'] as const).find((k) => k === sp.get('sort')) ?? 'attention';
  const dir: 'asc' | 'desc' = sp.get('dir') === 'desc' ? 'desc' : sp.get('dir') === 'asc' ? 'asc' : DEFAULT_DIR[sort];
  const page = Math.max(1, Number(sp.get('page')) || 1);

  // Poll while a run is going or one was just started from here (U-50-4).
  const [pollMs, setPollMs] = useState<number | false>(false);
  const runs = useQuery({ queryKey: ['client-sync-runs'], queryFn: () => loadRuns(12), refetchInterval: pollMs });
  const health = useQuery({ queryKey: ['client-sync-health'], queryFn: loadClientHealth, refetchInterval: pollMs });
  const counts = useQuery({ queryKey: ['client-open-counts'], queryFn: loadOpenCounts, staleTime: 60_000 });
  const all = useMemo(() => health.data ?? [], [health.data]);
  const failing = useMemo(() => all.filter((h) => h.failReason), [all]);
  const failRuns = useQuery({
    queryKey: ['client-fail-runs', failing.map((f) => `${f.client.id}:${f.lastSuccessAt}`).join(',')],
    enabled: health.isSuccess,
    queryFn: () => loadFailureRuns(failing),
  });

  const startedAt = sync.started?.at ?? pollFrom;
  const pending = sync.started
    ? all.filter((h) => sync.started?.ids.has(h.client.id) && !(h.lastAttemptAt && tsCmp(h.lastAttemptAt, new Date(sync.started.at).toISOString()) > 0)).length
    : 0;
  const running = runs.data?.[0]?.status === 'running';
  const wantPoll = running || (!!startedAt && Date.now() - startedAt < 30 * 60_000 && (pending > 0 || !sync.started));
  React.useEffect(() => { setPollMs(wantPoll ? 10_000 : false); }, [wantPoll]);

  const c = useMemo(() => countHealth(all), [all]);
  const owners = useMemo(() => [...new Set(all.map((h) => h.client.assigned_accountant).filter((o): o is string => !!o))].sort(), [all]);
  const names = useMemo(() => new Map(all.map((h) => [h.client.id, { name: h.client.name, gstin: h.client.gstin }])), [all]);

  const list = useMemo(() => {
    const cnt = counts.data;
    const term = q.trim().toLowerCase();
    const urgent = (id: string) => (cnt?.get(id)?.overdue ?? 0) + (cnt?.get(id)?.due7 ?? 0);
    const pull = (h: ClientHealth) => (h.lastSuccessAt ? Date.parse(h.lastSuccessAt) : 0);
    const rows = all.filter((h) => matchesStatus(h, status, reason)
      && (!owner || (owner === 'none' ? !h.client.assigned_accountant : h.client.assigned_accountant === owner))
      && (!term || h.client.name.toLowerCase().includes(term) || h.client.gstin.toLowerCase().includes(term)
        || (h.client.gst_user_id ?? '').toLowerCase().includes(term)));
    const sign = dir === 'asc' ? 1 : -1;
    const byName = (a: ClientHealth, b: ClientHealth) => a.client.name.localeCompare(b.client.name);
    // Failing, then never synced, then stale (most urgent notices, oldest pull first), then fresh (U-50-5, U-51-3).
    const cmp: Record<ClientSort, (a: ClientHealth, b: ClientHealth) => number> = {
      attention: (a, b) => RANK[a.state] - RANK[b.state] || urgent(b.client.id) - urgent(a.client.id) || pull(a) - pull(b),
      client: byName,
      pull: (a, b) => pull(a) - pull(b),
      open: (a, b) => (cnt?.get(a.client.id)?.open ?? 0) - (cnt?.get(b.client.id)?.open ?? 0),
    };
    return rows.sort((a, b) => sign * cmp[sort](a, b) || byName(a, b));
  }, [all, counts.data, status, reason, owner, q, sort, dir]);

  const set = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') next.delete(k); else next.set(k, v); });
    if (!keepPage) next.delete('page');
    setSp(next);
  };
  const [search, setSearch] = useState(q);
  React.useEffect(() => { setSearch(q); }, [q]);
  React.useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => set({ q: search || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['client-sync-health'] });
    qc.invalidateQueries({ queryKey: ['client-sync-runs'] });
    qc.invalidateQueries({ queryKey: ['client-open-counts'] });
    qc.invalidateQueries({ queryKey: ['client-fail-runs'] });
    qc.invalidateQueries({ queryKey: ['sync-log-items'] });
    qc.invalidateQueries({ queryKey: ['sync-log-messages'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
  };
  const canSync = canEditNoticeStatus();
  const handlers: RowHandlers = {
    canSync,
    canEditClients: canAddEditClients(),
    canDelete: canDeleteClients(),
    onSync: (ids) => { sync.start(ids).then((ok) => { if (ok) refresh(); }); },
    onFetchProfile: (ids) => { sync.start(ids, 'taxpayerprofile'); },
    onSetting: (rows) => setSettingFor(rows),
    onDelete: (h) => setDeleting(h),
    onChanged: refresh,
  };
  const onSort = (k: ClientSort) => {
    if (k === sort) set({ sort: k, dir: dir === 'asc' ? 'desc' : 'asc' });
    else set({ sort: k === 'attention' ? null : k, dir: null });
  };
  const retryIds = failing.filter(isRetryable).map((h) => h.client.id);
  const total = list.length;
  const pageRows = list.slice((page - 1) * PAGE, page * PAGE);
  const loginFails = c.reasons.login_failed ?? 0;
  const tileHref = (s: StatusFilter) => (s === 'all' ? '/notices-company-list' : `/notices-company-list?status=${s}`);
  const reasonHint = Object.entries(c.reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r, n]) => `${n} ${reasonDef(r).short}`).join(' · ');

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (status !== 'all') chips.push({ key: 'status', label: `Status: ${STATUS_LABEL[status]}`, clear: { status: null, reason: null } });
  if (reason) chips.push({ key: 'reason', label: `Reason: ${reasonDef(reason).long}`, clear: { reason: null } });
  if (owner) chips.push({ key: 'owner', label: `Owner: ${owner === 'none' ? 'nobody' : owner}`, clear: { owner: null } });
  if (q) chips.push({ key: 'q', label: `Search: ${q}`, clear: { q: null } });

  return (
    <NoticesShell
      section="Clients"
      status={health.data ? <SyncLine c={c} run={runs.data?.[0]} polling={pollMs !== false} /> : <Skeleton className="h-4 w-96 max-w-full" />}
      actions={<>
        {canSync && retryIds.length > 0 && (
          <Button size="sm" variant="outline" className={WS_BTN} disabled={sync.busy} onClick={() => handlers.onSync(retryIds)}
            title={loginFails ? `Leaves out ${plural(loginFails, 'failed login')}: update those passwords first.` : undefined}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry failed ({retryIds.length})
          </Button>
        )}
        {canAddEditClients() && <ImportPortalIdsDialog clients={all.map((h) => h.client)} onDone={refresh} />}
        {canSync && <SyncNowButton onStarted={() => { setPollFrom(Date.now()); refresh(); }} />}
      </>}
    >
      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'log' ? 'log' : null })} className="space-y-3">
        <TabsList className={TAB_LIST_CLASS} aria-label="Clients view">
          <TabsTrigger value="clients" className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>By client</TabsTrigger>
          <TabsTrigger value="log" className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>Sync log</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-0 space-y-3">
          {health.data ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <FilterTile to={tileHref('all')} label="Synced clients" accent="primary" active={status === 'all'} value={c.all.toLocaleString('en-IN')}
                hint="with a portal user ID, active" />
              <FilterTile to={tileHref('fresh')} label="Synced in 24 h" accent="success" active={status === 'fresh'}
                value={<>{c.fresh}<span className="text-base font-medium text-muted-foreground"> / {c.all}</span></>} hint="good pull in the last 24 h" />
              <FilterTile to={tileHref('stale')} label="Not synced in 24 h" accent="warning" active={status === 'stale'} value={c.stale}
                hint={c.never ? `${c.never} of them never synced` : 'oldest first'} />
              <FilterTile to={tileHref('never')} label="Never synced" accent="warning" active={status === 'never'} value={c.never} hint="no attempt on record" />
              <FilterTile to={tileHref('failed')} label="Failing" accent="destructive" active={status === 'failed'} value={c.failed} strong={c.failed > 0}
                hint={reasonHint || 'nothing failing'} />
              <FilterTile to={tileHref('off')} label="Not synced by the app" accent="muted" active={status === 'off'} value={c.off}
                hint="no user ID, inactive or excluded" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[70px]" />)}</div>
          )}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client, GSTIN or portal user ID" aria-label="Search clients" className="h-8 pl-7 text-xs" />
              </div>
              <FilterPill label="Status" allLabel={STATUS_LABEL.all} value={status} onChange={(v) => set({ status: v === 'all' ? null : v, reason: null })}
                options={[]} extraOptions={STATUSES.filter((s) => s !== 'all').map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
              <FilterPill label="Reason" allLabel="Any" value={reason ?? 'all'}
                onChange={(v) => set({ status: v === 'all' ? sp.get('status') : 'failed', reason: v === 'all' ? null : v })}
                options={[]} extraOptions={Object.keys({ ...REASONS, ...c.reasons }).map((r) => ({ value: r, label: `${reasonDef(r).long} (${c.reasons[r] ?? 0})` }))} />
              {owners.length > 0 && (
                <FilterPill label="Owner" allLabel="Anyone" value={owner ?? 'all'} onChange={(v) => set({ owner: v === 'all' ? null : v })}
                  options={[]} extraOptions={[...owners.map((o) => ({ value: o, label: o })), { value: 'none', label: 'Nobody' }]} />
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="outline" className={WS_BTN} onClick={refresh} disabled={health.isFetching}>
                  <RefreshCw className={cn('h-3.5 w-3.5', health.isFetching && 'animate-spin')} aria-hidden /> Refresh
                </Button>
              </div>
            </div>
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                {chips.map((ch) => (
                  <button key={ch.key} type="button" onClick={() => set(ch.clear)}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove filter ${ch.label}`}>
                    {ch.label} <X className="h-3 w-3" aria-hidden />
                  </button>
                ))}
                <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => set({ status: null, reason: null, owner: null, q: null })}>
                  Clear all
                </button>
              </div>
            )}
          </div>

          <Note tone="info">
            Counted as on the command centre: <b>synced</b> means a good notices pull in the last 24 hours; a client is <b>failing</b> when its
            last login failed after its last good pull, or its last notices pull failed. Inactive clients, clients excluded from the notices
            sync and clients without a portal user ID are not synced by the app and sit under "Not synced by the app".
          </Note>

          {health.error ? (
            <Note tone="warn">Couldn't load the clients: {health.error instanceof Error ? health.error.message : String(health.error)}{' '}
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => health.refetch()}>Retry</Button></Note>
          ) : health.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : total === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {status === 'failed' ? 'Nothing is failing.' : status === 'never' ? 'Every synced client has been tried at least once.' : 'No client matches these filters.'}{' '}
              {chips.length > 0 && <button type="button" className="text-primary underline underline-offset-2" onClick={() => set({ status: null, reason: null, owner: null, q: null })}>Show every synced client</button>}
            </div>
          ) : (
            <>
              <h2 className="sr-only" aria-live="polite">{STATUS_LABEL[status]} · {plural(total, 'client')}</h2>
              <ClientSyncTable rows={pageRows} counts={counts.data ?? new Map()} failRuns={failRuns.data ?? new Map()} started={sync.started}
                busy={sync.busy} sort={sort} dir={dir} onSort={onSort} handlers={handlers} />
              <Pager page={page} pageSize={PAGE} total={total} onPage={(p) => set({ page: String(p) }, true)} />
            </>
          )}
        </TabsContent>

        <TabsContent value="log" className="mt-0">
          <SyncLogTab runs={runs.data ?? []} runsLoading={runs.isLoading} names={names} canExport={canExportData()} />
        </TabsContent>
      </Tabs>

      <SyncSettingDialog clients={(settingFor ?? []).map((h) => ({ id: h.client.id, name: h.client.name }))} open={!!settingFor}
        onOpenChange={(o) => { if (!o) setSettingFor(null); }} onDone={refresh} />
      <DeleteClientDialog client={deleting?.client ?? null} onOpenChange={(o) => { if (!o) setDeleting(null); }} onDone={refresh} />
    </NoticesShell>
  );
};

export default CompanyListPage;
