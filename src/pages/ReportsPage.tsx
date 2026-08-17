import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { FileSpreadsheet, FileText, Loader2, Pause, Wallet, Search, Percent, ClipboardList, Hash, Users, AlertTriangle, History } from 'lucide-react';
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
    if (!selectedMonth) {
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
    const isDisabled = !selectedMonth || (needsClient && !selectedClientId);
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
