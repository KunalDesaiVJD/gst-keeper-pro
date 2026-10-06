// The Notices Dashboard's "Refund" Notice Summary row drill-down — every
// client's refund applications in one read-only list, mirroring Notice
// Alert's own "Refund" category click-through. Reuses EvidenceEventListView
// (the same read-only list the per-client "Refund Filed On Portal" report
// uses) fed a firm-wide ReportTable with GSTIN/Trade Name columns prepended.
import React, { useEffect, useState } from 'react';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { loadRefundFacts, type RefundFact } from '@/lib/noticeFacts';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import type { ReportTable } from '@/utils/allClientsReports';
import { isoDateToDMY } from '@/utils/formatDate';
import { Banknote, ArrowLeft, Loader2 } from 'lucide-react';

// The rows are public.refund_facts (lib/noticeFacts): every refund application
// plus the "Refunds" case rows from the portal's case list that no application
// covers (same ARN = same case) — exactly the set the Notice Summary's Refund
// row counts, so its number is this list's row count. "Closed" is the set's
// own flag (disbursed / withdrawn / rejected / re-credited, or a closed case).
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const AllClientsRefundsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [params] = useSearchParams();
  const status = params.get('status') || '';
  const [records, setRecords] = useState<RefundFact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await loadRefundFacts();
        if (!cancelled) setRecords(rows);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load refunds');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredRecords = status
    ? records.filter((r) => (status.toLowerCase() === 'closed' ? !!r.is_closed : !r.is_closed))
    : records;

  let totClaimed = 0, totSanctioned = 0;
  const dataRows = filteredRecords.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    const docs = Array.isArray(r.documents) ? (r.documents as { url?: string }[]) : [];
    return [
      r.client_gstin || '—', r.client_name || '—',
      r.arn || '—', r.refund_type || '—', isoDateToDMY(r.filed_date),
      num(r.claimed_amount), num(r.sanctioned_amount), r.status || (r.origin === 'case' ? 'Open' : '—'),
      docs.length === 0 || !docs[0].url ? '—' : docs[0].url,
    ];
  });
  const clientIds: (string | null)[] = filteredRecords.map((r) => r.client_id);
  if (dataRows.length > 0) {
    dataRows.push(['', '', '', 'TOTAL', '', totClaimed, totSanctioned, '', '']);
    clientIds.push(null);
  }

  const table: ReportTable = {
    title: 'Refund — All Clients',
    subtitle: `${filteredRecords.length} record${filteredRecords.length === 1 ? '' : 's'}` +
      (status ? `, status ${status}` : ' across every client on record'),
    headers: ['GSTIN', 'Trade Name', 'ARN', 'Refund Type', 'Filed Date', 'Claimed Amount', 'Sanctioned Amount', 'Status', 'Documents'],
    rows: dataRows,
    clientIds,
    fileNameBase: 'Refund_All_Clients',
    columnWidths: [16, 24, 18, 20, 12, 16, 18, 20, 12],
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/notices-dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title="Refund — All Clients" subtitle="Every client's refund applications, filed most recent first." icon={<Banknote className="h-6 w-6" />} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <EvidenceEventListView table={table} report={{ title: table.title, icon: Banknote }} />
      )}
    </div>
  );
};

export default AllClientsRefundsPage;
