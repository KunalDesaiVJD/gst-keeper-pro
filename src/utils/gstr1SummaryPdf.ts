import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Gstr1Summary } from './buildGstr1Summary';

interface Params {
  summary: Gstr1Summary;
  clientName: string;
  gstin: string;
  monthLabel: string;   // e.g. "Jun-26"
  fileName?: string | null;
}

const fmt2 = (n: number) =>
  (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Reproduces the portal's consolidated GSTR-1 summary as a downloadable PDF,
// driven by the same buildGstr1Summary() output the on-screen dialog uses.
export const exportGstr1SummaryToPDF = ({ summary, clientName, gstin, monthLabel }: Params) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape — 8 numeric columns

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('GSTR-1 Summary', 148, 14, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${clientName}${gstin ? `  (${gstin})` : ''}`, 148, 21, { align: 'center' });
  doc.text(`Tax Period: ${monthLabel}`, 148, 27, { align: 'center' });

  const body = summary.sections.map((s) => [
    `${s.code}  ${s.title}`,
    s.count.toLocaleString('en-IN'),
    s.docType,
    fmt2(s.value),
    fmt2(s.igst),
    fmt2(s.cgst),
    fmt2(s.sgst),
    fmt2(s.cess),
  ]);

  body.push([
    'Total liability (excl. HSN & Documents)',
    '',
    '',
    fmt2(summary.totals.value),
    fmt2(summary.totals.igst),
    fmt2(summary.totals.cgst),
    fmt2(summary.totals.sgst),
    fmt2(summary.totals.cess),
  ]);

  autoTable(doc, {
    startY: 33,
    head: [[
      'Description',
      'No. of records',
      'Document Type',
      'Value (Rs.)',
      'Integrated Tax (Rs.)',
      'Central Tax (Rs.)',
      'State/UT Tax (Rs.)',
      'Cess (Rs.)',
    ]],
    body,
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 24, halign: 'right' },
      7: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: 10, right: 10 },
    // Bold the trailing total row.
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 33;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text(
    'Note: 9B Credit/Debit Notes are shown net (Debit - Credit), so credit notes reduce the value. Counts are documents (invoices/notes), matching the GST portal.',
    10, finalY + 8, { maxWidth: 277 },
  );
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 10, finalY + 16);

  doc.save(`GSTR1_Summary_${clientName.replace(/\s+/g, '_')}_${monthLabel.replace(/[^\w-]/g, '')}.pdf`);
};
