// Row helpers for the Purchases & ITC step (PL-INPUT). Entry behaviour only —
// every total, implied rate and 9C figure comes from engine.ts.

import { newId } from '@/lib/gstr9/defaults';
import { DEFAULT_HEAD, EXPENSE_HEAD_LABEL, RATE_TOLERANCE, STANDARD_RATES } from '@/lib/gstr9/engine';
import type { PurchaseRowCalc } from '@/lib/gstr9/engine';
import type { ExpenseHead, InputSection, PurchaseRow, SupplyType } from '@/lib/gstr9/types';
import { fmtRate, round2 } from '../grid/money';

export const SECTIONS: InputSection[] = ['purchase', 'expense', 'capital_goods'];

export const SECTION_META: Record<
  InputSection,
  { letter: string; title: string; totalLabel: string; excelRef: string; sheetRows: string; description: string }
> = {
  purchase: {
    letter: 'A',
    title: '(A) Purchase',
    totalLabel: 'Total purchase',
    excelRef: 'PL-INPUT rows 9–30',
    sheetRows: 'rows 9–28',
    description: 'Purchase ledgers of goods and services. Enter each debit note / discount as its own row with a negative value.',
  },
  expense: {
    letter: 'B',
    title: '(B) Direct & indirect expense',
    totalLabel: 'Total indirect expense',
    excelRef: 'PL-INPUT rows 34–58',
    sheetRows: 'rows 34–56',
    description: 'Expense ledgers on which ITC was taken. Tag each to its GSTR-9C expense head — untagged ledgers fall into Q.',
  },
  capital_goods: {
    letter: 'C',
    title: '(C) Capital goods',
    totalLabel: 'Total capital goods',
    excelRef: 'PL-INPUT rows 63–69',
    sheetRows: 'rows 63–67',
    description: 'Fixed-asset additions on which ITC was taken.',
  },
};

export const SUPPLY_OPTIONS: Array<{ value: SupplyType; label: string }> = [
  { value: 'intra', label: 'Intra-state' },
  { value: 'inter', label: 'Inter-state' },
];

export const HEAD_OPTIONS: Array<{ value: ExpenseHead; label: string }> = (Object.keys(EXPENSE_HEAD_LABEL) as ExpenseHead[]).map((h) => ({
  value: h,
  label: EXPENSE_HEAD_LABEL[h],
}));

export const defaultHeadLabel = (section: InputSection): string => EXPENSE_HEAD_LABEL[DEFAULT_HEAD[section]];

export const newPurchaseRow = (section: InputSection): PurchaseRow => ({
  id: newId(),
  section,
  ledger: '',
  supplyType: 'intra',
  rate: null,
  taxable: 0,
  igst: 0,
  cgst: 0,
  sgst: null,
  cess: 0,
  head: null,
});

const z = (v: number | null | undefined) => !v || Math.abs(v) < 0.005;

/** No tax typed on the row yet (IGST, CGST, SGST and Cess all zero / SGST mirroring). */
export const isTaxBlank = (r: PurchaseRow): boolean => z(r.igst) && z(r.cgst) && z(r.sgst) && z(r.cess);

const dropFormulas = (r: PurchaseRow, keys: string[]): PurchaseRow => {
  if (!r.f || !keys.some((k) => k in r.f!)) return r;
  const f = { ...r.f };
  keys.forEach((k) => delete f[k]);
  return { ...r, f };
};

/** Formula-memory keys of the tax columns (taxInCols prefix "tax" + the Cess column). */
export const TAX_KEYS = ['tax.i', 'tax.c', 'tax.s', 'tax.x'];

/**
 * The sheet's `=D*18%` cells: when the row has a rate and no tax typed yet,
 * inter-state → IGST = value × rate; intra-state → CGST = value × rate / 2 and
 * SGST mirrors it. Rows that already carry tax are never touched.
 */
export const fillFromRate = (r: PurchaseRow): PurchaseRow => {
  if (r.rate === null || r.rate === undefined || z(r.rate) || z(r.taxable) || !isTaxBlank(r)) return r;
  const base = dropFormulas(r, TAX_KEYS);
  if (r.supplyType === 'inter') return { ...base, igst: round2((r.taxable * r.rate) / 100), cgst: 0, sgst: null };
  return { ...base, igst: 0, cgst: round2((r.taxable * r.rate) / 200), sgst: null };
};

