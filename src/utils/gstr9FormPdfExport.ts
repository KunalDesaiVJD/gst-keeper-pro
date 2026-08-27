import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface Gstr9PdfRow {
  tableNo: string;
  description: string;
  value: number;
  status?: string;
}

export interface Gstr9PdfSection {
  title: string;
  rows: Gstr9PdfRow[];
}

interface Gstr9PdfParams {
  clientName: string;
  clientGstin: string;
  financialYear: string;
  sections: Gstr9PdfSection[];
}

// Same accounting-style negatives as the on-screen fmt() — parentheses, not
// a leading minus, so a column of tax figures doesn't hide a credit note.
const fmt = (v: number): string => {
  const abs = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
};

export const exportGstr9FormToPDF = ({ clientName, clientGstin, financialYear, sections }: Gstr9PdfParams): void => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('GSTR-9 — Tables 4 to 16', 105, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Client: ${clientName}`, 14, 25);
  doc.text(`GSTIN: ${clientGstin}`, 14, 30);
  doc.text(`Financial Year: ${financialYear}`, 14, 35);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 150, 25);

  let startY = 42;
  sections.forEach((section) => {
    if (startY > 250) { doc.addPage(); startY = 20; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(section.title, 14, startY);

    autoTable(doc, {
      head: [['Description', 'Table No.', 'Value', 'Status']],
      body: section.rows.map((r) => [r.description, r.tableNo, fmt(r.value), r.status || '']),
      startY: startY + 3,
      styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [74, 144, 164], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { cellWidth: 22 }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 40 } },
      margin: { left: 14, right: 14 },
    });

    startY = (doc as any).lastAutoTable.finalY + 10;
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

  doc.save(`GSTR9_Form_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}.pdf`);
};
