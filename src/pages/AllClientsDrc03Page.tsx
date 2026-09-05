// The Notices Dashboard's "DRC 03" Notice Summary row drill-down — every
// client's DRC-03 voluntary payments in one read-only list, mirroring
// Notice Alert's own "DRC 03" category click-through. Reuses
// EvidenceEventListView (same as the per-client "DRC-03 Filed On Portal"
// report) fed a firm-wide ReportTable with GSTIN/Trade Name columns.
import React, { useEffect, useState } from 'react';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import type { ReportTable } from '@/utils/allClientsReports';
import { isDrc03Closed, isClosed } from '@/utils/noticeSummaryReport';
import { isoDateToDMY } from '@/utils/formatDate';
import { FileWarning, ArrowLeft, Loader2 } from 'lucide-react';

interface Drc03Record {
  arn: string | null;
  cause_of_payment: string | null;
  section: string | null;
  financial_year: string | null;
  filed_date: string | null;
  period_from: string | null;
  period_to: string | null;
  taxable_value: number | null;
  igst_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  cess_amount: number | null;
  interest_amount: number | null;
  late_fee_amount: number | null;
  penalty_amount: number | null;
  cash_amount: number | null;
  credit_amount: number | null;
  status: string | null;
  pdf_url: string | null;
  clients: { name: string | null; gstin: string | null } | null;
  client_id: string | null;
}

// See AllClientsRefundsPage for why this merge exists: the Additional
// Notices case-folder sync also writes a "Voluntary Payment"-typed
// gst_notices row per DRC-03 case, most of which have no matching ARN in the
// dedicated gst_drc03_filings table (confirmed live 2026-08-29: 11 of 146
// share an ARN) — without merging both, this page undercounted against the
// Notice Summary panel's own DRC 03 total.
interface CaseDrc03Row {
  case_id: string | null;
  description: string | null;
  issue_date: string | null;
  staff_status: string | null;
  pdf_url: string | null;
  clients: { name: string | null; gstin: string | null } | null;
  client_id: string | null;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const AllClientsDrc03Page: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [params] = useSearchParams();
  const status = params.get('status') || '';
  const [records, setRecords] = useState<Drc03Record[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data }, { data: caseData }] = await Promise.all([
        supabase
          .from('gst_drc03_filings')
          .select(
            'arn, cause_of_payment, section, financial_year, filed_date, period_from, period_to, ' +
            'taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, interest_amount, late_fee_amount, penalty_amount, ' +
            'cash_amount, credit_amount, status, pdf_url, client_id, clients(name, gstin)',
          )
          .order('filed_date', { ascending: false }),
        supabase
          .from('gst_notices')
          .select('case_id, description, issue_date, staff_status, pdf_url, client_id, clients(name, gstin)')
          .eq('source', 'notices')
          .eq('notice_type', 'Voluntary Payment'),
      ]);
      if (!cancelled) {
        const dedicated = (data || []) as unknown as Drc03Record[];
        // Dedupe by ARN, matching computeNoticeSummary's own key-based union
        // exactly — see AllClientsRefundsPage for why a naive concat
        // over-counts (duplicate ARNs within each source plus overlap
        // between them). Dedicated wins on a shared key since it carries
        // the richer tax-breakdown fields.
        const byKey = new Map<string, Drc03Record>();
        dedicated.forEach((r) => { if (r.arn) byKey.set(r.arn, r); });
        ((caseData || []) as unknown as CaseDrc03Row[]).forEach((r) => {
          if (!r.case_id || byKey.has(r.case_id)) return;
          byKey.set(r.case_id, {
            arn: r.case_id, cause_of_payment: r.description, section: null, financial_year: null,
            filed_date: r.issue_date, period_from: null, period_to: null,
            taxable_value: null, igst_amount: null, cgst_amount: null, sgst_amount: null, cess_amount: null,
            interest_amount: null, late_fee_amount: null, penalty_amount: null, cash_amount: null, credit_amount: null,
            status: r.staff_status || 'Open', pdf_url: r.pdf_url, clients: r.clients, client_id: r.client_id,
          });
        });
        setRecords(Array.from(byKey.values()));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  // Same split as computeNoticeSummary: dedicated rows close via
  // isDrc03Closed's portal-status wording, case-only rows via isClosed.
  const rowIsClosed = (r: Drc03Record) => isDrc03Closed(r.status) || isClosed(r.status);
  const filteredRecords = status
    ? records.filter((r) => (status.toLowerCase() === 'closed' ? rowIsClosed(r) : !rowIsClosed(r)))
    : records;

  let totTaxable = 0, totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0, totIntr = 0, totFee = 0, totPnlty = 0, totCash = 0, totCredit = 0;
  const dataRows = filteredRecords.map((r) => {
    totTaxable += num(r.taxable_value); totIgst += num(r.igst_amount); totCgst += num(r.cgst_amount); totSgst += num(r.sgst_amount);
    totCess += num(r.cess_amount); totIntr += num(r.interest_amount); totFee += num(r.late_fee_amount); totPnlty += num(r.penalty_amount);
    totCash += num(r.cash_amount); totCredit += num(r.credit_amount);
    return [
      r.clients?.gstin || '—', r.clients?.name || '—',
      r.arn || '—', r.cause_of_payment || '—', r.section || '—', r.financial_year || '—',
      isoDateToDMY(r.filed_date), `${isoDateToDMY(r.period_from)} to ${isoDateToDMY(r.period_to)}`,
      num(r.taxable_value), num(r.igst_amount), num(r.cgst_amount), num(r.sgst_amount), num(r.cess_amount),
      num(r.interest_amount), num(r.late_fee_amount), num(r.penalty_amount),
      num(r.cash_amount), num(r.credit_amount), r.status || '—', r.pdf_url || '—',
    ];
  });
  const clientIds: (string | null)[] = filteredRecords.map((r) => r.client_id);
  if (dataRows.length > 0) {
    dataRows.push([
      '', '', '', 'TOTAL', '', '', '', '',
      totTaxable, totIgst, totCgst, totSgst, totCess, totIntr, totFee, totPnlty, totCash, totCredit, '', '',
    ]);
    clientIds.push(null);
  }

  const table: ReportTable = {
    title: 'DRC-03 — All Clients',
    subtitle: `${filteredRecords.length} record${filteredRecords.length === 1 ? '' : 's'}` +
      (status ? `, status ${status}` : ' across every client on record'),
    headers: [
      'GSTIN', 'Trade Name', 'ARN', 'Cause of Payment', 'Section', 'FY', 'Filed Date', 'Period',
      'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Interest', 'Late Fee', 'Penalty',
      'Cash Amount', 'Credit Amount', 'Status', 'PDF',
    ],
    rows: dataRows,
    clientIds,
    fileNameBase: 'DRC03_All_Clients',
    columnWidths: [16, 24, 18, 30, 10, 10, 12, 18, 14, 12, 12, 12, 10, 12, 12, 12, 14, 14, 16, 30],
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/notices-dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title="DRC-03 — All Clients" subtitle="Every client's DRC-03 voluntary payments, filed most recent first." icon={<FileWarning className="h-6 w-6" />} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <EvidenceEventListView table={table} report={{ title: table.title, icon: FileWarning }} />
      )}
    </div>
  );
};

export default AllClientsDrc03Page;
