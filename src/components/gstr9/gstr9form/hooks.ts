import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StepKey } from '@/lib/gstr9/engine';
import type { Formulas, Gstr9ManualDoc, Tax, TaxIn } from '@/lib/gstr9/types';
import type { GridColumn } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { useWorkspace } from '../WorkspaceContext';
import { docFormulas, FORM_HEAD_LABELS, seedTaxIn, setDocFormulas, TAX_ORDER } from './helpers';

/** Open another step of the workspace, keeping the client (and everything else) in the URL. */
export const useGoStep = () => {
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
};

// ---------------------------------------------------------------------------
// Fixed-row grids over fields of the GSTR-9 manual doc
// ---------------------------------------------------------------------------

export interface FixedRowDef<V> {
  id: string;
  /** Row number as on the form, e.g. "6K". */
  code: string;
  /** Short label for the grid. */
  label: string;
  /** Full wording (tooltip). */
  title?: string;
  read: (g: Gstr9ManualDoc) => V;
  write: (g: Gstr9ManualDoc, v: V) => Gstr9ManualDoc;
  /** Nullable rows: the figure used while nothing is typed (shown muted). */
  computed?: Tax | null;
  /** Heads that can be typed (default: all). */
  heads?: string[];
  /** docs.gstr9.f key holding the "=a+b" of a column (undefined = not kept), e.g. (c) => `t10.${c}`. */
  fKey?: (col: string) => string | undefined;
}

export interface FixedRow<V> {
  id: string;
  code: string;
  label: string;
  title?: string;
  v: V;
  f?: Formulas;
  def: FixedRowDef<V>;
}

export interface FixedRowOpts<V> {
  /** Column keys whose formulas are kept in docs.gstr9.f (via each def's fKey). */
  cols?: string[];
  /** Formula memory held on the value itself (TaxIn.f) instead. */
  fromValue?: (v: V) => Formulas | undefined;
  toValue?: (v: V, f: Formulas | undefined) => V;
}

/**
 * Rows for a SheetGrid over fixed fields of docs.gstr9. Each row reads one
 * field; edits are written back immutably through update('gstr9', …), with
 * the "=a+b" memory kept on the value (TaxIn) or in docs.gstr9.f.
 */
export function useFixedRows<V>(defs: FixedRowDef<V>[], opts: FixedRowOpts<V> = {}) {
  const { docs, update, readOnly } = useWorkspace();
  const cols = opts.cols ?? [];
  const rows: FixedRow<V>[] = defs.map((def) => {
    const v = def.read(docs.gstr9);
    const f = opts.fromValue ? opts.fromValue(v) : def.fKey ? docFormulas(docs.gstr9.f, cols, def.fKey) : undefined;
    return { id: def.id, code: def.code, label: def.label, title: def.title, v, f, def };
  });
  const onRowsChange = (next: FixedRow<V>[]) => {
    const changed = next.filter((r, i) => r !== rows[i]);
    if (!changed.length) return;
    update('gstr9', (g) =>
      changed.reduce((acc, r) => {
        if (opts.toValue) return r.def.write(acc, opts.toValue(r.v, r.f));
        const out = r.def.write(acc, r.v);
        return r.def.fKey ? { ...out, f: setDocFormulas(out.f, cols, r.def.fKey, r.f) } : out;
      }, g),
    );
  };
  return { rows, onRowsChange, readOnly };
}

export type TaxInRow = FixedRow<TaxIn | null>;

/**
 * Central / State-UT (mirrors Central) / Integrated / Cess columns, in the
 * form's order, for TaxIn rows. Column keys are the heads, so the formula
 * memory lands in TaxIn.f keyed by head. A null row value means "use the
 * computed figure" (shown muted); typing into any head seeds the override.
 */
export function taxInFormCols(group?: string): GridColumn<TaxInRow>[] {
  return TAX_ORDER.map((h) =>
    moneyCol<TaxInRow>(
      h,
      FORM_HEAD_LABELS[h],
      (r) => (r.v == null ? null : r.v[h]),
      (r, val) => {
        const base = r.v ?? seedTaxIn(r.def.computed);
        const v: TaxIn = h === 's' ? { ...base, s: val } : { ...base, [h]: val ?? 0 };
        return { ...r, v };
      },
      {
        group,
        nullable: h === 's',
        editable: (r) => !r.def.heads || r.def.heads.includes(h),
        placeholder: (r) => (r.v == null ? (r.def.computed ? r.def.computed[h] : 0) : h === 's' ? r.v.c : null),
        title: (r) => {
          if (r.v == null) return 'Not typed — the computed figure is used. Type to override.';
          if (h === 's' && r.v.s == null) return 'Mirrors Central tax — type to override, clear to mirror again';
          return undefined;
        },
      },
    ),
  );
}
