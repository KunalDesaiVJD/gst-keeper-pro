// Grid plumbing for the Duties & Taxes step (DUTIES & TAXES-OUTPUT / -INPUT).
// No tax logic lives here: every computed figure comes from computeWorkings();
// these helpers only shape month rows for SheetGrid and turn typed "As per
// 3B" cells into portal hand edits (applyHandEdits, as the Portal step does).

import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MONTH_LABEL, type DiffLine, type StepKey } from '@/lib/gstr9/engine';
import type { FieldEdit } from '@/lib/gstr9/portalImport';
import { FY_MONTHS, type Formulas, type MonthKey, type PortalDoc, type Tax, type TaxIn } from '@/lib/gstr9/types';
import type { GridColumn } from '../grid/SheetGrid';
import { diffTone, moneyCol, taxDisplayCols, taxInCols, type TaxColsOpts } from '../grid/columns';
import { JustifyControl } from '../ui';
import { DiffValue, HeaderTip, MonthSource, SoftMoney } from './parts';

export const HEADS: Array<[keyof Tax, string]> = [
  ['i', 'IGST'],
  ['c', 'CGST'],
  ['s', 'SGST'],
  ['x', 'Cess'],
];
export const headsFor = (cess: boolean) => (cess ? HEADS : HEADS.slice(0, 3));

/** The two as-filed GSTR-3B quantities this step shows (PortalDoc.months[m]). */
export type PortalTaxField = 'outTax' | 'itcExclRcm';

/** PortalDoc field path of one head, e.g. "months.oct.outTax.i" (the key of `manual` and `f`). */
export const portalPath = (m: MonthKey, field: PortalTaxField, h: keyof Tax) => `months.${m}.${field}.${h}`;

export const typedHeadCount = (portal: PortalDoc, m: MonthKey, field: PortalTaxField): number =>
  HEADS.filter(([h]) => portal.manual[portalPath(m, field, h)]).length;

const EPS = 0.004;
export const hasCess = (...ts: Array<Partial<Tax> | null | undefined>): boolean =>
  ts.some((t) => !!t && Math.abs(Number(t.x) || 0) > EPS);

/** Open (reason-needed) difference lines whose key starts with `prefix.`. */
export const openCount = (diffs: DiffLine[], prefix: 'dto' | 'dti'): number =>
  diffs.filter((d) => d.open && d.key.startsWith(`${prefix}.`)).length;

/** Link to another step, keeping the open client (and everything else) in the URL. */
export const useGoStep = () => {
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

// ---------------------------------------------------------------------------
// Formula memory
// ---------------------------------------------------------------------------

/** Formulas with the keys of `field` ("outTax.i" …) left out; undefined when nothing remains. */
export const withoutPrefix = (f: Formulas | undefined, prefix: string): Formulas | undefined => {
  if (!f) return undefined;
  const out: Formulas = {};
  Object.entries(f).forEach(([k, v]) => {
    if (!k.startsWith(`${prefix}.`)) out[k] = v;
  });
  return Object.keys(out).length ? out : undefined;
};

/** Head-keyed formulas ({ c: "=1+2" }) → grid keys ({ "lye.c": "=1+2" }), and back. */
export const prefixF = (f: Formulas | undefined, prefix: string): Formulas | undefined =>
  f && Object.keys(f).length ? Object.fromEntries(Object.entries(f).map(([k, v]) => [`${prefix}.${k}`, v])) : undefined;
export const unprefixF = (f: Formulas | undefined, prefix: string): Formulas | undefined => {
  if (!f) return undefined;
  const out: Formulas = {};
  Object.entries(f).forEach(([k, v]) => {
    if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  });
  return Object.keys(out).length ? out : undefined;
};

export const sameF = (a: Formulas | undefined, b: Formulas | undefined): boolean => {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => a?.[k] === b?.[k]);
};

/**
 * A month row's formula memory: the books doc's own expressions plus the
 * portal's expressions for this month's "As per 3B" heads (PortalDoc.f, keyed
 * by field path — cleared by the Portal step when an import replaces them),
 * under the grid's column keys ("outTax.i" …).
 */
