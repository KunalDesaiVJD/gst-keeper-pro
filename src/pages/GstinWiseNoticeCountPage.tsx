// GstinWiseNoticeCountPage — the destination behind Report > GSTIN Wise
// Notice Count (see NoticesTopNav). Confirmed live against Notice Alert
// (2026-08-26): same Total/Open/Closed/Replied breakdown as their Notice
// Summary page, just grouped by company instead of by category — and its
// grand total matches Notice Summary's grand total exactly (both fold in
// Refund/DRC-03 alongside gst_notices), so this groups all three sources the
// same way computeNoticeSummary already does per-category.
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { isClosed, isRefundClosed, isDrc03Closed } from '@/utils/noticeSummaryReport';
import { isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { renderReportToExcel, type ReportTable } from '@/utils/allClientsReports';
import { Bell, Loader2, FileSpreadsheet, Search } from 'lucide-react';

interface NoticeRow {
  client_id: string;
  description: string | null;
  staff_status: string | null;
  reply_date: string | null;
}
interface StatusRow { client_id: string; status: string | null; }
interface ClientRow { id: string; name: string; gstin: string; }

type TypeOfNoticesFilter = 'all' | 'registration' | 'other';

interface GstinCountRow {
  clientId: string;
  gstin: string;
  name: string;
  total: number;
  open: number;
  closed: number;
  replied: number;
}

const GstinWiseNoticeCountPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [refunds, setRefunds] = useState<StatusRow[]>([]);
  const [drc03s, setDrc03s] = useState<StatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeOfNoticesFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [clientsRes, noticesRes, refundsRes, drc03Res] = await Promise.all([
        supabase.from('clients').select('id, name, gstin').order('name'),
        supabase.from('gst_notices').select('client_id, description, staff_status, reply_date').eq('source', 'notices'),
        supabase.from('gst_refund_applications').select('client_id, status'),
        supabase.from('gst_drc03_filings').select('client_id, status'),
      ]);
      if (!cancelled) {
        setClients((clientsRes.data || []) as ClientRow[]);
        setNotices((noticesRes.data || []) as NoticeRow[]);
        setRefunds((refundsRes.data || []) as StatusRow[]);
        setDrc03s((drc03Res.data || []) as StatusRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredNotices = notices.filter((r) => {
    if (typeFilter === 'registration') return isRegistrationDescription(r.description);
    if (typeFilter === 'other') return !isRegistrationDescription(r.description);
    return true;
  });

  const countsByClient = useMemo(() => {
    const m = new Map<string, GstinCountRow>();
    const ensure = (clientId: string) => {
      let e = m.get(clientId);
      if (!e) {
        const c = clients.find((c) => c.id === clientId);
        e = { clientId, gstin: c?.gstin || '—', name: c?.name || '—', total: 0, open: 0, closed: 0, replied: 0 };
        m.set(clientId, e);
      }
      return e;
    };
    filteredNotices.forEach((r) => {
      const e = ensure(r.client_id);
      e.total += 1;
      if (isClosed(r.staff_status)) e.closed += 1; else e.open += 1;
      if (r.reply_date) e.replied += 1;
    });
    if (typeFilter === 'all') {
      refunds.forEach((r) => {
        const e = ensure(r.client_id);
        e.total += 1;
        if (isRefundClosed(r.status)) e.closed += 1; else e.open += 1;
      });
      drc03s.forEach((r) => {
        const e = ensure(r.client_id);
        e.total += 1;
        if (isDrc03Closed(r.status)) e.closed += 1; else e.open += 1;
      });
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [filteredNotices, refunds, drc03s, clients, typeFilter]);

  const filteredCounts = countsByClient.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.gstin.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  const grandTotal = filteredCounts.reduce(
    (acc, r) => ({ total: acc.total + r.total, open: acc.open + r.open, closed: acc.closed + r.closed, replied: acc.replied + r.replied }),
    { total: 0, open: 0, closed: 0, replied: 0 },
  );

  const handleExport = () => {
    const table: ReportTable = {
      title: 'GSTIN Wise Notice Count',
      subtitle: `${filteredCounts.length} compan${filteredCounts.length === 1 ? 'y' : 'ies'}`,
      headers: ['GSTIN', 'Trade Name', 'Total', 'Open', 'Closed', 'Replied'],
      rows: [
        ...filteredCounts.map((r) => [r.gstin, r.name, r.total, r.open, r.closed, r.replied]),
        ['Total', '', grandTotal.total, grandTotal.open, grandTotal.closed, grandTotal.replied],
      ],
      fileNameBase: 'gstin_wise_notice_count',
      columnWidths: [18, 28, 10, 10, 10, 10],
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
          <span>GSTIN Wise Notice Count</span>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
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
              <div className="relative w-[240px] space-y-1">
                <Label className="text-xs text-muted-foreground">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="GSTIN or Trade Name" className="h-8 pl-8 text-xs" />
                </div>
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Export to Excel
            </Button>
          </div>

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-muted/60 text-[11px] font-semibold">GSTIN</TableHead>
                  <TableHead className="bg-muted/60 text-[11px] font-semibold">Trade Name</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Total</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Open</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Closed</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[11px] font-semibold">Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : filteredCounts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">No companies match.</TableCell></TableRow>
                ) : (
                  filteredCounts.map((r) => (
                    <TableRow key={r.clientId}>
                      <TableCell className="text-xs">{r.gstin}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs" title={r.name}>{r.name}</TableCell>
                      <TableCell
                        className="cursor-pointer text-right text-xs tabular-nums text-primary underline-offset-2 hover:underline"
                        onClick={() => navigate(`/notices-all?client=${r.clientId}`)}
                      >
                        {r.total}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer text-right text-xs tabular-nums text-primary underline-offset-2 hover:underline"
                        onClick={() => navigate(`/notices-all?client=${r.clientId}&status=Open`)}
                      >
                        {r.open || '—'}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer text-right text-xs tabular-nums text-primary underline-offset-2 hover:underline"
                        onClick={() => navigate(`/notices-all?client=${r.clientId}&status=Closed`)}
                      >
                        {r.closed || '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.replied || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!loading && filteredCounts.length > 0 && (
                <tfoot>
                  <TableRow className="bg-primary/5 font-semibold hover:bg-primary/10">
                    <TableCell colSpan={2} className="text-xs">Total</TableCell>
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

export default GstinWiseNoticeCountPage;
