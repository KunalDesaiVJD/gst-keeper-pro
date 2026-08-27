import * as XLSX from 'xlsx';
import type { Table17Row } from '@/lib/annualReturnAggregates';

/**
 * GSTR-9 TABLE 17 — HSN-wise summary of outward supplies, exported in the
 * same column order the portal's own HSN table uses (roadmap step 9,
 * portal-push path 1). Table 17 isn't part of Gstr9FormView's generic
 * 4-column PDF export (Description/Table No/Value/Status) — it needs its
 * own wide, tabular format, so it gets a dedicated Excel export instead.
 */
export const exportGstr9HsnToExcel = (clientName: string, financialYear: string, rows: Table17Row[]): void => {
  const headers = ['HSN Code', 'Description', 'UQC', 'Total Quantity', 'Taxable Value', 'Rate (%)', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess'];
  const body = rows.map((r) => [r.hsn, r.desc, r.uqc, r.qty || '', r.taxable || '', r.rate, r.igst || '', r.cgst || '', r.sgst || '', r.cess || '']);
  const totals = ['Total', '', '', '', rows.reduce((s, r) => s + r.taxable, 0), '', rows.reduce((s, r) => s + r.igst, 0), rows.reduce((s, r) => s + r.cgst, 0), rows.reduce((s, r) => s + r.sgst, 0), rows.reduce((s, r) => s + r.cess, 0)];

  const wsData = [
    [`Name of Client : ${clientName}`],
    [`Financial Year : ${financialYear}`],
    [],
    headers,
    ...body,
    totals,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Table 17 - HSN Outward');
  XLSX.writeFile(wb, `GSTR9_Table17_HSN_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}.xlsx`);
};
