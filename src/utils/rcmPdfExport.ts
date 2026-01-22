import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

const formatNumber = (num: number): string => {
  if (!num || num === 0) return '-';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

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

    if (supplyType === 'intrastate' && rate === '5%') {
      if (gstType === 'cgst_2_5') return sum + taxableValue * 0.025;
      if (gstType === 'sgst_2_5') return sum + taxableValue * 0.025;
    }

    if (supplyType === 'intrastate' && rate === '18%') {
      if (gstType === 'cgst_9') return sum + taxableValue * 0.09;
      if (gstType === 'sgst_9') return sum + taxableValue * 0.09;
    }

    if (supplyType === 'interstate' && rate === '5%') {
      if (gstType === 'igst_5') return sum + taxableValue * 0.05;
    }

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

export const exportRCMToPDF = (
  clientName: string,
  gstin: string,
  financialYear: string,
  data: RCMDataRow[],
  months: string[]
): void => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('RCM Summary', 148.5, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Client: ${clientName}`, 14, 25);
  doc.text(`GSTIN: ${gstin}`, 14, 30);
  doc.text(`Financial Year: ${financialYear}`, 14, 35);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 250, 25);

  // Table headers
  const headers = ['Particulars', 'RATE', ...months, 'TOTAL'];

  // Table data - taxable values
  const tableData = data.map((row) => {
    const rowTotal = Object.values(row.monthlyValues).reduce((sum, val) => sum + (val || 0), 0);
    return [
      row.particulars,
      row.rate,
      ...months.map((m) => formatNumber(row.monthlyValues[m] || 0)),
      formatNumber(rowTotal),
    ];
  });

  // Totals row
  const totalsRow = ['TOTAL', '-'];
  months.forEach((month) => {
    const monthTotal = data.reduce((sum, row) => sum + (row.monthlyValues[month] || 0), 0);
    totalsRow.push(formatNumber(monthTotal));
  });
  const grandTotal = data.reduce((sum, row) => {
    return sum + Object.values(row.monthlyValues).reduce((s, v) => s + (v || 0), 0);
  }, 0);
  totalsRow.push(formatNumber(grandTotal));
  tableData.push(totalsRow);

  // Empty row
  tableData.push(['', '', ...months.map(() => ''), '']);

  // GST Detail Rows
  const cgst25Row = ['CGST 2.5%', '-'];
  months.forEach((m) => cgst25Row.push(formatNumber(getGSTForMonth(data, m, 'cgst_2_5'))));
  cgst25Row.push(formatNumber(getGSTTotal(data, months, 'cgst_2_5')));
  tableData.push(cgst25Row);

  const sgst25Row = ['SGST 2.5%', '-'];
  months.forEach((m) => sgst25Row.push(formatNumber(getGSTForMonth(data, m, 'sgst_2_5'))));
  sgst25Row.push(formatNumber(getGSTTotal(data, months, 'sgst_2_5')));
  tableData.push(sgst25Row);

  const cgst9Row = ['CGST 9%', '-'];
  months.forEach((m) => cgst9Row.push(formatNumber(getGSTForMonth(data, m, 'cgst_9'))));
  cgst9Row.push(formatNumber(getGSTTotal(data, months, 'cgst_9')));
  tableData.push(cgst9Row);

  const sgst9Row = ['SGST 9%', '-'];
  months.forEach((m) => sgst9Row.push(formatNumber(getGSTForMonth(data, m, 'sgst_9'))));
  sgst9Row.push(formatNumber(getGSTTotal(data, months, 'sgst_9')));
  tableData.push(sgst9Row);

  const igst18Row = ['IGST 18%', '-'];
  months.forEach((m) => igst18Row.push(formatNumber(getGSTForMonth(data, m, 'igst_18'))));
  igst18Row.push(formatNumber(getGSTTotal(data, months, 'igst_18')));
  tableData.push(igst18Row);

  const igst5Row = ['IGST 5%', '-'];
  months.forEach((m) => igst5Row.push(formatNumber(getGSTForMonth(data, m, 'igst_5'))));
  igst5Row.push(formatNumber(getGSTTotal(data, months, 'igst_5')));
  tableData.push(igst5Row);

  // Empty row before totals
  tableData.push(['', '', ...months.map(() => ''), '']);

  // GST Total Rows
  const totalCGSTRow = ['TOTAL (CGST)', '-'];
  months.forEach((m) => totalCGSTRow.push(formatNumber(getTotalCGSTForMonth(data, m))));
  totalCGSTRow.push(formatNumber(months.reduce((sum, m) => sum + getTotalCGSTForMonth(data, m), 0)));
  tableData.push(totalCGSTRow);

  const totalSGSTRow = ['TOTAL (SGST)', '-'];
  months.forEach((m) => totalSGSTRow.push(formatNumber(getTotalSGSTForMonth(data, m))));
  totalSGSTRow.push(formatNumber(months.reduce((sum, m) => sum + getTotalSGSTForMonth(data, m), 0)));
  tableData.push(totalSGSTRow);

  const totalIGSTRow = ['TOTAL (IGST)', '-'];
  months.forEach((m) => totalIGSTRow.push(formatNumber(getTotalIGSTForMonth(data, m))));
  totalIGSTRow.push(formatNumber(months.reduce((sum, m) => sum + getTotalIGSTForMonth(data, m), 0)));
  tableData.push(totalIGSTRow);

  // Generate table
  autoTable(doc, {
    head: [headers],
    body: tableData,
    startY: 42,
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [74, 144, 164],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 35, halign: 'left' },
      1: { cellWidth: 15, halign: 'center' },
    },
    didParseCell: (cellData) => {
      const rowIdx = cellData.row.index;
      const dataLength = data.length;
      
      // Style the main totals row
      if (rowIdx === dataLength) {
        cellData.cell.styles.fillColor = [74, 144, 164];
        cellData.cell.styles.textColor = 255;
        cellData.cell.styles.fontStyle = 'bold';
      }
      
      // Style GST total rows (TOTAL CGST, SGST, IGST)
      const gstTotalRowIndices = [dataLength + 9, dataLength + 10, dataLength + 11];
      if (gstTotalRowIndices.includes(rowIdx)) {
        cellData.cell.styles.fillColor = [187, 247, 208]; // emerald-100
        cellData.cell.styles.fontStyle = 'bold';
      }
      
      // Right-align numeric columns
      if (cellData.column.index >= 2) {
        cellData.cell.styles.halign = 'right';
      }
    },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128);
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' }
    );
  }

  // Download
  doc.save(`RCM_Summary_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}.pdf`);
};
