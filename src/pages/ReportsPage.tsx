import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { renderReportToExcel, fyMonthsForKey } from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORTS_CATALOG } from '@/lib/reportsCatalog';
import { ReportsBrowser } from '@/components/reports/ReportsBrowser';

interface ClientLite { id: string; name: string; gstin: string; }

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: string; format: 'xlsx' | 'pdf' } | null>(null);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => {
      setClients((data || []) as ClientLite[]);
    });
  }, []);

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const start = new Date(2024, 3, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const cur = new Date(start);
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

  const handleDownload = async (report: ReportDefinition, format: 'xlsx' | 'pdf') => {
    if ((report.needs === 'month' || report.needs === 'client+month') && !selectedMonth) {
      toast.error('Pick a month first.');
      return;
    }
    if ((report.needs === 'client+month' || report.needs === 'client') && !selectedClientId) {
      toast.error('Pick a client first.');
      return;
    }
    setBusy({ key: report.key, format });
    try {
      const table = await report.build({ month: selectedMonth, clientId: selectedClientId });
      if (format === 'xlsx') renderReportToExcel(table);
      else renderReportToPdf(table);
      toast.success(`${report.title} downloaded.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Reports"
        subtitle={`${REPORTS_CATALOG.length} reports — search, browse by category, or pin the ones you run every month`}
        icon={<FileSpreadsheet className="h-6 w-6" />}
      />
      <ReportsBrowser
        reports={REPORTS_CATALOG}
        monthOptions={monthOptions}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        clients={clients}
        selectedClientId={selectedClientId}
        onClientChange={setSelectedClientId}
        fyLabel={fyLabel}
        busy={busy}
        onDownload={handleDownload}
      />
    </div>
  );
};

export default ReportsPage;
