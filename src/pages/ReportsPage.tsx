import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { FileSpreadsheet, FileText, Loader2, Pause, Wallet, Search, Percent, ClipboardList, Hash, Users, AlertTriangle, History, Scale, ArrowRightLeft, Rows3, BadgeCheck, Building2, ShoppingCart, Receipt, Layers, Repeat, Ship, PackageOpen, Package, ArrowLeftRight, RotateCcw, ListChecks, Gauge, IdCard, Link2, Layers3 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import {
  buildSuspendedClosingAllClients,
  buildCreditClosingAllClients,
  buildSuspendedClosingPerClient,
  buildCreditClosingPerClient,
  renderReportToExcel,
  fyMonthsForKey,
} from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import {
  buildGstr1RateWiseReport,
  buildGstr1SummaryReport,
  buildGstr1HsnSummaryReport,
  buildGstr1CustomerWiseReport,
  buildGstr1ErrorLogReport,
  buildGstr1PyInCyReport,
} from '@/utils/gstr1Reports';
import {
  buildGstr3bLiabilityReport,
  buildGstr3bVsGstr1TaxReport,
  buildGstr3bVsGstr1ComparisonReport,
  buildGstr3bVsGstr2bItcReport,
  buildGstr3bVsGstr2aItcReport,
} from '@/utils/gstr3bReports';
import {
  buildGstr2bRateWiseReport,
  buildGstr2bSupplierWiseReport,
  buildPurchaseRateWiseReport,
  buildGstr2bPyInCyReport,
} from '@/utils/gstr2bReports';
import {
  buildGstr2aRateWiseReport,
  buildGstr2aSupplierWiseReport,
  buildGstr2aPyInCyReport,
} from '@/utils/gstr2aReports';
import {
  buildPanOutputLiabilityReport,
  buildPanLiabilityVsItcClaimedReport,
  buildPanMultipleCompany2A2BReport,
} from '@/utils/panReports';
import {
  buildLiabilityDeclaredVsPaidReport,
  buildTaxLiabilityAndItcSummaryReport,
  buildTaxLiabilityExclExportRcmReport,
  buildTaxLiabilityRcmReport,
  buildTaxLiabilityExportSezReport,
  buildItcClaimedExclImportGoodsReport,
  buildItcClaimedImportGoodsReport,
  buildRcmLiabilityVsItcReport,
} from '@/utils/taxLiabilityReports';
import {
  buildCreditReversalReclaimStatement,
  buildRcmLedgerPerClient,
  buildFilingStatusReport,
  buildRcmTaxPaidVsItcClaimedAllClients,
  buildItcClaimedVsUtilizedAllClients,
  buildClientMasterReport,
} from '@/utils/extraLedgerReports';
import {
  REPORT_CATEGORY_LABELS,
  REPORT_CATEGORY_ORDER,
  REPORT_STATUS_META,
  type ReportCategory,
  type ReportDefinition,
} from '@/lib/reportRegistry';

interface ClientLite { id: string; name: string; gstin: string; }

/**
 * The registry for this page. Every report — today's 4 and every one the
 * roadmap adds later — is one entry here; the page below only ever reads
 * from this list, never branches on individual report keys.
 */
const REPORTS: ReportDefinition[] = [
  {
    key: 'sus-all',
    title: 'Suspended Ledger — All Clients',
    description: 'One row per client showing the suspended ITC closing balance for the selected month.',
    icon: Pause,
    category: 'ledgers',
    status: 'ready',
    needs: 'month',
    build: ({ month }) => buildSuspendedClosingAllClients(month),
  },
  {
    key: 'cred-all',
    title: 'Credit Ledger — All Clients',
    description: 'One row per client showing the GST Receivable (Credit Ledger) closing balance for the selected month, plus any cash GST payable.',
    icon: Wallet,
    category: 'ledgers',
    status: 'ready',
    needs: 'month',
    build: ({ month }) => buildCreditClosingAllClients(month),
  },
  {
    key: 'sus-one',
    title: 'Suspended Ledger — One Client × All Months',
    description: 'For the picked client, suspended ITC closing balance per month across the financial year of the selected month.',
    icon: Pause,
    category: 'ledgers',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildSuspendedClosingPerClient(clientId!, month),
  },
  {
    key: 'cred-one',
    title: 'Credit Ledger — One Client × All Months',
    description: 'For the picked client, Credit Ledger closing balance per month across the financial year of the selected month, plus cash GST payable.',
    icon: Wallet,
    category: 'ledgers',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildCreditClosingPerClient(clientId!, month),
  },
  {
    key: 'gstr1-rate-wise',
    title: 'GSTR 1 Rate Wise Report',
    description: 'Outward supplies for the selected client and period broken down by tax rate, with a Nil-rated/exempt row and grand total.',
    icon: Percent,
    category: 'gstr1',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr1RateWiseReport(clientId!, month),
  },
  {
    key: 'gstr1-summary',
    title: 'GSTR 1 Summary Report',
    description: 'The portal-style table-wise consolidated summary (4A, 4B, 5, 6A-C, 7, 8, 9B, 10, 11A-B, 12, 13) for the selected client and period.',
    icon: ClipboardList,
    category: 'gstr1',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr1SummaryReport(clientId!, month),
  },
  {
    key: 'gstr1-hsn-summary',
    title: 'GSTR 1 HSN Summary Report',
    description: 'Table 12 HSN-wise summary of outward supplies for the selected client and period, sorted by HSN/SAC code.',
    icon: Hash,
    category: 'gstr1',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr1HsnSummaryReport(clientId!, month),
  },
  {
    key: 'gstr1-customer-wise',
    title: 'GSTR 1 Customer Wise Report',
    description: 'B2B outward supplies (net of credit/debit notes) grouped by registered customer GSTIN for the selected client and period.',
    icon: Users,
    category: 'gstr1',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr1CustomerWiseReport(clientId!, month),
  },
  {
    key: 'gstr1-error-log',
    title: 'GSTR 1 Error Log',
    description: 'Every upload attempt for the selected client and period with its per-invoice portal validation errors, oldest first.',
    icon: AlertTriangle,
    category: 'gstr1',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr1ErrorLogReport(clientId!, month),
  },
  {
    key: 'gstr1-py-in-cy',
    title: 'GSTR 1 (P.Y invoice showing in C.Y)',
    description: 'Flags invoices, credit notes and debit notes dated in an earlier financial year but reported in the selected period\'s GSTR-1.',
    icon: History,
    category: 'gstr1',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr1PyInCyReport(clientId!, month),
  },
  {
    key: 'gstr3b-liability',
    title: 'GSTR 3B Liability Report',
    description: "This app's computed draft GSTR-3B — Table 3.1 outward/RCM liability and Table 4 ITC available/reversed/net — for the selected client and period.",
    icon: Scale,
    category: 'gstr3b',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr3bLiabilityReport(clientId!, month),
  },
  {
    key: 'gstr3b-vs-gstr1-tax',
    title: 'GSTR 3B vs GSTR 1 Tax Report',
    description: 'Side-by-side tax total from GSTR-1 vs this app\'s computed GSTR-3B Table 3.1, with a variance column. Approximate — see the report for what a variance means.',
    icon: ArrowRightLeft,
    category: 'gstr3b',
    status: 'ready-approx',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr3bVsGstr1TaxReport(clientId!, month),
  },
  {
    key: 'gstr3b-vs-gstr1-comparison',
    title: 'GSTR 3B vs GSTR 1 Comparison Report',
    description: 'Every GSTR-1 table alongside the GSTR-3B Table 3.1 row it feeds, so a mismatch traces to its source section. Approximate — this app\'s draft only, not the as-filed return.',
    icon: Rows3,
    category: 'gstr3b',
    status: 'ready-approx',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr3bVsGstr1ComparisonReport(clientId!, month),
  },
  {
    key: 'gstr3b-vs-gstr2b-itc',
    title: 'GSTR 3B vs GSTR 2B ITC Report',
    description: 'Eligible ITC per Import 2B vs GSTR-3B Table 4(A) ITC Available, with a variance column — catches a stale ITC Summary save. Approximate.',
    icon: BadgeCheck,
    category: 'gstr3b',
    status: 'ready-approx',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr3bVsGstr2bItcReport(clientId!, month),
  },
  {
    key: 'gstr3b-vs-gstr2a-itc',
    title: 'GSTR 3B vs GSTR 2A ITC Report',
    description: 'Every non-RCM document in the imported GSTR-2A vs GSTR-3B Table 4(A) ITC Available, with a variance column. Needs GSTR-2A imported first.',
    icon: BadgeCheck,
    category: 'gstr3b',
    status: 'extends-login',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr3bVsGstr2aItcReport(clientId!, month),
  },
  {
    key: 'gstr2b-rate-wise',
    title: 'GSTR 2B Rate Wise Report',
    description: 'Imported GSTR-2B documents broken down by tax rate (derived from tax ÷ taxable value) for the selected client and period.',
    icon: Percent,
    category: 'gstr2a2b',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr2bRateWiseReport(clientId!, month),
  },
  {
    key: 'gstr2b-supplier-wise',
    title: 'GSTR 2B Supplier Wise Report',
    description: 'Imported GSTR-2B documents grouped by supplier GSTIN, sorted by taxable value, for the selected client and period.',
    icon: Building2,
    category: 'gstr2a2b',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr2bSupplierWiseReport(clientId!, month),
  },
  {
    key: 'purchase-rate-wise',
    title: 'Purchase Rate Wise Report',
    description: "The client's own books register (not GSTR-2B) broken down by tax rate for the selected client and period.",
    icon: ShoppingCart,
    category: 'gstr2a2b',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildPurchaseRateWiseReport(clientId!, month),
  },
  {
    key: 'gstr2b-py-in-cy',
    title: 'GSTR 2B (P.Y Invoices showing in C.Y)',
    description: 'Flags imported GSTR-2B documents dated in an earlier financial year than the selected return period.',
    icon: History,
    category: 'gstr2a2b',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr2bPyInCyReport(clientId!, month),
  },
  {
    key: 'liability-declared-vs-paid',
    title: 'Difference in Liability Declared and Paid',
    description: 'Total output liability (before ITC set-off) vs the indicative net payable after set-off, by tax head, for the selected client and period.',
    icon: Receipt,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildLiabilityDeclaredVsPaidReport(clientId!, month),
  },
  {
    key: 'tax-liability-itc-summary',
    title: 'Tax Liability and ITC Summary',
    description: "A one-page digest of this app's computed draft GSTR-3B — outward, RCM and total liability alongside ITC available, reversed, net and payable.",
    icon: Layers,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildTaxLiabilityAndItcSummaryReport(clientId!, month),
  },
  {
    key: 'tax-liability-excl-export-rcm',
    title: 'Tax Liability Other Than Export/Reverse Charge',
    description: 'Domestic taxable supplies (B2B, B2CL, B2CS, net of notes) by rate — excludes exports/SEZ and Nil-rated/Exempt.',
    icon: Percent,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildTaxLiabilityExclExportRcmReport(clientId!, month),
  },
  {
    key: 'tax-liability-rcm',
    title: 'Tax Liability Due to Reverse Charge',
    description: 'RCM liability from RCM Summary broken down by rate and head (IGST vs CGST+SGST), plus Builder TDR/FSI reverse charge where applicable.',
    icon: Repeat,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildTaxLiabilityRcmReport(clientId!, month),
  },
  {
    key: 'tax-liability-export-sez',
    title: 'Tax Liability Due to Export and SEZ Supplies',
    description: 'GSTR-1 Tables 6A (Exports), 6B (SEZ) and 6C (Deemed Exports) for the selected client and period.',
    icon: Ship,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildTaxLiabilityExportSezReport(clientId!, month),
  },
  {
    key: 'itc-claimed-excl-import-goods',
    title: 'ITC Claimed and Due (Other Than Import of Goods)',
    description: 'GSTR-3B Table 4(A) rows (2)-(5) — import of services, RCM ITC, ISD, and all other ITC.',
    icon: PackageOpen,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildItcClaimedExclImportGoodsReport(clientId!, month),
  },
  {
    key: 'itc-claimed-import-goods',
    title: 'ITC Claimed and Due (Import of Goods)',
    description: 'GSTR-3B Table 4(A)(1) — import of goods, entered directly in ITC Summary.',
    icon: Package,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildItcClaimedImportGoodsReport(clientId!, month),
  },
  {
    key: 'rcm-liability-vs-itc',
    title: 'Reverse Charge Liability Declared and ITC Claimed Thereon',
    description: 'Table 3.1(d) RCM liability vs Table 4(A)(3) RCM ITC claimed — a variance points to a manual GSTR-3B adjustment on one side but not the other.',
    icon: ArrowLeftRight,
    category: 'tax-liability',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildRcmLiabilityVsItcReport(clientId!, month),
  },
  {
    key: 'credit-reversal-reclaim-statement',
    title: 'Credit Reversal and Reclaim Statement',
    description: 'For the picked client, month-by-month suspended-ITC movement across the financial year: reversed, reclaimed, expensed out, and still-suspended closing balance.',
    icon: RotateCcw,
    category: 'ledgers',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildCreditReversalReclaimStatement(clientId!, month),
  },
  {
    key: 'rcm-liability-itc-ledger',
    title: 'RCM Liability/ITC',
    description: 'For the picked client, RCM liability by month across the financial year, from RCM Summary.',
    icon: Repeat,
    category: 'ledgers',
    status: 'ready',
    needs: 'client+month',
    build: ({ clientId, month }) => buildRcmLedgerPerClient(clientId!, month),
  },
  {
    key: 'filing-status-report',
    title: 'Filing Status Report',
    description: 'Every client and return type for the selected month, with status and filed date — one row per client per return.',
    icon: ListChecks,
    category: 'extra',
    status: 'ready',
    needs: 'month',
    build: ({ month }) => buildFilingStatusReport(month),
  },
  {
    key: 'rcm-tax-paid-vs-itc-claimed-all',
    title: 'Tax Paid under RCM vs ITC Claimed',
    description: 'All clients for the selected month: RCM tax paid (Table 3.1d) vs RCM ITC claimed (Table 4A(3)), from this app\'s computed draft GSTR-3B.',
    icon: ArrowLeftRight,
    category: 'extra',
    status: 'ready',
    needs: 'month',
    build: ({ month }) => buildRcmTaxPaidVsItcClaimedAllClients(month),
  },
  {
    key: 'itc-claimed-vs-utilized-all',
    title: 'ITC Claimed vs ITC Utilized',
    description: 'All clients for the selected month: ITC claimed (Table 4A gross) vs ITC actually utilized against this month\'s liability.',
    icon: Gauge,
    category: 'extra',
    status: 'ready',
    needs: 'month',
    build: ({ month }) => buildItcClaimedVsUtilizedAllClients(month),
  },
  {
    key: 'client-master',
    title: 'Client Master',
    description: 'Every client with registration type, sub type, registration date, contact details and assigned accountant — no period needed.',
    icon: IdCard,
    category: 'extra',
    status: 'ready',
    needs: 'none',
    build: () => buildClientMasterReport(),
  },
  {
    key: 'gstr2a-rate-wise',
    title: 'GSTR 2A Rate Wise Report',
    description: 'Imported GSTR-2A documents broken down by tax rate (derived from tax ÷ taxable value). Pull it first from Import 2B\'s GSTR-2A Import card.',
    icon: Percent,
    category: 'gstr2a2b',
    status: 'extends-login',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr2aRateWiseReport(clientId!, month),
  },
  {
    key: 'gstr2a-supplier-wise',
    title: 'GSTR 2A Supplier Wise Report',
    description: 'Imported GSTR-2A documents grouped by supplier GSTIN, sorted by taxable value.',
    icon: Building2,
    category: 'gstr2a2b',
    status: 'extends-login',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr2aSupplierWiseReport(clientId!, month),
  },
  {
    key: 'gstr2a-py-in-cy',
    title: 'GSTR 2A (P.Y Invoices showing in C.Y)',
    description: 'Flags imported GSTR-2A documents dated in an earlier financial year than the selected return period.',
    icon: History,
    category: 'gstr2a2b',
    status: 'extends-login',
    needs: 'client+month',
    build: ({ clientId, month }) => buildGstr2aPyInCyReport(clientId!, month),
  },
  {
    key: 'pan-multiple-company-2a2b',
    title: 'GSTR 2A/2B Multiple Company Report',
    description: 'Pick any GSTIN under a PAN — rolls up every client sharing that PAN\'s imported GSTR-2A and GSTR-2B totals, side by side.',
    icon: Layers3,
    category: 'gstr2a2b',
    status: 'ready-approx',
    needs: 'client+month',
    build: ({ clientId, month }) => buildPanMultipleCompany2A2BReport(clientId!, month),
  },
  {
    key: 'pan-output-liability',
    title: 'Output Liability as per GSTR 1 and GSTR 3B (PAN-Based)',
    description: "Pick any GSTIN under a PAN — rolls up every client sharing that PAN's GSTR-1 output tax vs computed GSTR-3B liability, side by side.",
    icon: Link2,
    category: 'pan',
    status: 'ready-approx',
    needs: 'client+month',
    build: ({ clientId, month }) => buildPanOutputLiabilityReport(clientId!, month),
  },
  {
    key: 'pan-liability-vs-itc-claimed',
    title: 'Liability as per GSTR 1 and ITC Claimed as per GSTR 3B (PAN-Based)',
    description: "Pick any GSTIN under a PAN — rolls up every client sharing that PAN's GSTR-1 output liability vs GSTR-3B ITC claimed, side by side.",
    icon: Layers3,
    category: 'pan',
    status: 'ready-approx',
    needs: 'client+month',
    build: ({ clientId, month }) => buildPanLiabilityVsItcClaimedReport(clientId!, month),
  },
];

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: string; format: 'xlsx' | 'pdf' } | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<ReportCategory | 'all'>('all');

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => {
      setClients((data || []) as any);
    });
  }, []);

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const start = new Date(2024, 3, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    let cur = new Date(start);
    while (cur <= end) {
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      months.push({ value: `${mm}/${cur.getFullYear()}`, label: `${monthNames[cur.getMonth()]} ${cur.getFullYear()}` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  const fyLabel = useMemo(() => (selectedMonth ? fyMonthsForKey(selectedMonth).fyLabel : ''), [selectedMonth]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ReportCategory, number>();
    for (const r of REPORTS) counts.set(r.category, (counts.get(r.category) || 0) + 1);
    return counts;
  }, []);

  const visibleReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return REPORTS.filter((r) => {
      if (activeCategory !== 'all' && r.category !== activeCategory) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [search, activeCategory]);

  const handleDownload = async (report: ReportDefinition, format: 'xlsx' | 'pdf') => {
    if (report.needs !== 'none' && !selectedMonth) {
      toast.error('Pick a month first.');
      return;
    }
    if (report.needs === 'client+month' && !selectedClientId) {
      toast.error('Pick a client first.');
      return;
    }
    setBusy({ key: report.key, format });
    try {
      const table = await report.build({ month: selectedMonth, clientId: selectedClientId });
      if (format === 'xlsx') renderReportToExcel(table);
      else renderReportToPdf(table);
      toast.success(`${report.title} downloaded.`);
    } catch (err: any) {
      toast.error(`Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setBusy(null);
    }
  };

  const ReportCard: React.FC<{ report: ReportDefinition }> = ({ report }) => {
    const Icon = report.icon;
    const xlsxBusy = busy?.key === report.key && busy.format === 'xlsx';
    const pdfBusy = busy?.key === report.key && busy.format === 'pdf';
    const needsClient = report.needs === 'client+month';
    const isDisabled = (report.needs !== 'none' && !selectedMonth) || (needsClient && !selectedClientId);
    const statusMeta = REPORT_STATUS_META[report.status];

    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-primary" />
              {report.title}
            </CardTitle>
            <Badge variant={statusMeta.badgeVariant} className="shrink-0">{statusMeta.label}</Badge>
          </div>
          <CardDescription>{report.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          <Button
            onClick={() => handleDownload(report, 'xlsx')}
            disabled={isDisabled || xlsxBusy}
            variant="default"
            aria-label={`Download ${report.title} as Excel`}
          >
            {xlsxBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            Excel
          </Button>
          <Button
            onClick={() => handleDownload(report, 'pdf')}
            disabled={isDisabled || pdfBusy}
            variant="outline"
            aria-label={`Download ${report.title} as PDF`}
          >
            {pdfBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            PDF
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Reports"
        subtitle={`${REPORTS.length} reports across ${categoryCounts.size} categories today — more land here as each phase ships`}
        icon={<FileSpreadsheet className="h-6 w-6" />}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap">Month:</span>
              <div className="w-40">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
              {fyLabel && <span className="text-xs text-muted-foreground">({fyLabel} for per-client reports)</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap">Client:</span>
              <div className="min-w-[260px]">
                <SearchableSelect
                  options={clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                  value={selectedClientId}
                  onValueChange={setSelectedClientId}
                  placeholder="Select client (for per-client reports)..."
                  searchPlaceholder="Type to search clients..."
                  emptyText="No clients found."
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reports..."
          className="pl-9"
          aria-label="Search reports"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={activeCategory === 'all' ? 'default' : 'outline'}
          onClick={() => setActiveCategory('all')}
        >
          All ({REPORTS.length})
        </Button>
        {REPORT_CATEGORY_ORDER.map((cat) => (
          <Button
            key={cat}
            size="sm"
            variant={activeCategory === cat ? 'default' : 'outline'}
            onClick={() => setActiveCategory(cat)}
            disabled={!categoryCounts.get(cat)}
          >
            {REPORT_CATEGORY_LABELS[cat]} ({categoryCounts.get(cat) || 0})
          </Button>
        ))}
      </div>

      {visibleReports.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No reports here yet — this category is on the roadmap for a later phase.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleReports.map((r) => <ReportCard key={r.key} report={r} />)}
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
