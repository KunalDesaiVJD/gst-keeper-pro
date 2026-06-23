// Renders any ReportTable from allClientsReports.ts to a styled PDF.
// Layout matches the look used by Filing Status / ITC Summary PDFs so the
// firm's documents feel consistent: centered logo + bold title + dark-blue
// header band + alternating row stripes + right-aligned numbers + Generated
// timestamp in the footer.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoSmall from '@/assets/logo-small.png';
import type { ReportTable } from './allClientsReports';

const formatNumberForPdf = (v: any): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export const renderReportToPdf = (report: ReportTable) => {
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();

  // Centered logo
  const logoWidth = 60;
  const logoHeight = 20;
  doc.addImage(logoSmall, 'PNG', (pageWidth - logoWidth) / 2, 8, logoWidth, logoHeight);

  // Title (centered)
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(report.title, pageWidth / 2, 35, { align: 'center' });

  // Subtitle (centered, lighter)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text(report.subtitle, pageWidth / 2, 42, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  // Numeric columns are right-aligned; first 1-3 (Sr/Name/GSTIN or Sr/Month)
  // are left-aligned. Detect by header text: anything with CGST/SGST/IGST/
  // TOTAL/CASH/PAYABLE goes right.
  const isNumericHeader = (h: string) =>
    /CGST|SGST|IGST|TOTAL|PAYABLE|CASH/i.test(h);

  const columnStyles: Record<number, any> = {};
  report.headers.forEach((h, i) => {
    columnStyles[i] = { halign: isNumericHeader(h) ? 'right' : 'left' };
  });

  // Body cells: convert numbers to display strings
  const body = report.rows.map(r => r.map(c => formatNumberForPdf(c)));

  autoTable(doc, {
    startY: 48,
    head: [report.headers],
    body,
    headStyles: {
      fillColor: [30, 41, 59],   // dark slate-blue, matches Filing Status PDF
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'center',
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles,
    margin: { top: 48, left: 8, right: 8, bottom: 14 },
    // TOTAL row is the last one when we add one — bold it.
    didParseCell: (data) => {
      const isLast = data.row.index === report.rows.length - 1;
      const looksLikeTotalRow = String(report.rows[data.row.index]?.[1]).toUpperCase() === 'TOTAL';
      if (isLast && looksLikeTotalRow && data.section === 'body') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [220, 230, 240];
      }
    },
  });

  // Footer: generated timestamp (left) + page numbers (right)
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 8, doc.internal.pageSize.height - 6);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 8, doc.internal.pageSize.height - 6, { align: 'right' });
  }

  doc.save(`${report.fileNameBase}.pdf`);
};
