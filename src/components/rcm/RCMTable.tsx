import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

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
  onDataChange: (data: RCMDataRow[]) => void;
  isLocked?: boolean;
  isStaff: boolean;
}

const formatNumber = (num: number): string => {
  if (num === 0 || !num) return '-';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const RCMTable: React.FC<RCMTableProps> = ({
  data,
  masters,
  months,
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
    const defaultMaster = masters[0];
    onDataChange([
      ...data,
      {
        master_id: defaultMaster?.id,
        particulars: defaultMaster?.expense_name || '',
        rate: defaultMaster?.rate || '5%',
        supply_type: defaultMaster?.supply_type || 'intrastate',
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

  return (
    <div className="space-y-4">
      <ScrollArea className="w-full">
        <div className="min-w-[1400px]">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                <TableHead className="w-48 font-bold text-white border border-[#2E5A6B]">Particulars</TableHead>
                <TableHead className="w-24 font-bold text-white text-center border border-[#2E5A6B]">RATE</TableHead>
                {months.map((month) => (
                  <TableHead key={month} className="w-20 font-bold text-white text-center border border-[#2E5A6B]">
                    {month}
                  </TableHead>
                ))}
                <TableHead className="w-24 font-bold text-white text-center border border-[#2E5A6B]">TOTAL</TableHead>
                {isStaff && !isLocked && (
                  <TableHead className="w-12 text-center font-bold text-white border border-[#2E5A6B]"></TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, index) => (
                <TableRow key={row.id || `new-${index}`} className="hover:bg-muted/50">
                  <TableCell className="border border-border">
                    {isStaff && !isLocked ? (
                      <Select
                        value={row.master_id || masters.find((m) => m.expense_name === row.particulars)?.id || ''}
                        onValueChange={(val) => handleParticularsChange(index, val)}
                      >
                        <SelectTrigger className="h-8 border-0 shadow-none">
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
                  </TableCell>
                  <TableCell className="text-center border border-border font-medium">
                    {row.rate}
                  </TableCell>
                  {months.map((month) => (
                    <TableCell key={month} className="p-0 border border-border">
                      {isStaff && !isLocked ? (
                        <Input
                          type="number"
                          value={row.monthlyValues[month] || ''}
                          onChange={(e) => handleMonthValueChange(index, month, e.target.value)}
                          className="h-8 text-right border-0 shadow-none rounded-none [&::-webkit-inner-spin-button]:appearance-none"
                          min="0"
                        />
                      ) : (
                        <span className="block text-right px-2">
                          {formatNumber(row.monthlyValues[month] || 0)}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(getRowTotal(row))}
                  </TableCell>
                  {isStaff && !isLocked && (
                    <TableCell className="text-center border border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteRow(index)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}

              {/* Totals Row */}
              <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4] font-bold">
                <TableCell className="text-center text-white border border-[#2E5A6B]">TOTAL</TableCell>
                <TableCell className="text-center text-white border border-[#2E5A6B]">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right text-white border border-[#2E5A6B]">
                    {formatNumber(getMonthTotal(month))}
                  </TableCell>
                ))}
                <TableCell className="text-right text-white border border-[#2E5A6B]">
                  {formatNumber(getGrandTotal())}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-[#2E5A6B]" />}
              </TableRow>

              {/* Empty Row for spacing */}
              <TableRow className="h-4 hover:bg-transparent">
                <TableCell colSpan={months.length + 4} className="border-0"></TableCell>
              </TableRow>

              {/* GST Summary Rows */}
              {/* CGST 2.5% */}
              <TableRow className="hover:bg-muted/50">
                <TableCell className="font-medium border border-border">CGST 2.5%</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getGSTForMonth(month, 'cgst_2_5'))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium border border-border bg-muted/30">
                  {formatNumber(getGSTTotal('cgst_2_5'))}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* SGST 2.5% */}
              <TableRow className="hover:bg-muted/50">
                <TableCell className="font-medium border border-border">SGST 2.5%</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getGSTForMonth(month, 'sgst_2_5'))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium border border-border bg-muted/30">
                  {formatNumber(getGSTTotal('sgst_2_5'))}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* CGST 9% */}
              <TableRow className="hover:bg-muted/50">
                <TableCell className="font-medium border border-border">CGST 9%</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getGSTForMonth(month, 'cgst_9'))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium border border-border bg-muted/30">
                  {formatNumber(getGSTTotal('cgst_9'))}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* SGST 9% */}
              <TableRow className="hover:bg-muted/50">
                <TableCell className="font-medium border border-border">SGST 9%</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getGSTForMonth(month, 'sgst_9'))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium border border-border bg-muted/30">
                  {formatNumber(getGSTTotal('sgst_9'))}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* IGST 18% */}
              <TableRow className="hover:bg-muted/50">
                <TableCell className="font-medium border border-border">IGST 18%</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getGSTForMonth(month, 'igst_18'))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium border border-border bg-muted/30">
                  {formatNumber(getGSTTotal('igst_18'))}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* IGST 5% */}
              <TableRow className="hover:bg-muted/50">
                <TableCell className="font-medium border border-border">IGST 5%</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getGSTForMonth(month, 'igst_5'))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium border border-border bg-muted/30">
                  {formatNumber(getGSTTotal('igst_5'))}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* Empty Row for spacing */}
              <TableRow className="h-4 hover:bg-transparent">
                <TableCell colSpan={months.length + 4} className="border-0"></TableCell>
              </TableRow>

              {/* TOTAL (CGST) */}
              <TableRow className="bg-emerald-100 hover:bg-emerald-100 font-bold">
                <TableCell className="font-bold border border-border">TOTAL (CGST)</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getTotalCGSTForMonth(month))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-bold border border-border">
                  {formatNumber(getGrandTotalCGST())}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* TOTAL (SGST) */}
              <TableRow className="bg-emerald-100 hover:bg-emerald-100 font-bold">
                <TableCell className="font-bold border border-border">TOTAL (SGST)</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getTotalSGSTForMonth(month))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-bold border border-border">
                  {formatNumber(getGrandTotalSGST())}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>

              {/* TOTAL (IGST) */}
              <TableRow className="bg-emerald-100 hover:bg-emerald-100 font-bold">
                <TableCell className="font-bold border border-border">TOTAL (IGST)</TableCell>
                <TableCell className="text-center border border-border">-</TableCell>
                {months.map((month) => (
                  <TableCell key={month} className="text-right border border-border">
                    {formatNumber(getTotalIGSTForMonth(month))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-bold border border-border">
                  {formatNumber(getGrandTotalIGST())}
                </TableCell>
                {isStaff && !isLocked && <TableCell className="border border-border" />}
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {isStaff && !isLocked && (
        <Button onClick={handleAddRow} variant="outline" className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          Add Row
        </Button>
      )}
    </div>
  );
};

export default RCMTable;
