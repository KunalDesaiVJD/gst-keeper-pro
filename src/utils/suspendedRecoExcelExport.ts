import * as XLSX from 'xlsx';

interface SuspendedRecoData {
  clientName: string;
  clientGstin: string;
  month: string;
  openingCgst: number;
  openingSgst: number;
  openingIgst: number;
  portalCgst: number;
  portalSgst: number;
  portalIgst: number;
  booksCgst: number;
  booksSgst: number;
  booksIgst: number;
  diffCgst: number;
  diffSgst: number;
  diffIgst: number;
  /** Where the opening came from: pulled (who, when), manual (allowed by X: reason), overridden. */
  openingSource?: string;
}

/** The sheet's rows (exported for the checks in scripts/verify-reco-gate.mjs). */
export const suspendedRecoSheetRows = (data: SuspendedRecoData): (string | number)[][] => {
  const openingTotal = data.openingCgst + data.openingSgst + data.openingIgst;
  const portalTotal = data.portalCgst + data.portalSgst + data.portalIgst;
  const booksTotal = data.booksCgst + data.booksSgst + data.booksIgst;
  const diffTotal = data.diffCgst + data.diffSgst + data.diffIgst;

  return [
    ['Suspended Reconciliation'],
    [`Client: ${data.clientName}`, '', `GSTIN: ${data.clientGstin}`, '', `Month: ${data.month}`],
    [],
    ['PARTICULARS', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    ['OPENING BALANCE AS PER PORTAL', data.openingCgst, data.openingSgst, data.openingIgst, openingTotal],
    ...(data.openingSource ? [[`Opening source: ${data.openingSource}`]] : []),
    ['CURRENT TOTAL AS PER SUSPENDED RECO', data.portalCgst, data.portalSgst, data.portalIgst, portalTotal],
    [],
    ['CLOSING BALANCE AS PER BOOKS', data.booksCgst, data.booksSgst, data.booksIgst, booksTotal],
    [],
    ['DIFFERENCE', data.diffCgst, data.diffSgst, data.diffIgst, diffTotal],
  ];
};

export const exportSuspendedRecoToExcel = (data: SuspendedRecoData) => {
  const workbook = XLSX.utils.book_new();
  const sheetData = suspendedRecoSheetRows(data);

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = [
    { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Suspended Reco');

  XLSX.writeFile(workbook, `Suspended_Reco_${data.clientName.replace(/\s+/g, '_')}_${data.month.replace('/', '-')}.xlsx`);
};
