// Notices & Litigation · GSTIN-wise count (audit U-72-1..4; L-12, L-13;
// cross-cutting ui-b). One row per client with notices or an open matter:
// open, overdue, due in 7 days, unassigned, exposure on open notices, the next
// reply date, open matters with their outstanding demand and the last good
// portal pull (red when older than a day). Counted from public.notice_facts
// with the All notices list's own flags, so each number opens
// noticesListHref({ filter, client }) and that list shows the same count.
// Most overdue first, then exposure, then open — the command centre's
// "Clients needing attention", whose "All clients" opens this page. Search,
// the Show filter and the sort live in the URL. Clients left out of the sync
// or marked inactive say so. Total, closed and replied stay in the export.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { FileSpreadsheet, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { FilterPill } from '@/components/notices/FilterPill';
import { AmountLink, AsOfLine, CountLink, FilterChips, SortHead, type Chip } from '@/components/notices/reports/ReportBits';
import { loadCountRows, emptyCounts, type Counts } from '@/components/notices/reports/noticeCounts';
import { clientRows, loadClientContext, type ClientReportRow } from '@/components/notices/reports/clientRows';
import { noticesListHref, type NoticeListParams } from '@/lib/noticeQueries';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { dueWords, fmtAgo, fmtDate, fmtDateTime, fmtDay, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

type SortKey = 'attention' | 'client' | 'open' | 'overdue' | 'due7' | 'unassigned' | 'exposure' | 'next' | 'matters' | 'pull';
type Show = 'all' | 'open' | 'overdue' | 'nosync';
const SORT_KEYS: SortKey[] = ['attention', 'client', 'open', 'overdue', 'due7', 'unassigned', 'exposure', 'next', 'matters', 'pull'];
const SHOWS: { key: Show; label: string }[] = [
  { key: 'open', label: 'With open notices' },
  { key: 'overdue', label: 'With overdue notices' },
  { key: 'nosync', label: 'Not synced in 24 h' },
];
/** Sorts that read naturally smallest first. */
const ASCENDING: SortKey[] = ['client', 'next', 'pull'];

const attention = (a: ClientReportRow, b: ClientReportRow) =>
  b.counts.overdue - a.counts.overdue || b.counts.exposure - a.counts.exposure || b.counts.open - a.counts.open || a.name.localeCompare(b.name);

function sortValue(r: ClientReportRow, k: SortKey): number | string | null {
  switch (k) {
    case 'client': return r.name.toLowerCase();
    case 'open': return r.counts.open;
    case 'overdue': return r.counts.overdue;
    case 'due7': return r.counts.due7;
    case 'unassigned': return r.counts.unassigned;
    case 'exposure': return r.counts.exposure;
    case 'next': return r.counts.nextDue;
    case 'matters': return r.matterOutstanding || r.matters;
    // Never synced sorts as the stalest; clients left out of the sync go last.
    case 'pull': return r.excluded ? null : r.lastPull ?? '0000';
    default: return null;
  }
}

const GstinWiseNoticeCountPage: React.FC = () => {
  const { isStaffRole, user, canExportData } = useAuth();
  const [sp, setSp] = useSearchParams();
  const meId = user?.id ?? null;
  const today = istToday();

  const sort = (SORT_KEYS.includes(sp.get('sort') as SortKey) ? sp.get('sort') : 'attention') as SortKey;
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' || sp.get('dir') === 'desc' ? (sp.get('dir') as 'asc' | 'desc') : ASCENDING.includes(sort) ? 'asc' : 'desc';
  const show = (SHOWS.some((s) => s.key === sp.get('show')) ? sp.get('show') : 'all') as Show;
  const qParam = sp.get('q') ?? '';
  const [q, setQ] = useState(qParam);
  useEffect(() => { setQ(qParam); }, [qParam]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    setSp(next, { replace: false });
  };
  useEffect(() => {
    if (q === qParam) return;
    const t = setTimeout(() => set({ q: q.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const notices = useQuery({ queryKey: ['notice-report-rows', {}, meId], queryFn: () => loadCountRows({}, meId) });
  const context = useQuery({ queryKey: ['notice-report-clients'], queryFn: loadClientContext });

  const all = useMemo(() => (notices.data && context.data ? clientRows(notices.data, context.data) : []), [notices.data, context.data]);
  const visible = useMemo(() => {
    const term = qParam.trim().toLowerCase();
    const list = all.filter((r) => {
      if (term && !r.name.toLowerCase().includes(term) && !r.gstin.toLowerCase().includes(term)) return false;
      if (show === 'open') return r.counts.open > 0;
      if (show === 'overdue') return r.counts.overdue > 0;
      if (show === 'nosync') return r.excluded || r.inactive || r.stale;
      return true;
    });
    const sign = dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (sort === 'attention') return attention(a, b);
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      if (va === vb) return attention(a, b);
      if (va === null) return 1;
      if (vb === null) return -1;
      return sign * (va < vb ? -1 : 1);
    });
  }, [all, qParam, show, sort, dir]);
  const total = useMemo(() => visible.reduce((acc, r) => {
    const c = acc.counts;
    (['total', 'open', 'overdue', 'due7', 'unassigned', 'replied', 'closed', 'exposure', 'exposureCount'] as const).forEach((k) => { c[k] += r.counts[k]; });
    return { counts: c, matters: acc.matters + r.matters, outstanding: acc.outstanding + r.matterOutstanding };
  }, { counts: emptyCounts(), matters: 0, outstanding: 0 }), [visible]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const onSort = (k: SortKey) => set(k === sort
    ? { sort: k === 'attention' ? undefined : k, dir: dir === 'asc' ? 'desc' : 'asc' }
    : { sort: k === 'attention' ? undefined : k, dir: undefined });
  // The total row is the firm-wide list only while every client with open notices is on screen.
  const totalsLink = !qParam && (show === 'all' || show === 'open');
  const chips: Chip[] = [];
  if (qParam) chips.push({ key: 'q', label: `Search: ${qParam}`, onRemove: () => { setQ(''); set({ q: undefined }); } });
  if (show !== 'all') chips.push({ key: 'show', label: SHOWS.find((s) => s.key === show)?.label ?? show, onRemove: () => set({ show: undefined }) });
  const loading = !notices.data || !context.data;
  const error = notices.error ?? context.error;

  const exportXlsx = () => {
    const data = visible.map((r) => ({
      GSTIN: r.gstin, Client: r.name, Open: r.counts.open, Overdue: r.counts.overdue, 'Due in 7 days': r.counts.due7,
      Unassigned: r.counts.unassigned, 'Exposure (₹)': Math.round(r.counts.exposure), 'Next reply due': fmtDate(r.counts.nextDue),
      'Open matters': r.matters, 'Matters outstanding (₹)': Math.round(r.matterOutstanding),
      'Last good pull': r.lastPull ? fmtDateTime(r.lastPull) : 'never', Sync: r.excluded ? 'excluded from sync' : r.inactive ? 'inactive' : r.loginFailed ? 'login failed' : '',
      Replied: r.counts.replied, Closed: r.counts.closed, Total: r.counts.total,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GSTIN-wise');
    XLSX.writeFile(wb, `GSTIN-wise notice count ${today}.xlsx`);
    toast.success(`Exported ${plural(visible.length, 'client')}`);
  };

  const href = (r: ClientReportRow | null, p: Partial<NoticeListParams>) => noticesListHref(r ? { ...p, client: r.clientId } : p);
  const who = (r: ClientReportRow | null) => (r ? r.name : 'All clients');
  const countCell = (r: ClientReportRow | null, c: Counts, k: 'open' | 'overdue' | 'due7' | 'unassigned', what: string) =>
    !r && !totalsLink ? <span className="tabular-nums">{c[k].toLocaleString('en-IN')}</span>
      : <CountLink n={c[k]} to={href(r, { filter: k })} label={`${who(r)}, ${what}`} alarm={k === 'overdue'} onMuted={!r} />;
  const exposureCell = (r: ClientReportRow | null, c: Counts) =>
    !r && !totalsLink ? <span className="tabular-nums">{c.exposure ? fmtInrShort(c.exposure) : '—'}</span>
      : <AmountLink amount={c.exposure} to={href(r, { filter: 'exposure' })} label={`${who(r)}, exposure on ${plural(c.exposureCount, 'open notice')}`} onMuted={!r} />;
  const nextCell = (r: ClientReportRow) => {
    const d = r.counts.nextDue;
    if (!d) return <span className="text-muted-foreground">—</span>;
    const days = daysBetween(today, d);
    return (
      <Link to={href(r, { filter: 'open', due: d })} className="block rounded text-xs leading-tight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="sr-only">{r.name}, next reply due: </span>
        <span className={cn('block font-semibold text-primary', days <= 2 && 'text-destructive-strong')}>{fmtDay(d)}</span>
        <span className="text-muted-foreground">{dueWords(days)}{r.counts.nextDueCount > 1 ? ` · ${r.counts.nextDueCount} notices` : ''}</span>
      </Link>
    );
  };
  const mattersCell = (r: ClientReportRow) => (r.matters > 0 ? (
    <Link to={`/litigation?client=${r.clientId}`} className="block rounded text-xs leading-tight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="sr-only">{r.name}, open matters: </span>
      <span className="block font-medium tabular-nums text-primary">{r.matters}</span>
      {r.matterOutstanding > 0 && <span className="text-muted-foreground">{fmtInrShort(r.matterOutstanding)} outstanding</span>}
    </Link>
  ) : <span className="text-muted-foreground">0</span>);
  const pullCell = (r: ClientReportRow) => {
    if (r.excluded) return <span className="text-xs text-muted-foreground">left out of the sync</span>;
    return (
      <span className="text-xs leading-tight">
        <span className={cn('block', r.stale && 'font-medium text-destructive-strong')}>{r.lastPull ? fmtAgo(r.lastPull) : 'never'}</span>
        {r.loginFailed && <span className="text-destructive-strong">login failed</span>}
      </span>
    );
  };
  const chipsFor = (r: ClientReportRow) => (
    <>
      {r.excluded && <Badge variant="secondary" className="text-[10px] font-medium">Not synced</Badge>}
      {r.inactive && <Badge variant="secondary" className="text-[10px] font-medium">Inactive</Badge>}
    </>
  );

  return (
    <NoticesShell section="GSTIN-wise count" status={<AsOfLine at={notices.dataUpdatedAt} />}
      actions={canExportData() && (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={loading || !visible.length}>
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Export to Excel
        </Button>
      )}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client name or GSTIN" aria-label="Search clients" className="h-8 pl-7 text-xs" />
          </div>
          <FilterPill label="Show" allLabel="All clients" value={show} onChange={(v) => set({ show: v === 'all' ? undefined : v })} options={[]}
            extraOptions={SHOWS.map((s) => ({ value: s.key, label: s.label }))} />
        </div>
        <FilterChips chips={chips} onClear={() => { setQ(''); set({ q: undefined, show: undefined }); }} />
      </div>

      {error ? (
        <Note tone="warn">Couldn't load the clients: {error instanceof Error ? error.message : String(error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => { notices.refetch(); context.refetch(); }}>Retry</Button></Note>
      ) : loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <SectionCard title={`${plural(visible.length, 'client')}${sort === 'attention' ? ' · most overdue first' : ''}`}
          description="Each number opens that client's notices with the same filter · exposure is open notices' demand, each dispute once">
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No client matches.</p>
          ) : (
            <>
              {/* Phones: one card per client. */}
              <ul className="space-y-2 md:hidden">
                {visible.map((r) => (
                  <li key={r.clientId} className={cn('rounded-lg border bg-card p-3', r.counts.overdue > 0 && 'border-destructive/50')}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link to={`/notices-company/${r.clientId}`} className="min-w-0 truncate text-sm font-semibold text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{r.name}</Link>
                      {chipsFor(r)}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.gstin}</div>
                    <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                      <div><dt className="text-muted-foreground">Open</dt><dd>{countCell(r, r.counts, 'open', 'open')}</dd></div>
                      <div><dt className="text-muted-foreground">Overdue</dt><dd>{countCell(r, r.counts, 'overdue', 'overdue')}</dd></div>
                      <div><dt className="text-muted-foreground">Due in 7 d</dt><dd>{countCell(r, r.counts, 'due7', 'due in 7 days')}</dd></div>
                      <div><dt className="text-muted-foreground">Unassigned</dt><dd>{countCell(r, r.counts, 'unassigned', 'without an owner')}</dd></div>
                      <div><dt className="text-muted-foreground">Exposure</dt><dd>{exposureCell(r, r.counts)}</dd></div>
                      <div><dt className="text-muted-foreground">Open matters</dt><dd>{mattersCell(r)}</dd></div>
                      <div><dt className="text-muted-foreground">Next reply due</dt><dd>{nextCell(r)}</dd></div>
                      <div className="col-span-2"><dt className="text-muted-foreground">Last good pull</dt><dd>{pullCell(r)}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>

              <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
                <table className={WS_TABLE}>
                  <thead>
                    <tr>
                      <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} />
                      <SortHead label="Open" k="open" sort={sort} dir={dir} onSort={onSort} right />
                      <SortHead label="Overdue" k="overdue" sort={sort} dir={dir} onSort={onSort} right />
                      <SortHead label="Due in 7 d" k="due7" sort={sort} dir={dir} onSort={onSort} right />
                      <SortHead label="Unassigned" k="unassigned" sort={sort} dir={dir} onSort={onSort} right />
                      <SortHead label="Exposure" k="exposure" sort={sort} dir={dir} onSort={onSort} right />
                      <SortHead label="Next reply due" k="next" sort={sort} dir={dir} onSort={onSort} />
                      <SortHead label="Open matters" k="matters" sort={sort} dir={dir} onSort={onSort} />
                      <SortHead label="Last good pull" k="pull" sort={sort} dir={dir} onSort={onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.clientId} className={cn(WS_TR, r.counts.overdue > 0 && 'bg-destructive/[0.03]')}>
                        <th scope="row" className={cn(WS_TD, 'max-w-[16rem] text-left font-normal')}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link to={`/notices-company/${r.clientId}`} className="min-w-0 truncate font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{r.name}</Link>
                            {chipsFor(r)}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">{r.gstin}</div>
                        </th>
                        <td className={WS_TD_NUM}>{countCell(r, r.counts, 'open', 'open')}</td>
                        <td className={WS_TD_NUM}>{countCell(r, r.counts, 'overdue', 'overdue')}</td>
                        <td className={WS_TD_NUM}>{countCell(r, r.counts, 'due7', 'due in 7 days')}</td>
                        <td className={WS_TD_NUM}>{countCell(r, r.counts, 'unassigned', 'without an owner')}</td>
                        <td className={WS_TD_NUM}>{exposureCell(r, r.counts)}</td>
                        <td className={cn(WS_TD, 'whitespace-nowrap')}>{nextCell(r)}</td>
                        <td className={cn(WS_TD, 'whitespace-nowrap')}>{mattersCell(r)}</td>
                        <td className={cn(WS_TD, 'whitespace-nowrap')}>{pullCell(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={WS_TR_TOTAL}>
                      <th scope="row" className={cn(WS_TD, 'text-left')}>{totalsLink ? 'All clients' : `Total of ${plural(visible.length, 'client')} shown`}</th>
                      <td className={WS_TD_NUM}>{countCell(null, total.counts, 'open', 'open')}</td>
                      <td className={WS_TD_NUM}>{countCell(null, total.counts, 'overdue', 'overdue')}</td>
                      <td className={WS_TD_NUM}>{countCell(null, total.counts, 'due7', 'due in 7 days')}</td>
                      <td className={WS_TD_NUM}>{countCell(null, total.counts, 'unassigned', 'without an owner')}</td>
                      <td className={WS_TD_NUM}>{exposureCell(null, total.counts)}</td>
                      <td className={WS_TD} />
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                        <span className="tabular-nums">{total.matters}</span>
                        {total.outstanding > 0 && <span className="block font-normal text-foreground/70">{fmtInrShort(total.outstanding)} outstanding</span>}
                      </td>
                      <td className={WS_TD} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Last good pull turns red after 24 hours without a successful portal sync. Matters' outstanding is demand less paid and pre-deposit;
                the command centre's exposure adds it to the notices' figure.
              </p>
            </>
          )}
        </SectionCard>
      )}
    </NoticesShell>
  );
};

export default GstinWiseNoticeCountPage;
