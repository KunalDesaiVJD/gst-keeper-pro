// Rate-wise breakup of a Duties & Taxes month (optional). A month's typed group
// (Sales, Credit note, Purchase, Debit note) is either one books figure typed
// directly, or the sum of its rate lines. The sum is written into the group's
// TaxIn whenever the lines change, so the engine (computeWorkings) and every
// export keep reading the group figure alone and never need to know which way
// it was entered.

import type { DtRateLine, Tax, TaxIn, ValTax } from './types';

/** Quick-add rates for a new line (any other rate, e.g. 0.1% or 6%, can be typed in the Rate % cell). */
export const GST_RATES = [0.25, 1.5, 3, 5, 7.5, 12, 18, 28, 40] as const;

const n0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n: number): number => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) || Math.abs(r) < 0.005 ? 0 : r;
};

/** A line's tax by head (SGST mirrors CGST). */
export const rateLineTax = (l: DtRateLine): Tax => ({ i: n0(l.igst), c: n0(l.cgst), s: l.sgst === null || l.sgst === undefined ? n0(l.cgst) : n0(l.sgst), x: n0(l.cess) });

/** Lines that carry anything (a blank line added and left empty is not part of the breakup). */
export const meaningfulLines = (lines: DtRateLine[] | null | undefined): DtRateLine[] =>
  (lines ?? []).filter((l) => n0(l.taxable) || n0(l.igst) || n0(l.cgst) || n0(l.sgst) || n0(l.cess));

/** True when the group has a rate-wise breakup (and so its figure is computed, not typed). */
export const hasRateLines = (lines: DtRateLine[] | null | undefined): boolean => meaningfulLines(lines).length > 0;

/** Taxable value and tax of the lines, summed. */
export const rateLinesTotal = (lines: DtRateLine[] | null | undefined): ValTax =>
  meaningfulLines(lines).reduce<ValTax>(
    (a, l) => {
      const t = rateLineTax(l);
      return { t: r2(a.t + n0(l.taxable)), i: r2(a.i + t.i), c: r2(a.c + t.c), s: r2(a.s + t.s), x: r2(a.x + t.x) };
    },
    { t: 0, i: 0, c: 0, s: 0, x: 0 },
  );

/** The group's books figure from its lines: IGST, CGST and Cess summed, SGST mirroring CGST. */
export const rollUpRateLines = (lines: DtRateLine[] | null | undefined): TaxIn => {
  const t = rateLinesTotal(lines);
  return { i: t.i, c: t.c, s: null, x: t.x };
};

/** Taxable value and tax per rate (and supply), for the summary and the working paper. */
export const rateLinesByRate = (lines: DtRateLine[] | null | undefined): Array<{ rate: number | null; supply: DtRateLine['supplyType']; total: ValTax }> => {
  const map = new Map<string, { rate: number | null; supply: DtRateLine['supplyType']; total: ValTax }>();
  meaningfulLines(lines).forEach((l) => {
    const k = `${l.rate ?? ''}|${l.supplyType}`;
    const cur = map.get(k) ?? { rate: l.rate ?? null, supply: l.supplyType, total: { t: 0, i: 0, c: 0, s: 0, x: 0 } };
    const t = rateLineTax(l);
    cur.total = { t: r2(cur.total.t + n0(l.taxable)), i: r2(cur.total.i + t.i), c: r2(cur.total.c + t.c), s: r2(cur.total.s + t.s), x: r2(cur.total.x + t.x) };
    map.set(k, cur);
  });
  return [...map.values()].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1) || a.supply.localeCompare(b.supply));
};
