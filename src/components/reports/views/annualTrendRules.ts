// How the annual trend view (AnnualTrendView) reads one client's months of a
// financial year before the table kit draws them: the month column, the
// headline figure the chart follows, which months were never pulled, and the
// quarter each month falls in (a hidden column, so the months can be grouped
// with quarterly subtotals). No React, so
// scripts/verify-variance-annual-views.mjs checks it.
import { SENTINEL_RE } from '@/lib/reportExport/layout';
import type { ReportTable } from '@/utils/allClientsReports';

const MONTH_HEADER_RE = /month|period/i;
const MONTH_CELL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+(\d{4})$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NOT_PULLED_RE = /not\s*pulled|not\s*captured/i;

/** The month column: the first headed Month or Period, else the first. */
export const monthColumn = (headers: string[]): number => Math.max(0, headers.findIndex((h) => MONTH_HEADER_RE.test(h)));

/** A placeholder in place of a figure ("NOT PULLED", a lone dash): the month has no figures yet. */
export const isSentinel = (v: unknown): boolean => typeof v === 'string' && (NOT_PULLED_RE.test(v) || SENTINEL_RE.test(v.trim()));

/**
 * A month not yet pulled from the portal says so in any of its figure cells
 * (the GSTR-3B annual summary writes it under Outward Liability and leaves the
 * rest blank), so the whole row is read, not only the headline column.
 */
export const isNotPulledRow = (cells: (string | number)[]): boolean => cells.some((c) => typeof c === 'string' && NOT_PULLED_RE.test(c));

/**
 * The headline figure the chart follows: checked in tiers ('Total' beats
 * 'Closing' beats 'Liability'), the rightmost match in a tier winning, since
 * these reports read left to right toward the bottom-line figure ("Total
 * Liability" … "Total Payable (as filed)"). A column that is nil in every
 * month gives way to one that is not (a client with no cash payable all year
 * would otherwise open on a flat line at zero); it still wins when nothing
 * else has a figure. Only figure columns qualify; with no match, the first
 * figure column. -1 when there is none.
 */
export function headlineColumn(headers: string[], isFigure: (col: number) => boolean, hasValue: (col: number) => boolean = () => true): number {
  for (const live of [true, false]) {
    for (const re of [/total/i, /closing/i, /liability/i]) {
      let found = -1;
      headers.forEach((h, c) => { if (isFigure(c) && re.test(h) && (!live || hasValue(c))) found = c; });
      if (found !== -1) return found;
    }
  }
  const first = headers.findIndex((_, c) => isFigure(c) && hasValue(c));
  return first !== -1 ? first : headers.findIndex((_, c) => isFigure(c));
}

/**
 * The financial-year quarter of a month label ("Apr 2025" is "FY 2025-26 Q1
 * (Apr to Jun)"), FY first so quarters of two years sort apart; '' for
 * anything that is not a month. Plain ASCII: it is printed on the PDF.
 */
export function quarterOf(label: unknown): string {
  const m = MONTH_CELL_RE.exec(String(label ?? '').trim());
  if (!m) return '';
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const year = +m[2];
  const start = mon >= 3 ? year : year - 1;
  const q = Math.floor(((mon - 3 + 12) % 12) / 3);
  const span = ['Apr to Jun', 'Jul to Sep', 'Oct to Dec', 'Jan to Mar'][q];
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')} Q${q + 1} (${span})`;
}

export const QUARTER_HEADER = 'Quarter';

/**
 * The table with a Quarter column added at the end (the view hides it; it is
 * there to group by, and shown when a reviewer asks for it). Hints that run
 * parallel to the columns grow with it. Unchanged, with -1, when no row has a
 * month to place.
 */
export function withQuarterColumn(table: ReportTable, monthCol: number): { table: ReportTable; quarterCol: number } {
  const quarters = table.rows.map((r) => quarterOf(r[monthCol]));
  if (!quarters.some(Boolean) || table.headers.includes(QUARTER_HEADER)) return { table, quarterCol: -1 };
  const quarterCol = table.headers.length;
  return {
    quarterCol,
    table: {
      ...table,
      headers: [...table.headers, QUARTER_HEADER],
      rows: table.rows.map((r, i) => [...r, quarters[i]]),
      columnWidths: [...table.columnWidths, 22],
      ...(table.headerLabels ? { headerLabels: [...table.headerLabels, QUARTER_HEADER] } : {}),
      ...(table.columnGroups ? { columnGroups: [...table.columnGroups, { label: '', span: 1 }] } : {}),
    },
  };
}

/**
 * The "filtered" export without a word about the Quarter column: the report
 * never had it, so "Columns hidden: Quarter" would tell the reader something
 * is missing when nothing is. Other hidden columns are still named.
 */
export function withoutQuarterNote(t: ReportTable): ReportTable {
  const prune = (value: string): string => value.split(/,\s*/).filter((v) => v.trim() !== QUARTER_HEADER).join(', ');
  const subtitle = t.subtitle.split('   |   ')
    .map((seg) => (seg.startsWith('Columns hidden: ') ? `Columns hidden: ${prune(seg.slice('Columns hidden: '.length))}` : seg))
    .filter((seg) => seg !== 'Columns hidden: ')
    .join('   |   ');
  const meta = t.meta
    ?.map((f) => (f.label === 'Columns hidden' ? { ...f, value: prune(f.value) } : f))
    .filter((f) => !(f.label === 'Columns hidden' && !f.value));
  return { ...t, subtitle, ...(meta ? { meta } : {}) };
}
