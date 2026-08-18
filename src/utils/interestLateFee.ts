// Interest (s.50/Rule 88B), late fee (s.47) and Rule 42 ITC-reversal
// calculations for the Phase 4 scrutiny reports. Pure, side-effect-free
// functions — see docs/INTEREST_LATE_FEE_POSITIONS.md for what's elected
// here, what's confirmed with the firm, and what's a known simplification.

export interface TaxHeadAmounts { igst: number; cgst: number; sgst: number; }

const r2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ─────────────────── Due date + days late ──────────────────────────────

/** Group-1 returns (GSTR-1, GSTR-1 (IFF), GSTR-6, GSTR-7) use target_date_group1;
 *  everything else in the group-2 set (GSTR-3B, GSTR-3B (Q), ITC-04, CMP-08)
 *  uses target_date_group2 — same grouping FilingStatusPage.tsx uses. */
const GROUP_1_RETURNS = new Set(['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-6', 'GSTR-7']);

export function dueDayForReturn(returnType: string, targetDateGroup1: number | null, targetDateGroup2: number | null): number {
  if (GROUP_1_RETURNS.has(returnType)) return targetDateGroup1 ?? 11;
  return targetDateGroup2 ?? 20;
}

/** The due date for a MM/YYYY return period is always in the FOLLOWING
 * calendar month, on the client's configured due-day. */
export function computeDueDate(periodMonth: string, dueDay: number): Date {
  const [mm, yyyy] = periodMonth.split('/').map(Number);
  return new Date(yyyy, mm, dueDay); // JS month is 0-indexed, so `mm` (1-indexed) IS next month's index
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days between the due date and the filed date (or today,
 * if not yet filed — "still accruing", not a final figure). Never negative. */
export function computeDaysLate(dueDate: Date, filedDateIso: string | null): { daysLate: number; asOf: Date; stillAccruing: boolean } {
  const asOf = filedDateIso ? new Date(filedDateIso + 'T00:00:00') : new Date();
  const diffDays = Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY);
  return { daysLate: Math.max(0, diffDays), asOf, stillAccruing: !filedDateIso };
}

// ─────────────────── Interest (s.50 / Rule 88B(1)) ─────────────────────

const INTEREST_RATE_PCT = 18;
const DAYS_IN_YEAR = 365; // flat, no leap-year adjustment — see positions doc §2

/** Interest on the cash-ledger-discharged portion only (net of ITC set-off) —
 * pass the `cashPayable` output of computeItcOffset() (gstr3bReports.ts). */
export function computeInterest(cashPortion: TaxHeadAmounts, daysLate: number): TaxHeadAmounts & { total: number } {
  const factor = (INTEREST_RATE_PCT / 100 / DAYS_IN_YEAR) * daysLate;
  const igst = r2(cashPortion.igst * factor);
  const cgst = r2(cashPortion.cgst * factor);
  const sgst = r2(cashPortion.sgst * factor);
  return { igst, cgst, sgst, total: r2(igst + cgst + sgst) };
}

// ─────────────────── Late fee (s.47) ────────────────────────────────────

// See docs/INTEREST_LATE_FEE_POSITIONS.md §4 — verify against the current
// notification before relying on this for a live filing season.
export const LATE_FEE_SLABS = {
  nil: { perDayEachHead: 10, capEachHead: 250 },                 // ₹20/day total, ₹500 cap total
  upTo1_5Cr: { perDayEachHead: 25, capEachHead: 1000 },           // ₹50/day total, ₹2,000 cap total
  from1_5CrTo5Cr: { perDayEachHead: 25, capEachHead: 2500 },      // ₹50/day total, ₹5,000 cap total
  above5Cr: { perDayEachHead: 25, capEachHead: 5000 },            // ₹50/day total, ₹10,000 cap total
};

export type LateFeeTier = keyof typeof LATE_FEE_SLABS;

export function lateFeeTierForTurnover(aggregateTurnover: number | null): { tier: LateFeeTier; assumed: boolean } {
  if (aggregateTurnover == null) return { tier: 'from1_5CrTo5Cr', assumed: true }; // middle tier, flagged — see positions doc §4
  if (aggregateTurnover <= 1.5e7) return { tier: 'upTo1_5Cr', assumed: false };
  if (aggregateTurnover <= 5e7) return { tier: 'from1_5CrTo5Cr', assumed: false };
  return { tier: 'above5Cr', assumed: false };
}

export interface LateFeeResult { cgst: number; sgst: number; total: number; tier: LateFeeTier; turnoverAssumed: boolean; }

/** `isNil` = zero computed GSTR-3B liability for the period (outward + RCM)
 * — an approximation of the portal's own NIL-return test, see positions doc §4. */
export function computeLateFee(isNil: boolean, daysLate: number, aggregateTurnover: number | null): LateFeeResult {
  const { tier, assumed } = lateFeeTierForTurnover(aggregateTurnover);
  const slab = isNil ? LATE_FEE_SLABS.nil : LATE_FEE_SLABS[tier];
  const cgst = Math.min(slab.perDayEachHead * daysLate, slab.capEachHead);
  const sgst = cgst; // CGST and SGST legs are always symmetric under s.47
  return { cgst: r2(cgst), sgst: r2(sgst), total: r2(cgst + sgst), tier: isNil ? 'nil' : tier, turnoverAssumed: assumed };
}

// ─────────────────── Rule 42 ITC reversal ───────────────────────────────

export interface Rule42Input {
  itcAvailable: number;                    // Table 4A total for the period
  itcDirectlyAttributableExempt: number;   // optional "T1"
  exemptTurnover: number | null;
  aggregateTurnover: number | null;
}

export interface Rule42Result {
  commonCredit: number;
  ratio: number | null;    // exempt / aggregate, null if turnover not entered
  reversal: number;        // D1
  turnoverMissing: boolean;
}

export function computeRule42Reversal(input: Rule42Input): Rule42Result {
  const commonCredit = r2(input.itcAvailable - (input.itcDirectlyAttributableExempt || 0));
  const turnoverMissing = input.exemptTurnover == null || input.aggregateTurnover == null || input.aggregateTurnover === 0;
  if (turnoverMissing) return { commonCredit, ratio: null, reversal: 0, turnoverMissing: true };
  const ratio = (input.exemptTurnover as number) / (input.aggregateTurnover as number);
  return { commonCredit, ratio, reversal: r2(commonCredit * ratio), turnoverMissing: false };
}
