// The Notices Dashboard's "Refund" Notice Summary row drill-down — every
// client's refund applications in one read-only list, mirroring Notice
// Alert's own "Refund" category click-through. Reuses EvidenceEventListView
// (the same read-only list the per-client "Refund Filed On Portal" report
// uses) fed a firm-wide ReportTable with GSTIN/Trade Name columns prepended.
import React, { useEffect, useState } from 'react';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import type { ReportTable } from '@/utils/allClientsReports';
import { isRefundClosed, isClosed } from '@/utils/noticeSummaryReport';
import { isoDateToDMY } from '@/utils/formatDate';
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
  client_id: string | null;
}

// The Additional Notices case-folder sync also writes a "Refunds"-typed
// gst_notices row per refund case — a MINORITY of those share an ARN with a
// dedicated gst_refund_applications row (confirmed live 2026-08-29: 9 of 49),
// but most don't, meaning most refund cases only exist here, never in the
// dedicated table. Without merging both sources this page silently showed
// far fewer records (28) than the Notice Summary panel's own count (51) for
// the exact same underlying data — same dedup-by-ARN as computeNoticeSummary.
interface CaseRefundRow {
  case_id: string | null;
  description: string | null;
  issue_date: string | null;
  staff_status: string | null;
  pdf_url: string | null;
  clients: { name: string | null; gstin: string | null } | null;
  client_id: string | null;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const AllClientsRefundsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [params] = useSearchParams();
  const status = params.get('status') || '';
  const [records, setRecords] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data }, { data: caseData }] = await Promise.all([
        supabase
          .from('gst_refund_applications')
          .select('arn, refund_type, filed_date, claimed_amount, sanctioned_amount, status, documents, client_id, clients(name, gstin)')
          .order('filed_date', { ascending: false }),
        supabase
          .from('gst_notices')
          .select('case_id, description, issue_date, staff_status, pdf_url, client_id, clients(name, gstin)')
          .eq('source', 'notices')
          .eq('notice_type', 'Refunds'),
      ]);
      if (!cancelled) {
        const dedicated = (data || []) as unknown as RefundRecord[];
        // Dedupe by ARN, matching computeNoticeSummary's own key-based union
        // exactly (28 raw dedicated rows include 2 duplicate ARNs; the 49
        // raw case rows include further duplicates and overlap with
        // dedicated ARNs — a naive concat over-counts by ~17 vs the Notice
        // Summary panel's own total). Dedicated wins on a shared key since
        // it carries the richer amount/status fields.
        const byKey = new Map<string, RefundRecord>();
        dedicated.forEach((r) => { if (r.arn) byKey.set(r.arn, r); });
        ((caseData || []) as unknown as CaseRefundRow[]).forEach((r) => {
          if (!r.case_id || byKey.has(r.case_id)) return;
          byKey.set(r.case_id, {
            arn: r.case_id, refund_type: r.description, filed_date: r.issue_date,
            claimed_amount: null, sanctioned_amount: null,
            status: r.staff_status || 'Open',
            documents: r.pdf_url ? [{ tab: '', label: 'PDF', url: r.pdf_url }] : [],
            clients: r.clients,
            client_id: r.client_id,
          });
        });
        setRecords(Array.from(byKey.values()));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  // Dedicated rows close via isRefundClosed's portal-status wording; case-only
  // rows (staff_status 'Open'/'Closed') via isClosed instead — same split
  // computeNoticeSummary uses when merging the two sources.
  const rowIsClosed = (r: RefundRecord) => isRefundClosed(r.status) || isClosed(r.status);
  const filteredRecords = status
    ? records.filter((r) => (status.toLowerCase() === 'closed' ? rowIsClosed(r) : !rowIsClosed(r)))
    : records;

  let totClaimed = 0, totSanctioned = 0;
  const dataRows = filteredRecords.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    const docs = Array.isArray(r.documents) ? r.documents : [];
    return [
      r.clients?.gstin || '—', r.clients?.name || '—',
      r.arn || '—', r.refund_type || '—', isoDateToDMY(r.filed_date),
      num(r.claimed_amount), num(r.sanctioned_amount), r.status || '—',
      docs.length === 0 ? '—' : docs[0].url,
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
