import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { FileSpreadsheet, FileText, Loader2, Pause, Wallet, Users, User, KeyRound, Eye, EyeOff } from 'lucide-react';
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
  buildClientCredentials,
  fetchClientCredentials,
  renderReportToExcel,
  fyMonthsForKey,
  type ReportTable,
  type ClientCredentialRow,
} from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';

interface ClientLite { id: string; name: string; gstin: string; }

type ReportKey = 'sus-all' | 'cred-all' | 'sus-one' | 'cred-one' | 'client-creds';

interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  icon: React.ElementType;
  needs: 'month' | 'client+month' | 'none';
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
  {
    key: 'client-creds',
    title: 'Client Login Credentials — All Clients',
    description: 'Every client with GSTIN, GST portal User ID and password. Reads the latest saved credentials each time you download.',
    icon: KeyRound,
    needs: 'none',
    build: () => buildClientCredentials(),
  },
];

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: ReportKey; format: 'xlsx' | 'pdf' } | null>(null);
  // Live credentials table: fetched on load and kept in sync via realtime so a
  // change made in Client master shows here without a page reload.
  const [creds, setCreds] = useState<ClientCredentialRow[]>([]);
  const [showPasswords, setShowPasswords] = useState(false);
  const [credSearch, setCredSearch] = useState('');

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => {
      setClients((data || []) as any);
    });
  }, []);

  const loadCreds = useCallback(() => {
    fetchClientCredentials().then(setCreds).catch(() => { /* surfaced on download */ });
  }, []);

  useEffect(() => {
    loadCreds();
    // Any insert/update/delete on clients (e.g. a credential edit in Client
    // master) re-pulls the list so this table stays current.
    const channel = supabase
      .channel('reports-client-credentials')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => loadCreds())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadCreds]);

  const filteredCreds = useMemo(() => {
    const q = credSearch.trim().toLowerCase();
    if (!q) return creds;
    return creds.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.gstin || '').toLowerCase().includes(q) ||
      (c.gst_user_id || '').toLowerCase().includes(q)
    );
  }, [creds, credSearch]);

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

  const ReportCard: React.FC<{ report: ReportDef }> = ({ report }) => {
    const Icon = report.icon;
    const xlsxBusy = busy?.key === report.key && busy.format === 'xlsx';
    const pdfBusy = busy?.key === report.key && busy.format === 'pdf';
    const needsClient = report.needs === 'client+month';
    const isDisabled = report.needs === 'none'
      ? false
      : (!selectedMonth || (needsClient && !selectedClientId));

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
        subtitle="Cross-client and per-client closing-balance reports"
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

      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <KeyRound className="h-4 w-4" /> Client Credentials
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {REPORTS.filter(r => r.needs === 'none').map(r => <ReportCard key={r.key} report={r} />)}
        </div>

        {/* Live on-screen table — every client, auto-updating on credential changes */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-primary" /> All Client Logins ({creds.length})
                </CardTitle>
                <CardDescription>Live view — updates automatically when credentials change in Client master.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-56">
                  <Input
                    placeholder="Search name / GSTIN / User ID..."
                    value={credSearch}
                    onChange={(e) => setCredSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowPasswords((v) => !v)}>
                  {showPasswords
                    ? <><EyeOff className="h-4 w-4 mr-1.5" /> Hide passwords</>
                    : <><Eye className="h-4 w-4 mr-1.5" /> Reveal passwords</>}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[60vh] rounded-md border border-border">
              <table className="w-full text-sm border-collapse min-w-[720px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-primary text-primary-foreground">
                    <th className="border border-primary-foreground/20 p-2 text-center w-10">#</th>
                    <th className="border border-primary-foreground/20 p-2 text-left">Client Name</th>
                    <th className="border border-primary-foreground/20 p-2 text-left">GSTIN</th>
                    <th className="border border-primary-foreground/20 p-2 text-left">GST User ID</th>
                    <th className="border border-primary-foreground/20 p-2 text-left">GST Password</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCreds.map((c, i) => (
                    <tr key={`${c.gstin || c.name}-${i}`} className="odd:bg-muted/30">
                      <td className="border border-border p-2 text-center tabular-nums">{i + 1}</td>
                      <td className="border border-border p-2 font-medium">{c.name}</td>
                      <td className="border border-border p-2 font-mono text-xs">{c.gstin || '—'}</td>
                      <td className="border border-border p-2 font-mono text-xs">{c.gst_user_id || '—'}</td>
                      <td className="border border-border p-2 font-mono text-xs">
                        {c.gst_password ? (showPasswords ? c.gst_password : '••••••••') : '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredCreds.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center p-6 text-muted-foreground">
                        {creds.length === 0 ? 'No clients found.' : 'No clients match your search.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ReportsPage;
