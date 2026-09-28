// Shared plumbing for the GSTR-9C step: the line model behind every 9C
// grid, the "computed unless typed" edit rule, and the computed defaults
// shown under an override.
//
// No tax logic lives here. Every figure comes from computeWorkings(); the
// figure under an override is the engine's `gstr9c.defaults`, so the
// placeholder is exactly what "Use computed" would give.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StepKey } from '@/lib/gstr9/engine';
import type { Gstr9cDoc, RateWiseRow, Tax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';

/** One figure column of a 9C table. */
export type FormHead = 't' | 'c' | 's' | 'i' | 'x';

/** The 9C offline utility's column order: Value, Central, State/UT, Integrated, Cess. */
export const FORM_HEADS: FormHead[] = ['t', 'c', 's', 'i', 'x'];
export const TAX_HEADS: FormHead[] = ['c', 's', 'i', 'x'];
export const FORM_HEAD_LABEL: Record<FormHead, string> = {
  t: 'Value',
  c: 'Central tax',
  s: 'State/UT tax',
  i: 'Integrated tax',
  x: 'Cess',
};

export type Figures = Partial<Record<FormHead, number>>;

/**
 * One row of a 9C table.
 *  - `typed`: staff enter it (stored is never null);
 *  - `override`: computed unless typed (stored null = follow the computed default `def`);
 *  - `computed`: read-only engine figure (`shown`).
 */
export interface FormLine {
  id: string;
  /** Row letter as on the form, e.g. "5A". */
  code: string;
  label: string;
  /** Muted suffix after the label: sign "(+)", formula "(Q − P)" … */
  hint?: string;
  mode: 'typed' | 'override' | 'computed';
  /** Columns this row has; the others show "—". */
  heads: FormHead[];
  shown?: Figures;
  stored?: Figures | null;
  def?: Figures;
  /** Writes the row back into the 9C doc (override: null = computed again). */
  write?: (doc: Gstr9cDoc, v: Figures | null) => Gstr9cDoc;
  /**
   * Field path of the row in the 9C doc (e.g. "t9.E", "t5A"), under which typed
   * "=a+b" expressions are remembered in `doc.f` ("t9.E.c"; single-column rows use the path itself).
   */
  fKey?: string;
  /** Expression changes made in the grid, by `doc.f` path (null = drop). Set by FormGrid while editing. */
  fEdits?: Record<string, string | null>;
  /** Short name of where the computed default comes from ("Books", "GSTR-9" …). */
  source?: string;
  sourceTitle?: string;
  /** Difference line key (engine `diffs`) — shows its JustifyControl on the row. */
  diffKey?: string;
  emphasis?: 'total' | 'diff';
  /** A per-cell warning (e.g. a negative figure in a row the form subtracts). */
  warn?: (h: FormHead, v: number) => string | null;
}

const EPS = 0.005;
export const n0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The figure a row shows in one column (override rows show the computed default until typed). */
export const lineValue = (l: FormLine, h: FormHead): number | null => {
  if (!l.heads.includes(h)) return null;
  if (l.mode === 'computed') return n0(l.shown?.[h]);
  if (l.mode === 'typed') return n0(l.stored?.[h]);
  return l.stored ? n0(l.stored[h]) : n0(l.def?.[h]);
};

/** The `doc.f` key of one cell, or null when the row doesn't remember expressions. */
export const fPath = (l: FormLine, h: FormHead): string | null => {
  if (!l.fKey) return null;
  return l.heads.length === 1 ? l.fKey : `${l.fKey}.${h}`;
};

/** Every `doc.f` key a row can hold. */
export const fPaths = (l: FormLine): string[] => l.heads.map((h) => fPath(l, h)).filter((p): p is string => !!p);

/**
 * Apply one edited cell. Typed rows: cleared = 0. Override rows: the first
 * typed cell copies the computed default for the other columns; a cleared
 * cell goes back to its computed figure, and once every column equals the
 * computed default the row follows the computation again (null).
 */
export function editLine(l: FormLine, h: FormHead, v: number | null): Figures | null {
  if (l.mode === 'typed') return { ...(l.stored || {}), [h]: v ?? 0 };
  if (l.mode !== 'override') return l.stored ?? null;
  const def = l.def || {};
  const next: Figures = l.stored ? { ...l.stored } : { ...def };
  next[h] = v === null ? n0(def[h]) : v;
  const same = l.heads.every((k) => Math.abs(n0(next[k]) - n0(def[k])) < EPS);
  return same ? null : next;
}

// ---------------------------------------------------------------------------
// Converters between the stored shapes and Figures
// ---------------------------------------------------------------------------

type TaxLike = { i?: number | null; c?: number | null; s?: number | null; x?: number | null; t?: number | null };

/** Tax / ValTax → Figures. A null SGST mirrors CGST (the TaxIn rule). */
export const figs = (v: TaxLike | null | undefined, withValue = true): Figures | null => {
  if (!v) return null;
  const c = n0(v.c);
  const out: Figures = { c, s: v.s === null || v.s === undefined ? c : n0(v.s), i: n0(v.i), x: n0(v.x) };
  if (withValue) out.t = n0(v.t);
  return out;
};

export const amount = (v: number | null | undefined): Figures | null => (v === null || v === undefined ? null : { t: n0(v) });

export const toRateRow = (f: Figures): RateWiseRow => ({ t: n0(f.t), i: n0(f.i), c: n0(f.c), s: n0(f.s), x: n0(f.x) });
export const toTax = (f: Figures): Tax => ({ i: n0(f.i), c: n0(f.c), s: n0(f.s), x: n0(f.x) });

/** Column totals of typed rows, for the footer of the purely manual tables (11, 16, Part V). */
export const columnTotals = (lines: FormLine[], heads: FormHead[]): Record<string, number> => {
  const out: Record<string, number> = {};
  heads.forEach((h) => {
    out[h] = lines.reduce((s, l) => s + (l.heads.includes(h) ? n0(lineValue(l, h)) : 0), 0);
  });
  return out;
};

export const HEAD_SHORT: Record<keyof Tax, string> = { c: 'CGST', s: 'SGST', i: 'IGST', x: 'Cess' };
export const HEAD_ORDER: Array<keyof Tax> = ['c', 's', 'i', 'x'];

/** Non-zero heads of a tax figure, "CGST 1,200.00 · SGST 1,200.00", or "Nil". */
export const headsText = (t: Tax): string => {
  const parts = HEAD_ORDER.filter((h) => Math.abs(t[h]) >= 0.005).map((h) => `${HEAD_SHORT[h]} ${fmtMoney(t[h])}`);
  return parts.length ? parts.join(' · ') : 'Nil';
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Open another step, keeping the client (and everything else) in the URL. */
export function useGoToStep(): (step: StepKey) => void {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (step: StepKey) => {
      const next = new URLSearchParams(params);
      next.set('step', step);
      setParams(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );
}
