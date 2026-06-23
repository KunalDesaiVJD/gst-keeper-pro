import * as XLSX from 'xlsx';

interface GstReceivableExportData {
  clientName: string;
  clientGstin: string;
  month: string;
  openingCgst: number; openingSgst: number; openingIgst: number;
  availedCgst: number; availedSgst: number; availedIgst: number;
  utilizedCgst: number; utilizedSgst: number; utilizedIgst: number;
  reversedCgst: number; reversedSgst: number; reversedIgst: number;
  reclaimedCgst: number; reclaimedSgst: number; reclaimedIgst: number;
  portalClosingCgst: number; portalClosingSgst: number; portalClosingIgst: number;
  payableCgst: number; payableSgst: number; payableIgst: number;
  booksClosingCgst: number; booksClosingSgst: number; booksClosingIgst: number;
  diffCgst: number; diffSgst: number; diffIgst: number;
}

const sumT = (cgst: number, sgst: number, igst: number) => cgst + sgst + igst;

export const exportGstReceivableRecoToExcel = (d: GstReceivableExportData) => {
  const workbook = XLSX.utils.book_new();

  const rows: (string | number)[][] = [
    ['GST Receivable Reconciliation'],
    [`Client: ${d.clientName}`, '', `GSTIN: ${d.clientGstin}`, '', `Month: ${d.month}`],
    [],
    ['PARTICULARS', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    ['OPENING BALANCE AS PER PORTAL', d.openingCgst, d.openingSgst, d.openingIgst, sumT(d.openingCgst, d.openingSgst, d.openingIgst)],
    ['ADD: ITC AVAILED (4A)', d.availedCgst, d.availedSgst, d.availedIgst, sumT(d.availedCgst, d.availedSgst, d.availedIgst)],
    ['LESS: ITC UTILIZED (min of GSTR-1 output and Available ITC)', d.utilizedCgst, d.utilizedSgst, d.utilizedIgst, sumT(d.utilizedCgst, d.utilizedSgst, d.utilizedIgst)],
    ['LESS: ITC REVERSED (4B)', d.reversedCgst, d.reversedSgst, d.reversedIgst, sumT(d.reversedCgst, d.reversedSgst, d.reversedIgst)],
    ['ADD: ITC RECLAIMED (4D)', d.reclaimedCgst, d.reclaimedSgst, d.reclaimedIgst, sumT(d.reclaimedCgst, d.reclaimedSgst, d.reclaimedIgst)],
    [],
    ['CLOSING BALANCE AS PER PORTAL', d.portalClosingCgst, d.portalClosingSgst, d.portalClosingIgst, sumT(d.portalClosingCgst, d.portalClosingSgst, d.portalClosingIgst)],
    ['GST PAYABLE (CASH)', d.payableCgst, d.payableSgst, d.payableIgst, sumT(d.payableCgst, d.payableSgst, d.payableIgst)],
    [],
    ['CLOSING BALANCE AS PER BOOKS', d.booksClosingCgst, d.booksClosingSgst, d.booksClosingIgst, sumT(d.booksClosingCgst, d.booksClosingSgst, d.booksClosingIgst)],
    [],
    ['DIFFERENCE', d.diffCgst, d.diffSgst, d.diffIgst, sumT(d.diffCgst, d.diffSgst, d.diffIgst)],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 55 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'GST Receivable');

  XLSX.writeFile(workbook, `GST_Receivable_${d.clientName.replace(/\s+/g, '_')}_${d.month.replace('/', '-')}.xlsx`);
};
