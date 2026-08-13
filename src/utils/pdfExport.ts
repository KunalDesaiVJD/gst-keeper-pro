import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FilingStatusRecord, filingStatusDisplayLabel } from '@/types';
import logoSmall from '@/assets/logo-small.png';

export const exportFilingStatusToPDF = (
  records: FilingStatusRecord[],
  returnType: string,
  month: string
) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

  // Add logo image at the center
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoWidth = 60; // Adjust width as needed
  const logoHeight = 20; // Adjust height as needed
  const logoX = (pageWidth - logoWidth) / 2;
  
  doc.addImage(logoSmall, 'PNG', logoX, 8, logoWidth, logoHeight);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`${returnType} Filing Status - ${month}`, 148, 35, { align: 'center' });

  // Show ARN column for GSTR-1 and GSTR-3B (including IFF/Quarterly variants)
  const showArn = /^(GSTR-1|GSTR-3B)/.test(returnType);

  // Table
  const head = showArn
    ? [['Sr.', 'Client Name', 'Accountant', 'Frequency', 'Status', 'Target', 'Filed Date', 'ARN', 'Remarks']]
    : [['Sr.', 'Client Name', 'Accountant', 'Frequency', 'Status', 'Target', 'Filed Date', 'Remarks']];

  const tableData = records.map((record, idx) => {
    const base = [
      idx + 1,
      record.clientName,
      record.accountantName,
      record.filingFrequency,
      filingStatusDisplayLabel(record.status),
      record.targetDate,
      record.filedDate ? new Date(record.filedDate).toLocaleDateString('en-IN') : '-',
    ];
    if (showArn) base.push(record.arn || '-');
    base.push(record.remarks || '-');
    return base;
  });

  const columnStyles: Record<number, any> = {
    0: { cellWidth: 10 },
    1: { cellWidth: 50 },
    2: { cellWidth: 25 },
    3: { cellWidth: 22 },
    4: { cellWidth: 28 },
    5: { cellWidth: 14 },
    6: { cellWidth: 22 },
  };
  if (showArn) {
    columnStyles[7] = { cellWidth: 32 };
    columnStyles[8] = { cellWidth: 'auto' };
  } else {
    columnStyles[7] = { cellWidth: 'auto' };
  }

  autoTable(doc, {
    startY: 42,
    head,
    body: tableData,
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8,
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250],
    },
    columnStyles,
    margin: { top: 42, left: 10, right: 10 },
  });

  // Summary - Updated for new status types
  const filed = records.filter(r => r.status === 'Filed').length;
  const pending = records.filter(r => r.status === 'Prepared' || r.status === 'Prepared Pending' || r.status === 'Data Pending' || r.status === 'Data Received' || r.status === 'Mismatch in Data').length;
  
  const finalY = (doc as any).lastAutoTable.finalY || 42;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Total Clients: ${records.length}  |  Filed: ${filed}  |  Pending: ${pending}`, 14, finalY + 10);
  
  // Footer
  doc.setFontSize(8);
  doc.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 14, doc.internal.pageSize.height - 10);

  // Download
  doc.save(`Filing_Status_${returnType}_${month.replace('/', '-')}.pdf`);
};
