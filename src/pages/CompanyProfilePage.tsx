// Notices & Litigation · Client profile (/notices-company/:clientId; roadmap
// Phase 2). Fixes audit U-56-1..6, U-57-1..3 and the cross-cutting house-style,
// date, title and linking findings for this screen: is this client's portal
// data fresh (and the one fix when it is not), what is at stake (the command
// centre's tiles for this client, each opening a list with the same count),
// the client's notices in the shared notice table with the canonical
// categories, refunds and DRC-03 in their own lists, the case folders, and the
// registration facts a reply needs. Filters, sort and page live in the URL.
import React, { useMemo } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadCloud, Pencil, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { NoticeTable } from '@/components/notices/NoticeTable';
import { FilterPill } from '@/components/notices/FilterPill';
import { Pager } from '@/components/notices/Pager';
import { FilterTile } from '@/components/notices/clients/FilterTile';
import { PortalLoginPopover } from '@/components/notices/clients/PortalLoginPopover';
import { ClientProfileCard } from '@/components/notices/clients/ClientProfileCard';
import { ReturnStrip } from '@/components/notices/clients/ReturnStrip';
import { ClientCases } from '@/components/notices/clients/ClientCases';
import { Drc03List, RefundList } from '@/components/notices/clients/ClientLedgers';
import { useClientSync } from '@/components/notices/clients/useClientSync';
import { loadClientProfile, matterOutstanding, refundNeedsReply, type ClientProfileData } from '@/components/notices/clients/profileData';
import { OFF_LABEL, reasonDef, type ClientHealth, type FailureRun } from '@/components/notices/clients/syncHealth';
import { summarizeCase } from '@/components/notices/clients/caseFolder';
import { LIST_FILTERS, SORTS, defaultSort, filterDef, noticesListHref, type ListFilter, type SortKey } from '@/lib/noticeQueries';
import { daysBetween, istToday, type NoticeFact } from '@/lib/noticeFacts';
import { fmtAgo, fmtDay, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const PAGE = 50;
const SHOW: ListFilter[] = ['open', 'overdue', 'due7', 'new', 'unassigned', 'exposure', 'nodue', 'issued15', 'replied', 'submitted', 'closed', 'auto_closed', 'all'];

/** The All notices list's filters (lib/noticeQueries applyListFilters), on the client's rows. */
function matchesFilter(f: NoticeFact, filter: ListFilter, issuedFrom: string): boolean {
  switch (filter) {
    case 'open': return !!f.is_open;
    case 'overdue': return !!f.is_overdue;
    case 'due7': return !!f.is_due_in_7;
    case 'new': return !!f.is_new;
    case 'unassigned': return !!f.is_unassigned;
    case 'exposure': return !!f.is_open && Number(f.exposure_amount) > 0;
    case 'nodue': return !!f.is_open && !f.effective_due;
    case 'issued15': return !!f.issue_date && f.issue_date >= issuedFrom;
    case 'replied': return !!f.is_replied;
    case 'submitted': return !!(f.submission_date || f.submission_arn);
    case 'closed': return !f.is_open;
    case 'auto_closed': return !f.is_open && /^auto:/.test(f.close_reason ?? '');
    default: return true;
  }
}

function sortRows(rows: NoticeFact[], key: SortKey, dir: 'asc' | 'desc'): NoticeFact[] {
  const col = SORTS[key].column as keyof NoticeFact;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[col] as unknown; const bv = b[col] as unknown;
    if (av === null || av === undefined) return bv === null || bv === undefined ? String(a.id).localeCompare(String(b.id)) : 1;
    if (bv === null || bv === undefined) return -1;
    const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return sign * c || String(a.id).localeCompare(String(b.id));
  });
}

