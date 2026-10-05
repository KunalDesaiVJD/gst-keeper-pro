// Payables found by the annual reconciliation, disclosed output-wise and
// input-wise, and how each was set off. A set-off is recorded only against
// evidence in the system (annual_return_payable_setoffs, database-enforced):
//  * a DRC-03 imported into the system — synced from the portal
//    (gst_drc03_filings) or its copy uploaded with ARN and date, or
//  * an effect given in a GSTR-3B — the return period, its filing date and
//    the filed GSTR-3B's copy.
// Set-offs are not blocked by the year's lock: DRC-03s are usually paid after
// GSTR-9/9C is filed.

import type { Tax } from './types';

export type PayableSide = 'output' | 'input';
export type SetOffMethod = 'drc03' | 'gstr3b';

export const SIDE_LABEL: Record<PayableSide, string> = { output: 'Output tax', input: 'Input tax credit' };
export const METHOD_LABEL: Record<SetOffMethod, string> = { drc03: 'DRC-03', gstr3b: 'GSTR-3B' };

/** Where a GSTR-3B effect is given, per side. */
export const GSTR3B_TABLES: Record<PayableSide, string[]> = {
  output: ['3.1(a)', '3.1(b)', '3.1(c)', '3.1(d)', '3.1(e)'],
  input: ['4(B)(1)', '4(B)(2)', '4(D)'],
};

export interface SetOff {
  id: string;
  side: PayableSide;
  method: SetOffMethod;
  /** gst_drc03_filings.id when set off against a DRC-03 synced from the portal. */
  drc03Id: string | null;
  /** DRC-03 ARN, or the GSTR-3B ARN when given. */
  reference: string | null;
  /** DRC-03 date, or the GSTR-3B filing date. */
  docDate: string | null;
  /** "MM/YYYY" — the GSTR-3B in which the effect was given. */
  gstr3bPeriod: string | null;
  /** Table of the GSTR-3B the effect went into, e.g. "3.1(a)" or "4(B)(2)". */
  gstr3bTable: string | null;
  evidenceUrl: string | null;
  evidenceName: string | null;
  tax: Tax;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

/** A DRC-03 as synced from the portal by the browser extension (gst_drc03_filings). */
export interface Drc03Filing {
  id: string;
  arn: string | null;
  filedDate: string | null;
  financialYear: string | null;
  cause: string | null;
  section: string | null;
  status: string | null;
  tax: Tax;
  interest: number;
  lateFee: number;
  penalty: number;
  pdfUrl: string | null;
}

/** What the engine needs of a set-off (live ones only). */
export type SetOffLite = Pick<SetOff, 'side' | 'method' | 'tax'>;

/** A DRC-03's "Annual return" FY ("2023-2024") against the working's FY ("2023-24"). */
export const drc03MatchesFY = (drc03Fy: string | null | undefined, financialYear: string): boolean => {
  if (!drc03Fy) return false;
  return drc03Fy.slice(0, 4) === financialYear.slice(0, 4);
};

/** What a synced DRC-03 still has left after the (live) set-offs already made against it. */
export const drc03Available = (d: Drc03Filing, setOffs: SetOff[]): Tax => {
  const used = setOffs
    .filter((o) => !o.deletedAt && o.drc03Id === d.id)
    .reduce((a, o) => ({ i: a.i + o.tax.i, c: a.c + o.tax.c, s: a.s + o.tax.s, x: a.x + o.tax.x }), { i: 0, c: 0, s: 0, x: 0 });
  return {
    i: Math.max(d.tax.i - used.i, 0),
    c: Math.max(d.tax.c - used.c, 0),
    s: Math.max(d.tax.s - used.s, 0),
    x: Math.max(d.tax.x - used.x, 0),
  };
};
