// The "five percentage points for every quarter or part thereof" reduction
// of ITC on capital goods, shared by every rule that uses it:
//   s.18(6) / Rule 40(2) / Rule 44(6) — capital goods sold (capitalGoods.ts),
//   s.18(4) / Rule 44(1)(b) — switch to composition or exempt supplies,
//   Rule 43 — capital goods moving from exempt-only use to common use.
//
// A quarter is a run of three months counted from the date of the invoice
// (not a calendar quarter): the first runs from the invoice date to the day
// before the same date three months later. Any part of a quarter counts in
// full, so an event on the invoice date itself is in the first quarter.
// Twenty quarters reduce the credit to nil.
//
// Pure, no imports: node --experimental-strip-types can run it directly
// (scripts/verify-capital-goods-sold.mjs).

/** "2025-09-10" (or a Date) → a UTC date at midnight; null when it cannot be read. */
export const parseIsoDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const out = new Date(Date.UTC(y, mo, d));
  return out.getUTCFullYear() === y && out.getUTCMonth() === mo && out.getUTCDate() === d ? out : null;
};

/** The same day `n` months later; a day the month does not have becomes its last day (31 Jan + 1 → 28/29 Feb). */
export const addMonthsUtc = (d: Date, n: number): Date => {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
};

/** Quarters at which the credit is nil (20 × 5 = 100 percentage points). */
export const NIL_AFTER_QUARTERS = 20;
/** Percentage points taken off for each quarter or part of one. */
export const POINTS_PER_QUARTER = 5;

/**
 * Quarters, or parts of a quarter, from the invoice date to the event date
 * (a sale, a switch of scheme, a change of use). An event on the invoice date
 * is in quarter 1; one on the date three months later starts quarter 2.
 * null when a date is missing or unreadable, or the event is before the invoice.
 */
export const quartersOrPart = (invoiceDate: string | Date | null | undefined, eventDate: string | Date | null | undefined): number | null => {
  const inv = parseIsoDate(invoiceDate);
  const ev = parseIsoDate(eventDate);
  if (!inv || !ev || ev.getTime() < inv.getTime()) return null;
  // Count the quarters that have started on or before the event: k = 0, 1, … while invoice + 3k months ≤ event.
  let k = 0;
  while (addMonthsUtc(inv, 3 * (k + 1)).getTime() <= ev.getTime()) k++;
  return k + 1;
};

/** The share of the credit left after `quarters`: 1 − 5% × quarters, never below nil. */
export const remainingShare = (quarters: number): number =>
  Math.max(0, 1 - (POINTS_PER_QUARTER * Math.max(0, quarters)) / 100);

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The credit as reduced, head by head (Rule 44(6): worked separately for each
 * tax): each head × (1 − 5% × quarters), rounded to the paisa, nil after 20 quarters.
 */
export const reduceByQuarters = <T extends Record<string, number>>(itc: T, quarters: number): T => {
  const share = remainingShare(quarters);
  return Object.fromEntries(Object.entries(itc).map(([k, v]) => [k, round2((Number(v) || 0) * share)])) as T;
};
