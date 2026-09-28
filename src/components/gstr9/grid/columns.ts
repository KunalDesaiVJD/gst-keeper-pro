import type { Formulas, Tax, TaxIn } from '@/lib/gstr9/types';
import type { CellEdit, CellTone, GridColumn } from './SheetGrid';

// Column builders shared by every entry grid, so IGST / CGST / SGST / Cess
// behave identically everywhere (SGST mirrors CGST until typed, formulas are
// remembered per field, cleared money cells become 0).

type WithF = { f?: Formulas };

const getF = (row: unknown, field: string): string | undefined => (row as WithF)?.f?.[field];

const withF = <R,>(row: R, field: string, formula: string | undefined): R => {
  const prev = (row as WithF).f || {};
  if (!formula && !(field in prev)) return row;
  const f = { ...prev };
  if (formula) f[field] = formula;
  else delete f[field];
  return { ...(row as object), f } as R;
};

export interface MoneyColOpts<R> {
  group?: string;
  width?: number;
  tone?: (row: R) => CellTone;
  title?: (row: R) => string | undefined;
  editable?: (row: R) => boolean;
  /** Muted value shown while the stored value is null. */
  placeholder?: (row: R) => number | null | undefined;
  /** Keep null (instead of 0) when cleared — for "computed unless typed" cells. */
  nullable?: boolean;
  sticky?: boolean;
}

/** An editable money column bound to one numeric field of the row. */
export function moneyCol<R>(
  key: string,
  header: string,
  get: (row: R) => number | null | undefined,
  set: (row: R, value: number | null) => R,
  opts: MoneyColOpts<R> = {},
): GridColumn<R> {
  return {
    key,
    header,
    group: opts.group,
    type: 'money',
    width: opts.width ?? 118,
    value: (r) => {
      const v = get(r);
      return v === null || v === undefined ? (opts.nullable ? null : null) : v;
    },
    placeholder: opts.placeholder,
    formula: (r) => getF(r, key),
    editable: opts.editable,
    tone: opts.tone,
    title: opts.title,
    sticky: opts.sticky,
    onEdit: (r: R, e: CellEdit) => withF(set(r, e.num === null ? (opts.nullable ? null : 0) : e.num), key, e.formula),
  };
}

/** A read-only money column. */
export function displayCol<R>(
  key: string,
  header: string,
  get: (row: R, index: number) => number | null | undefined,
  opts: { group?: string; width?: number; tone?: (row: R) => CellTone; title?: (row: R) => string | undefined } = {},
): GridColumn<R> {
  return { key, header, group: opts.group, type: 'money', width: opts.width ?? 118, value: get, tone: opts.tone, title: opts.title };
}

export interface TaxColsOpts<R> {
  group?: string;
  /** Prefix for column keys (and formula memory), e.g. "sales" → "sales.i". */
  prefix: string;
  cess?: boolean;
  igst?: boolean;
  editable?: (row: R) => boolean;
  tone?: (row: R, head: keyof Tax) => CellTone;
}

/**
 * IGST / CGST / SGST (/ Cess) columns for a TaxIn field. SGST shows the CGST
 * figure in italics while it mirrors it (the Excel's `=F` cells); typing a
 * value breaks the mirror, clearing it restores the mirror.
 */
export function taxInCols<R>(get: (row: R) => TaxIn, set: (row: R, t: TaxIn) => R, opts: TaxColsOpts<R>): GridColumn<R>[] {
  const p = opts.prefix;
  const cols: GridColumn<R>[] = [];
  if (opts.igst !== false) {
    cols.push(moneyCol<R>(`${p}.i`, 'IGST', (r) => get(r).i, (r, v) => set(r, { ...get(r), i: v ?? 0 }), {
      group: opts.group, editable: opts.editable, tone: opts.tone ? (r) => opts.tone!(r, 'i') : undefined,
    }));
  }
  cols.push(moneyCol<R>(`${p}.c`, 'CGST', (r) => get(r).c, (r, v) => set(r, { ...get(r), c: v ?? 0 }), {
    group: opts.group, editable: opts.editable, tone: opts.tone ? (r) => opts.tone!(r, 'c') : undefined,
  }));
  cols.push(moneyCol<R>(`${p}.s`, 'SGST', (r) => get(r).s, (r, v) => set(r, { ...get(r), s: v }), {
    group: opts.group,
    editable: opts.editable,
    nullable: true,
    placeholder: (r) => get(r).c,
    title: (r) => (get(r).s === null ? 'Mirrors CGST — type to override, clear to mirror again' : undefined),
    tone: opts.tone ? (r) => opts.tone!(r, 's') : undefined,
  }));
  if (opts.cess) {
    cols.push(moneyCol<R>(`${p}.x`, 'Cess', (r) => get(r).x, (r, v) => set(r, { ...get(r), x: v ?? 0 }), {
      group: opts.group, editable: opts.editable, width: 96, tone: opts.tone ? (r) => opts.tone!(r, 'x') : undefined,
    }));
  }
  return cols;
}

/** Read-only IGST / CGST / SGST (/ Cess) columns for a computed Tax. */
export function taxDisplayCols<R>(
  get: (row: R, index: number) => Tax,
  opts: { group?: string; prefix: string; cess?: boolean; tone?: (row: R, head: keyof Tax) => CellTone },
): GridColumn<R>[] {
  const heads: Array<[keyof Tax, string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST']];
  if (opts.cess) heads.push(['x', 'Cess']);
  return heads.map(([h, label]) =>
    displayCol<R>(`${opts.prefix}.${h}`, label, (r, i) => get(r, i)[h], { group: opts.group, tone: opts.tone ? (r) => opts.tone!(r, h) : undefined }),
  );
}

/** Footer cells for a Tax under the column keys taxInCols / taxDisplayCols generate. */
export const taxFooter = (prefix: string, t: Partial<Tax> | null | undefined, cess = false): Record<string, number> => {
  const out: Record<string, number> = {
    [`${prefix}.i`]: t?.i ?? 0,
    [`${prefix}.c`]: t?.c ?? 0,
    [`${prefix}.s`]: t?.s ?? 0,
  };
  if (cess) out[`${prefix}.x`] = t?.x ?? 0;
  return out;
};

/** Tone for a difference cell: red beyond tolerance, green at zero, muted when small. */
export const diffTone = (v: number, tolerance: number): CellTone => {
  const a = Math.abs(v);
  if (a < 0.005) return 'ok';
  if (a <= tolerance) return 'muted';
  return 'error';
};
