import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Gstr3bResult } from './buildGstr3bJson';

interface Params {
  result: Gstr3bResult;
  clientName: string;
  gstin: string;
  monthLabel: string; // e.g. "Jun-26"
}

const fmt2 = (n: number) =>
  (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Portal-style GSTR-3B PDF: Table 3.1, Table 3.2 and Table 4, driven by the
// same computed summary the on-screen page uses.
export const exportGstr3bToPDF = ({ result, clientName, gstin, monthLabel }: Params) => {
  const s = result.summary;
  const doc = new jsPDF('p', 'mm', 'a4');

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('Form GSTR-3B', 105, 14, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${clientName}${gstin ? `  (${gstin})` : ''}`, 105, 20, { align: 'center' });
  doc.text(`Tax Period: ${monthLabel}`, 105, 25, { align: 'center' });

  // Table 3.1 — outward supplies & inward RCM.
  autoTable(doc, {
    startY: 31,
    head: [['3.1 Nature of supplies', 'Taxable value', 'Integrated tax', 'Central tax', 'State/UT tax']],
    body: [
      ['(a) Outward taxable (other than zero/nil/exempt)', fmt2(s.outward.txval), fmt2(s.outward.igst), fmt2(s.outward.cgst), fmt2(s.outward.sgst)],
      ['(b) Outward taxable (zero rated)', fmt2(s.zeroRated.txval), fmt2(s.zeroRated.igst), '0.00', '0.00'],
      ['(c) Other outward (nil rated, exempted)', fmt2(s.nilExempt), '0.00', '0.00', '0.00'],
      ['(d) Inward supplies (liable to reverse charge)', fmt2(s.rcmLiability.txval), fmt2(s.rcmLiability.igst), fmt2(s.rcmLiability.cgst), fmt2(s.rcmLiability.sgst)],
      ['(e) Non-GST outward supplies', fmt2(s.nonGst), '0.00', '0.00', '0.00'],
      ['Total tax liability (a + d)', '', fmt2(s.totalLiability.igst), fmt2(s.totalLiability.cgst), fmt2(s.totalLiability.sgst)],
    ],
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 74 },
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
    },
    didParseCell: (d) => { if (d.section === 'body' && d.row.index === 5) d.cell.styles.fontStyle = 'bold'; },
    margin: { left: 12, right: 12 },
  });

  // Table 4 — eligible ITC.
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 6,
    head: [['4. Eligible ITC', 'Integrated tax', 'Central tax', 'State/UT tax']],
    body: [
      ['(A) ITC available', fmt2(s.itcAvailable.igst), fmt2(s.itcAvailable.cgst), fmt2(s.itcAvailable.sgst)],
      ['(B) ITC reversed', fmt2(s.itcReversed.igst), fmt2(s.itcReversed.cgst), fmt2(s.itcReversed.sgst)],
      ['(C) Net ITC available (A - B)', fmt2(s.itcNet.igst), fmt2(s.itcNet.cgst), fmt2(s.itcNet.sgst)],
      ['(D) Other Details', '', '', ''],
      ...s.itcOtherDetails.map((d) => [`${d.srNo} ${d.label}`, fmt2(d.igst), fmt2(d.cgst), fmt2(d.sgst)]),
    ],
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 90 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section === 'body' && (d.row.index === 2 || d.row.index === 3)) d.cell.styles.fontStyle = 'bold';
    },
    margin: { left: 12, right: 12 },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 31;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 12, finalY + 8);

  doc.save(`GSTR3B_${clientName.replace(/\s+/g, '_')}_${monthLabel.replace(/[^\w-]/g, '')}.pdf`);
};
