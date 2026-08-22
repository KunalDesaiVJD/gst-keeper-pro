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
    /CGST|SGST|IGST|TOTAL|PAYABLE|CASH|CESS|VALUE|QTY|COUNT|RATE/i.test(h);

  // report.columnWidths are Excel "wch" (character-count) widths — reused
  // here as a relative sizing hint so a free-text column (e.g. DRC-03's
  // "Cause of Payment") gets a real width instead of autoTable's default
  // 'auto' sizing, which — with 15+ columns on one page — was dividing the
  // page so thin some columns landed under one character wide, wrapping
  // every word (including headers) to one character per line. A fixed floor
  // keeps every column legible; horizontalPageBreak spreads onto extra pages
  // sideways when a wide report (like an 18-column one) can't fit at that
  // floor, instead of squeezing to unreadable widths on a single page.
  const MM_PER_WCH = 2;
  const MIN_COL_MM = 14;
  const hasWidthHints = Array.isArray(report.columnWidths) && report.columnWidths.length === report.headers.length;

  // A "PDF" column (Notices/DRC-03) holds a raw Supabase Storage URL —
  // 100+ characters that autoTable wraps one character per line in a
  // narrow column, blowing up row heights. Show a short "View PDF" label
  // instead and make it an actual clickable link (via didDrawCell below),
  // and give the freed-up width back to the other columns so the table
  // still fills the page instead of leaving a blank strip on the right.
  const pdfColIndex = report.headers.findIndex((h) => h.trim().toUpperCase() === 'PDF');
  const PDF_COL_MM = 22;
  const pdfUrls: (string | null)[] = report.rows.map((r) => {
    if (pdfColIndex === -1) return null;
    const v = r[pdfColIndex];
    return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null;
  });

  const margin = { top: 48, left: 8, right: 8, bottom: 14 };
  // A few mm of slack below the true usable width — autoTable's own cell
  // padding/border math can tip a table that exactly matches the page edge
  // into an unwanted horizontal page break, stranding the last column alone
  // on a second page.
  const availableWidth = pageWidth - margin.left - margin.right - 4;

  const columnStyles: Record<number, any> = {};
  if (hasWidthHints) {
    const rawWidths = report.headers.map((_, i) => Math.max(report.columnWidths[i] * MM_PER_WCH, MIN_COL_MM));
    if (pdfColIndex !== -1) {
      const otherSum = rawWidths.reduce((s, w, i) => (i === pdfColIndex ? s : s + w), 0);
      const scale = otherSum > 0 ? (availableWidth - PDF_COL_MM) / otherSum : 1;
      rawWidths.forEach((w, i) => { rawWidths[i] = i === pdfColIndex ? PDF_COL_MM : w * scale; });
    }
    report.headers.forEach((h, i) => {
      columnStyles[i] = {
        halign: i === pdfColIndex ? 'center' : (isNumericHeader(h) ? 'right' : 'left'),
        cellWidth: rawWidths[i],
      };
    });
  } else {
    report.headers.forEach((h, i) => {
      columnStyles[i] = { halign: isNumericHeader(h) ? 'right' : 'left' };
    });
  }

  // Body cells: convert numbers to display strings; the PDF column gets the
  // short link label instead of the raw URL.
  const body = report.rows.map((r, ri) => r.map((c, ci) => (
    ci === pdfColIndex ? (pdfUrls[ri] ? 'View PDF' : '—') : formatNumberForPdf(c)
  )));

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
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: 0,
    margin,
    // TOTAL row is the last one when we add one — bold it. The PDF column's
    // "View PDF" label is styled like a link; didDrawCell below turns it
    // into an actual clickable link once autoTable has positioned the cell.
    didParseCell: (data) => {
      const isLast = data.row.index === report.rows.length - 1;
      const looksLikeTotalRow = String(report.rows[data.row.index]?.[1]).toUpperCase() === 'TOTAL';
      if (isLast && looksLikeTotalRow && data.section === 'body') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [220, 230, 240];
      }
      if (data.section === 'body' && data.column.index === pdfColIndex && pdfUrls[data.row.index]) {
        data.cell.styles.textColor = [37, 99, 235]; // blue-600
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === pdfColIndex) {
        const url = pdfUrls[data.row.index];
        if (url) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
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
