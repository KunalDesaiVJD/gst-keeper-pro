// Small, pure helpers shared by the Annexures and Notice steps. No tax logic
// lives here — every figure these steps show comes from computeWorkings().

import type { Formulas, Tax, TaxIn } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';

export type Head = keyof Tax;

export const HEAD_NAME: Record<Head, string> = { i: 'IGST', c: 'CGST', s: 'SGST / UTGST', x: 'Cess' };

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * A resolved figure as a typed cell. SGST becomes `null` (mirrors CGST) when
 * it equals CGST, so a later CGST edit carries SGST along — the Excel's `=F`.
 */
export const toTaxIn = (t: Tax): TaxIn => ({ i: t.i, c: t.c, s: same(t.s, t.c) ? null : t.s, x: t.x });

/** A resolved figure as a typed cell with SGST written out (no mirror). */
export const explicitTaxIn = (t: Tax): TaxIn => ({ i: t.i, c: t.c, s: t.s, x: t.x });

/** Set one head of a typed cell. A cleared SGST goes back to mirroring CGST; any other cleared head is 0. */
export const setHead = (t: TaxIn, h: Head, v: number | null): TaxIn => (h === 's' ? { ...t, s: v } : { ...t, [h]: v ?? 0 });

/** Remember (or forget) the "=a+b" expression typed into one head of a cell group. */
export const setHeadFormula = (t: TaxIn, h: Head, formula: string | undefined): TaxIn => {
  const prev = t.f || {};
  if (!formula && !(h in prev)) return t;
  const f: Formulas = { ...prev };
  if (formula) f[h] = formula;
  else delete f[h];
  const { f: _drop, ...rest } = t;
  return Object.keys(f).length ? { ...rest, f } : rest;
};

/** Doc-level formulas under "prefix." (e.g. "deemedSupplies.c") → keyed by the rest ("c"). */
export const pickFormulas = (f: Formulas | undefined, prefix: string): Formulas | undefined => {
  const out: Formulas = {};
  Object.entries(f || {}).forEach(([k, v]) => {
    if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  });
  return Object.keys(out).length ? out : undefined;
};

/** Replace the doc-level formulas under "prefix." with `sub`. */
export const putFormulas = (f: Formulas | undefined, prefix: string, sub: Formulas | undefined): Formulas => {
  const out: Formulas = {};
  Object.entries(f || {}).forEach(([k, v]) => {
    if (!k.startsWith(`${prefix}.`)) out[k] = v;
  });
  Object.entries(sub || {}).forEach(([k, v]) => {
    out[`${prefix}.${k}`] = v;
  });
  return out;
};

export const hasAmount = (t: Tax): boolean => [t.i, t.c, t.s, t.x].some((v) => !same(v, 0));

/** "2024-25" → "2023-24". */
export const previousFY = (fy: string): string => {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

/** URL search param that keeps the open Annexure tab (a1–a4) alongside ?client=&step=. */
export const ANNEX_TAB_PARAM = 'ann';

/** ₹12,34,567.00 / −₹9,897.46 — for KPI tiles. */
export const rupees = (n: number): string => (n < -0.004 ? `−₹${fmtMoney(-n)}` : `₹${fmtMoney(n)}`);
