// The Notices Dashboard's "Refund" Notice Summary row drill-down — every
// client's refund applications in one read-only list, mirroring Notice
// Alert's own "Refund" category click-through. Reuses EvidenceEventListView
// (the same read-only list the per-client "Refund Filed On Portal" report
// uses) fed a firm-wide ReportTable with GSTIN/Trade Name columns prepended.
import React, { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import type { ReportTable } from '@/utils/allClientsReports';
import { Banknote, ArrowLeft, Loader2 } from 'lucide-react';

interface RefundRecord {
  arn: string | null;
  refund_type: string | null;
  filed_date: string | null;
  claimed_amount: number | null;
  sanctioned_amount: number | null;
  status: string | null;
  documents: { tab: string; label: string; url: string }[] | null;
  clients: { name: string | null; gstin: string | null } | null;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const AllClientsRefundsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [records, setRecords] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('gst_refund_applications')
        .select('arn, refund_type, filed_date, claimed_amount, sanctioned_amount, status, documents, clients(name, gstin)')
        .order('filed_date', { ascending: false });
      if (!cancelled) {
        setRecords((data || []) as unknown as RefundRecord[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  let totClaimed = 0, totSanctioned = 0;
  const dataRows = records.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    const docs = Array.isArray(r.documents) ? r.documents : [];
    return [
      r.clients?.gstin || '—', r.clients?.name || '—',
      r.arn || '—', r.refund_type || '—', r.filed_date || '—',
      num(r.claimed_amount), num(r.sanctioned_amount), r.status || '—',
      docs.length === 0 ? '—' : docs[0].url,
    ];
  });
  if (dataRows.length > 0) {
    dataRows.push(['', '', '', 'TOTAL', '', totClaimed, totSanctioned, '', '']);
  }

  const table: ReportTable = {
    title: 'Refund — All Clients',
    subtitle: `${records.length} record${records.length === 1 ? '' : 's'} across every client on record`,
    headers: ['GSTIN', 'Trade Name', 'ARN', 'Refund Type', 'Filed Date', 'Claimed Amount', 'Sanctioned Amount', 'Status', 'Documents'],
    rows: dataRows,
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
