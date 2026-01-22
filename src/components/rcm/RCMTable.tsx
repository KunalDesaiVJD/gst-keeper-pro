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

interface RCMDataRow {
  id?: string;
  particulars: string;
  rate: string;
  supply_type: string;
  taxable_value: number;
  cgst_2_5: number;
  cgst_9: number;
  sgst_2_5: number;
  sgst_9: number;
  igst_5: number;
  igst_18: number;
  month: string;
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

const calculateGST = (
  taxableValue: number,
  rate: string,
  supplyType: string
): Partial<RCMDataRow> => {
  const baseRate = rate.includes('18') ? 18 : 5;
  const isInterstate = supplyType === 'interstate';

  if (isInterstate) {
    return {
      cgst_2_5: 0,
      cgst_9: 0,
      sgst_2_5: 0,
      sgst_9: 0,
      igst_5: baseRate === 5 ? taxableValue * 0.05 : 0,
      igst_18: baseRate === 18 ? taxableValue * 0.18 : 0,
    };
  } else {
    const halfRate = baseRate / 2;
    const gstAmount = (taxableValue * halfRate) / 100;
    return {
      cgst_2_5: baseRate === 5 ? gstAmount : 0,
      cgst_9: baseRate === 18 ? gstAmount : 0,
      sgst_2_5: baseRate === 5 ? gstAmount : 0,
      sgst_9: baseRate === 18 ? gstAmount : 0,
      igst_5: 0,
      igst_18: 0,
    };
  }
};

const formatNumber = (num: number): string => {
  if (num === 0) return '-';
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
    const taxableValue = newData[index].taxable_value || 0;
    const gstValues = calculateGST(taxableValue, master.rate, master.supply_type);

    newData[index] = {
      ...newData[index],
      particulars: master.expense_name,
      rate: master.rate,
      supply_type: master.supply_type,
      ...gstValues,
    };
    onDataChange(newData);
  };

  const handleTaxableChange = (index: number, value: string) => {
    const numValue = parseFloat(value) || 0;
    const newData = [...data];
    const row = newData[index];
    const gstValues = calculateGST(numValue, row.rate, row.supply_type);

    newData[index] = {
      ...row,
      taxable_value: numValue,
      ...gstValues,
    };
    onDataChange(newData);
  };

  const handleMonthChange = (index: number, month: string) => {
    const newData = [...data];
    newData[index] = { ...newData[index], month };
    onDataChange(newData);
  };

  const handleAddRow = () => {
    const defaultMaster = masters[0];
    const defaultMonth = months[0] || '';
    onDataChange([
      ...data,
      {
        particulars: defaultMaster?.expense_name || '',
        rate: defaultMaster?.rate || '5%',
        supply_type: defaultMaster?.supply_type || 'intrastate',
        taxable_value: 0,
        cgst_2_5: 0,
        cgst_9: 0,
        sgst_2_5: 0,
        sgst_9: 0,
        igst_5: 0,
        igst_18: 0,
        month: defaultMonth,
        isNew: true,
      },
    ]);
  };

  const handleDeleteRow = (index: number) => {
    const newData = data.filter((_, i) => i !== index);
    onDataChange(newData);
  };

  // Calculate totals
  const totals = data.reduce(
    (acc, row) => ({
      taxable_value: acc.taxable_value + (row.taxable_value || 0),
      cgst_2_5: acc.cgst_2_5 + (row.cgst_2_5 || 0),
      cgst_9: acc.cgst_9 + (row.cgst_9 || 0),
      sgst_2_5: acc.sgst_2_5 + (row.sgst_2_5 || 0),
      sgst_9: acc.sgst_9 + (row.sgst_9 || 0),
      igst_5: acc.igst_5 + (row.igst_5 || 0),
      igst_18: acc.igst_18 + (row.igst_18 || 0),
    }),
    {
      taxable_value: 0,
      cgst_2_5: 0,
      cgst_9: 0,
      sgst_2_5: 0,
      sgst_9: 0,
      igst_5: 0,
      igst_18: 0,
    }
  );

  const totalCGST = totals.cgst_2_5 + totals.cgst_9;
  const totalSGST = totals.sgst_2_5 + totals.sgst_9;
  const totalIGST = totals.igst_5 + totals.igst_18;

