import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface ClearDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: '2B Reconciliation' | 'ITC Summary' | 'Suspended Reco' | 'RCM Summary';
  clientId: string;
  clientName: string;
  onCleared?: () => void;
}

const generateFinancialYears = (): string[] => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const currentFY = currentMonth < 3 ? currentYear - 1 : currentYear;
  const years: string[] = [];
  for (let i = -3; i <= 2; i++) {
    const startYear = currentFY + i;
    const endYear = startYear + 1;
    years.push(`${startYear}-${String(endYear).slice(-2)}`);
  }
  return years;
};

const ClearDataDialog: React.FC<ClearDataDialogProps> = ({
  open,
  onOpenChange,
  module,
  clientId,
  clientName,
  onCleared,
}) => {
  const { user } = useAuth();
  const [selectedFY, setSelectedFY] = useState<string>('');
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const financialYears = useMemo(() => generateFinancialYears(), []);

  // Parse FY to date range: "2025-26" → Apr 1 2025 to Mar 31 2026
  const getFYDateRange = (fy: string): { startMonth: string; endMonth: string; months: string[] } => {
    const [startYearStr] = fy.split('-');
    const startYear = parseInt(startYearStr);
    const endYear = startYear + 1;
    
    // Generate all months in MM/YYYY format
    const months: string[] = [];
    for (let m = 4; m <= 12; m++) {
      months.push(`${String(m).padStart(2, '0')}/${startYear}`);
    }
    for (let m = 1; m <= 3; m++) {
      months.push(`${String(m).padStart(2, '0')}/${endYear}`);
    }
    
    return {
      startMonth: `04/${startYear}`,
      endMonth: `03/${endYear}`,
      months,
    };
  };

  // Generate RCM month format: "Apr-25", "May-25", etc.
  const getRCMMonths = (fy: string): string[] => {
    const [startYearStr] = fy.split('-');
    const startYear = parseInt(startYearStr);
    const endYear = startYear + 1;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const months: string[] = [];
    for (let m = 3; m <= 11; m++) { // Apr to Dec
      months.push(`${monthNames[m]}-${String(startYear).slice(-2)}`);
    }
    for (let m = 0; m <= 2; m++) { // Jan to Mar
      months.push(`${monthNames[m]}-${String(endYear).slice(-2)}`);
    }
    return months;
  };

  const handleClear = async () => {
    if (!selectedFY || confirmText !== 'CLEAR' || !clientId) return;

    setIsDeleting(true);
    try {
      const { months } = getFYDateRange(selectedFY);
      let totalDeleted = 0;

      if (module === '2B Reconciliation') {
        const { data: d1 } = await supabase
          .from('bills_not_in_2b')
          .delete()
          .eq('client_id', clientId)
          .in('period_month', months)
          .select('id');
        const { data: d2 } = await supabase
          .from('bills_not_in_books')
          .delete()
          .eq('client_id', clientId)
          .in('period_month', months)
          .select('id');
        totalDeleted = (d1?.length || 0) + (d2?.length || 0);
      } else if (module === 'ITC Summary') {
        const { data } = await supabase
          .from('itc_summaries')
          .delete()
          .eq('client_id', clientId)
          .in('period_month', months)
          .select('id');
        totalDeleted = data?.length || 0;
      } else if (module === 'Suspended Reco') {
        const { data } = await supabase
          .from('suspended_reco')
          .delete()
          .eq('client_id', clientId)
          .in('period_month', months)
          .select('id');
        totalDeleted = data?.length || 0;
      } else if (module === 'RCM Summary') {
        const rcmFY = selectedFY.replace('-', '-');
        // RCM uses "2025-26" format for financial_year
        const fullFY = `${selectedFY.split('-')[0]}-${String(parseInt(selectedFY.split('-')[0]) + 1).slice(-2)}`;
        const { data } = await supabase
          .from('rcm_data')
          .delete()
          .eq('client_id', clientId)
          .eq('financial_year', fullFY)
          .select('id');
        totalDeleted = data?.length || 0;
      }

      // Log to audit_log
      await supabase.from('audit_log').insert({
        user_id: user?.id,
        user_role: user?.role || 'unknown',
        client_id: clientId,
        client_name: clientName,
        module,
        action: 'clear_data',
        financial_year: selectedFY,
        records_deleted: totalDeleted,
      });

      toast.success(`Cleared ${totalDeleted} records from ${module} for FY ${selectedFY}`);
      setConfirmText('');
      setSelectedFY('');
      onOpenChange(false);
      onCleared?.();
    } catch (error: any) {
      toast.error('Failed to clear data: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Clear Data - {module}
          </DialogTitle>
          <DialogDescription>
            This will permanently delete all {module} data for <strong>{clientName}</strong> in the selected financial year.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Financial Year</label>
            <Select value={selectedFY} onValueChange={setSelectedFY}>
              <SelectTrigger>
                <SelectValue placeholder="Select Financial Year" />
              </SelectTrigger>
              <SelectContent>
                {financialYears.map(fy => (
                  <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedFY && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-destructive">⚠️ This action cannot be undone!</p>
              <p className="text-muted-foreground mt-1">
                All {module} records for {clientName} from Apr {selectedFY.split('-')[0]} to Mar {parseInt(selectedFY.split('-')[0]) + 1} will be permanently deleted.
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">
              Type <span className="font-mono text-destructive">CLEAR</span> to confirm
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type CLEAR"
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={confirmText !== 'CLEAR' || !selectedFY || isDeleting}
            onClick={handleClear}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {isDeleting ? 'Clearing...' : 'Clear Data'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ClearDataDialog;
