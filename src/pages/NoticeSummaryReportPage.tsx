// Notices & Litigation · Notice summary (audit U-70-1..4; cross-cutting ui-b:
// house style, "numbers disagree", "as of" stamp, real links in cells).
// The canonical notice set (public.notice_facts) by category or stage: open,
// overdue, due in 7 days, unassigned, exposure, age of the oldest open notice,
// replied, closed and total, biggest open first, with no placeholder rows. Every
// count uses the All notices list's own filter and opens noticesListHref with
// that filter, so the list shows the same number; the master filters (client,
// FY, owner, form, priority) and the category live in the URL and travel with
// every link. Totals by financial year were taken out at the firm's request of
// 7 October 2026 (the FY filter stays). Refunds and DRC-03 payments are
// counted from their own ledgers and open those pages. Excel and PDF.
import React, { useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Note } from '@/components/gstr9/ui';
import { Panel } from '@/components/notices/ui/Panel';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { FilterPill } from '@/components/notices/FilterPill';
import { useNoticeFilterOptions } from '@/components/notices/NoticeFilterBar';
import { AsOfLine, FilterChips, FilterTile, type Chip } from '@/components/notices/reports/ReportBits';
import { SummaryTable } from '@/components/notices/reports/SummaryTable';
import { groupKey, summaryRows, type SummaryRow, type SummarySort, type SummaryTab } from '@/components/notices/reports/summaryRows';
import { LedgerSummary } from '@/components/notices/reports/LedgerSummary';
import { loadCountRows, groupCounts, ageDays, type BaseFilters } from '@/components/notices/reports/noticeCounts';
import { noticesListHref, type NoticeListParams } from '@/lib/noticeQueries';
import { istToday } from '@/lib/noticeFacts';
import { fmtDateTime, fmtFy, fmtInrShort, plural } from '@/lib/noticeFormat';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';

const TABS: { key: SummaryTab; label: string; title: string }[] = [
  { key: 'category', label: 'By category', title: 'Notices by category' },
  { key: 'stage', label: 'By stage', title: 'Notices by stage' },
];
const SORTS: SummarySort[] = ['default', 'name', 'open', 'overdue', 'due7', 'unassigned', 'exposure', 'oldest', 'replied', 'closed', 'total'];

