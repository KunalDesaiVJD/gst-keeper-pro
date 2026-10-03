import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StepKey } from '@/lib/gstr9/engine';
import type { Formulas, Gstr9ManualDoc, Tax, TaxIn } from '@/lib/gstr9/types';
import { LOCKED_TITLE } from '@/lib/gstr9/sourceLock';
import type { GridColumn } from '../grid/SheetGrid';
import { moneyCol, SGST_LOCKED_TITLE } from '../grid/columns';
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
  /** The figure comes from a source and the user is not the superadmin: shown, not editable (sourceLock.ts). */
  locked?: boolean;
  /** Heads that can be typed (default: all). */
  heads?: string[];
  /** docs.gstr9.f key holding the "=a+b" of a column (undefined = not kept), e.g. (c) => `t10.${c}`. */
  fKey?: (col: string) => string | undefined;
  /**
   * A State/UT tax row that is always the Central tax row (`id` of that row):
   * locked, and written with the same figures whenever that row is entered
   * (SGST = CGST, grid/columns lockSgst). E.g. Table 14 and 19 "State tax".
   */
  follows?: string;
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
        let out = opts.toValue ? r.def.write(acc, opts.toValue(r.v, r.f)) : r.def.write(acc, r.v);
        if (!opts.toValue && r.def.fKey) out = { ...out, f: setDocFormulas(out.f, cols, r.def.fKey, r.f) };
        // Rows that follow this one (State/UT tax after Central tax) take the same figures, without expressions.
        defs.filter((d) => d.follows === r.def.id).forEach((d) => {
          out = opts.toValue ? d.write(out, opts.toValue(r.v, undefined)) : d.write(out, r.v);
          if (!opts.toValue && d.fKey) out = { ...out, f: setDocFormulas(out.f, cols, d.fKey, undefined) };
        });
        return out;
      }, g),
    );
  };
  return { rows, onRowsChange, readOnly };
}

/** A money column of a fixed-row grid whose follower rows (def.follows) are locked. */
export function lockFollowerRows<V>(col: GridColumn<FixedRow<V>>): GridColumn<FixedRow<V>> {
  return {
    ...col,
    editable: (r) => !r.def.follows && (col.editable ? col.editable(r) : true),
    title: (r) => (r.def.follows ? SGST_LOCKED_TITLE : col.title?.(r)),
  };
}

export type TaxInRow = FixedRow<TaxIn | null>;

/**
 * Central / State-UT (mirrors Central, locked — lockSgst) / Integrated / Cess columns, in the
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
        if (h === 's') return r; // SGST is locked (lockSgst)
        const base = r.v ?? seedTaxIn(r.def.computed);
        // A CGST entry carries SGST (null = mirrors CGST).
        const v: TaxIn = h === 'c' ? { ...base, c: val ?? 0, s: null } : { ...base, [h]: val ?? 0 };
        return { ...r, v };
      },
      {
        group,
        nullable: h === 's',
        editable: (r) => h !== 's' && !r.def.locked && (!r.def.heads || r.def.heads.includes(h)),
        placeholder: (r) => (r.v == null ? (r.def.computed ? r.def.computed[h] : 0) : h === 's' ? r.v.c : null),
        title: (r) => {
          if (h === 's') return SGST_LOCKED_TITLE;
          if (r.def.locked) return `${r.v == null ? 'Computed' : 'Typed over by a superadmin'}. ${LOCKED_TITLE.filled}`;
          if (r.v == null) return 'Not typed — the computed figure is used. Type to override.';
          return undefined;
        },
      },
    ),
  );
}
