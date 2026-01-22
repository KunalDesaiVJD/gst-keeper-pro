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

  // Table data
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
    didParseCell: (data) => {
      // Style the totals row
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fillColor = [74, 144, 164];
        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = 'bold';
      }
      // Right-align numeric columns
      if (data.column.index >= 2) {
        data.cell.styles.halign = 'right';
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
