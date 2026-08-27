// NoticeSummaryReportPage — the destination behind Report > Notice Summary
// (see NoticesTopNav). Confirmed live against Notice Alert (2026-08-26):
// their "Report" nav is a dropdown with two dedicated pages, "Notice
// Summary" and "GSTIN Wise Notice Count" — not a link into this app's own
// generic Reports Hub, which is a completely different, unrelated report
// surface. Reuses the exact same category-breakdown table already on the
// Notices Dashboard (computeNoticeSummary) as a full page, matching Notice
// Alert's own full-page version of the same table.
import React, { useEffect, useState } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { computeNoticeSummary, type NoticeSummarySourceRow } from '@/utils/noticeSummaryReport';
import { isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { renderReportToExcel, type ReportTable } from '@/utils/allClientsReports';
import { Bell, Loader2, FileSpreadsheet } from 'lucide-react';

interface NoticeRow extends NoticeSummarySourceRow {
  description: string | null;
}

type TypeOfNoticesFilter = 'all' | 'registration' | 'other';

const NoticeSummaryReportPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [refundStatuses, setRefundStatuses] = useState<(string | null)[]>([]);
  const [drc03Statuses, setDrc03Statuses] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeOfNoticesFilter>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [noticesRes, refundRes, drc03Res] = await Promise.all([
        supabase.from('gst_notices').select('notice_type, description, staff_status, reply_date').eq('source', 'notices'),
        supabase.from('gst_refund_applications').select('status'),
        supabase.from('gst_drc03_filings').select('status'),
      ]);
      if (!cancelled) {
        setRows((noticesRes.data || []) as NoticeRow[]);
        setRefundStatuses((refundRes.data || []).map((r) => r.status));
        setDrc03Statuses((drc03Res.data || []).map((r) => r.status));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredRows = rows.filter((r) => {
    if (typeFilter === 'registration') return isRegistrationDescription(r.description);
    if (typeFilter === 'other') return !isRegistrationDescription(r.description);
    return true;
  });
  const { categoryRows, grandTotal } = computeNoticeSummary(filteredRows, refundStatuses, drc03Statuses);

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
    <div className="space-y-2.5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title="Notices Dashboard" icon={<Bell className="h-5 w-5" />} embedded />
        <NoticesTopNav />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link to="/notices-dashboard" className="text-primary hover:underline">GST Dashboard</Link>
          <span>›</span>
          <span>Notice Summary</span>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Types Of Notices</Label>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeOfNoticesFilter)}>
                <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="registration">Registration</SelectItem>
                  <SelectItem value="other">Other than Registration</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Export to Excel
            </Button>
          </div>

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-muted/60 text-[11px] font-semibold">Special Remarks</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Total</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Open</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Closed</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : (
                  categoryRows.map((r) => (
                    <TableRow
                      key={r.type}
                      className={cn(!r.placeholder && 'cursor-pointer')}
                      onClick={r.placeholder ? undefined : () => navigate(r.to || `/notices-all?category=${encodeURIComponent(r.type)}`)}
                    >
                      <TableCell className={cn('text-xs font-medium', r.placeholder ? 'text-muted-foreground' : 'text-primary')}>{r.type}</TableCell>
                      <TableCell className={cn('text-right text-xs tabular-nums', !r.placeholder && 'text-primary underline-offset-2 hover:underline')}>{r.placeholder ? '—' : r.total}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.open || '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.closed || '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.replied || '—'}</TableCell>
                    </TableRow>
                  ))
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
