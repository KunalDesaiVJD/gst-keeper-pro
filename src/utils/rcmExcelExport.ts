import * as XLSX from 'xlsx';

interface RCMDataRow {
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
}

const MONTHS_ORDER = [
  'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
  'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'
];

export const exportRCMToExcel = (
  clientName: string,
  financialYear: string,
  data: RCMDataRow[]
): void => {
  // Group data by particulars for the summary view
  const groupedByParticulars = data.reduce((acc, row) => {
    if (!acc[row.particulars]) {
      acc[row.particulars] = {
        particulars: row.particulars,
        rate: row.rate,
        months: {} as Record<string, number>,
        total: 0,
      };
    }
    acc[row.particulars].months[row.month] = (acc[row.particulars].months[row.month] || 0) + row.taxable_value;
    acc[row.particulars].total += row.taxable_value;
    return acc;
  }, {} as Record<string, { particulars: string; rate: string; months: Record<string, number>; total: number }>);

  // Generate month columns based on financial year
  const [startYear, endYear] = financialYear.split('-').map((y) => parseInt(y));
  const fullStartYear = startYear < 100 ? 2000 + startYear : startYear;
  const fullEndYear = endYear < 100 ? 2000 + endYear : endYear;
  
  const monthColumns = MONTHS_ORDER.map((m, idx) => {
    const year = idx < 9 ? fullStartYear : fullEndYear;
    return `${m}-${String(year).slice(-2)}`;
  });

  // Create header rows
  const wsData: any[][] = [
    ['', '', '', '', '', '', '', '', '', '', '', '', 'ADD MASTER', 'FINANCIAL YEAR', financialYear],
    [],
    [`Name of Client : ${clientName}`],
    [],
    ['Particulars', 'RATE', ...monthColumns, 'TOTAL'],
  ];

  // Add data rows
  Object.values(groupedByParticulars).forEach((row) => {
    const monthValues = monthColumns.map((m) => row.months[m] || '-');
    wsData.push([row.particulars, row.rate, ...monthValues, row.total || '-']);
  });

  // Add total row
  const totals = monthColumns.map((m) =>
    Object.values(groupedByParticulars).reduce(
      (sum, row) => sum + (row.months[m] || 0),
      0
    ) || '-'
  );
  const grandTotal = Object.values(groupedByParticulars).reduce(
    (sum, row) => sum + row.total,
    0
  );
  wsData.push(['TOTAL', '', ...totals, grandTotal || '-']);

  // Add blank row
  wsData.push([]);

  // Calculate GST totals by month
  const gstTotals = {
    cgst_2_5: {} as Record<string, number>,
    sgst_2_5: {} as Record<string, number>,
    cgst_9: {} as Record<string, number>,
    sgst_9: {} as Record<string, number>,
    igst_5: {} as Record<string, number>,
    igst_18: {} as Record<string, number>,
  };

  data.forEach((row) => {
    gstTotals.cgst_2_5[row.month] = (gstTotals.cgst_2_5[row.month] || 0) + row.cgst_2_5;
    gstTotals.sgst_2_5[row.month] = (gstTotals.sgst_2_5[row.month] || 0) + row.sgst_2_5;
    gstTotals.cgst_9[row.month] = (gstTotals.cgst_9[row.month] || 0) + row.cgst_9;
    gstTotals.sgst_9[row.month] = (gstTotals.sgst_9[row.month] || 0) + row.sgst_9;
    gstTotals.igst_5[row.month] = (gstTotals.igst_5[row.month] || 0) + row.igst_5;
    gstTotals.igst_18[row.month] = (gstTotals.igst_18[row.month] || 0) + row.igst_18;
  });

  // Add GST summary rows
  const gstRows = [
    ['', 'CGST 2.5%', ...monthColumns.map((m) => gstTotals.cgst_2_5[m] || '-')],
    ['', 'SGST 2.5%', ...monthColumns.map((m) => gstTotals.sgst_2_5[m] || '-')],
    ['', 'CGST 9%', ...monthColumns.map((m) => gstTotals.cgst_9[m] || '-')],
    ['', 'SGST 9%', ...monthColumns.map((m) => gstTotals.sgst_9[m] || '-')],
    ['', 'IGST 5%', ...monthColumns.map((m) => gstTotals.igst_5[m] || '-')],
    ['', 'IGST 18%', ...monthColumns.map((m) => gstTotals.igst_18[m] || '-')],
    [],
    [
      '',
      'TOTAL (CGST)',
      ...monthColumns.map((m) => (gstTotals.cgst_2_5[m] || 0) + (gstTotals.cgst_9[m] || 0) || '-'),
    ],
    [
      '',
      'TOTAL (SGST)',
      ...monthColumns.map((m) => (gstTotals.sgst_2_5[m] || 0) + (gstTotals.sgst_9[m] || 0) || '-'),
    ],
    [
      '',
      'TOTAL (IGST)',
      ...monthColumns.map((m) => (gstTotals.igst_5[m] || 0) + (gstTotals.igst_18[m] || 0) || '-'),
    ],
  ];

  wsData.push(...gstRows);

  // Create workbook
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RCM Summary');

  // Set column widths
  ws['!cols'] = [
    { wch: 25 }, // Particulars
    { wch: 12 }, // Rate
    ...monthColumns.map(() => ({ wch: 10 })),
    { wch: 12 }, // Total
  ];

  // Save file
  const fileName = `RCM_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

export const importRCMFromExcel = (
  file: File,
  months: string[]
): Promise<RCMDataRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        const rows: RCMDataRow[] = [];
        let headerRowIndex = -1;

        // Find header row
        for (let i = 0; i < jsonData.length; i++) {
          if (jsonData[i][0] === 'Particulars' && jsonData[i][1] === 'RATE') {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex === -1) {
          throw new Error('Invalid Excel format - header row not found');
        }

        const headers = jsonData[headerRowIndex] as string[];
        const monthColumns = headers.slice(2, -1); // Skip Particulars, RATE, and TOTAL

        // Parse data rows
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row[0] || row[0] === 'TOTAL' || row[0] === '') break;

          const particulars = row[0] as string;
          const rate = (row[1] as string) || '5%';
          const supplyType = rate.includes('18') ? 'intrastate' : 'intrastate';

          // Create a row for each month with taxable value
          monthColumns.forEach((monthCol, idx) => {
            const taxableValue = parseFloat(row[idx + 2]) || 0;
            if (taxableValue > 0 && months.includes(monthCol)) {
              const baseRate = rate.includes('18') ? 18 : 5;
              const halfRate = baseRate / 2;
              const gstAmount = (taxableValue * halfRate) / 100;

              rows.push({
                particulars,
                rate,
                supply_type: supplyType,
                taxable_value: taxableValue,
                cgst_2_5: baseRate === 5 ? gstAmount : 0,
                cgst_9: baseRate === 18 ? gstAmount : 0,
                sgst_2_5: baseRate === 5 ? gstAmount : 0,
                sgst_9: baseRate === 18 ? gstAmount : 0,
                igst_5: 0,
                igst_18: 0,
                month: monthCol,
              });
            }
          });
        }

        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};
