// NoticeSummaryReportPage — the destination behind Report > Notice Summary
// (see NoticesTopNav). Confirmed live against Notice Alert (2026-08-26):
// their "Report" nav is a dropdown with two dedicated pages, "Notice
// Summary" and "GSTIN Wise Notice Count" — not a link into this app's own
// generic Reports Hub, which is a completely different, unrelated report
// surface. Reuses the exact same category-breakdown table already on the
// Notices Dashboard (computeNoticeSummary) as a full page, matching Notice
// Alert's own full-page version of the same table.
import React, { useState } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useNoticeSet } from '@/hooks/useNoticeSet';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import NoticesPageHeader from '@/components/notices/NoticesPageHeader';
import NoticesCardHeader from '@/components/notices/NoticesCardHeader';
import FilterPill from '@/components/notices/FilterPill';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { computeNoticeSummary, summaryCellHref, type SummaryCellKind } from '@/utils/noticeSummaryReport';
import { isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { renderReportToExcel, type ReportTable } from '@/utils/allClientsReports';
import { ListOrdered, Loader2, FileSpreadsheet } from 'lucide-react';

type TypeOfNoticesFilter = 'all' | 'registration' | 'other';

const NoticeSummaryReportPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const navigate = useNavigate();
  const { rows, refundRows, drc03Rows, loading } = useNoticeSet();
  const [typeFilter, setTypeFilter] = useState<TypeOfNoticesFilter>('all');

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredRows = rows.filter((r) => {
    if (typeFilter === 'registration') return isRegistrationDescription(r.description);
    if (typeFilter === 'other') return !isRegistrationDescription(r.description);
    return true;
  });
  const { categoryRows, grandTotal } = computeNoticeSummary(filteredRows, refundRows, drc03Rows);

  const handleExport = () => {
    const table: ReportTable = {
      title: 'Notice Summary',
      subtitle: `${categoryRows.length} categor${categoryRows.length === 1 ? 'y' : 'ies'}`,
      headers: ['Remarks', 'Total', 'Open', 'Closed', 'Replied'],
      rows: [
        ...categoryRows.map((r) => [r.type, r.placeholder ? 0 : r.total, r.open, r.closed, r.replied]),
        ['Total', grandTotal.total, grandTotal.open, grandTotal.closed, grandTotal.replied],
      ],
      fileNameBase: 'notice_summary',
      columnWidths: [24, 10, 10, 10, 10],
    };
    renderReportToExcel(table);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title="Notice Summary"
        icon={ListOrdered}
        subtitle={
          <span className="flex items-center gap-1.5">
            <Link to="/notices-dashboard" className="text-primary hover:underline">GST Dashboard</Link>
            <span>›</span>
            <span>Notice Summary</span>
          </span>
        }
        actions={
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport}>
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Export to Excel
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NoticesTopNav />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            label="Type"
            allLabel="All notices"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as TypeOfNoticesFilter)}
            options={[]}
            extraOptions={[
              { value: 'registration', label: 'Registration' },
              { value: 'other', label: 'Other than Registration' },
            ]}
          />
        </div>
      </div>

      <Card>
        <NoticesCardHeader
          title="Notices by category"
          description="Total, open, closed and replied counts for every notice category."
          badge={categoryRows.length}
        />
        <CardContent className="pt-3 pb-3">
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Special Remarks</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Open</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Closed</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : (
                  categoryRows.map((r) => {
                    const cell = (kind: SummaryCellKind, value: number) => {
                      const href = summaryCellHref(r, kind);
                      return (
                        <TableCell
                          className={cn('text-right text-xs tabular-nums', href && 'cursor-pointer text-primary underline-offset-2 hover:underline')}
                          onClick={href ? () => navigate(href) : undefined}
                        >
                          {value || '—'}
                        </TableCell>
                      );
                    };
                    return (
                      <TableRow key={r.type}>
                        <TableCell className={cn('text-xs font-medium', r.placeholder ? 'text-muted-foreground' : 'text-primary')}>{r.type}</TableCell>
                        {cell('total', r.total)}
                        {cell('open', r.open)}
                        {cell('closed', r.closed)}
                        {cell('replied', r.replied)}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
              {!loading && (
                <tfoot>
                  <TableRow className="bg-primary/5 font-semibold hover:bg-primary/10">
                    <TableCell className="text-xs">Total</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.total}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.open}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.closed}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.replied}</TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NoticeSummaryReportPage;
