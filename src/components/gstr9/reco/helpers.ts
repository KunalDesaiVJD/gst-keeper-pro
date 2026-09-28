// Small helpers shared by the reconciliation steps (Outward reco, ITC reco,
// 9C expense heads). No tax logic lives here — every figure these steps show
// comes from computeWorkings(); these only shape rows for the grids/tables.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StepKey } from '@/lib/gstr9/engine';
import type { Formulas, Tax, TaxIn, ValTax } from '@/lib/gstr9/types';
import type { CellTone, GridColumn } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';

/** Link to another step, keeping the open client (and everything else) in the URL. */
export const useGoToStep = () => {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (key: StepKey) => {
      const next = new URLSearchParams(params);
      next.set('step', key);
      setParams(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );
};

export const EPS = 0.004;
export const nz = (v: number | null | undefined): boolean => Math.abs(v ?? 0) > EPS;
export const anyTax = (t: Partial<ValTax> | Tax | null | undefined): boolean =>
  !!t && (nz(t.i) || nz(t.c) || nz(t.s) || nz(t.x));
export const anyValTax = (t: Partial<ValTax> | null | undefined): boolean => !!t && (nz(t.t) || anyTax(t));

/** Text classes for a CellTone, matching SheetGrid's own cell tones. */
export const toneClass = (tone: CellTone): string =>
  tone === 'error'
    ? 'text-destructive-strong font-medium'
    : tone === 'warn'
      ? 'bg-warning/15 font-medium text-foreground'
      : tone === 'ok'
        ? 'text-success-strong'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : '';

/** A computed Tax as a typed cell — SGST stays mirrored when it equals CGST. */
export const taxToIn = (t: Tax): TaxIn => ({ i: t.i, c: t.c, s: Math.abs(t.s - t.c) < 0.005 ? null : t.s, x: t.x });

export const HEAD_NAME: Record<keyof Tax, string> = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };
/** Head names as the GSTR-9 form prints them (used with FORM_ORDER, like the GSTR-9 step). */
export const FORM_HEAD_NAME: Record<keyof Tax, string> = { c: 'Central tax', s: 'State/UT tax', i: 'Integrated tax', x: 'Cess' };
/** The Excel working sheets (GSTR 9-OUTPUT / 9-INPUT / 9C): IGST, CGST, SGST, Cess. */
export const SHEET_ORDER: Array<keyof Tax> = ['i', 'c', 's', 'x'];
/**
 * The GSTR-9 form (and the firm's GSTR-9 sheet, G:J): Central, State/UT,
 * Integrated, Cess — so a block copied from the form or that sheet pastes
 * into the right columns.
 */
export const FORM_ORDER: Array<keyof Tax> = ['c', 's', 'i', 'x'];

/**
 * Re-order (and optionally re-label) tax columns — keys ending ".i/.c/.s/.x"
 * or plain "i/c/s/x"; other columns keep their place.
 */
export function orderTaxCols<R>(cols: GridColumn<R>[], order: Array<keyof Tax>, names?: Record<keyof Tax, string>): GridColumn<R>[] {
  const headOf = (c: GridColumn<R>): keyof Tax | null => {
    const h = c.key.split('.').pop();
    return h === 'i' || h === 'c' || h === 's' || h === 'x' ? h : null;
  };
  const tax: GridColumn<R>[] = [];
  order.forEach((h) => {
    const c = cols.find((col) => headOf(col) === h);
    if (c) tax.push(names ? { ...c, header: names[h] } : c);
  });
  let k = 0;
  return cols.map((c) => (headOf(c) ? tax[k++] : c));
}

/** Attach (or drop) the "=a+b" memory on a typed cell group (TaxIn.f); null passes through. */
export function withFormulas(v: TaxIn, f: Formulas | undefined): TaxIn;
export function withFormulas(v: TaxIn | null, f: Formulas | undefined): TaxIn | null;
export function withFormulas(v: TaxIn | null, f: Formulas | undefined): TaxIn | null {
  if (!v) return v;
  const { f: _previous, ...rest } = v;
  return f && Object.keys(f).length ? { ...rest, f } : rest;
}

