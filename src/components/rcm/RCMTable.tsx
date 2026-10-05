import React from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Trash2, Plus, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WS_CELL_INPUT, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_HEADING, WS_TR_TOTAL,
} from '@/components/workspace/theme';

interface RCMMaster {
  id: string;
  expense_name: string;
  rate: string;
  supply_type: string;
}

interface RCMMonthlyData {
  [month: string]: number;
}

interface RCMDataRow {
  id?: string;
  master_id?: string;
  particulars: string;
  rate: string;
  supply_type: string;
  monthlyValues: RCMMonthlyData;
  isNew?: boolean;
}

interface RCMTableProps {
  data: RCMDataRow[];
  masters: RCMMaster[];
  months: string[];
  lockedMonths?: Set<string>;
  onDataChange: (data: RCMDataRow[]) => void;
  isLocked?: boolean;
  isStaff: boolean;
}

const formatNumber = (num: number): string => {
  // Handle -0 and 0 cases
  if (num === 0 || Object.is(num, -0) || !num) return '-';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const RCMTable: React.FC<RCMTableProps> = ({
  data,
  masters,
  months,
  lockedMonths = new Set(),
  onDataChange,
  isLocked = false,
  isStaff,
}) => {
  const handleParticularsChange = (index: number, masterId: string) => {
    const master = masters.find((m) => m.id === masterId);
    if (!master) return;

    const newData = [...data];
    newData[index] = {
      ...newData[index],
      master_id: master.id,
      particulars: master.expense_name,
      rate: master.rate,
      supply_type: master.supply_type,
    };
    onDataChange(newData);
  };

  const handleMonthValueChange = (index: number, month: string, value: string) => {
    // Check if month is locked
    if (lockedMonths.has(month)) return;

    const numValue = parseFloat(value) || 0;
    const newData = [...data];
    newData[index] = {
      ...newData[index],
      monthlyValues: {
        ...newData[index].monthlyValues,
        [month]: numValue,
      },
    };
    onDataChange(newData);
  };

  const handleAddRow = () => {
    // Add a blank row by default
    onDataChange([
      ...data,
      {
        master_id: undefined,
        particulars: '',
        rate: '5%',
        supply_type: 'intrastate',
        monthlyValues: {},
        isNew: true,
      },
    ]);
  };

  const handleDeleteRow = (index: number) => {
    const newData = data.filter((_, i) => i !== index);
    onDataChange(newData);
  };

  // Calculate row total
  const getRowTotal = (row: RCMDataRow): number => {
    return Object.values(row.monthlyValues).reduce((sum, val) => sum + (val || 0), 0);
  };

  // Calculate column totals
  const getMonthTotal = (month: string): number => {
    return data.reduce((sum, row) => sum + (row.monthlyValues[month] || 0), 0);
  };

  const getGrandTotal = (): number => {
    return data.reduce((sum, row) => sum + getRowTotal(row), 0);
  };

  // GST Calculation functions
  const getGSTForMonth = (month: string, gstType: 'cgst_2_5' | 'sgst_2_5' | 'cgst_9' | 'sgst_9' | 'igst_5' | 'igst_18'): number => {
    return data.reduce((sum, row) => {
      const taxableValue = row.monthlyValues[month] || 0;
      const rate = row.rate;
      const supplyType = row.supply_type;
      
      if (taxableValue === 0) return sum;
      
      // Intrastate 5% -> CGST 2.5% + SGST 2.5%
      if (supplyType === 'intrastate' && rate === '5%') {
        if (gstType === 'cgst_2_5') return sum + (taxableValue * 0.025);
        if (gstType === 'sgst_2_5') return sum + (taxableValue * 0.025);
      }
      
      // Intrastate 18% -> CGST 9% + SGST 9%
      if (supplyType === 'intrastate' && rate === '18%') {
        if (gstType === 'cgst_9') return sum + (taxableValue * 0.09);
        if (gstType === 'sgst_9') return sum + (taxableValue * 0.09);
      }
      
      // Interstate 5% -> IGST 5%
      if (supplyType === 'interstate' && rate === '5%') {
        if (gstType === 'igst_5') return sum + (taxableValue * 0.05);
      }
      
      // Interstate 18% -> IGST 18%
      if (supplyType === 'interstate' && rate === '18%') {
        if (gstType === 'igst_18') return sum + (taxableValue * 0.18);
      }
      
      return sum;
    }, 0);
  };

  const getGSTTotal = (gstType: 'cgst_2_5' | 'sgst_2_5' | 'cgst_9' | 'sgst_9' | 'igst_5' | 'igst_18'): number => {
    return months.reduce((sum, month) => sum + getGSTForMonth(month, gstType), 0);
  };

  const getTotalCGSTForMonth = (month: string): number => {
    return getGSTForMonth(month, 'cgst_2_5') + getGSTForMonth(month, 'cgst_9');
  };

  const getTotalSGSTForMonth = (month: string): number => {
    return getGSTForMonth(month, 'sgst_2_5') + getGSTForMonth(month, 'sgst_9');
  };

  const getTotalIGSTForMonth = (month: string): number => {
    return getGSTForMonth(month, 'igst_5') + getGSTForMonth(month, 'igst_18');
  };

  const getGrandTotalCGST = (): number => {
    return months.reduce((sum, month) => sum + getTotalCGSTForMonth(month), 0);
  };

  const getGrandTotalSGST = (): number => {
    return months.reduce((sum, month) => sum + getTotalSGSTForMonth(month), 0);
  };

  const getGrandTotalIGST = (): number => {
    return months.reduce((sum, month) => sum + getTotalIGSTForMonth(month), 0);
  };

  const isMonthLocked = (month: string): boolean => {
    return lockedMonths.has(month);
  };

  const canEditRows = isStaff && !isLocked;
  const colCount = months.length + 3 + (canEditRows ? 1 : 0);

  // One computed row (tax head or tax total): label, "—" rate, a figure per month, the year total.
  const figureRow = (label: string, perMonth: (month: string) => number, total: number, className: string = WS_TR) => (
    <tr className={className}>
      <td className={cn(WS_TD, 'font-medium')}>{label}</td>
      <td className={cn(WS_TD, 'text-center text-muted-foreground')}>—</td>
      {months.map((month) => (
        <td key={month} className={WS_TD_NUM}>{formatNumber(perMonth(month))}</td>
      ))}
      <td className={cn(WS_TD_NUM, 'bg-muted/40 font-semibold', !canEditRows && 'border-r-0')}>{formatNumber(total)}</td>
      {canEditRows && <td className={cn(WS_TD, 'border-r-0')} />}
    </tr>
  );

  const headingRow = (label: string) => (
    <tr className={WS_TR_HEADING}>
      <td colSpan={colCount} className={cn(WS_TD, 'border-r-0')}>{label}</td>
    </tr>
  );

  return (
    <div className="space-y-2">
      <div className={cn(WS_TABLE_WRAP, 'max-h-[70vh]')}>
        <table className={cn(WS_TABLE, 'min-w-[1400px]')} aria-label="RCM summary">
          <thead>
            <tr>
              <th className={cn(WS_TH, 'w-56')}>
                <div className="flex items-center justify-between gap-2">
                  <span>Particulars</span>
                  {canEditRows && (
                    <Button
                      onClick={handleAddRow}
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[11px] font-medium"
                    >
                      <Plus className="h-3 w-3" />
                      Add row
                    </Button>
                  )}
                </div>
              </th>
              <th className={cn(WS_TH, 'w-20 text-center')}>Rate</th>
              {months.map((month) => (
                <th key={month} className={cn(WS_TH, 'w-24 text-right')}>
                  <span className="inline-flex items-center justify-end gap-1">
                    {isMonthLocked(month) && <Lock className="h-3 w-3" aria-label="Locked" />}
                    {month}
                  </span>
                </th>
              ))}
              <th className={cn(WS_TH, 'w-28 text-right', !canEditRows && 'border-r-0')}>Total</th>
              {canEditRows && (
                <th className={cn(WS_TH, 'w-10 border-r-0')} aria-label="Delete row" />
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={row.id || `new-${index}`} className={WS_TR}>
                <td className={cn(WS_TD, canEditRows && 'p-0')}>
                  {canEditRows ? (
                    <Select
                      value={row.master_id || masters.find((m) => m.expense_name === row.particulars)?.id || ''}
                      onValueChange={(val) => handleParticularsChange(index, val)}
                    >
                      <SelectTrigger className="h-8 rounded-none border-0 bg-transparent px-2 text-xs shadow-none" aria-label="Expense">
                        <SelectValue placeholder="Select expense" />
                      </SelectTrigger>
                      <SelectContent>
                        {masters.map((master) => (
                          <SelectItem key={master.id} value={master.id}>
                            {master.expense_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span>{row.particulars}</span>
                  )}
                </td>
                <td className={cn(WS_TD, 'text-center font-medium')}>
                  {row.rate}
                </td>
                {months.map((month) => {
                  const monthIsLocked = isMonthLocked(month);
                  const editable = canEditRows && !monthIsLocked;
                  return (
                    <td
                      key={month}
                      className={cn(
                        editable ? cn(WS_TD, 'bg-primary/[0.03] p-0') : WS_TD_NUM,
                        monthIsLocked && 'bg-muted/40 text-muted-foreground',
                      )}
                    >
                      {editable ? (
                        <Input
                          type="number"
                          value={row.monthlyValues[month] || ''}
                          onChange={(e) => handleMonthValueChange(index, month, e.target.value)}
                          className={cn(WS_CELL_INPUT, 'text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none')}
                          aria-label={`${row.particulars || 'Expense'} ${month}`}
                          min="0"
                        />
                      ) : (
                        formatNumber(row.monthlyValues[month] || 0)
                      )}
                    </td>
                  );
                })}
                <td className={cn(WS_TD_NUM, 'bg-muted/40 font-medium', !canEditRows && 'border-r-0')}>
                  {formatNumber(getRowTotal(row))}
                </td>
                {canEditRows && (
                  <td className={cn(WS_TD, 'border-r-0 p-0 text-center')}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteRow(index)}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      aria-label="Delete row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}

            {/* Totals Row */}
            {figureRow('Total taxable value', getMonthTotal, getGrandTotal(), WS_TR_TOTAL)}

            {/* GST Summary Rows */}
            {headingRow('Tax payable under RCM, by rate')}
            {figureRow('CGST 2.5%', (m) => getGSTForMonth(m, 'cgst_2_5'), getGSTTotal('cgst_2_5'))}
            {figureRow('SGST 2.5%', (m) => getGSTForMonth(m, 'sgst_2_5'), getGSTTotal('sgst_2_5'))}
            {figureRow('CGST 9%', (m) => getGSTForMonth(m, 'cgst_9'), getGSTTotal('cgst_9'))}
            {figureRow('SGST 9%', (m) => getGSTForMonth(m, 'sgst_9'), getGSTTotal('sgst_9'))}
            {figureRow('IGST 18%', (m) => getGSTForMonth(m, 'igst_18'), getGSTTotal('igst_18'))}
            {figureRow('IGST 5%', (m) => getGSTForMonth(m, 'igst_5'), getGSTTotal('igst_5'))}

            {/* Tax totals */}
            {headingRow('Tax payable under RCM, by head')}
            {figureRow('Total (CGST)', getTotalCGSTForMonth, getGrandTotalCGST(), WS_TR_TOTAL)}
            {figureRow('Total (SGST)', getTotalSGSTForMonth, getGrandTotalSGST(), WS_TR_TOTAL)}
            {figureRow('Total (IGST)', getTotalIGSTForMonth, getGrandTotalIGST(), WS_TR_TOTAL)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RCMTable;
