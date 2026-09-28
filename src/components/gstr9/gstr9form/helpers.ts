// Non-component helpers for the GSTR-9 form step (kept out of the .tsx files
// so React fast-refresh only sees components there).

import { createElement } from 'react';
import type { StepKey } from '@/lib/gstr9/engine';
import type { Formulas, Tax, TaxIn } from '@/lib/gstr9/types';
import type { CellTone, GridColumn } from '../grid/SheetGrid';
import type { MatrixHead } from '../ui';

/** The form's own column order: Taxable value, Central, State/UT, Integrated, Cess. */
export const FORM_HEADS: MatrixHead[] = ['t', 'c', 's', 'i', 'x'];
export const FORM_TAX_HEADS: MatrixHead[] = ['c', 's', 'i', 'x'];
export const FORM_HEAD_LABELS: Record<MatrixHead, string> = {
  t: 'Taxable value',
  c: 'Central tax',
  s: 'State/UT tax',
  i: 'Integrated tax',
  x: 'Cess',
};
export const TAX_ORDER: Array<keyof Tax> = ['c', 's', 'i', 'x'];


export const STEP_LABEL: Partial<Record<StepKey, string>> = {
  portal: 'Portal data',
  sales: 'Sales',
  purchases: 'Purchases & ITC',
  duties: 'Duties & Taxes',
  rcm: 'RCM',
  outward: 'Outward reco',
  itc: 'ITC reco',
  annexures: 'Annexures',
};

// "=a+b" memory. A TaxIn keeps its own (TaxIn.f, keyed by head); every other
// typed field of the GSTR-9 doc keeps it in docs.gstr9.f, keyed by field path
// (e.g. "t10.c", "t14.igst.payable", "t9Payable.igst").

/** Formula memory held on a TaxIn value. */
export const taxInF = (v: TaxIn | null): Formulas | undefined => v?.f;

/** Attach (or drop) the formula memory on a TaxIn value. */
export const withTaxInF = (v: TaxIn | null, f: Formulas | undefined): TaxIn | null => {
  if (!v) return v;
  const out: TaxIn = { i: v.i, c: v.c, s: v.s, x: v.x };
  if (f && Object.keys(f).length) out.f = f;
  return out;
};

/** A row's formulas (by column key) read from the doc-level map. */
export const docFormulas = (docF: Formulas | undefined, cols: string[], key: (col: string) => string | undefined): Formulas | undefined => {
  const out: Formulas = {};
  cols.forEach((c) => {
    const k = key(c);
    const v = k ? docF?.[k] : undefined;
    if (v) out[c] = v;
  });
  return Object.keys(out).length ? out : undefined;
};

/** The doc-level map with one row's formulas (by column key) written back. */
export const setDocFormulas = (
  docF: Formulas | undefined,
  cols: string[],
  key: (col: string) => string | undefined,
  rowF: Formulas | undefined,
): Formulas | undefined => {
  const out: Formulas = { ...(docF || {}) };
  cols.forEach((c) => {
    const k = key(c);
    if (!k) return;
    if (rowF?.[c]) out[k] = rowF[c];
    else delete out[k];
  });
  return Object.keys(out).length ? out : undefined;
};

/** Did staff type (part of) this portal figure by hand? `prefix` like "gstr9.table4.b2b". */
export const isManualPath = (manual: Record<string, true> | undefined, prefix: string): boolean =>
  Object.keys(manual || {}).some((k) => k === prefix || k.startsWith(`${prefix}.`));

/** A typed override seeded from the computed figure, so the other heads don't jump to 0. */
export const seedTaxIn = (t: Tax | null | undefined): TaxIn => {
  if (!t) return { i: 0, c: 0, s: null, x: 0 };
  return { i: t.i, c: t.c, s: Math.abs(t.s - t.c) < 0.005 ? null : t.s, x: t.x };
};

/** FY "2025-26" → 2025. */
export const fyStartYear = (fy: string): number => Number(String(fy).slice(0, 4)) || 0;

/** Tailwind classes for a CellTone outside the grid (FormTable cells). */
export const toneClass = (t: CellTone): string =>
  t === 'error' ? 'text-destructive font-medium' : t === 'ok' ? 'text-success' : t === 'muted' ? 'text-muted-foreground' : t === 'warn' ? 'text-warning-foreground' : '';

/** A single sticky "Particulars" column showing the row code and label. */
export const particularsCol = <R extends { code: string; label: string; title?: string }>(header = 'Particulars', width = 250): GridColumn<R> => ({
  key: 'particulars',
  header,
  type: 'display',
  align: 'left',
  width,
  sticky: true,
  value: (r) => (r.code ? `${r.code} ${r.label}` : r.label),
  render: (r) =>
    createElement(
      'span',
      { className: 'inline-flex items-baseline gap-1.5' },
      r.code ? createElement('span', { className: 'font-mono text-[10px] font-semibold text-muted-foreground' }, r.code) : null,
      r.label,
    ),
  title: (r) => r.title ?? r.label,
});