/**
 * Formulas of one fixed row kept in a doc-level `f` map under a field path
 * (e.g. "t4BooksExtra.at.t"), for stored shapes without their own `f`.
 */
export const pathFormulas = (docF: Formulas | undefined, prefix: string): Formulas | undefined => {
  const out: Formulas = {};
  Object.entries(docF ?? {}).forEach(([k, v]) => {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  });
  return Object.keys(out).length ? out : undefined;
};

/** Replace every doc-level formula under `root` with the given rows' formulas (keyed `${root}${id}.${col}`). */
export const mergePathFormulas = (
  docF: Formulas | undefined,
  root: string,
  rows: Array<{ id: string; f?: Formulas }>,
): Formulas | undefined => {
  const out: Formulas = {};
  Object.entries(docF ?? {}).forEach(([k, v]) => {
    if (!k.startsWith(root)) out[k] = v;
  });
  rows.forEach((r) =>
    Object.entries(r.f ?? {}).forEach(([k, v]) => {
      out[`${root}${r.id}.${k}`] = v;
    }),
  );
  return Object.keys(out).length ? out : undefined;
};

/**
 * A grid row whose tax is either typed (`v`) or, while `v` is null, a
 * computed default (`computed`) shown in italics as a placeholder. Typing any
 * head starts an override from the computed figures; the owner offers a
 * "use computed" reset that sets `v` back to null.
 */
export interface OverrideRow {
  id: string;
  v: TaxIn | null;
  /** Default shown while `v` is null. null = the row is always typed. */
  computed: Tax | null;
  /** "=a+b" memory, keyed by column key — read from v.f, store with withFormulas(v, f). */
  f?: Formulas;
}

/** IGST / CGST / SGST (mirrors CGST) / Cess columns for OverrideRow grids. */
export function overrideTaxCols<R extends OverrideRow>(
  opts: {
    editable?: (r: R) => boolean;
    /** Tooltip on a cell that shows the computed default. */
    computedHint?: string | ((r: R) => string);
    order?: Array<keyof Tax>;
    names?: Record<keyof Tax, string>;
    group?: string;
  } = {},
): GridColumn<R>[] {
  const base = (r: R): TaxIn => r.v ?? taxToIn(r.computed ?? { i: 0, c: 0, s: 0, x: 0 });
  return (opts.order ?? SHEET_ORDER).map((h) =>
    moneyCol<R>(
      h,
      (opts.names ?? HEAD_NAME)[h],
      (r) => (r.v ? r.v[h] : null),
      (r, n) => {
        // Clearing a cell of a row that still follows its computed default changes nothing.
        if (r.v == null && n == null) return r;
        const next: TaxIn = { i: base(r).i, c: base(r).c, s: base(r).s, x: base(r).x };
        if (h === 's') next.s = n ?? null;
        else next[h] = n ?? 0;
        return { ...r, v: next };
      },
      {
        nullable: true,
        group: opts.group,
        width: h === 'x' ? 100 : 124,
        editable: opts.editable,
        placeholder: (r) => (r.v ? (h === 's' ? r.v.c : null) : r.computed ? r.computed[h] : null),
        title: (r) =>
          r.v == null && r.computed
            ? (typeof opts.computedHint === 'function' ? opts.computedHint(r) : opts.computedHint) ?? 'Computed — type to override'
            : h === 's' && r.v && r.v.s == null
              ? `Mirrors ${(opts.names ?? HEAD_NAME).c} — type to override, clear to mirror again`
              : undefined,
      },
    ),
  );
}

/** Keep a GSTR-9 offline-tool description within its 30-character limit. */
export const DESC_MAX = 30;
