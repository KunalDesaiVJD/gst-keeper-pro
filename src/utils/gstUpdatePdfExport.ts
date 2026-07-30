import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoSmall from '@/assets/logo-small.png';

interface GSTUpdateRow {
  client_name?: string;
  effect_month: string;
  update_effect_month: string;
  update_in_return: string;
  update_type: string;
  update_instructions_by: string;
  matter_brief: string;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  interest: number;
  remarks: string;
  remarks_checked: boolean;
  itc_section?: string;
  itc_sr_no?: string;
}

export const exportGSTUpdateToPDF = (
  records: GSTUpdateRow[],
  filters?: {
    client?: string;
    updateEffectMonth?: string;
    effectMonth?: string;
  }
) => {
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoWidth = 60;
  const logoHeight = 20;
  const logoX = (pageWidth - logoWidth) / 2;

  doc.addImage(logoSmall, 'PNG', logoX, 8, logoWidth, logoHeight);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  let title = 'GST Update Sheet';
  if (filters?.client) title += ` - ${filters.client}`;
  if (filters?.updateEffectMonth) title += ` (${filters.updateEffectMonth})`;
  doc.text(title, pageWidth / 2, 35, { align: 'center' });

  const tableData = records.map((r, idx) => [
    idx + 1,
    r.client_name || '',
    r.effect_month || '-',
    r.update_effect_month,
    r.update_in_return,
    r.update_type,
    r.update_instructions_by || '-',
    r.matter_brief || '-',
    r.taxable_value || 0,
    r.cgst || 0,
    r.sgst || 0,
    r.igst || 0,
    r.interest || 0,
    r.remarks || '-',
    (r.itc_section && r.itc_sr_no) ? `${r.itc_section} ${r.itc_sr_no}` : '',
    r.remarks_checked ? '✓' : '',
  ]);

  autoTable(doc, {
    startY: 42,
    head: [['Sr.', 'Client', 'Mistake Month', 'Update Effect', 'Return', 'Type', 'Instructions By', 'Matter Brief', 'Taxable', 'CGST', 'SGST', 'IGST', 'Interest', 'Remarks', 'ITC Sr No', '✓']],
    body: tableData,
    headStyles: {
      fillColor: [74, 144, 164],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7,
    },
    bodyStyles: { fontSize: 6 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 25 },
      2: { cellWidth: 16 },
      3: { cellWidth: 18 },
      4: { cellWidth: 16 },
      5: { cellWidth: 20 },
      6: { cellWidth: 18 },
      7: { cellWidth: 30 },
      8: { cellWidth: 16, halign: 'right' },
      9: { cellWidth: 14, halign: 'right' },
      10: { cellWidth: 14, halign: 'right' },
      11: { cellWidth: 14, halign: 'right' },
      12: { cellWidth: 14, halign: 'right' },
      13: { cellWidth: 'auto' },
      14: { cellWidth: 20 },
      15: { cellWidth: 8, halign: 'center' },
    },
    margin: { top: 42, left: 5, right: 5 },
  });

  doc.setFontSize(8);
  doc.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 14, doc.internal.pageSize.height - 10);
  doc.text(`Total Records: ${records.length}`, pageWidth - 60, doc.internal.pageSize.height - 10);

  const fileName = `GST_Update_Sheet${filters?.updateEffectMonth ? '_' + filters.updateEffectMonth.replace(/\s+/g, '_') : ''}.pdf`;
  doc.save(fileName);
};
