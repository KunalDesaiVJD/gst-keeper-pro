import * as XLSX from 'xlsx';

interface GstReceivableExportData {
  clientName: string;
  clientGstin: string;
  month: string;
  prevMonthLabel?: string;
  openingCgst: number; openingSgst: number; openingIgst: number;
  availedCgst: number; availedSgst: number; availedIgst: number;
  utilizedCgst: number; utilizedSgst: number; utilizedIgst: number;
  portalClosingCgst: number; portalClosingSgst: number; portalClosingIgst: number;
  booksClosingCgst: number; booksClosingSgst: number; booksClosingIgst: number;
  diffCgst: number; diffSgst: number; diffIgst: number;
}

const sumT = (cgst: number, sgst: number, igst: number) => cgst + sgst + igst;

export const exportGstReceivableRecoToExcel = (d: GstReceivableExportData) => {
  const workbook = XLSX.utils.book_new();

  const availedLabel = d.prevMonthLabel
    ? `ADD: NET ITC AVAILABLE (4C) — ${d.prevMonthLabel} ITC Summary`
    : 'ADD: NET ITC AVAILABLE (4C)';
  const utilizedLabel = d.prevMonthLabel
    ? `LESS: ITC UTILIZED — ${d.prevMonthLabel} GSTR-3B output, Table 3.1a (capped at Available ITC)`
    : 'LESS: ITC UTILIZED (min of GSTR-3B output and Available ITC)';

  const rows: (string | number)[][] = [
    ['GST Receivable Reconciliation'],
    [`Client: ${d.clientName}`, '', `GSTIN: ${d.clientGstin}`, '', `Month: ${d.month}`],
    [],
    ['PARTICULARS', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    ['OPENING BALANCE AS PER PORTAL', d.openingCgst, d.openingSgst, d.openingIgst, sumT(d.openingCgst, d.openingSgst, d.openingIgst)],
    [availedLabel, d.availedCgst, d.availedSgst, d.availedIgst, sumT(d.availedCgst, d.availedSgst, d.availedIgst)],
    [utilizedLabel, d.utilizedCgst, d.utilizedSgst, d.utilizedIgst, sumT(d.utilizedCgst, d.utilizedSgst, d.utilizedIgst)],
    [],
    ['CLOSING BALANCE AS PER PORTAL', d.portalClosingCgst, d.portalClosingSgst, d.portalClosingIgst, sumT(d.portalClosingCgst, d.portalClosingSgst, d.portalClosingIgst)],
    [],
    ['CLOSING BALANCE AS PER BOOKS', d.booksClosingCgst, d.booksClosingSgst, d.booksClosingIgst, sumT(d.booksClosingCgst, d.booksClosingSgst, d.booksClosingIgst)],
    [],
    ['DIFFERENCE', d.diffCgst, d.diffSgst, d.diffIgst, sumT(d.diffCgst, d.diffSgst, d.diffIgst)],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 60 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'GST Receivable');

  XLSX.writeFile(workbook, `GST_Receivable_${d.clientName.replace(/\s+/g, '_')}_${d.month.replace('/', '-')}.xlsx`);
};
