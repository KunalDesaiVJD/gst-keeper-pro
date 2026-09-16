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
import { useNoticeSet } from '@/hooks/useNoticeSet';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import NoticesPageHeader from '@/components/notices/NoticesPageHeader';
import NoticesCardHeader from '@/components/notices/NoticesCardHeader';
import FilterPill from '@/components/notices/FilterPill';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { isClosed, isRefundClosed, isDrc03Closed } from '@/utils/noticeSummaryReport';
import { isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { renderReportToExcel, type ReportTable } from '@/utils/allClientsReports';
import { Building2, Loader2, FileSpreadsheet, Search } from 'lucide-react';

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
  matterCount: number;
  exposure: number;
}

interface MatterAgg { client_id: string; count: number; demand: number; }

const GstinWiseNoticeCountPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const navigate = useNavigate();
  const { rows: notices, refundRows: refunds, drc03Rows: drc03s, loading } = useNoticeSet();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [matterAggs, setMatterAggs] = useState<MatterAgg[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeOfNoticesFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: cData }, { data: mData }] = await Promise.all([
        supabase.from('clients').select('id, name, gstin').order('name'),
        supabase.from('litigation_matters').select('client_id, status, demand_tax, demand_interest, demand_penalty, demand_cess'),
      ]);
      if (cancelled) return;
      setClients((cData || []) as ClientRow[]);
      const agg = new Map<string, MatterAgg>();
      ((mData || []) as any[]).filter(m => m.status !== 'Closed').forEach(m => {
        if (!agg.has(m.client_id)) agg.set(m.client_id, { client_id: m.client_id, count: 0, demand: 0 });
        const e = agg.get(m.client_id)!;
        e.count += 1;
        e.demand += (m.demand_tax ?? 0) + (m.demand_interest ?? 0) + (m.demand_penalty ?? 0) + (m.demand_cess ?? 0);
      });
      setMatterAggs([...agg.values()]);
      setClientsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredNotices = notices.filter((r) => {
    if (typeFilter === 'registration') return isRegistrationDescription(r.description);
    if (typeFilter === 'other') return !isRegistrationDescription(r.description);
    return true;
  });

  const matterMap = useMemo(() => {
    const m = new Map<string, MatterAgg>();
    matterAggs.forEach(a => m.set(a.client_id, a));
    return m;
  }, [matterAggs]);

  const countsByClient = useMemo(() => {
    const m = new Map<string, GstinCountRow>();
    const ensure = (clientId: string) => {
      let e = m.get(clientId);
      if (!e) {
        const c = clients.find((c) => c.id === clientId);
        const ma = matterMap.get(clientId);
        e = { clientId, gstin: c?.gstin || '—', name: c?.name || '—', total: 0, open: 0, closed: 0, replied: 0, matterCount: ma?.count ?? 0, exposure: ma?.demand ?? 0 };
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
        if (!r.client_id) return;
        const e = ensure(r.client_id);
        e.total += 1;
        if (isRefundClosed(r.status)) e.closed += 1; else e.open += 1;
      });
      drc03s.forEach((r) => {
        if (!r.client_id) return;
        const e = ensure(r.client_id);
        e.total += 1;
        if (isDrc03Closed(r.status)) e.closed += 1; else e.open += 1;
      });
    }
    for (const [cid, ma] of matterMap) {
      if (!m.has(cid)) ensure(cid);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [filteredNotices, refunds, drc03s, clients, typeFilter, matterMap]);

  const filteredCounts = countsByClient.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.gstin.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  const fmtINR = (n: number) => n > 0 ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n) : '—';

  const grandTotal = filteredCounts.reduce(
    (acc, r) => ({ total: acc.total + r.total, open: acc.open + r.open, closed: acc.closed + r.closed, replied: acc.replied + r.replied, matters: acc.matters + r.matterCount, exposure: acc.exposure + r.exposure }),
    { total: 0, open: 0, closed: 0, replied: 0, matters: 0, exposure: 0 },
  );

  const handleExport = () => {
    const table: ReportTable = {
      title: 'GSTIN Wise Notice Count',
      subtitle: `${filteredCounts.length} compan${filteredCounts.length === 1 ? 'y' : 'ies'}`,
      headers: ['GSTIN', 'Trade Name', 'Total', 'Open', 'Closed', 'Replied', 'Matters', 'Exposure'],
      rows: [
        ...filteredCounts.map((r) => [r.gstin, r.name, r.total, r.open, r.closed, r.replied, r.matterCount, r.exposure]),
        ['Total', '', grandTotal.total, grandTotal.open, grandTotal.closed, grandTotal.replied, grandTotal.matters, grandTotal.exposure],
      ],
      fileNameBase: 'gstin_wise_notice_count',
      columnWidths: [18, 24, 8, 8, 8, 8, 8, 14],
    };
    renderReportToExcel(table);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title="GSTIN-wise Notice Count"
        icon={Building2}
        subtitle={
          <>
            <span className="flex items-center gap-1.5">
              <Link to="/notices-dashboard" className="text-primary hover:underline">GST Dashboard</Link>
              <span>›</span>
              <span>GSTIN Wise Notice Count</span>
            </span>
            <span>{filteredCounts.length} companies · {grandTotal.total} notices</span>
          </>
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
        <NoticesCardHeader title="Notices by GSTIN" badge={filteredCounts.length} />
        <CardContent className="space-y-3 pt-3 pb-3">
          <div className="relative w-[240px] space-y-1">
            <Label className="text-[11px] text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="GSTIN or Trade Name" className="h-8 pl-8 text-xs" />
            </div>
          </div>

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">GSTIN</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Trade Name</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Open</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Closed</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Replied</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Matters</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Exposure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(loading || clientsLoading) ? (
                  <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : filteredCounts.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-10 text-center text-xs text-muted-foreground">No companies match.</TableCell></TableRow>
                ) : (
                  filteredCounts.map((r) => (
                    <TableRow key={r.clientId}>
                      <TableCell className="text-[10px] font-mono text-muted-foreground">
                        <Link to={`/notices-company/${r.clientId}`} className="hover:text-primary hover:underline">
                          {r.gstin}
                        </Link>
                      </TableCell>
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
                      <TableCell
                        className="cursor-pointer text-right text-xs tabular-nums text-primary underline-offset-2 hover:underline"
                        onClick={() => r.matterCount > 0 ? navigate(`/litigation?client=${r.clientId}`) : undefined}
                      >
                        {r.matterCount || '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-primary">{fmtINR(r.exposure)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!(loading || clientsLoading) && filteredCounts.length > 0 && (
                <tfoot>
                  <TableRow className="bg-primary/5 font-semibold hover:bg-primary/10">
                    <TableCell colSpan={2} className="text-xs">Total</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.total}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.open}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.closed}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.replied}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.matters}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-primary">{fmtINR(grandTotal.exposure)}</TableCell>
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
