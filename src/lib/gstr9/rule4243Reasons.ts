// GSTR-9C Tables 13 / 15 and 16 from the Rule 42/43 working: the reason line
// for the un-reconciled ITC that the working explains, and the tax still to be
// paid on it. Offered on the GSTR-9C step as a button, never written by
// itself (the reasons are the auditor's words). docs/GSTR9_9C_WORKINGS.md §6
// position 43. Lines use only the characters the 9C utility accepts
// (REASON_CHARS_REGEX: no rupee sign, percent, dash or double quote).

import type { Gstr9cT16Key, Tax } from './types';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const tot = (t: Tax) => r2(t.i + t.c + t.s + t.x);
const amt = (n: number) => `Rs. ${r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface Rule4243ReasonInput {
  financialYear: string;
  on: boolean;
  t7C: Tax;
  t7D: Tax;
  /** Still to reverse after the GSTR-3Bs (Payables), and its interest. */
  payable42: Tax;
  payable43: Tax;
  interest42: Tax;
  interest43: Tax;
  postingPeriod: string;
  builderR42: Tax;
  builderR43: Tax;
}

export interface Rule4243Reason {
  /** The reason lines (Table 13; the same lines suit Table 15). Empty when there is nothing to explain. */
  lines: string[];
  /** Table 16 amounts: A Central, B State/UT, C Integrated, D Cess, E Interest (F Penalty left out). */
  t16: Partial<Record<Gstr9cT16Key, number>>;
  hasPayable: boolean;
}

export function rule4243Reason(x: Rule4243ReasonInput): Rule4243Reason {
  const lines: string[] = [];
  if (!x.on) return { lines, t16: {}, hasPayable: false };
  const c = tot(x.t7C);
  const d = tot(x.t7D);
  if (c > 0.005 || d > 0.005) {
    const parts = [
      c > 0.005 ? `Rule 42 ${amt(c)} (GSTR-9 Table 7C)` : '',
      d > 0.005 ? `Rule 43 ${amt(d)} (GSTR-9 Table 7D)` : '',
    ].filter(Boolean).join(' and ');
    lines.push(`ITC on common inputs, input services and capital goods attributable to exempt supplies reversed under ${parts} for FY ${x.financialYear}, worked on the turnover ratio E/F of each tax period with the annual determination under rule 42(2).`);
  }
  const b = tot(x.builderR42) + tot(x.builderR43);
  if (b > 0.005) {
    lines.push(`Of this, ${amt(b)} is the final reversal at completion of the project on carpet area (units unsold at completion, Schedule III para 5), included in 7C and 7D.`);
  }
  const pay = { i: x.payable42.i + x.payable43.i, c: x.payable42.c + x.payable43.c, s: x.payable42.s + x.payable43.s, x: x.payable42.x + x.payable43.x };
  const int = tot(x.interest42) + tot(x.interest43);
  const hasPayable = tot(pay) > 0.005;
  if (hasPayable) {
    lines.push(`${amt(tot(pay))} of the reversal was not made in the GSTR-3B returns of the year and is paid with interest of ${amt(int)} under section 50 through the GSTR-3B of ${x.postingPeriod} or DRC-03.`);
  }
  const t16: Rule4243Reason['t16'] = hasPayable
    ? { A: r2(pay.c), B: r2(pay.s), C: r2(pay.i), D: r2(pay.x), E: r2(int) }
    : {};
  return { lines, t16, hasPayable };
}
