import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ITCRow {
  srNo: string;
  particular: string;
  igst: number;
  cgst: number;
  sgst: number;
  isHeader?: boolean;
  isAutoLinked?: boolean;
  reasons?: string;
}

interface ITCData {
  section4A: ITCRow[];
  section4B: ITCRow[];
  section4D: ITCRow[];
}

interface PartialItcSplit {
  onITCAsPerA: { igst: number; cgst: number; sgst: number };
  onOtherReversal: { igst: number; cgst: number; sgst: number };
  row1Reclassified: { igst: number; cgst: number; sgst: number };
  row2Reclassified: { igst: number; cgst: number; sgst: number };
  row2Calculated: { igst: number; cgst: number; sgst: number };
}

interface ITCExportParams {
  clientName: string;
  clientGstin: string;
  month: string;
  itcData: ITCData;
  total5: { igst: number; cgst: number; sgst: number };
  total4A: { igst: number; cgst: number; sgst: number };
  total4B: { igst: number; cgst: number; sgst: number };
  net4C: { igst: number; cgst: number; sgst: number };
  totalReclaimed: number;
  totalReversal: number;
  isLocked: boolean;
  // Builder client under apportionment (No-ITC/Partial-ITC) — same split the
  // on-screen table reclassifies with. Pass null/omit for a client where no
  // apportionment applies; section4B is then exported as saved, unmodified.
  partialITC?: PartialItcSplit | null;
}

