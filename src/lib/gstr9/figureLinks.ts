// Figure links (25 Nov 2026): a figure on the GSTR-9 / GSTR-9C step can be
// clicked to open the step, tab and row it comes from, scrolled to and
// flashed. Pure helpers only; the components live in
// src/components/gstr9/figure/FigLink.tsx.
//
// Every row of the workspace's shared tables (SheetGrid, MatrixTable,
// FormTable) carries `data-fig="<table label>|<row id>"` and each of its
// cells `data-col="<column key>"`, so a target names a source by the
// table's own accessible label and the row id it already has. Nothing is
// registered by hand on the source side.

import type { StepKey } from './engine';

/** URL search params the workspace reads for a figure jump. */
export const FIG_PARAM = 'fig';
export const FIG_COL_PARAM = 'figcol';

export interface FigTarget {
  /** Step the figure is entered or computed on. */
  step: StepKey;
  /** Tab params that open the right tab(s), e.g. { salestab: 'partb' }. */
  tab?: Record<string, string>;
  /** Accessible label of the table holding the row (its `label` prop). */
  table?: string;
  /** Row id within that table (getRowId / row key). */
  row?: string;
  /** Column key of the cell to flash (optional; the row flashes otherwise). */
  col?: string;
  /** What the link says it opens, e.g. "Sales › Part B". */
  label: string;
}

/** The anchor id a table row carries. */
export const figAnchor = (table: string, row: string): string => `${table}|${row}`;

/** The search params a jump sets on top of the current ones. */
export function figTargetParams(current: URLSearchParams, t: FigTarget): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('step', t.step);
  Object.entries(t.tab ?? {}).forEach(([k, v]) => next.set(k, v));
  next.delete(FIG_PARAM);
  next.delete(FIG_COL_PARAM);
  if (t.table && t.row) {
    next.set(FIG_PARAM, figAnchor(t.table, t.row));
    if (t.col) next.set(FIG_COL_PARAM, t.col);
  }
  return next;
}
