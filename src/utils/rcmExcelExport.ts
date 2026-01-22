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

  // Calculate totals
  const totals: (string | number)[] = ['TOTAL', '-'];
  months.forEach((month) => {
    const monthTotal = data.reduce((sum, row) => sum + (row.monthlyValues[month] || 0), 0);
    totals.push(monthTotal || '-');
  });
  const grandTotal = data.reduce((sum, row) => {
    return sum + Object.values(row.monthlyValues).reduce((s, v) => s + (v || 0), 0);
  }, 0);
  totals.push(grandTotal || '-');

  // Combine all rows
  const wsData = [
    [`Name of Client : ${clientName}`],
    [],
    headers,
    ...rows,
    totals,
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
