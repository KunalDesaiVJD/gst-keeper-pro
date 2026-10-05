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

/**
 * Which columns the month grids show: the sheet's full layout (default), the
 * Input sheet with the four suspended-ITC groups folded into their net, or
 * only books net · as per 3B · difference (both tabs).
 */
export type DutiesView = 'sheet' | 'compact' | 'recon';

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

/** Link to another step (optionally to one of its tabs, e.g. { itctab: 'next' }), keeping the open client (and everything else) in the URL. */
export const useGoStep = () => {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (key: StepKey, extra?: Record<string, string>) => {
      const next = new URLSearchParams(params);
      next.set('step', key);
      Object.entries(extra ?? {}).forEach(([k, v]) => next.set(k, v));
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

/**
 * Sticky month column (Apr … Mar) carrying the month's justification control
 * (JustifyControl renders nothing where the engine has no line), so a month's
 * status stays in sight however far the figures scroll sideways. Footer labels
 * also render here (see footerStatusLabel).
 */
export function monthCol<R extends { id: MonthKey }>(prefix: 'dto' | 'dti', width: number): GridColumn<R> {
  return {
    key: 'month',
    header: 'Month',
    type: 'display',
    value: (r) => MONTH_LABEL[r.id],
    render: (r) => (
      <span className="flex items-center justify-between gap-1.5">
        {MONTH_LABEL[r.id]}
        <JustifyControl lineKey={`${prefix}.${r.id}`} compact />
      </span>
    ),
    sticky: true,
    align: 'left',
    width,
  };
}

/** taxInCols for the Duties & Taxes grids (SGST mirrors CGST, locked — see lockSgst). */
export function mirroredTaxCols<R>(get: (r: R) => TaxIn, set: (r: R, t: TaxIn) => R, opts: TaxColsOpts<R>): GridColumn<R>[] {
  return taxInCols<R>(get, set, opts);
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
 * Only a superadmin can type over a fetched figure (`canEdit`, sourceLock.ts);
 * the owner records a hand edit.
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
  /** The superadmin: the only user who can type over a portal figure. */
  canEdit: boolean;
}): GridColumn<R>[] {
  const { field, get, set, portal, cess, group, what, canEdit } = opts;
  const source: GridColumn<R> = {
    key: `${field}.src`,
    header: (
      <HeaderTip
        label="Source"
        tip={
          <>
            <span className="font-medium">As per 3B</span> = {what} of the as-filed GSTR-3B, pulled from the GST portal on the
            Portal data step — never the app’s own GSTR-3B. The figures are locked: only a superadmin can type over one, and a re-import
            asks before replacing a typed figure.
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
  const lockNote = canEdit ? '' : ' Locked — only a superadmin can type over it.';
  const cellTitle = (r: R, h: keyof Tax): string => {
    if (portal.manual[portalPath(r.id, field, h)]) return `${what} — typed by hand by a superadmin. A portal re-import will ask before replacing it.${lockNote}`;
    if (!portal.monthMeta[r.id]?.source) return `${what} — not fetched yet. Fetch it on the Portal data step${canEdit ? ', or type it' : ''}.${lockNote}`;
    return `${what} of the as-filed GSTR-3B.${lockNote}`;
  };
  return [
    source,
    // SGST here is the filed return's own figure, not a copy of CGST — it stays its own cell (superadmin only).
    ...headsFor(cess).map(([h, label]) =>
      moneyCol<R>(`${field}.${h}`, label, (r) => get(r)[h], (r, v) => set(r, { ...get(r), [h]: v ?? 0 }), {
        group,
        width: h === 'x' ? 96 : undefined,
        editable: () => canEdit,
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

/** Footer cells for a difference, in the same tones as the grid's difference cells. */
export const diffCells = (prefix: string, t: Tax, cess: boolean, tolerance: number): Record<string, React.ReactNode> =>
  Object.fromEntries(headsFor(cess).map(([h]) => [`${prefix}.${h}`, <DiffValue key={h} value={t[h]} tolerance={tolerance} />]));

/** Footer cells of a secondary line: plain figures rendered soft (normal weight, muted). */
export const soft = (cells: Record<string, React.ReactNode>): Record<string, React.ReactNode> =>
  Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, typeof v === 'number' ? <SoftMoney key={k} value={v} /> : v]));

/** A footer-row label with the line's justification control beside it, in the sticky month column. */
export const footerStatusLabel = (label: React.ReactNode, lineKey: string): React.ReactNode => (
  <span className="flex items-center justify-between gap-1.5">
    {label}
    <JustifyControl lineKey={lineKey} compact />
  </span>
);