/** The row's tax is exactly what fillFromRate gives (so it was filled from the rate, not typed from the books). */
const isRateTax = (r: PurchaseRow): boolean => {
  if (r.rate === null || r.rate === undefined || z(r.rate) || z(r.taxable) || !z(r.cess) || r.sgst !== null) return false;
  const blank = { ...r, igst: 0, cgst: 0, sgst: null };
  const auto = fillFromRate(blank);
  return Math.abs(auto.igst - r.igst) < 0.005 && Math.abs(auto.cgst - r.cgst) < 0.005;
};

/**
 * Supply changed: fill a blank row from the rate, and move tax that was filled
 * from the rate to the new head (IGST ↔ CGST/SGST). Typed tax is left alone.
 */
export const changeSupply = (r: PurchaseRow, supplyType: SupplyType): PurchaseRow => {
  if (supplyType === r.supplyType) return r;
  if (isRateTax(r)) return fillFromRate({ ...r, supplyType, igst: 0, cgst: 0, sgst: null });
  return fillFromRate({ ...r, supplyType });
};

/** Tax typed in one head only tells the supply type: IGST alone → inter-state, CGST/SGST alone → intra-state. */
export const inferSupply = (r: PurchaseRow): PurchaseRow => {
  const i = !z(r.igst);
  const cs = !z(r.cgst) || !z(r.sgst);
  if (i && !cs && r.supplyType !== 'inter') return { ...r, supplyType: 'inter' };
  if (cs && !i && r.supplyType !== 'intra') return { ...r, supplyType: 'intra' };
  return r;
};

/** Put one section's rows back into the full array, keeping every other section's rows (and order) untouched. */
export const spliceSection = (all: PurchaseRow[], section: InputSection, next: PurchaseRow[]): PurchaseRow[] => {
  const out: PurchaseRow[] = [];
  let placed = false;
  all.forEach((r) => {
    if (r.section !== section) {
      out.push(r);
      return;
    }
    if (!placed) {
      out.push(...next.map((n) => (n.section === section ? n : { ...n, section })));
      placed = true;
    }
  });
  if (!placed) out.push(...next.map((n) => (n.section === section ? n : { ...n, section })));
  return out;
};

/** A GST rate in force (within the engine's rate tolerance). */
export const isStandardRate = (rate: number): boolean => STANDARD_RATES.some((s) => Math.abs(Math.abs(rate) - s) <= RATE_TOLERANCE);

/**
 * Conservative name-based suggestions for expense ledgers — only heads a
 * ledger name states unambiguously. On the firm's sample this reproduces the
 * sheet's own tagging except "Computer Accessories" (which the sheet puts in M).
 */
const HEAD_RULES: Array<[RegExp, ExpenseHead]> = [
  [/insurance|inssurance|\brent(al)?\b|\blease\b/i, 'rent_insurance'],
  [/\bbank\b/i, 'bank_charges'],
  [/stationery|stationary|printing|postage|courier/i, 'stationery'],
  [/repair|maint[ae]n[ae]nce/i, 'repair_maintenance'],
  [/freight|carriage|cartage/i, 'freight'],
  [/\bpower\b|electricity|\bfuel\b|diesel|petrol/i, 'power_fuel'],
  [/royalty/i, 'royalty'],
  [/conveyance/i, 'conveyance'],
];

export const suggestHead = (ledger: string): ExpenseHead | null => {
  const hit = HEAD_RULES.find(([re]) => re.test(ledger || ''));
  return hit ? hit[1] : null;
};

export interface RateFlag {
  kind: 'mismatch' | 'nonstandard_rate' | 'nonstandard_implied';
  message: string;
}

/** The implied-rate check (the sheet's column H), read from the engine's per-row figures. Display only. */
export const rateFlag = (r: PurchaseRow, calc: PurchaseRowCalc | undefined): RateFlag | null => {
  const implied = calc?.impliedRate ?? null;
  if (calc?.rateMismatch && implied !== null && r.rate !== null) {
    return {
      kind: 'mismatch',
      message: `Tax is ${fmtRate(Math.abs(implied))} of the value, not ${fmtRate(r.rate)} — a partial or blocked credit, or a ledger mixing rates? Check the ledger or note why.`,
    };
  }
  if (r.rate !== null && r.rate !== undefined && !isStandardRate(r.rate)) {
    return {
      kind: 'nonstandard_rate',
      message: `${fmtRate(r.rate)} is not a GST rate — usually a partial or blocked credit. Enter the ledger's actual rate (e.g. 18) so the check flags the gap.`,
    };
  }
  if ((r.rate === null || r.rate === undefined) && implied !== null && !isStandardRate(implied)) {
    return {
      kind: 'nonstandard_implied',
      message: `Tax is ${fmtRate(Math.abs(implied))} of the value, which is not a GST rate — a partial or blocked credit, or mixed rates?`,
    };
  }
  return null;
};
