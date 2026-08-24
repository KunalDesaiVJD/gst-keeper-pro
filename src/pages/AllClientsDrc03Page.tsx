// The Notices Dashboard's "DRC 03" Notice Summary row drill-down — every
// client's DRC-03 voluntary payments in one read-only list, mirroring
// Notice Alert's own "DRC 03" category click-through. Reuses
// EvidenceEventListView (same as the per-client "DRC-03 Filed On Portal"
// report) fed a firm-wide ReportTable with GSTIN/Trade Name columns.
import React, { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import type { ReportTable } from '@/utils/allClientsReports';
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
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const AllClientsDrc03Page: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [records, setRecords] = useState<Drc03Record[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('gst_drc03_filings')
        .select(
          'arn, cause_of_payment, section, financial_year, filed_date, period_from, period_to, ' +
          'taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, interest_amount, late_fee_amount, penalty_amount, ' +
          'cash_amount, credit_amount, status, pdf_url, clients(name, gstin)',
        )
        .order('filed_date', { ascending: false });
      if (!cancelled) {
        setRecords((data || []) as unknown as Drc03Record[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  let totTaxable = 0, totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0, totIntr = 0, totFee = 0, totPnlty = 0, totCash = 0, totCredit = 0;
  const dataRows = records.map((r) => {
    totTaxable += num(r.taxable_value); totIgst += num(r.igst_amount); totCgst += num(r.cgst_amount); totSgst += num(r.sgst_amount);
    totCess += num(r.cess_amount); totIntr += num(r.interest_amount); totFee += num(r.late_fee_amount); totPnlty += num(r.penalty_amount);
    totCash += num(r.cash_amount); totCredit += num(r.credit_amount);
    return [
      r.clients?.gstin || '—', r.clients?.name || '—',
      r.arn || '—', r.cause_of_payment || '—', r.section || '—', r.financial_year || '—',
      r.filed_date || '—', `${r.period_from || '—'} to ${r.period_to || '—'}`,
      num(r.taxable_value), num(r.igst_amount), num(r.cgst_amount), num(r.sgst_amount), num(r.cess_amount),
      num(r.interest_amount), num(r.late_fee_amount), num(r.penalty_amount),
      num(r.cash_amount), num(r.credit_amount), r.status || '—', r.pdf_url || '—',
    ];
  });
  if (dataRows.length > 0) {
    dataRows.push([
      '', '', '', 'TOTAL', '', '', '', '',
      totTaxable, totIgst, totCgst, totSgst, totCess, totIntr, totFee, totPnlty, totCash, totCredit, '', '',
    ]);
  }

  const table: ReportTable = {
    title: 'DRC-03 — All Clients',
    subtitle: `${records.length} record${records.length === 1 ? '' : 's'} across every client on record`,
    headers: [
      'GSTIN', 'Trade Name', 'ARN', 'Cause of Payment', 'Section', 'FY', 'Filed Date', 'Period',
      'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Interest', 'Late Fee', 'Penalty',
      'Cash Amount', 'Credit Amount', 'Status', 'PDF',
    ],
    rows: dataRows,
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
