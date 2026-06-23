import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { FileSpreadsheet, FileDown, Loader2, Pause, Wallet, Users, User } from 'lucide-react';
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
  type ReportTable,
} from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';

interface ClientLite { id: string; name: string; gstin: string; }

type ReportKey = 'sus-all' | 'cred-all' | 'sus-one' | 'cred-one';

interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  icon: React.ElementType;
  needs: 'month' | 'client+month';
  build: (args: { month: string; clientId?: string }) => Promise<ReportTable>;
}

const REPORTS: ReportDef[] = [
  {
    key: 'sus-all',
    title: 'Suspended Ledger — All Clients',
    description: 'One row per client showing the suspended ITC closing balance for the selected month.',
    icon: Pause,
    needs: 'month',
    build: ({ month }) => buildSuspendedClosingAllClients(month),
  },
  {
    key: 'cred-all',
    title: 'Credit Ledger — All Clients',
    description: 'One row per client showing the GST Receivable (Credit Ledger) closing balance for the selected month, plus any cash GST payable.',
    icon: Wallet,
    needs: 'month',
    build: ({ month }) => buildCreditClosingAllClients(month),
  },
  {
    key: 'sus-one',
    title: 'Suspended Ledger — One Client × All Months',
    description: 'For the picked client, suspended ITC closing balance per month across the financial year of the selected month.',
    icon: Pause,
    needs: 'client+month',
    build: ({ clientId, month }) => buildSuspendedClosingPerClient(clientId!, month),
  },
  {
    key: 'cred-one',
    title: 'Credit Ledger — One Client × All Months',
    description: 'For the picked client, Credit Ledger closing balance per month across the financial year of the selected month, plus cash GST payable.',
    icon: Wallet,
    needs: 'client+month',
    build: ({ clientId, month }) => buildCreditClosingPerClient(clientId!, month),
  },
];

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: ReportKey; format: 'xlsx' | 'pdf' } | null>(null);

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

  const handleDownload = async (report: ReportDef, format: 'xlsx' | 'pdf') => {
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

  const ReportCard: React.FC<{ report: ReportDef }> = ({ report }) => {
    const Icon = report.icon;
    const xlsxBusy = busy?.key === report.key && busy.format === 'xlsx';
    const pdfBusy = busy?.key === report.key && busy.format === 'pdf';
    const needsClient = report.needs === 'client+month';
    const isDisabled = !selectedMonth || (needsClient && !selectedClientId);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {report.title}
          </CardTitle>
          <CardDescription>{report.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          <Button onClick={() => handleDownload(report, 'xlsx')} disabled={isDisabled || xlsxBusy} variant="default">
            {xlsxBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            Excel
          </Button>
          <Button onClick={() => handleDownload(report, 'pdf')} disabled={isDisabled || pdfBusy} variant="outline">
            {pdfBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
            PDF
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Reports</h1>
          <p className="text-muted-foreground">Cross-client and per-client closing-balance reports</p>
        </div>
      </div>

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

      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <Users className="h-4 w-4" /> Cross-Client Reports (per month)
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {REPORTS.filter(r => r.needs === 'month').map(r => <ReportCard key={r.key} report={r} />)}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <User className="h-4 w-4" /> Per-Client Reports (full FY)
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {REPORTS.filter(r => r.needs === 'client+month').map(r => <ReportCard key={r.key} report={r} />)}
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