export const exportITCSummaryToPDF = (params: ITCExportParams) => {
  const { clientName, clientGstin, month, itcData, total5, total4A, total4B, net4C, totalReclaimed, totalReversal, isLocked, partialITC } = params;
  
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('V. J. Desai & Co. LLP', 148, 15, { align: 'center' });
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Chartered Accountants', 148, 22, { align: 'center' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`ITC Summary - ${month}`, 148, 32, { align: 'center' });

  // Client Info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Client: ${clientName}`, 14, 42);
  doc.text(`GSTIN: ${clientGstin}`, 14, 48);

  // Summary boxes
  doc.setFillColor(220, 252, 231); // green background
  doc.rect(200, 40, 40, 14, 'F');
  doc.setFillColor(254, 226, 226); // red background
  doc.rect(245, 40, 40, 14, 'F');
  
  doc.setFontSize(8);
  doc.text('RECLAIMED', 220, 46, { align: 'center' });
  doc.text('REVERSAL', 265, 46, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`₹${totalReclaimed.toLocaleString('en-IN')}`, 220, 52, { align: 'center' });
  doc.text(`₹${totalReversal.toLocaleString('en-IN')}`, 265, 52, { align: 'center' });

  const formatNum = (n: number) => n.toLocaleString('en-IN');
  const calcTotal = (r: ITCRow) => r.igst + r.cgst + r.sgst;

  // Build table data
  const tableData: (string | number)[][] = [];

  // Section 4A
  tableData.push(['4 (A)', 'ITC Available', '', '', '', '', '']);
  itcData.section4A.forEach((row, idx) => {
    tableData.push([
      row.srNo,
      row.particular + (row.isAutoLinked ? ' [Auto-linked]' : ''),
      formatNum(row.igst),
      formatNum(row.cgst),
      formatNum(row.sgst),
      formatNum(calcTotal(row)),
      row.reasons || ''
    ]);
    // Insert Total (5) after 5.5
    if (row.srNo === '5.5') {
      tableData.push([
        'Total (5)',
        '5.1+5.2-5.3+5.4+5.5',
        formatNum(total5.igst),
        formatNum(total5.cgst),
        formatNum(total5.sgst),
        formatNum(total5.igst + total5.cgst + total5.sgst),
        ''
      ]);
    }
  });
  tableData.push(['', 'Total (4A)', formatNum(total4A.igst), formatNum(total4A.cgst), formatNum(total4A.sgst), formatNum(total4A.igst + total4A.cgst + total4A.sgst), '']);

  // Section 4B — a Builder client under apportionment (partialITC set) gets
  // the same reclassification the on-screen table applies: (1)/(2) show the
  // reclassified totals, and two reconciling lines make each foot from its
  // own visible rows, instead of silently disagreeing with Total (4B) below.
  tableData.push(['4 (B)', 'ITC Reversed', '', '', '', '', '']);
  itcData.section4B.forEach(row => {
    if (partialITC && row.srNo === '(1)' && row.particular.includes('Calculation of Ineligible ITC')) {
      const v = partialITC.row1Reclassified;
      tableData.push([row.srNo, row.particular + ' [Auto-calculated]', formatNum(v.igst), formatNum(v.cgst), formatNum(v.sgst), formatNum(v.igst + v.cgst + v.sgst), row.reasons || '']);
      return;
    }
    if (partialITC && row.particular === 'i) On ITC as per 4A') {
      const v = partialITC.onITCAsPerA;
      tableData.push([row.srNo, row.particular + ' [Auto-calculated]', formatNum(v.igst), formatNum(v.cgst), formatNum(v.sgst), formatNum(v.igst + v.cgst + v.sgst), row.reasons || '']);
      return;
    }
    if (partialITC && row.particular.includes('On Other reversal')) {
      const v = partialITC.onOtherReversal;
      tableData.push([row.srNo, row.particular + ' [Auto-calculated]', formatNum(v.igst), formatNum(v.cgst), formatNum(v.sgst), formatNum(v.igst + v.cgst + v.sgst), row.reasons || '']);
      const r = partialITC.row2Calculated;
      tableData.push(['', 'iv) Reclassified from "Others" below (2B RECO / 180-day reversal) [Auto-calculated]', formatNum(r.igst), formatNum(r.cgst), formatNum(r.sgst), formatNum(r.igst + r.cgst + r.sgst), '']);
      return;
    }
    if (partialITC && row.srNo === '(2)' && row.particular === 'Others') {
      const v = partialITC.row2Reclassified;
      tableData.push([row.srNo, row.particular + ' [Auto-calculated]', formatNum(v.igst), formatNum(v.cgst), formatNum(v.sgst), formatNum(v.igst + v.cgst + v.sgst), row.reasons || '']);
      return;
    }
    if (partialITC && row.particular === 'ITC Reversal for the previous months, if any.') {
      tableData.push([row.srNo, row.particular + (row.isAutoLinked ? ' [Auto-linked]' : ''), formatNum(row.igst), formatNum(row.cgst), formatNum(row.sgst), formatNum(calcTotal(row)), row.reasons || '']);
      const r = partialITC.row2Calculated;
      tableData.push(['', 'Less: reclassified to (1) above [Auto-calculated]', formatNum(-r.igst), formatNum(-r.cgst), formatNum(-r.sgst), formatNum(-(r.igst + r.cgst + r.sgst)), '']);
      return;
    }
    tableData.push([
      row.srNo,
      row.particular + (row.isAutoLinked ? ' [Auto-linked]' : ''),
      formatNum(row.igst),
      formatNum(row.cgst),
      formatNum(row.sgst),
      formatNum(calcTotal(row)),
      row.reasons || ''
    ]);
  });
  tableData.push(['', 'Total (4B)', formatNum(total4B.igst), formatNum(total4B.cgst), formatNum(total4B.sgst), formatNum(total4B.igst + total4B.cgst + total4B.sgst), '']);

  // Section 4C
  tableData.push(['4 (C)', 'NET ITC AVAILABLE (A - B)', formatNum(net4C.igst), formatNum(net4C.cgst), formatNum(net4C.sgst), formatNum(net4C.igst + net4C.cgst + net4C.sgst), '']);

  // Section 4D
  tableData.push(['4 (D)', 'Other Details', '', '', '', '', '']);
  itcData.section4D.forEach(row => {
    tableData.push([
      row.srNo,
      row.particular + (row.isAutoLinked ? ' [Auto-linked]' : ''),
      formatNum(row.igst),
      formatNum(row.cgst),
      formatNum(row.sgst),
      formatNum(calcTotal(row)),
      row.reasons || ''
    ]);
  });

  autoTable(doc, {
    startY: 58,
    head: [['Sr. No.', 'PARTICULAR', 'IGST', 'CGST', 'SGST', 'TOTAL', 'REASONS']],
    body: tableData,
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7,
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250],
    },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 75 },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 25, halign: 'right' },
      6: { cellWidth: 'auto' },
    },
    margin: { top: 58, left: 10, right: 10 },
    didParseCell: function(data) {
      // Highlight section headers
      if (data.row.index >= 0 && data.section === 'body') {
        const firstCell = data.row.cells[0]?.text?.[0] || '';
        if (firstCell.startsWith('4 (') || firstCell === 'Total (5)' || firstCell === '') {
          const secondCell = data.row.cells[1]?.text?.[0] || '';
          if (secondCell.startsWith('Total') || secondCell.startsWith('NET ITC') || secondCell.startsWith('ITC Available') || secondCell.startsWith('ITC Reversed') || secondCell.startsWith('Other Details')) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [241, 245, 249];
          }
        }
      }
    }
  });

  // Footer
  const finalY = (doc as any).lastAutoTable.finalY || 58;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Status: ${isLocked ? 'Locked (Return Filed)' : 'Editable'}`, 14, finalY + 10);
  doc.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 14, finalY + 16);

  // Download
  doc.save(`ITC_Summary_${clientName.replace(/\s+/g, '_')}_${month.replace('/', '-')}.pdf`);
};