const NoticeSummaryReportPage: React.FC = () => {
  const { isStaffRole, user, canExportData } = useAuth();
  const [sp, setSp] = useSearchParams();
  const meId = user?.id ?? null;
  const opts = useNoticeFilterOptions().data;

  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'category') as SummaryTab;
  const sort = (SORTS.includes(sp.get('sort') as SummarySort) ? sp.get('sort') : 'default') as SummarySort;
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const base: BaseFilters = useMemo(() => {
    const b: BaseFilters = {};
    (['client', 'owner', 'fy', 'form', 'category', 'priority'] as const).forEach((k) => { const v = sp.get(k); if (v) b[k] = v; });
    return b;
  }, [sp]);

  const q = useQuery({
    queryKey: ['notice-report-rows', base, meId],
    queryFn: () => loadCountRows(base, meId),
    placeholderData: (prev) => prev,
  });
  const today = istToday();
  const { rows, total } = useMemo(() => {
    const g = groupCounts(q.data ?? [], groupKey(tab));
    return { rows: summaryRows(tab, g.groups, sort, dir, today), total: g.total };
  }, [q.data, tab, sort, dir, today]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    setSp(next, { replace: false });
  };
  const href = (p: Partial<NoticeListParams>) => noticesListHref({ ...base, ...p });
  // The master filters show in their own bar; this page adds the category.
  const chips: Chip[] = [];
  if (base.category) chips.push({ key: 'category', label: `Category: ${base.category}`, onRemove: () => set({ category: undefined }) });
  const filtersText = [
    base.client && 'One client', base.fy && (base.fy === 'none' ? 'FY not stated' : `FY ${fmtFy(base.fy)}`),
    base.owner && `Owner: ${base.owner === 'me' ? 'Me' : base.owner === 'none' ? 'Unassigned' : 'one person'}`,
    base.form && `Form: ${base.form}`, base.priority && `Priority: ${base.priority}`, base.category && `Category: ${base.category}`,
  ].filter(Boolean).join(' · ') || 'All notices';
  const filtered = Object.keys(base).length > 0;
  const tabDef = TABS.find((t) => t.key === tab) ?? TABS[0];
  const asOf = q.dataUpdatedAt ? `${fmtDateTime(new Date(q.dataUpdatedAt).toISOString())} IST` : '';

  const tableFor = (t: SummaryTab): (string | number)[][] => {
    const g = groupCounts(q.data ?? [], groupKey(t));
    const line = (label: string, c: SummaryRow['counts']) => [
      label, c.open, c.overdue, c.due7, c.unassigned, Math.round(c.exposure), ageDays(c.oldestOpen, today) ?? '', c.replied, c.closed, c.total,
    ];
    return [
      ...summaryRows(t, g.groups, 'default', 'desc', today).map((r) => line(r.label, r.counts)),
      line('Total', g.total),
    ];
  };
  const headers = (rupee: string) => ['Open', 'Overdue', 'Due in 7 days', 'Unassigned', `Exposure (${rupee})`, 'Oldest open (days)', 'Replied', 'Closed', 'Total'];
  const firstHead = (t: SummaryTab) => (t === 'stage' ? 'Stage' : 'Category');

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    TABS.forEach((t) => {
      const ws = XLSX.utils.aoa_to_sheet([[t.title], [`As of ${asOf} · ${filtersText}`], [], [firstHead(t.key), ...headers('₹')], ...tableFor(t.key)]);
      ws['!cols'] = [{ wch: 28 }, ...headers('₹').map(() => ({ wch: 13 }))];
      XLSX.utils.book_append_sheet(wb, ws, t.label.replace('By ', '').replace(/^\w/, (c) => c.toUpperCase()));
    });
    XLSX.writeFile(wb, `Notice summary ${today}.xlsx`);
    toast.success('Exported the notice summary');
  };
  const exportPdf = () => {
    try {
      renderReportToPdf({
        title: `Notice summary · ${tabDef.label.toLowerCase()}`,
        subtitle: `As of ${asOf} · ${filtersText}`,
        headers: [firstHead(tab), ...headers('Rs')],
        rows: tableFor(tab),
        fileNameBase: `Notice summary ${tabDef.label.toLowerCase()} ${today}`,
        columnWidths: [26, 9, 9, 11, 11, 14, 14, 9, 9, 9],
      });
    } catch (e) {
      toast.error(`PDF failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <NoticesShell
      section="Notice summary"
      master
      status={<AsOfLine at={q.dataUpdatedAt} />}
      actions={canExportData() && (
        <>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={!q.data}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Export to Excel
          </Button>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={exportPdf} disabled={!q.data}>
            <FileDown className="h-3.5 w-3.5" aria-hidden /> Export to PDF
          </Button>
        </>
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill label="Category" allLabel="Any" value={base.category ?? 'all'} onChange={(v) => set({ category: v === 'all' ? undefined : v })} options={opts?.categories ?? []} />
        <FilterChips chips={chips} onClear={() => set({ category: undefined })} />
      </div>

      {q.error ? (
        <Note tone="warn">Couldn't count the notices: {q.error instanceof Error ? q.error.message : String(q.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => q.refetch()}>Retry</Button></Note>
      ) : !q.data ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[68px]" />)}</div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            <FilterTile to={href({ filter: 'open' })} label="Open" accent="primary" value={total.open.toLocaleString('en-IN')} hint={`of ${plural(total.total, 'notice')}`} />
            <FilterTile to={href({ filter: 'overdue' })} label="Overdue and still open" accent="destructive" alarm={total.overdue > 0}
              value={total.overdue.toLocaleString('en-IN')} hint={total.overdue ? 'reply date passed, no reply logged' : 'nothing overdue'} />
            <FilterTile to={href({ filter: 'due7' })} label="Due in the next 7 days" accent="warning" value={total.due7.toLocaleString('en-IN')} hint="not yet replied" />
            <FilterTile to={href({ filter: 'unassigned' })} label="Without an owner" accent="info" value={total.unassigned.toLocaleString('en-IN')} hint="open notices" />
            <FilterTile to={href({ filter: 'exposure' })} label="Exposure on open notices" accent="muted" value={fmtInrShort(total.exposure)}
              hint={`${plural(total.exposureCount, 'dispute')} · matters not included`} />
          </div>

          <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'category' ? undefined : v, sort: undefined, dir: undefined })} className="space-y-3">
            <TabsList className={TAB_LIST_CLASS} aria-label="Break the notices down">
              {TABS.map((t) => <TabsTrigger key={t.key} value={t.key} className={`${TAB_TRIGGER_CLASS} h-8 px-3`}>{t.label}</TabsTrigger>)}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.key} value={t.key} className="mt-0">
                <Panel title={t.title} info={t.key === 'stage' ? 'In the order work moves. Each number opens the list it counts.' : 'Most open first. Each number opens the list it counts.'}>
                  <SummaryTable tab={t.key} rows={rows} total={total} base={base} today={today} sort={sort} dir={dir}
                    onSort={(k) => set(k === sort ? { sort: k, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: k === 'default' ? undefined : k, dir: k === 'name' ? 'asc' : undefined })}
                    showUntracked={t.key === 'category' && !filtered} />
                </Panel>
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}

      <LedgerSummary filtered={filtered} />
    </NoticesShell>
  );
};

export default NoticeSummaryReportPage;
