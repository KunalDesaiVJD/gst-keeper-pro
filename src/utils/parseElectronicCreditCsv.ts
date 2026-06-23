// Parses the "Electronic Credit Reversal and Re-claimed Statement" CSV that the
// GST portal lets a taxpayer download. The file is parsed entirely in the
// browser — nothing is uploaded to storage — so the caller can read just the
// numbers we need and discard the file blob.
//
// CSV shape (variable preamble, then a multi-column header block, then data
// rows). Each data row's columns of interest, by 0-indexed position:
//   [3]  Return period (e.g. "Apr-26") — summary rows have "-" here
//   [17] Closing Balance Integrated Tax  (IGST)
//   [18] Closing Balance Central Tax     (CGST)
//   [19] Closing Balance State/UT Tax    (SGST)
//   [20] Closing Balance Cess            (ignored — never used in this app)
// GSTIN and Legal Name live in the preamble as `key,value` adjacent cells.

export interface CreditCsvRow {
  returnPeriod: string;     // "Apr-26"
  periodMonthKey: string;   // "04/2026" — matches the app's MM/YYYY format
  closingIgst: number;
  closingCgst: number;
  closingSgst: number;
}

export interface CreditCsvParseResult {
  gstin: string;
  legalName: string;
  rows: CreditCsvRow[];
}

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const splitCsvLine = (line: string): string[] => {
  // The portal CSV doesn't quote commas inside fields for the columns we read,
  // so a plain split is correct and avoids dragging in a CSV parser dep.
  return line.split(',').map(s => s.trim());
};

const parseReturnPeriod = (rp: string): string | null => {
  const m = rp.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mm = MONTH_MAP[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
  if (!mm) return null;
  const yyyy = 2000 + parseInt(m[2], 10);
  return `${mm}/${yyyy}`;
};

const toNum = (s: string | undefined): number => {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const parseElectronicCreditCsv = (csv: string): CreditCsvParseResult => {
  const lines = csv.split(/\r?\n/);
  let gstin = '';
  let legalName = '';
  const rows: CreditCsvRow[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const cells = splitCsvLine(raw);

    // Pick up GSTIN / Legal Name wherever the key cell appears
    for (let i = 0; i < cells.length - 1; i++) {
      if (cells[i] === 'GSTIN' && !gstin) gstin = cells[i + 1];
      if (cells[i] === 'Legal Name' && !legalName) legalName = cells[i + 1];
    }

    // Skip rows whose Return period isn't a real month (Opening / Closing
    // balance summary rows use "-" or are blank).
    const returnPeriod = cells[3] || '';
    const periodMonthKey = parseReturnPeriod(returnPeriod);
    if (!periodMonthKey) continue;

    rows.push({
      returnPeriod,
      periodMonthKey,
      closingIgst: toNum(cells[17]),
      closingCgst: toNum(cells[18]),
      closingSgst: toNum(cells[19]),
    });
  }

  return { gstin: gstin.trim(), legalName: legalName.trim(), rows };
};

// Helper: given a target month (MM/YYYY) like the page is currently on, return
// the previous month's key — i.e. the row in the CSV that supplies this month's
// opening balance. Jun-26 page wants May-26 closing.
export const previousPeriodMonthKey = (targetMonth: string): string | null => {
  const [mm, yyyy] = targetMonth.split('/').map(Number);
  if (!mm || !yyyy) return null;
  const prevMonth = mm === 1 ? 12 : mm - 1;
  const prevYear = mm === 1 ? yyyy - 1 : yyyy;
  return `${String(prevMonth).padStart(2, '0')}/${prevYear}`;
};

// Helper: format a periodMonthKey ("05/2026") into a human label ("May-26") so
// we can echo it in toasts and the info popover.
export const formatPeriodLabel = (periodMonthKey: string): string => {
  const [mm, yyyy] = periodMonthKey.split('/').map(Number);
  if (!mm || !yyyy) return periodMonthKey;
  const monthName = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k] === String(mm).padStart(2, '0'));
  if (!monthName) return periodMonthKey;
  return `${monthName}-${String(yyyy).slice(-2)}`;
};
