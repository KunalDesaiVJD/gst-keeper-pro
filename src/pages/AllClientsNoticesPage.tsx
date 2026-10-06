// Notices & Litigation · All notices (roadmap Phase 2; audit U-20..U-34).
// Every dashboard number opens this list with the same filter, and the URL
// carries every filter, so the two always agree and a link reproduces the
// view. The database filters, sorts and pages (lib/noticeQueries), so it stays
// quick at 5,000 notices. A row opens the notice workspace (/notices/:id);
// old ?noticeId= links (e-mails, the bell) go there too. Opened from the
// command centre the list carries dash=1 (the dashboard's notice types only,
// shown as a removable chip); every row shows its type's reply need.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { NoticeFilterBar } from '@/components/notices/NoticeFilterBar';
import { NoticeTable } from '@/components/notices/NoticeTable';
import { Pager } from '@/components/notices/Pager';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import {
  defaultSort, fetchNoticePage, fetchNoticeRows, fetchNoticeSum, filterDef, listSearch, parseListParams, PAGE_SIZE,
  type NoticeListParams, type SortKey, SORTS,
} from '@/lib/noticeQueries';
import { stageLabel } from '@/lib/noticeStages';
import { closeReasonText, fmtDate, fmtFy, noticeTitle } from '@/lib/noticeFormat';
import { responseNeedDef } from '@/lib/noticeTypes';

const AllClientsNoticesPage: React.FC = () => {
  const { isStaffRole, user, canEditNoticeStatus, canExportData } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const params = useMemo(() => parseListParams(sp), [sp]);
  const meId = user?.id ?? null;
  const [exporting, setExporting] = useState(false);

  const list = useQuery({
    queryKey: ['notice-list', listSearch(params), meId],
    queryFn: () => fetchNoticePage(params, meId),
    placeholderData: (prev) => prev,
  });
  const exposureTotal = useQuery({
    queryKey: ['notice-list-sum', listSearch(params), meId],
    enabled: params.filter === 'exposure',
    queryFn: () => fetchNoticeSum(params, meId, 'exposure_amount'),
  });
  const client = useQuery({
    queryKey: ['client-name', params.client],
    enabled: !!params.client,
    queryFn: async () => (await supabase.from('clients').select('name, gstin').eq('id', params.client as string).maybeSingle()).data,
  });

  const legacyNotice = sp.get('noticeId');
  if (legacyNotice) return <Navigate to={`/notices/${legacyNotice}`} replace />;
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const update = (patch: Partial<NoticeListParams>) => {
    const next = { ...params, ...patch };
    setSp(new URLSearchParams(listSearch(next).slice(1)), { replace: false });
  };
  const sortKey: SortKey = params.sort ?? defaultSort(params.filter);
  const sortDir: 'asc' | 'desc' = params.dir ?? (SORTS[sortKey].ascending ? 'asc' : 'desc');
  const onSort = (k: SortKey) => {
    if (k === sortKey) update({ sort: k, dir: sortDir === 'asc' ? 'desc' : 'asc', page: 1 });
    else update({ sort: k, dir: undefined, page: 1 });
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notice-list'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const rows = await fetchNoticeRows(params, meId);
      const data = rows.map((r) => ({
        Client: r.client_name, GSTIN: r.client_gstin, Notice: noticeTitle(r), Form: r.form_code ?? '', Reference: r.reference_number ?? '',
        Case: r.case_id ?? '', Issued: fmtDate(r.issue_date), 'Due': fmtDate(r.effective_due), 'Due basis': r.due_basis ?? '',
        'Days to due': r.is_open && !r.is_replied ? r.days_to_due ?? '' : '', 'Reply need': responseNeedDef(r.response_need).label,
        Stage: stageLabel(r.stage), Owner: r.assign_to ?? '',
        Priority: r.effective_priority ?? '', 'Demand (₹)': r.amount_of_demand ?? '', 'Exposure (₹)': r.exposure_amount ?? '',
        'Replied on': fmtDate(r.reply_date), 'Order on': fmtDate(r.order_date), Category: r.category ?? '', FY: fmtFy(r.financial_year),
        'Close reason': closeReasonText(r.close_reason), Description: r.description ?? '',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Notices');
      XLSX.writeFile(wb, `Notices — ${filterDef(params.filter).title}${client.data?.name ? ` — ${client.data.name}` : ''}.xlsx`);
      toast.success(`Exported ${rows.length} notice${rows.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setExporting(false); }
  };

  const total = list.data?.total ?? 0;
  const heading = `${filterDef(params.filter).title}${client.data?.name ? ` · ${client.data.name}` : ''}`;

  return (
    <NoticesShell
      section="All notices"
      actions={canEditNoticeStatus() ? <AddNoticeDialog onSuccess={refresh} /> : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold" aria-live="polite">
          {heading} <span className="text-muted-foreground">· {list.isLoading ? '…' : total.toLocaleString('en-IN')}</span>
        </h2>
        {params.client && (
          <span className="text-xs text-muted-foreground">
            <Link to={`/notices-company/${params.client}`} className="text-primary hover:underline">Client profile</Link>
            {' · '}<Link to={`/refunds-all?client=${params.client}`} className="text-primary hover:underline">Refunds</Link>
            {' · '}<Link to={`/drc03-all?client=${params.client}`} className="text-primary hover:underline">DRC-03</Link>
          </span>
        )}
      </div>
      <NoticeFilterBar params={params} onChange={update} clientName={client.data?.name ?? null}
        actions={<>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
          {canExportData() && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={exporting || !total}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Export to Excel
            </Button>
          )}
        </>} />

      {list.error ? (
        <Note tone="warn">Couldn't load the notices: {list.error instanceof Error ? list.error.message : String(list.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => list.refetch()}>Retry</Button></Note>
      ) : list.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No notices match. {params.filter !== 'all' && <button type="button" className="text-primary hover:underline" onClick={() => update({ filter: 'all', page: 1 })}>Show all notices</button>}
        </div>
      ) : (
        <>
          <NoticeTable rows={list.data?.rows ?? []} canEdit={canEditNoticeStatus()} sort={sortKey} dir={sortDir} onSort={onSort}
            onChanged={refresh} showClient={!params.client}
            footerTotal={params.filter === 'exposure' && exposureTotal.data !== undefined
              ? { label: `Total exposure across ${total.toLocaleString('en-IN')} notice${total === 1 ? '' : 's'}`, amount: exposureTotal.data } : null} />
          {params.filter === 'exposure' && (
            <p className="text-xs text-muted-foreground">
              Each open dispute is counted once (its latest notice carries the demand). The dashboard's exposure also adds open
              matters' outstanding — <Link to="/litigation" className="text-primary underline underline-offset-2">see Matters</Link>.
            </p>
          )}
          <Pager page={params.page} pageSize={PAGE_SIZE} total={total} onPage={(p) => update({ page: p })} />
        </>
      )}
    </NoticesShell>
  );
};

export default AllClientsNoticesPage;
