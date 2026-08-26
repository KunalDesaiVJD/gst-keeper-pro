import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface NoticeFormatPdfParams {
  clientName: string;
  clientGstin: string;
  financialYear: string;
  outward: { igst: number; cgst: number; sgst: number; net: { igst: number; cgst: number; sgst: number } };
  inward: { t8A: number; used: number; netExcessUsed: number };
}

const fmt = (v: number): string => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const exportNoticeFormatToPDF = ({ clientName, clientGstin, financialYear, outward, inward }: NoticeFormatPdfParams): void => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Notice Format', 105, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Client: ${clientName}`, 14, 25);
  doc.text(`GSTIN: ${clientGstin}`, 14, 30);
  doc.text(`Financial Year: ${financialYear}`, 14, 35);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 150, 25);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Outward', 14, 45);

  autoTable(doc, {
    head: [['Description', 'Table No. in GSTR-9', 'IGST', 'CGST', 'SGST']],
    body: [
      ['Total output tax liability', '9', fmt(outward.igst), fmt(outward.cgst), fmt(outward.sgst)],
      ['Net tax payable', '9', fmt(outward.net.igst), fmt(outward.net.cgst), fmt(outward.net.sgst)],
    ],
    startY: 48,
    styles: { fontSize: 9, cellPadding: 1.5 },
    headStyles: { fillColor: [74, 144, 164], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    didParseCell: (cellData) => {
      if (cellData.row.index === 1) cellData.cell.styles.fontStyle = 'bold';
    },
    margin: { left: 14, right: 14 },
  });

  const inwardStartY = (doc as any).lastAutoTable.finalY + 12;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Inward', 14, inwardStartY);

  autoTable(doc, {
    head: [['Description', 'Table No. in GSTR-9', 'Total']],
    body: [
      ['ITC as per Table 8A of GSTR-9', '8A', fmt(inward.t8A)],
      ['ITC used as per 4A(5) of GSTR-3B', '—', fmt(inward.used)],
      ['Net excess used', '—', fmt(inward.netExcessUsed)],
    ],
    startY: inwardStartY + 3,
    styles: { fontSize: 9, cellPadding: 1.5 },
    headStyles: { fillColor: [74, 144, 164], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' } },
    didParseCell: (cellData) => {
      if (cellData.row.index === 2) cellData.cell.styles.fontStyle = 'bold';
    },
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128);
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' },
    );
  }

  doc.save(`Notice_Format_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}.pdf`);
};
