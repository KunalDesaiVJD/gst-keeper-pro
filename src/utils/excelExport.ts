import * as XLSX from 'xlsx';
import { BillNotIn2B, BillNotInBooks } from '@/types';
import { format } from 'date-fns';

export const export2BToExcel = (
  clientName: string,
  month: string,
  billsNotIn2B: BillNotIn2B[],
  billsNotInBooks: BillNotInBooks[]
) => {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Bills Not Available in 2B
  const sheet1Data = [
    ['Bills Not Available in 2B'],
    ['Client: ' + clientName, '', '', '', '', '', '', '', 'Month: ' + month],
    [],
    ['Date', 'Supplier Name', 'Invoice No.', 'GSTIN', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Reversal Month', 'Reclaim Month'],
    ...billsNotIn2B.map(row => [
      format(new Date(row.date), 'dd/MM/yyyy'),
      row.supplierName,
      row.supplierInvoiceNumber,
      row.supplierGstin,
      row.taxableValue,
      row.inputIgst,
      row.inputCgst,
      row.inputSgst,
      row.reversalMonth,
      row.reclaimMonth || ''
    ]),
    [],
    ['TOTAL', '', '', '',
      billsNotIn2B.reduce((sum, r) => sum + r.taxableValue, 0),
      billsNotIn2B.reduce((sum, r) => sum + r.inputIgst, 0),
      billsNotIn2B.reduce((sum, r) => sum + r.inputCgst, 0),
      billsNotIn2B.reduce((sum, r) => sum + r.inputSgst, 0),
      '', ''
    ]
  ];

  const sheet1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  XLSX.utils.book_append_sheet(workbook, sheet1, 'Bills Not in 2B');

  // Sheet 2: Bills Not Available in Books
  const sheet2Data = [
    ['Bills Not Available in Books'],
    ['Client: ' + clientName, '', '', '', '', '', '', '', 'Month: ' + month],
    [],
    ['Date', 'Supplier Name', 'Invoice No.', 'GSTIN', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Book Entry Month', 'Bill in 2B Month'],
    ...billsNotInBooks.map(row => [
      format(new Date(row.date), 'dd/MM/yyyy'),
      row.supplierName,
      row.supplierInvoiceNumber,
      row.supplierGstin,
      row.taxableValue,
      row.inputIgst,
      row.inputCgst,
      row.inputSgst,
      row.bookEntryMonth,
      row.billIn2BMonth || ''
    ]),
    [],
    ['TOTAL', '', '', '',
      billsNotInBooks.reduce((sum, r) => sum + r.taxableValue, 0),
      billsNotInBooks.reduce((sum, r) => sum + r.inputIgst, 0),
      billsNotInBooks.reduce((sum, r) => sum + r.inputCgst, 0),
      billsNotInBooks.reduce((sum, r) => sum + r.inputSgst, 0),
      '', ''
    ]
  ];

  const sheet2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  XLSX.utils.book_append_sheet(workbook, sheet2, 'Bills Not in Books');

  // Download
  XLSX.writeFile(workbook, `2B_Running_Sheet_${clientName.replace(/\s+/g, '_')}_${month.replace('/', '-')}.xlsx`);
};

export const import2BFromExcel = (file: File): Promise<{ billsNotIn2B: Partial<BillNotIn2B>[]; billsNotInBooks: Partial<BillNotInBooks>[] }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const billsNotIn2B: Partial<BillNotIn2B>[] = [];
        const billsNotInBooks: Partial<BillNotInBooks>[] = [];

        // Parse first sheet (Bills Not in 2B)
        if (workbook.SheetNames.length > 0) {
          const sheet1 = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet1, { header: 1 }) as any[][];
          
          // Skip header rows (first 4 rows typically)
          for (let i = 4; i < rows.length; i++) {
            const row = rows[i];
            if (row && row[0] && row[0] !== 'TOTAL' && row[1]) {
              billsNotIn2B.push({
                date: parseExcelDate(row[0]),
                supplierName: String(row[1] || ''),
                supplierInvoiceNumber: String(row[2] || ''),
                supplierGstin: String(row[3] || ''),
                taxableValue: Number(row[4]) || 0,
                inputIgst: Number(row[5]) || 0,
                inputCgst: Number(row[6]) || 0,
                inputSgst: Number(row[7]) || 0,
                reversalMonth: String(row[8] || ''),
                reclaimMonth: String(row[9] || ''),
              });
            }
          }
        }

        // Parse second sheet (Bills Not in Books)
        if (workbook.SheetNames.length > 1) {
          const sheet2 = workbook.Sheets[workbook.SheetNames[1]];
          const rows = XLSX.utils.sheet_to_json(sheet2, { header: 1 }) as any[][];
          
          for (let i = 4; i < rows.length; i++) {
            const row = rows[i];
            if (row && row[0] && row[0] !== 'TOTAL' && row[1]) {
              billsNotInBooks.push({
                date: parseExcelDate(row[0]),
                supplierName: String(row[1] || ''),
                supplierInvoiceNumber: String(row[2] || ''),
                supplierGstin: String(row[3] || ''),
                taxableValue: Number(row[4]) || 0,
                inputIgst: Number(row[5]) || 0,
                inputCgst: Number(row[6]) || 0,
                inputSgst: Number(row[7]) || 0,
                bookEntryMonth: String(row[8] || ''),
                billIn2BMonth: String(row[9] || ''),
              });
            }
          }
        }

        resolve({ billsNotIn2B, billsNotInBooks });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

const parseExcelDate = (value: any): Date => {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date
    return new Date((value - 25569) * 86400 * 1000);
  }
  if (typeof value === 'string') {
    // Try DD/MM/YYYY format
    const parts = value.split('/');
    if (parts.length === 3) {
      return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    }
  }
  return new Date();
};
