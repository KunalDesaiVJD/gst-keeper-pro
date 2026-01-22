import * as XLSX from 'xlsx';

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

interface RCMMaster {
  id: string;
  expense_name: string;
  rate: string;
  supply_type: string;
}

// GST Calculation helper functions
const getGSTForMonth = (
  data: RCMDataRow[],
  month: string,
  gstType: 'cgst_2_5' | 'sgst_2_5' | 'cgst_9' | 'sgst_9' | 'igst_5' | 'igst_18'
): number => {
  return data.reduce((sum, row) => {
    const taxableValue = row.monthlyValues[month] || 0;
    const rate = row.rate;
    const supplyType = row.supply_type;

    if (taxableValue === 0) return sum;

    // Intrastate 5% -> CGST 2.5% + SGST 2.5%
    if (supplyType === 'intrastate' && rate === '5%') {
      if (gstType === 'cgst_2_5') return sum + taxableValue * 0.025;
      if (gstType === 'sgst_2_5') return sum + taxableValue * 0.025;
    }

    // Intrastate 18% -> CGST 9% + SGST 9%
    if (supplyType === 'intrastate' && rate === '18%') {
      if (gstType === 'cgst_9') return sum + taxableValue * 0.09;
      if (gstType === 'sgst_9') return sum + taxableValue * 0.09;
    }

    // Interstate 5% -> IGST 5%
    if (supplyType === 'interstate' && rate === '5%') {
      if (gstType === 'igst_5') return sum + taxableValue * 0.05;
    }

    // Interstate 18% -> IGST 18%
    if (supplyType === 'interstate' && rate === '18%') {
      if (gstType === 'igst_18') return sum + taxableValue * 0.18;
    }

    return sum;
  }, 0);
};

const getGSTTotal = (
  data: RCMDataRow[],
  months: string[],
  gstType: 'cgst_2_5' | 'sgst_2_5' | 'cgst_9' | 'sgst_9' | 'igst_5' | 'igst_18'
): number => {
  return months.reduce((sum, month) => sum + getGSTForMonth(data, month, gstType), 0);
};

const getTotalCGSTForMonth = (data: RCMDataRow[], month: string): number => {
  return getGSTForMonth(data, month, 'cgst_2_5') + getGSTForMonth(data, month, 'cgst_9');
};

const getTotalSGSTForMonth = (data: RCMDataRow[], month: string): number => {
  return getGSTForMonth(data, month, 'sgst_2_5') + getGSTForMonth(data, month, 'sgst_9');
};

const getTotalIGSTForMonth = (data: RCMDataRow[], month: string): number => {
  return getGSTForMonth(data, month, 'igst_5') + getGSTForMonth(data, month, 'igst_18');
};

const formatExcelValue = (num: number): string | number => {
  if (num === 0 || !num) return '-';
  return Math.round(num * 100) / 100;
};

