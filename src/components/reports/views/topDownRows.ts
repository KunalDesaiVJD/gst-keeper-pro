// The pure half of what the two views read top to bottom share (see
// ./TopDownControls.tsx): a report's rows cut at the months of a merge, the
// section a row sits under, and what counts as a nil row. No React, so the
// views' table builders stay plain functions.
import type { ReportTable, RowKind } from '@/utils/allClientsReports';
import { rowKindsOf } from '@/lib/reportExport/layout';
import type { ModelRow } from './tableKit';

export type Cell = string | number;
export type Row = Cell[];

export const cellText = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/** One row of the report as it came, with its kind and its index in table.rows. */
export interface SourceRow { cells: Row; kind: RowKind; i: number }

/** The report's rows cut at each period band of a multi-month merge (one block when there is none). */
export function splitPeriods(table: Pick<ReportTable, 'rows' | 'rowKinds'>): { band: SourceRow | null; rows: SourceRow[] }[] {
  const kinds = rowKindsOf(table.rows, table.rowKinds);
  const blocks: { band: SourceRow | null; rows: SourceRow[] }[] = [];
  let cur: { band: SourceRow | null; rows: SourceRow[] } = { band: null, rows: [] };
  table.rows.forEach((cells, i) => {
    if (kinds[i] === 'period') {
      if (cur.band || cur.rows.length) blocks.push(cur);
      cur = { band: { cells, kind: 'period', i }, rows: [] };
      return;
    }
    cur.rows.push({ cells, kind: kinds[i], i });
  });
  if (cur.band || cur.rows.length) blocks.push(cur);
  return blocks;
}

/** The text of the section heading a row sits under ('' for none). */
export const sectionTitleOf = (row: ModelRow, table: Pick<ReportTable, 'rows'>): string =>
  (row.section >= 0 ? (table.rows[row.section] ?? []).map(cellText).find((s) => s !== '') ?? '' : '');

/** A row with figures, all of them nil. A row with no figure at all (a date, a status, the PDF link) is never one. */
export const isNilRow = (cells: Row): boolean => {
  const figures = cells.filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  return figures.length > 0 && figures.every((v) => Math.abs(v) < 0.005);
};