/** Is this client's portal data fresh, and the one fix when it is not (U-56-1). */
const SyncStrip: React.FC<{
  h: ClientHealth; run: FailureRun | null; canSync: boolean; canEditClients: boolean; busy: boolean;
  onSync: () => void; onSaved: (retry: boolean) => void;
}> = ({ h, run, canSync, canEditClients, busy, onSync, onSaved }) => {
  const n = h.steps.notices;
  const dot = h.state === 'fresh' ? 'bg-success' : h.state === 'failed' ? 'bg-destructive' : h.state === 'off' ? 'bg-muted-foreground' : 'bg-warning';
  const login = (label: string) => canEditClients && <PortalLoginPopover client={h.client} label={label} align="start" onSaved={({ retry }) => onSaved(retry)} />;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
      <span className={cn('inline-block h-2 w-2 rounded-full', dot)} aria-hidden />
      {h.state === 'off' && h.off ? (
        <span className="font-medium text-foreground">Not synced by the app: {OFF_LABEL[h.off].toLowerCase()}</span>
      ) : h.state === 'failed' ? (
        <span className="font-medium text-destructive-strong">
          {reasonDef(h.failReason).long} {fmtAgo(h.failAt)}{run ? ` · failing since ${fmtAgo(run.since)}, ${plural(run.tries, 'try', 'tries')}` : ''}
        </span>
      ) : h.never ? (
        <span className="font-medium text-foreground">Never synced from the portal</span>
      ) : (
        <span className={cn('font-medium', h.fresh ? 'text-foreground' : 'text-destructive-strong')}>Portal: last good pull {fmtAgo(h.lastSuccessAt)}{h.fresh ? '' : ' (over 24 h)'}</span>
      )}
      {n?.last_success_at && <span>· {n.rows_seen ?? 0} on the portal, {n.rows_new ?? 0} new{n.last_ext_version ? ` · extension v${n.last_ext_version}` : ''}</span>}
      <span aria-hidden>·</span>
      <Link to={`/notices-company-list?tab=log&client=${h.client.id}`} className="text-primary underline-offset-2 hover:underline">Sync log</Link>
      {h.state === 'failed' && reasonDef(h.failReason).action === 'password' && login('Update password')}
      {h.state === 'off' && h.off === 'no_user_id' && login('Add portal user ID')}
      {canSync && h.eligible && !h.fresh && reasonDef(h.failReason).action !== 'password' && (
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={onSync}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {h.state === 'failed' ? 'Retry' : 'Sync now'}
        </Button>
      )}
    </div>
  );
};

/** The command centre's tiles for this client; each opens the list it counts (U-56-1, U-56-5, U-57-1). */
const ClientTiles: React.FC<{ d: ClientProfileData; clientId: string; today: string }> = ({ d, clientId, today }) => {
  const f = d.notices;
  const open = f.filter((n) => n.is_open);
  const overdue = f.filter((n) => n.is_overdue);
  const due7 = f.filter((n) => n.is_due_in_7);
  const exposure = f.filter((n) => n.is_open && Number(n.exposure_amount) > 0);
  const fresh = f.filter((n) => n.is_new).length;
  const oldest = overdue.reduce((m, n) => Math.max(m, -(n.days_to_due ?? 0)), 0);
  const next = due7.map((n) => n.effective_due).filter(Boolean).sort()[0] ?? null;
  const outstanding = d.matters.reduce((s, m) => s + matterOutstanding(m), 0);
  // Hearings fixed on notices or matters, and those only the portal's case folders show.
  const folderHearings = [...new Set(d.folders.map((x) => x.case_id))].map((caseId) => {
    const s = summarizeCase(d.folders.filter((x) => x.case_id === caseId), { today });
    return s.nextHearing ? { date: s.nextHearing.date, title: s.nextHearing.event.title, to: `/notices-case-folder/${clientId}/${encodeURIComponent(caseId)}` } : null;
  }).filter((x): x is { date: string; title: string; to: string } => !!x);
  const hearing = [
    ...d.hearings.map((h) => ({ date: h.hearing_on, title: h.title ?? 'Hearing', to: h.notice_id ? `/notices/${h.notice_id}?tab=hearings` : `/litigation/${h.matter_id}` })),
    ...folderHearings,
  ].sort((a, b) => a.date.localeCompare(b.date))[0];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <FilterTile to={noticesListHref({ client: clientId })} label="Open notices" accent="primary" value={open.length}
        hint={`of ${f.length} on record${fresh ? ` · ${fresh} new in 24 h` : ''}`} />
      <FilterTile to={noticesListHref({ filter: 'overdue', client: clientId })} label="Overdue & still open" accent="destructive" strong={overdue.length > 0}
        value={overdue.length} hint={overdue.length ? `oldest ${oldest} d late` : 'nothing overdue'} />
      <FilterTile to={noticesListHref({ filter: 'due7', client: clientId })} label="Due in next 7 days" accent="warning" value={due7.length}
        hint={next ? `next ${fmtDay(next)}` : 'nothing due this week'} />
      <FilterTile to={noticesListHref({ filter: 'exposure', client: clientId })} label="Exposure under dispute" accent="muted"
        value={fmtInrShort(exposure.reduce((s, n) => s + Number(n.exposure_amount ?? 0), 0))} hint={plural(exposure.length, 'notice')} />
      <FilterTile to={hearing?.to ?? '/notices-hearings'} label="Next hearing" accent="info" value={hearing ? fmtDay(hearing.date) : 'None'}
        hint={hearing ? `${daysBetween(today, hearing.date) === 0 ? 'today' : `in ${daysBetween(today, hearing.date)} d`} · ${hearing.title}` : 'none fixed'} />
      <FilterTile to={`/litigation?client=${clientId}`} label="Open matters" accent="warning" value={d.matters.length}
        hint={d.matters.length ? `${fmtInrShort(outstanding)} outstanding` : 'no litigation'} />
    </div>
  );
};