export const monthRowF = (booksF: Formulas | undefined, portal: PortalDoc, m: MonthKey, field: PortalTaxField): Formulas | undefined => {
  const out: Formulas = { ...(withoutPrefix(booksF, field) ?? {}) };
  HEADS.forEach(([h]) => {
    const expr = portal.f?.[portalPath(m, field, h)];
    if (expr) out[`${field}.${h}`] = expr;
  });
  return Object.keys(out).length ? out : undefined;
};

/**
 * The hand edits a grid change makes to one month's "As per 3B": every head
 * whose value or expression changed. applyHandEdits marks them as typed.
 */
export const portalEdits = (
  m: MonthKey,
  field: PortalTaxField,
  prev: { tax: Tax; f?: Formulas },
  next: { tax: Tax; f?: Formulas },
): FieldEdit[] =>
  HEADS.flatMap(([h]) => {
    const k = `${field}.${h}`;
    const pv = Number(prev.tax[h]) || 0;
    const nv = Number(next.tax[h]) || 0;
    const nf = next.f?.[k];
    if (Math.abs(pv - nv) <= 1e-9 && (prev.f?.[k] ?? undefined) === nf) return [];
    return [{ path: portalPath(m, field, h), value: nv, formula: nf ?? null }];
  });

// ---------------------------------------------------------------------------
// Month select for the adjustment lists
// ---------------------------------------------------------------------------

const FULL_NAME: Record<MonthKey, string> = {
  apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September',
  oct: 'October', nov: 'November', dec: 'December', jan: 'January', feb: 'February', mar: 'March',
};

/**
 * Month options whose aliases accept the ways the firm's sheet writes a
 * month: APR, APRIL, APR-24, APRIL-24, April 2024, 04/2024 (the year from the FY).
 */
export const monthOptions = (financialYear: string) => {
  const start = Number(financialYear.slice(0, 4)) || 0;
  return FY_MONTHS.map((m, idx) => {
    const yyyy = String(idx < 9 ? start : start + 1);
    const yy = yyyy.slice(-2);
    const mm = String(((idx + 3) % 12) + 1).padStart(2, '0');
    const names = [MONTH_LABEL[m], FULL_NAME[m], ...(m === 'sep' ? ['Sept'] : [])];
    const aliases = [
      FULL_NAME[m],
      ...(m === 'sep' ? ['Sept'] : []),
      ...names.flatMap((n) => [`${n}-${yy}`, `${n} ${yy}`, `${n}'${yy}`, `${n}-${yyyy}`, `${n} ${yyyy}`]),
      `${mm}/${yyyy}`,
      `${mm}-${yyyy}`,
      mm,
    ];
    return { value: m, label: MONTH_LABEL[m], aliases };
  });
};

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Sticky month column (Apr … Mar); footer labels also render here. */
export function monthCol<R extends { id: MonthKey }>(width: number): GridColumn<R> {
  return { key: 'month', header: 'Month', type: 'display', value: (r) => MONTH_LABEL[r.id], sticky: true, align: 'left', width };
}

/**
 * taxInCols, plus: an SGST that is entered (typed or pasted) equal to CGST goes
 * back to mirroring it — the workbook's SGST cells are `=D` / `=+J`, so pasting
 * the sheet's CGST + SGST pair keeps the two linked, as they are in Excel.
 */
export function mirroredTaxCols<R>(get: (r: R) => TaxIn, set: (r: R, t: TaxIn) => R, opts: TaxColsOpts<R>): GridColumn<R>[] {
  return taxInCols<R>(get, set, opts).map((col) => {
    if (col.key !== `${opts.prefix}.s` || !col.onEdit) return col;
    const base = col.onEdit;
    return {
      ...col,
      onEdit: (r, e) => {
        const out = base(r, e);
        const t = get(out);
        if (!e.formula && t.s !== null && t.s !== undefined && Math.abs(t.s - t.c) < 0.005) return set(out, { ...t, s: null });
        return out;
      },
    };
  });
}

/**
 * Computed columns sitting where the sheet has its own computed columns (NET
 * SALES I:K, NET PURCHASE U:W): read-only, but they take their cell from a
 * pasted block so a full sheet row lands in the right editable columns.
 */
export function computedCols<R>(get: (r: R) => Tax, opts: { group: string; prefix: string; cess: boolean }): GridColumn<R>[] {
  return taxDisplayCols<R>((r) => get(r), opts).map((c) => ({ ...c, pasteThrough: true }));
}

