// How the annual trend view (AnnualTrendView) reads one client's months of a
// financial year before the table kit draws them: the month column, the
// headline figure the chart follows, which months were never pulled, the
// quarter each month falls in (a hidden column, so the months can be grouped
// with quarterly subtotals), and a merge of several months as one block per
// financial year. No React, so scripts/verify-variance-annual-views.mjs
// checks it.
import { SENTINEL_RE, rowKindsOf } from '@/lib/reportExport/layout';
import type { ReportTable } from '@/utils/allClientsReports';
import { periodLabel } from './tableKit/tableModel';

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

const BAND_RE = /^— (.+) —$/;
const COMBINED_RE = /\d+ periods combined/;

/** The financial year of a month label ("Apr 2026" is "FY 2026-27"), '' for anything else. */
const yearOf = (label: string): string => /^FY \S+/.exec(quarterOf(label))?.[0] ?? '';

/** Month labels listed with each year once: "Apr, May, Jun 2026"; "Dec 2026, Jan 2027". */
const listMonths = (labels: string[]): string => labels.map((l, k) => {
  const year = l.split(' ')[1];
  return year && labels[k + 1]?.split(' ')[1] === year ? l.split(' ')[0] : l;
}).join(', ');

/**
 * A merge of several months as one block per financial year. Each annual
 * report builds its whole year from any one month of it, so a merge made
 * month by month (Apr, May and Jun, or "This FY") holds the same year once
 * per month picked, each copy with its own FY TOTAL: added up by the kit,
 * every figure would read as that many times the year's. buildForPeriods
 * already builds a report marked periodScope 'fy' once per year, so this is
 * the safety net for one that is not: a table with each year once comes back
 * as it is. The first block of each year that was
 * built is kept, with its own TOTAL; the repeats and their bands go, and the
 * subtitle says so ("Apr, May, Jun 2026 are in the same financial year: shown
 * once"), as does `note`. Two years stay two blocks. One year left reads as
 * the report does for one month: no band, its TOTAL as printed. Unchanged,
 * with a null note, when no year repeats.
 */
export function oneBlockPerYear(table: ReportTable, monthCol: number): { table: ReportTable; note: string | null } {
  const kinds = rowKindsOf(table.rows, table.rowKinds);
  const bands = kinds.flatMap((k, i) => (k === 'period' ? [i] : []));
  if (bands.length < 2) return { table, note: null };
  const blocks = bands.map((start, b) => {
    const end = b + 1 < bands.length ? bands[b + 1] : table.rows.length;
    const key = BAND_RE.exec(String(table.rows[start][0] ?? '').trim())?.[1] ?? '';
    const years = table.rows.slice(start + 1, end).map((r) => yearOf(String(r[monthCol] ?? '').trim())).filter(Boolean);
    // A block that could not be built has no months: its year is the picked month's.
    return { start, end, key, year: years[0] ?? yearOf(periodLabel(key)), built: years.length > 0 };
  });

  const byYear = new Map<string, number[]>();
  const keep = new Set<number>();
  blocks.forEach((b, k) => {
    if (!b.year) { keep.add(k); return; }
    byYear.set(b.year, [...(byYear.get(b.year) ?? []), k]);
  });
  for (const list of byYear.values()) keep.add(list.find((k) => blocks[k].built) ?? list[0]);
  if (keep.size === blocks.length) return { table, note: null };

  const note = [...byYear.values()].filter((list) => list.length > 1)
    .map((list) => `${listMonths(list.map((k) => periodLabel(blocks[k].key)))} are in the same financial year: shown once`)
    .join('; ');
  const single = keep.size === 1;
  // The rows kept (anything before the first band too), by their index in table.rows.
  const at: number[] = Array.from({ length: bands[0] }, (_, i) => i);
  blocks.forEach((b, k) => {
    if (!keep.has(k)) return;
    for (let i = single ? b.start + 1 : b.start; i < b.end; i++) at.push(i);
  });
  // A single year back as printed: the merge renamed its "TOTAL" "TOTAL (MM/YYYY)".
  const own = single ? `TOTAL (${blocks[[...keep][0]].key})` : null;
  const rows = at.map((i) => (own ? table.rows[i].map((c) => (c === own ? 'TOTAL' : c)) : table.rows[i]));
  const pick = <T,>(xs: T[] | undefined): T[] | undefined => (xs ? at.map((i) => xs[i]) : undefined);
  const periods = single ? '' : `${keep.size} periods combined`;
  const subtitle = [
    single ? table.subtitle.replace(/\s*\|\s*\d+ periods combined/, '') : table.subtitle.replace(COMBINED_RE, periods),
    note,
  ].join('   |   ');
  const meta = table.meta
    ?.filter((f) => !(single && f.label === 'Periods'))
    .map((f) => (f.label === 'Periods' ? { ...f, value: `${keep.size} combined` } : f));
  return {
    note,
    table: {
      ...table,
      subtitle,
      rows,
      ...(table.rowKinds ? { rowKinds: pick(table.rowKinds) } : {}),
      ...(table.rowTones ? { rowTones: pick(table.rowTones) } : {}),
      ...(table.rowIds ? { rowIds: pick(table.rowIds) } : {}),
      ...(table.clientIds ? { clientIds: pick(table.clientIds) } : {}),
      ...(table.rowFlags ? { rowFlags: pick(table.rowFlags) } : {}),
      ...(meta ? { meta } : {}),
      fileNameBase: table.fileNameBase.replace(/_\d+periods$/, single ? '' : `_${keep.size}periods`),
    },
  };
}
