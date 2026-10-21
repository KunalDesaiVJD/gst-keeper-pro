import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { History, FileSpreadsheet, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { Badge } from '@/components/gstr9/badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR,
} from '@/components/workspace/theme';
import {
  DEFAULT_DAYS, HISTORY_PAGES, allowanceIdsOf, describeChange, exportRows, filtersFromSearch, filtersToSearch, formatStamp,
  loadAllChangeHistory, loadAllowances, loadChangeHistory, monthLabel, pageOfTable, sourceLabel, tableLabel, whoLabel, whoNote,
  withDefaultRange,
  type AllowanceSource, type HistoryCursor, type HistoryFilters, type HistoryRow, type HistorySource,
} from '@/lib/changeHistory';

const ALL = '__all__';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LINES_SHOWN = 6;
const EXPORT_LIMIT = 5000;

/** The last 36 months and the next two, newest first. */
function monthOptions() {
  const now = new Date();
  const out: { value: string; label: string }[] = [{ value: ALL, label: 'Any month' }];
  for (let i = 2; i >= -36; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ value: `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

/** Financial years from 2017-18 to this one, newest first. */
function fyOptions() {
  const now = new Date();
  const last = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const out: string[] = [];
  for (let y = last; y >= 2017; y--) out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  return out;
}

const source = supabase as unknown as HistorySource;
const allowanceSource = supabase as unknown as AllowanceSource;

const ChangeHistoryPage: React.FC = () => {
  const { canViewChangeHistory, canExportData } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearch(params), [params]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const allowed = canViewChangeHistory();

  const setFilters = (patch: Partial<HistoryFilters>) => {
    const next = { ...filters, ...patch };
    setParams(filtersToSearch(next), { replace: true });
  };

  const clientsQ = useQuery({
    queryKey: ['change-history-clients'],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, gstin').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const staffQ = useQuery({
    queryKey: ['change-history-staff'],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, first_name').order('first_name');
      if (error) throw error;
      return data ?? [];
    },
  });
  // What this browser's own changes are recorded as (the header reaches the database).
  const whoamiQ = useQuery({
    queryKey: ['change-history-whoami'],
    enabled: allowed,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gst_change_log_whoami');
      if (error) throw error;
      return data as { actor_id: string | null; actor_name: string | null; source: string } | null;
    },
  });

  const names = useMemo(() => Object.fromEntries((staffQ.data ?? []).map((p) => [p.user_id, p.first_name])), [staffQ.data]);
  const clientName = useMemo(() => {
    const m = new Map((clientsQ.data ?? []).map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? '(deleted client)' : '');
  }, [clientsQ.data]);
  // Nothing narrowing the history (no client, month, year or dates): the last 30 days.
  const effective = useMemo(() => withDefaultRange(filters), [filters]);
  const { defaulted, ...queryFilters } = effective;

  const historyQ = useInfiniteQuery({
    queryKey: ['change-history', queryFilters],
    enabled: allowed,
    initialPageParam: null as HistoryCursor | null,
    queryFn: ({ pageParam }) => loadChangeHistory(source, queryFilters, pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows: HistoryRow[] = useMemo(() => (historyQ.data?.pages ?? []).flatMap((p) => p.rows), [historyQ.data]);
  // The allowances these rows were entered under, for the "manual (allowed by X: reason)" badge.
  const allowanceIds = useMemo(() => allowanceIdsOf(rows), [rows]);
  const allowancesQ = useQuery({
    queryKey: ['change-history-allowances', allowanceIds],
    enabled: allowed && allowanceIds.length > 0,
    queryFn: () => loadAllowances(allowanceSource, allowanceIds),
  });
  const allowances = allowancesQ.data ?? {};

  useEffect(() => { setExpanded({}); }, [params]);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Pages of 500, each starting below the last row read, so a busy month is never cut at the API's 1,000-row reply.
      const { rows: all, capped } = await loadAllChangeHistory(source, queryFilters, EXPORT_LIMIT);
      if (!all.length) { toast.info('Nothing to export for these filters.'); return; }
      const exportAllowances = await loadAllowances(allowanceSource, allowanceIdsOf(all));
      const sheetRows = exportRows(all, { clientName, names, allowances: exportAllowances });
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      ws['!cols'] = [18, 22, 22, 26, 10, 18, 22, 26, 14, 30, 24, 24, 30, 24].map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Change history');
      const about = [
        ['Change history', ''],
        ['Exported on', formatStamp(new Date().toISOString())],
        ['Client', queryFilters.clientId ? clientName(queryFilters.clientId) : 'All clients'],
        ['Month', queryFilters.month ? monthLabel(queryFilters.month) : queryFilters.financialYear ? `FY ${queryFilters.financialYear}` : 'Any'],
        ['Page', HISTORY_PAGES.find((p) => p.key === queryFilters.page)?.label ?? 'All pages'],
        ['Person', queryFilters.actorId ? names[queryFilters.actorId] ?? queryFilters.actorId : 'Anyone'],
        ['From', queryFilters.from ?? ''],
        ['To', queryFilters.to ?? ''],
        ['Changes', all.length.toLocaleString('en-IN')],
        ['Complete', capped ? `No. Only the newest ${EXPORT_LIMIT.toLocaleString('en-IN')} changes are in this file. Narrow the filters for the rest.` : 'Yes'],
      ];
      const aboutWs = XLSX.utils.aoa_to_sheet(about);
      aboutWs['!cols'] = [{ wch: 14 }, { wch: 80 }];
      XLSX.utils.book_append_sheet(wb, aboutWs, 'About');
      const parts = ['Change history', queryFilters.clientId ? clientName(queryFilters.clientId) : '', queryFilters.month ? monthLabel(queryFilters.month) : queryFilters.financialYear ?? '']
        .filter(Boolean).join(' ').replace(/[\\/:*?"<>|]/g, '-');
      XLSX.writeFile(wb, `${parts}.xlsx`);
      if (capped) toast.info(`Only the newest ${EXPORT_LIMIT.toLocaleString('en-IN')} changes were exported. Narrow the filters for the rest.`);
    } catch (e) {
      toast.error('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  };

  if (!allowed) {
    return (
      <div className={WS_PAGE}>
        <PageHeader compact title="Change history" icon={<History />} />
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Change history is open to the GST Manager and the superadmin, and to staff whose position includes Change history.
        </CardContent></Card>
      </div>
    );
  }

  const hasFilters = Object.values(filters).some(Boolean);
  const whoami = whoamiQ.data;

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Change history"
        subtitle="Who changed what, and when"
        icon={<History />}
        actions={
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => historyQ.refetch()} disabled={historyQ.isFetching}>
              <RefreshCw className={cn('h-3.5 w-3.5', historyQ.isFetching && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={WS_BTN}
              onClick={handleExport}
              disabled={!canExportData() || exporting}
              title={canExportData() ? undefined : 'Needs the Export data permission. Ask a GST Manager to add it to your position.'}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          </>
        }
      />
      {whoami && (
        <p className="text-[11px] text-muted-foreground">
          {whoami.actor_id
            ? <>Your changes are recorded as <span className="font-medium text-foreground">{whoami.actor_name ?? whoami.actor_id.slice(0, 8)}</span>, from the {sourceLabel(whoami.source).toLowerCase()}.</>
            : <>Your changes reach the database without your name. Sign out and in again.</>}
        </p>
      )}

      {defaulted && (
        <p className="text-[11px] text-muted-foreground">
          Showing the last {DEFAULT_DAYS} days. Pick a client, a month or dates to see more.
        </p>
      )}

      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-full min-w-0 space-y-0.5 sm:w-64">
              <span className={WS_FILTER_LABEL}>Client</span>
              <SearchableSelect
                options={[{ value: ALL, label: 'All clients' }, ...(clientsQ.data ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin ?? undefined }))]}
                value={filters.clientId ?? ALL}
                onValueChange={(v) => setFilters({ clientId: v === ALL ? null : v })}
                placeholder="All clients"
                searchPlaceholder="Type to search clients..."
                emptyText="No clients found."
                className={WS_CONTROL}
              />
            </label>
            <label className="w-36 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Month</span>
              <SearchableMonthSelect
                options={monthOptions()}
                value={filters.month ?? ALL}
                onValueChange={(v) => setFilters({ month: v === ALL ? null : v, financialYear: null })}
                placeholder="Any month"
                className={WS_CONTROL}
              />
            </label>
            <label className="w-32 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Financial year</span>
              <Select value={filters.financialYear ?? ALL} onValueChange={(v) => setFilters({ financialYear: v === ALL ? null : v, month: null })}>
                <SelectTrigger className={WS_CONTROL}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any year</SelectItem>
                  {fyOptions().map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="w-48 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Page</span>
              <Select value={filters.page ?? ALL} onValueChange={(v) => setFilters({ page: v === ALL ? null : (v as HistoryFilters['page']), table: null })}>
                <SelectTrigger className={WS_CONTROL}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All pages</SelectItem>
                  {HISTORY_PAGES.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="w-40 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Person</span>
              <Select value={filters.actorId ?? ALL} onValueChange={(v) => setFilters({ actorId: v === ALL ? null : v })}>
                <SelectTrigger className={WS_CONTROL}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Anyone</SelectItem>
                  {(staffQ.data ?? []).map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.first_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="w-36 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>From</span>
              <Input type="date" className={WS_CONTROL} value={filters.from ?? (defaulted ? queryFilters.from ?? '' : '')} onChange={(e) => setFilters({ from: e.target.value || null })} />
            </label>
            <label className="w-36 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>To</span>
              <Input type="date" className={WS_CONTROL} value={filters.to ?? ''} onChange={(e) => setFilters({ to: e.target.value || null })} />
            </label>
            {hasFilters && (
              <Button variant="ghost" size="sm" className={WS_BTN} onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {historyQ.isError && (
        <p className="text-sm text-destructive">
          The change history could not be loaded: {historyQ.error instanceof Error ? historyQ.error.message : String(historyQ.error)}
        </p>
      )}

      <div className={cn(WS_TABLE_WRAP, 'max-h-[72vh]')}>
        <table className={cn(WS_TABLE, '[&_tr>*:last-child]:border-r-0')}>
          <thead>
            <tr>
              <th className={WS_TH}>When</th>
              <th className={WS_TH}>Who</th>
              <th className={WS_TH}>Client</th>
              <th className={WS_TH}>Month</th>
              <th className={WS_TH}>Page</th>
              <th className={WS_TH}>Action</th>
              <th className={cn(WS_TH, 'min-w-[22rem]')}>What changed</th>
            </tr>
          </thead>
          <tbody>
            {historyQ.isLoading && (
              <tr><td colSpan={7} className={cn(WS_TD, 'text-center text-muted-foreground')}>Loading...</td></tr>
            )}
            {!historyQ.isLoading && rows.length === 0 && (
              <TableEmptyState colSpan={7} icon={<History className="h-5 w-5" />} title="No changes recorded"
                description={hasFilters ? 'Nothing matches these filters.' : 'Changes appear here as soon as anyone saves.'} />
            )}
            {rows.map((r) => {
              const view = describeChange(r, names, allowances);
              const open = !!expanded[r.key];
              const lines = open ? view.lines : view.lines.slice(0, LINES_SHOWN);
              const note = whoNote(r);
              const pageLabel = pageOfTable(r.table_name)?.label ?? tableLabel(r.table_name);
              const sub = [tableLabel(r.table_name) !== pageLabel ? tableLabel(r.table_name) : null, r.row_label].filter(Boolean).join(' · ');
              return (
                <tr key={r.key} className={cn(WS_TR, 'align-top')}>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{formatStamp(r.at)}</td>
                  <td className={cn(WS_TD, 'text-xs')}>
                    <div className="font-medium">{whoLabel(r)}</div>
                    {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
                  </td>
                  <td className={cn(WS_TD, 'text-xs')}>{clientName(r.client_id)}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                    {r.period_month ? monthLabel(r.period_month) : r.financial_year ? `FY ${r.financial_year}` : ''}
                  </td>
                  <td className={cn(WS_TD, 'text-xs')}>
                    <div>{pageLabel}</div>
                    {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
                  </td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{view.action}</td>
                  <td className={cn(WS_TD, 'text-xs')}>
                    <ul className="space-y-0.5">
                      {lines.map((l) => (
                        <li key={l.field}>
                          <span className="text-muted-foreground">{l.label}: </span>
                          {r.op === 'UPDATE'
                            ? <><span className="line-through decoration-muted-foreground/60">{l.old}</span>{' → '}<span className="font-medium">{l.new}</span></>
                            : <span className={r.op === 'DELETE' ? 'line-through decoration-muted-foreground/60' : 'font-medium'}>{l.old || l.new}</span>}
                        </li>
                      ))}
                    </ul>
                    {view.lines.length > LINES_SHOWN && (
                      <button type="button" className="mt-0.5 text-[11px] text-primary hover:underline"
                        onClick={() => setExpanded((e) => ({ ...e, [r.key]: !open }))}>
                        {open ? 'Show fewer' : `Show all ${view.lines.length}`}
                      </button>
                    )}
                    {view.badge && <Badge variant="warning" className="mt-1 whitespace-normal text-[11px] font-normal">{view.badge}</Badge>}
                    {view.note && <p className="mt-0.5 text-[11px] text-muted-foreground">{view.note}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {historyQ.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className={WS_BTN} onClick={() => historyQ.fetchNextPage()} disabled={historyQ.isFetchingNextPage}>
            {historyQ.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {rows.length.toLocaleString('en-IN')} change{rows.length === 1 ? '' : 's'} shown{historyQ.hasNextPage ? ', more below' : ''}.
          The record cannot be edited or deleted.
        </p>
      )}
    </div>
  );
};

export default ChangeHistoryPage;
