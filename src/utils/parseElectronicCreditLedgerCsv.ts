// Parses the "Electronic Credit Ledger" CSV that the GST portal exports.
// Different column layout from the Reversal CSV (parseElectronicCreditCsv):
// cells are double-quoted, and there is a single "Balance Available" block
// covering Integrated / Central / State / CESS / Total at indices 11-15.
//
// Each Tax Period can appear in MULTIPLE rows (a Credit row when ITC accrues
// and a Debit row when GSTR-3B liability is offset). We dedupe by Tax Period
// and keep the row with the HIGHEST S.No — that's the post-debit balance,
// which is the true closing balance for the period and therefore the opening
// balance for the NEXT period.

export interface CreditLedgerRow {
  srNo: number;
  date: string;            // "19/04/2025" — kept as-is from the CSV
  taxPeriod: string;       // "Mar-25"
  periodMonthKey: string;  // "03/2025" — matches MM/YYYY used in the app
  description: string;
  transactionType: string; // "Credit" | "Debit"
  balanceIgst: number;
  balanceCgst: number;
  balanceSgst: number;
}

export interface CreditLedgerParseResult {
  gstin: string;
  legalName: string;
  rows: CreditLedgerRow[];          // raw rows (multiple per Tax Period possible)
  rowsByPeriod: Map<string, CreditLedgerRow>; // deduped — last (highest S.No) per periodMonthKey
}

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const splitCsvLine = (line: string): string[] => {
  // The Credit Ledger CSV double-quotes every cell. None of the cells we care
  // about contain commas, so a naive split + quote-strip is correct.
  return line.split(',').map(s => {
    let t = s.trim();
    if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
    return t.trim();
  });
};

const parseTaxPeriod = (tp: string): string | null => {
  const m = tp.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const monthName = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const mm = MONTH_MAP[monthName];
  if (!mm) return null;
  const yyyy = 2000 + parseInt(m[2], 10);
  return `${mm}/${yyyy}`;
};

const toNum = (s: string | undefined): number => {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const toInt = (s: string | undefined): number => {
  if (!s) return 0;
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

export const parseElectronicCreditLedgerCsv = (csv: string): CreditLedgerParseResult => {
  const lines = csv.split(/\r?\n/);
  let gstin = '';
  let legalName = '';
  const rows: CreditLedgerRow[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const cells = splitCsvLine(raw);

    // GSTIN / Legal Name show up as key-value pairs in the preamble
    for (let i = 0; i < cells.length - 1; i++) {
      if (cells[i] === 'GSTIN' && !gstin) gstin = cells[i + 1];
      if (cells[i] === 'Legal Name' && !legalName) legalName = cells[i + 1];
    }

    // Data rows: cell[3] holds the Tax Period like "Mar-25". Skip Opening
    // Balance / Closing Balance summary rows (they have "-" here).
    const taxPeriod = cells[3] || '';
    const periodMonthKey = parseTaxPeriod(taxPeriod);
    if (!periodMonthKey) continue;

    rows.push({
      srNo: toInt(cells[0]),
      date: cells[1] || '',
      taxPeriod,
      periodMonthKey,
      description: cells[4] || '',
      transactionType: cells[5] || '',
      balanceIgst: toNum(cells[11]),
      balanceCgst: toNum(cells[12]),
      balanceSgst: toNum(cells[13]),
    });
  }

  // Dedupe: take the LAST row per Tax Period (highest S.No)
  const rowsByPeriod = new Map<string, CreditLedgerRow>();
  for (const r of rows) {
    const existing = rowsByPeriod.get(r.periodMonthKey);
    if (!existing || r.srNo > existing.srNo) {
      rowsByPeriod.set(r.periodMonthKey, r);
    }
  }

  return { gstin: gstin.trim(), legalName: legalName.trim(), rows, rowsByPeriod };
};

// Helper: given a target month (MM/YYYY), return the previous month's key.
// e.g. Jun-26 → May-26. Used for sourcing M-1 figures (ITC Summary, GSTR-1).
export const previousPeriodMonthKey = (targetMonth: string): string | null => {
  const [mm, yyyy] = targetMonth.split('/').map(Number);
  if (!mm || !yyyy) return null;
  const prevMonth = mm === 1 ? 12 : mm - 1;
  const prevYear = mm === 1 ? yyyy - 1 : yyyy;
  return `${String(prevMonth).padStart(2, '0')}/${prevYear}`;
};

// Helper: given a target month (MM/YYYY), return the M-2 month's key. The
// Jun-26 reco verifies May-26 entries, so the page's "OPENING BALANCE" is
// May-26's opening = Apr-26's closing in the Credit Ledger CSV.
export const openingBalancePeriodKey = (targetMonth: string): string | null => {
  const prev = previousPeriodMonthKey(targetMonth);
  return prev ? previousPeriodMonthKey(prev) : null;
};

// Helper: format a periodMonthKey ("05/2026") into a human label ("May-26").
export const formatPeriodLabel = (periodMonthKey: string): string => {
  const [mm, yyyy] = periodMonthKey.split('/').map(Number);
  if (!mm || !yyyy) return periodMonthKey;
  const monthName = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k] === String(mm).padStart(2, '0'));
  if (!monthName) return periodMonthKey;
  return `${monthName}-${String(yyyy).slice(-2)}`;
};