export const exportRCMToExcel = (
  clientName: string,
  financialYear: string,
  data: RCMDataRow[],
  months: string[]
): void => {
  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();

  // Prepare header row
  const headers = ['Particulars', 'RATE', ...months, 'TOTAL'];

  // Prepare data rows
  const rows = data.map((row) => {
    const rowTotal = Object.values(row.monthlyValues).reduce((sum, val) => sum + (val || 0), 0);
    return [
      row.particulars,
      row.rate,
      ...months.map((m) => row.monthlyValues[m] || ''),
      rowTotal || '',
    ];
  });

  // Calculate taxable value totals
  const totals: (string | number)[] = ['TOTAL', '-'];
  months.forEach((month) => {
    const monthTotal = data.reduce((sum, row) => sum + (row.monthlyValues[month] || 0), 0);
    totals.push(monthTotal || '-');
  });
  const grandTotal = data.reduce((sum, row) => {
    return sum + Object.values(row.monthlyValues).reduce((s, v) => s + (v || 0), 0);
  }, 0);
  totals.push(grandTotal || '-');

  // GST Summary Rows
  const emptyRow: (string | number)[] = [];

  // Individual GST rates
  const cgst25Row: (string | number)[] = ['CGST 2.5%', '-'];
  months.forEach((month) => cgst25Row.push(formatExcelValue(getGSTForMonth(data, month, 'cgst_2_5'))));
  cgst25Row.push(formatExcelValue(getGSTTotal(data, months, 'cgst_2_5')));

  const sgst25Row: (string | number)[] = ['SGST 2.5%', '-'];
  months.forEach((month) => sgst25Row.push(formatExcelValue(getGSTForMonth(data, month, 'sgst_2_5'))));
  sgst25Row.push(formatExcelValue(getGSTTotal(data, months, 'sgst_2_5')));

  const cgst9Row: (string | number)[] = ['CGST 9%', '-'];
  months.forEach((month) => cgst9Row.push(formatExcelValue(getGSTForMonth(data, month, 'cgst_9'))));
  cgst9Row.push(formatExcelValue(getGSTTotal(data, months, 'cgst_9')));

  const sgst9Row: (string | number)[] = ['SGST 9%', '-'];
  months.forEach((month) => sgst9Row.push(formatExcelValue(getGSTForMonth(data, month, 'sgst_9'))));
  sgst9Row.push(formatExcelValue(getGSTTotal(data, months, 'sgst_9')));

  const igst18Row: (string | number)[] = ['IGST 18%', '-'];
  months.forEach((month) => igst18Row.push(formatExcelValue(getGSTForMonth(data, month, 'igst_18'))));
  igst18Row.push(formatExcelValue(getGSTTotal(data, months, 'igst_18')));

  const igst5Row: (string | number)[] = ['IGST 5%', '-'];
  months.forEach((month) => igst5Row.push(formatExcelValue(getGSTForMonth(data, month, 'igst_5'))));
  igst5Row.push(formatExcelValue(getGSTTotal(data, months, 'igst_5')));

  // GST Totals
  const totalCGSTRow: (string | number)[] = ['TOTAL (CGST)', '-'];
  months.forEach((month) => totalCGSTRow.push(formatExcelValue(getTotalCGSTForMonth(data, month))));
  totalCGSTRow.push(formatExcelValue(months.reduce((sum, m) => sum + getTotalCGSTForMonth(data, m), 0)));

  const totalSGSTRow: (string | number)[] = ['TOTAL (SGST)', '-'];
  months.forEach((month) => totalSGSTRow.push(formatExcelValue(getTotalSGSTForMonth(data, month))));
  totalSGSTRow.push(formatExcelValue(months.reduce((sum, m) => sum + getTotalSGSTForMonth(data, m), 0)));

  const totalIGSTRow: (string | number)[] = ['TOTAL (IGST)', '-'];
  months.forEach((month) => totalIGSTRow.push(formatExcelValue(getTotalIGSTForMonth(data, month))));
  totalIGSTRow.push(formatExcelValue(months.reduce((sum, m) => sum + getTotalIGSTForMonth(data, m), 0)));

  // Combine all rows
  const wsData = [
    [`Name of Client : ${clientName}`],
    [],
    headers,
    ...rows,
    totals,
    emptyRow,
    cgst25Row,
    sgst25Row,
    cgst9Row,
    sgst9Row,
    igst18Row,
    igst5Row,
    emptyRow,
    totalCGSTRow,
    totalSGSTRow,
    totalIGSTRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws['!cols'] = [
    { wch: 25 }, // Particulars
    { wch: 12 }, // RATE
    ...months.map(() => ({ wch: 10 })), // Month columns
    { wch: 12 }, // TOTAL
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'RCM Summary');

  // Download
  XLSX.writeFile(wb, `RCM_WORKING_${financialYear}.xlsx`);
};

export const importRCMFromExcel = async (
  file: File,
  months: string[],
  masters: RCMMaster[]
): Promise<RCMDataRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        // Find header row (row with "Particulars")
        let headerRowIndex = -1;
        for (let i = 0; i < jsonData.length; i++) {
          if (jsonData[i] && jsonData[i][0]?.toString().toLowerCase().includes('particulars')) {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex === -1) {
          throw new Error('Could not find header row with "Particulars"');
        }

        const headerRow = jsonData[headerRowIndex];
        const importedRows: RCMDataRow[] = [];

        // Process data rows
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || !row[0] || row[0].toString().toLowerCase() === 'total') continue;

          const particulars = row[0]?.toString().trim();
          const rate = row[1]?.toString().trim() || '5%';

          // Find matching master
          const master = masters.find(
            (m) => m.expense_name.toLowerCase() === particulars.toLowerCase()
          );

          // Build monthly values
          const monthlyValues: RCMMonthlyData = {};
          for (let j = 2; j < headerRow.length - 1; j++) {
            const monthHeader = headerRow[j]?.toString().trim();
            const matchedMonth = months.find((m) => m === monthHeader);
            if (matchedMonth && row[j]) {
              const value = parseFloat(row[j]) || 0;
              if (value > 0) {
                monthlyValues[matchedMonth] = value;
              }
            }
          }

          importedRows.push({
            master_id: master?.id,
            particulars: particulars,
            rate: master?.rate || rate,
            supply_type: master?.supply_type || 'intrastate',
            monthlyValues,
            isNew: true,
          });
        }

        resolve(importedRows);
      } catch (error: any) {
        reject(new Error(error.message || 'Failed to parse Excel file'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};