const CompanyProfilePage: React.FC = () => {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { isStaffRole, canEditNoticeStatus, canAddEditClients } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const sync = useClientSync();
  const today = istToday();
  const q = useQuery({ queryKey: ['client-profile', clientId], enabled: !!clientId, queryFn: () => loadClientProfile(clientId) });
  const d = q.data;

  const show: ListFilter = SHOW.find((s) => s === sp.get('show')) ?? 'open';
  const cat = sp.get('cat');
  const sort: SortKey = (Object.keys(SORTS) as SortKey[]).find((k) => k === sp.get('sort')) ?? defaultSort(show);
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' || sp.get('dir') === 'desc' ? (sp.get('dir') as 'asc' | 'desc') : SORTS[sort].ascending ? 'asc' : 'desc';
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const categories = useMemo(() => [...new Set((d?.notices ?? []).map((n) => n.category).filter((c): c is string => !!c))].sort(), [d]);
  const rows = useMemo(() => {
    const issuedFrom = new Date(Date.now() - 15 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return sortRows((d?.notices ?? []).filter((n) => matchesFilter(n, show, issuedFrom) && (!cat || n.category === cat)), sort, dir);
  }, [d, show, cat, sort, dir]);
  const caseIds = useMemo(() => new Set((d?.folders ?? []).map((f) => f.case_id)), [d]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  if (!clientId) return <Navigate to="/notices-company-list" replace />;

  const set = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') next.delete(k); else next.set(k, v); });
    if (!keepPage) next.delete('page');
    setSp(next);
  };
  const reload = () => {
    qc.invalidateQueries({ queryKey: ['client-profile', clientId] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['client-sync-health'] });
  };
  const onSort = (k: SortKey) => {
    if (k === sort) set({ sort: k, dir: dir === 'asc' ? 'desc' : 'asc' });
    else set({ sort: k, dir: null });
  };
  const canSync = canEditNoticeStatus();
  const syncNow = () => { sync.start([clientId]).then((ok) => { if (ok) reload(); }); };
  const fetchProfile = () => { sync.start([clientId], 'taxpayerprofile'); };

  if (q.isLoading) {
    return (
      <NoticesShell section="Clients">
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-7 w-80 max-w-full" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[70px]" />)}</div>
          <Skeleton className="h-96 w-full" />
        </div>
      </NoticesShell>
    );
  }
  if (q.error || !d) {
    return (
      <NoticesShell section="Clients">
        <Note tone="warn">Couldn't load the client: {q.error instanceof Error ? q.error.message : String(q.error)}</Note>
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry</Button>
      </NoticesShell>
    );
  }
  if (!d.client || !d.health) {
    return (
      <NoticesShell section="Clients">
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          This client is not on record — it may have been deleted. <Link to="/notices-company-list" className="text-primary underline underline-offset-2">All clients</Link>
        </div>
      </NoticesShell>
    );
  }

  const c = d.client;
  const h = d.health;
  const refundsWaiting = d.refunds.filter(refundNeedsReply).length;
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const listHref = noticesListHref({ filter: show, client: clientId, category: cat ?? undefined });

  return (
    <NoticesShell
      section="Clients"
      status={<SyncStrip h={h} run={d.failRun} canSync={canSync} canEditClients={canAddEditClients()} busy={sync.busy}
        onSync={syncNow} onSaved={(retry) => { reload(); if (retry) syncNow(); }} />}
      actions={<>
        {canAddEditClients() && (
          <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to={`/edit-client/${c.id}`}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit client</Link></Button>
        )}
        {canSync && c.gst_user_id && (
          <Button size="sm" variant="outline" className={WS_BTN} onClick={fetchProfile} disabled={sync.busy}><DownloadCloud className="h-3.5 w-3.5" aria-hidden /> Fetch profile</Button>
        )}
        {canSync && c.gst_user_id && !c.notices_sync_excluded && (
          <Button size="sm" className={WS_BTN} onClick={syncNow} disabled={sync.busy}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Sync this client</Button>
        )}
      </>}
    >
      <div className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground"><Link to="/notices-company-list" className="hover:underline">Clients</Link> › {c.name}</nav>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="min-w-0 break-words font-heading text-lg font-bold leading-tight sm:text-xl">{c.name}</h2>
          <span className="font-mono text-xs text-muted-foreground">{c.gstin}</span>
          {c.assigned_accountant && <span className="text-xs text-muted-foreground">Owner {c.assigned_accountant}</span>}
          {c.inactive_at_hand && <Badge variant="secondary" className="text-[11px]">Inactive at hand</Badge>}
          {c.notices_sync_excluded && <Badge variant="secondary" className="text-[11px]">Excluded from notices sync</Badge>}
          {refundsWaiting > 0 && (
            <a href="#client-refunds" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Badge variant="warning" className="text-[11px]">{plural(refundsWaiting, 'refund')} waiting for a reply</Badge>
            </a>
          )}
        </div>
      </div>

      <ClientTiles d={d} clientId={clientId} today={today} />

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <SectionCard title={`${filterDef(show).title} · ${total}`}
            description="Each opens its workspace; the stage and owner change in place"
            actions={<Link to={listHref} className="text-xs font-medium text-primary hover:underline">Open in All notices →</Link>}>
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterPill label="Show" allLabel="All" value={show === 'all' ? 'all' : show}
                onChange={(v) => set({ show: v === 'open' ? null : v, sort: null, dir: null })}
                options={[]} extraOptions={LIST_FILTERS.filter((x) => x.key !== 'all').map((x) => ({ value: x.key, label: x.label }))} />
              {categories.length > 0 && (
                <FilterPill label="Category" allLabel="Any" value={cat ?? 'all'} onChange={(v) => set({ cat: v === 'all' ? null : v })} options={categories} />
              )}
            </div>
            {total === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No {filterDef(show).label.toLowerCase()} notices{cat ? ` in ${cat}` : ''}.{' '}
                {(show !== 'all' || cat) && <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => set({ show: 'all', cat: null })}>Show every notice</button>}
              </p>
            ) : (
              <>
                <NoticeTable rows={pageRows} canEdit={canSync} sort={sort} dir={dir} onSort={onSort} onChanged={reload} showClient={false} />
                <Pager page={page} pageSize={PAGE} total={total} onPage={(p) => set({ page: String(p) }, true)} />
              </>
            )}
          </SectionCard>

          <ClientCases clientId={clientId} folders={d.folders} notices={d.notices} today={today} />
          <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-2">
            <div id="client-refunds" className="scroll-mt-4"><RefundList clientId={clientId} rows={d.refunds} caseIds={caseIds} /></div>
            <Drc03List clientId={clientId} rows={d.drc03} caseIds={caseIds} />
          </div>
        </div>
        <aside className="min-w-0 space-y-3" aria-label="Client facts">
          <ClientProfileCard client={c} extras={d.extras} profile={d.profile} busy={sync.busy}
            onFetchProfile={canSync && c.gst_user_id ? fetchProfile : undefined} />
          <ReturnStrip filings={d.filings} extras={d.extras} today={today} />
        </aside>
      </div>
    </NoticesShell>
  );
};

export default CompanyProfilePage;