  return (
    <div className="space-y-4">
      <ScrollArea className="w-full">
        <div className="min-w-[1200px]">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary/10">
                <TableHead className="w-12 text-center font-bold">Sr.</TableHead>
                <TableHead className="w-48 font-bold">Particulars</TableHead>
                <TableHead className="w-24 font-bold">Month</TableHead>
                <TableHead className="w-32 text-right font-bold">Taxable</TableHead>
                <TableHead className="w-24 text-center font-bold">Rate</TableHead>
                <TableHead className="w-28 text-right font-bold">CGST 2.5%</TableHead>
                <TableHead className="w-28 text-right font-bold">CGST 9%</TableHead>
                <TableHead className="w-28 text-right font-bold">SGST 2.5%</TableHead>
                <TableHead className="w-28 text-right font-bold">SGST 9%</TableHead>
                <TableHead className="w-28 text-right font-bold">IGST 5%</TableHead>
                <TableHead className="w-28 text-right font-bold">IGST 18%</TableHead>
                {isStaff && !isLocked && (
                  <TableHead className="w-16 text-center font-bold">Action</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, index) => (
                <TableRow key={row.id || `new-${index}`} className="hover:bg-muted/50">
                  <TableCell className="text-center font-medium">{index + 1}</TableCell>
                  <TableCell>
                    {isStaff && !isLocked ? (
                      <Select
                        value={masters.find((m) => m.expense_name === row.particulars)?.id || ''}
                        onValueChange={(val) => handleParticularsChange(index, val)}
                      >
                        <SelectTrigger className="h-8">
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
                  <TableCell>
                    {isStaff && !isLocked ? (
                      <Select
                        value={row.month}
                        onValueChange={(val) => handleMonthChange(index, val)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Month" />
                        </SelectTrigger>
                        <SelectContent>
                          {months.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span>{row.month}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isStaff && !isLocked ? (
                      <Input
                        type="number"
                        value={row.taxable_value || ''}
                        onChange={(e) => handleTaxableChange(index, e.target.value)}
                        className="h-8 text-right [&::-webkit-inner-spin-button]:appearance-none"
                        min="0"
                      />
                    ) : (
                      <span className="block text-right">
                        {formatNumber(row.taxable_value)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-xs">
                      {row.rate} {row.supply_type === 'interstate' ? 'Inter' : 'Intra'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(row.cgst_2_5)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.cgst_9)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.sgst_2_5)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.sgst_9)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.igst_5)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.igst_18)}</TableCell>
                  {isStaff && !isLocked && (
                    <TableCell className="text-center">
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
              <TableRow className="bg-primary/10 font-bold border-t-2">
                <TableCell className="text-center">-</TableCell>
                <TableCell>TOTAL</TableCell>
                <TableCell>-</TableCell>
                <TableCell className="text-right">{formatNumber(totals.taxable_value)}</TableCell>
                <TableCell>-</TableCell>
                <TableCell className="text-right">{formatNumber(totals.cgst_2_5)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.cgst_9)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.sgst_2_5)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.sgst_9)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.igst_5)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.igst_18)}</TableCell>
                {isStaff && !isLocked && <TableCell />}
              </TableRow>

              {/* Summary Rows */}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={5} className="text-right font-medium">
                  TOTAL (CGST)
                </TableCell>
                <TableCell colSpan={2} className="text-right font-bold text-primary">
                  {formatNumber(totalCGST)}
                </TableCell>
                <TableCell colSpan={isStaff && !isLocked ? 5 : 4} />
              </TableRow>
              <TableRow className="bg-muted/30">
                <TableCell colSpan={5} className="text-right font-medium">
                  TOTAL (SGST)
                </TableCell>
                <TableCell colSpan={2} />
                <TableCell colSpan={2} className="text-right font-bold text-primary">
                  {formatNumber(totalSGST)}
                </TableCell>
                <TableCell colSpan={isStaff && !isLocked ? 3 : 2} />
              </TableRow>
              <TableRow className="bg-muted/30">
                <TableCell colSpan={5} className="text-right font-medium">
                  TOTAL (IGST)
                </TableCell>
                <TableCell colSpan={4} />
                <TableCell colSpan={2} className="text-right font-bold text-primary">
                  {formatNumber(totalIGST)}
                </TableCell>
                {isStaff && !isLocked && <TableCell />}
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
