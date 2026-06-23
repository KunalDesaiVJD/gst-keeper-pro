import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { FileSpreadsheet, Download, Loader2, Pause, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import {
  generateSuspendedLedgerReport,
  generateCreditLedgerReport,
} from '@/utils/allClientsReports';

interface ReportDef {
  key: string;
  title: string;
  description: string;
  icon: React.ElementType;
  run: (month: string) => Promise<void>;
}

const REPORTS: ReportDef[] = [
  {
    key: 'suspended-ledger',
    title: 'Suspended Ledger — Closing Balance',
    description:
      'For the selected month, one row per client showing the Suspended Reco closing balance per Portal (Opening + Current Total) vs per Books, with the Difference column. Use this to spot which clients have unreconciled suspended ITC.',
    icon: Pause,
    run: generateSuspendedLedgerReport,
  },
  {
    key: 'credit-ledger',
    title: 'Credit Ledger — Closing Balance',
    description:
      'For the selected month, one row per client showing the GST Receivable (Credit Ledger) closing per Portal vs per Books, plus the GST Payable (cash) column for clients whose output exceeded available ITC.',
    icon: Wallet,
    run: generateCreditLedgerReport,
  },
];

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

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

  const handleDownload = async (report: ReportDef) => {
    if (!selectedMonth) {
      toast.error('Please select a month first.');
      return;
    }
    setBusyKey(report.key);
    try {
      await report.run(selectedMonth);
      toast.success(`${report.title} downloaded.`);
    } catch (err: any) {
      toast.error(`Failed to generate report: ${err.message || 'Unknown error'}`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Reports</h1>
          <p className="text-muted-foreground">Cross-client Excel reports for a selected period</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
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
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {REPORTS.map(report => {
          const Icon = report.icon;
          const busy = busyKey === report.key;
          return (
            <Card key={report.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  {report.title}
                </CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => handleDownload(report)} disabled={!selectedMonth || busy}>
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Download Excel
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ReportsPage;
