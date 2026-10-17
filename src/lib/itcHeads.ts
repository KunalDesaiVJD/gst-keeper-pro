// ITC typed in ITC Summary against what 2B gives, head by head. Shared by the
// ITC Summary "Typed, not from 2B" mark and the GSTR-3B page's typed list
// (src/utils/fetchGstr3b.ts), so the two always say the same thing.
// Row 5.2 may hold a negative head (a booked credit note), so heads are never
// netted against each other: IGST −800 with CGST/SGST +400 is typed, not empty.

export interface Heads {
  igst: number;
  cgst: number;
  sgst: number;
}

const total = (a: Heads) => a.igst + a.cgst + a.sgst;

/** Something is typed: the heads come to ₹0.50 or more, each counted whatever its sign. */
export const headsTyped = (a: Heads): boolean => Math.abs(a.igst) + Math.abs(a.cgst) + Math.abs(a.sgst) >= 0.5;

/** The same figure: within ₹1 in total and in every head. */
export const headsEqual = (a: Heads, b: Heads): boolean =>
  Math.abs(total(a) - total(b)) < 1
  && Math.abs(a.igst - b.igst) < 1 && Math.abs(a.cgst - b.cgst) < 1 && Math.abs(a.sgst - b.sgst) < 1;

/** The totals agree but the heads do not (IGST typed where 2B gives CGST/SGST, or a negative head). */
export const headsDifferOnly = (a: Heads, b: Heads): boolean => Math.abs(total(a) - total(b)) < 1 && !headsEqual(a, b);

/** Any head below zero. */
export const headsNegative = (a: Heads): boolean => a.igst < -0.005 || a.cgst < -0.005 || a.sgst < -0.005;

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "IGST −800.00, CGST 400.00, SGST 400.00" */
export const headsText = (a: Heads): string => `IGST ${inr(a.igst)}, CGST ${inr(a.cgst)}, SGST ${inr(a.sgst)}`;