/**
 * The "AS PER 3B" group: a source chip, then IGST / CGST / SGST (/ Cess) as
 * plain money columns (no SGST mirror — they are the portal's own figures).
 * Typing here overrides the fetched figure; the owner records a hand edit.
 */
export function portal3bCols<R extends { id: MonthKey }>(opts: {
  field: PortalTaxField;
  get: (r: R) => Tax;
  set: (r: R, t: Tax) => R;
  portal: PortalDoc;
  cess: boolean;
  group: string;
  /** What the figure is, for the header tooltip and cell titles. */
  what: string;
}): GridColumn<R>[] {
  const { field, get, set, portal, cess, group, what } = opts;
  const source: GridColumn<R> = {
    key: `${field}.src`,
    header: (
      <HeaderTip
        label="Source"
        tip={
          <>
            <span className="font-medium">As per 3B</span> = {what} of the as-filed GSTR-3B, pulled from the GST portal on the
            Portal data step — never the app’s own GSTR-3B. Type over a figure to override it; a re-import asks before replacing a typed figure.
          </>
        }
      />
    ),
    group,
    type: 'display',
    value: () => null,
    width: 112,
    align: 'left',
    render: (r) => <MonthSource meta={portal.monthMeta[r.id]} typedHeads={typedHeadCount(portal, r.id, field)} />,
  };
  const cellTitle = (r: R, h: keyof Tax): string => {
    if (portal.manual[portalPath(r.id, field, h)]) return `${what} — typed by hand. A portal re-import will ask before replacing it.`;
    if (!portal.monthMeta[r.id]?.source) return `${what} — not fetched yet. Fetch it on the Portal data step, or type it.`;
    return `${what} of the as-filed GSTR-3B.`;
  };
  return [
    source,
    ...headsFor(cess).map(([h, label]) =>
      moneyCol<R>(`${field}.${h}`, label, (r) => get(r)[h], (r, v) => set(r, { ...get(r), [h]: v ?? 0 }), {
        group,
        width: h === 'x' ? 96 : undefined,
        title: (r) => cellTitle(r, h),
        tone: (r) => (!portal.monthMeta[r.id]?.source && Math.abs(get(r)[h]) < EPS ? 'muted' : undefined),
      }),
    ),
  ];
}

/**
 * Read-only difference columns, toned against the tolerance. A month with no
 * difference line (no as-filed 3B yet — the engine reports those months in one
 * "not fetched" line instead) is shown muted.
 */
export function diffCols<R extends { id: MonthKey }>(
  get: (r: R) => Tax,
  opts: { cess: boolean; tolerance: number; group: string; hasLine: (m: MonthKey) => boolean },
): GridColumn<R>[] {
  return taxDisplayCols<R>((r) => get(r), {
    group: opts.group,
    prefix: 'diff',
    cess: opts.cess,
    tone: (r, h) => (opts.hasLine(r.id) ? diffTone(get(r)[h], opts.tolerance) : 'muted'),
  });
}

/** Status column: the month's justification control (JustifyControl renders nothing where the engine has no line). */
export function statusCol<R extends { id: MonthKey }>(prefix: 'dto' | 'dti'): GridColumn<R> {
  return {
    key: 'status',
    header: 'Status',
    type: 'display',
    value: () => null,
    width: 64,
    align: 'center',
    render: (r) => <JustifyControl lineKey={`${prefix}.${r.id}`} compact />,
  };
}

/** Footer cells for a difference, in the same tones as the grid's difference cells. */
export const diffCells = (prefix: string, t: Tax, cess: boolean, tolerance: number): Record<string, React.ReactNode> =>
  Object.fromEntries(headsFor(cess).map(([h]) => [`${prefix}.${h}`, <DiffValue key={h} value={t[h]} tolerance={tolerance} />]));

/** Footer cells of a secondary line: plain figures rendered soft (normal weight, muted). */
export const soft = (cells: Record<string, React.ReactNode>): Record<string, React.ReactNode> =>
  Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, typeof v === 'number' ? <SoftMoney key={k} value={v} /> : v]));

/** A footer status cell holding a justification control. */
export const statusCell = (lineKey: string): Record<string, React.ReactNode> => ({
  status: <JustifyControl lineKey={lineKey} compact />,
});
