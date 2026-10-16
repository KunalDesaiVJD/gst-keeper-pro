// Phase 2 of the Reports roadmap: one multi-select period picker instead of
// a single month, for every report that needs a period — no per-report
// build() rewrite required. Each selected period is built individually
// (every report's build() already exists and is unit-tested by use), then
// stitched into one combined table here. A report that doesn't take a
// period at all (needs: 'client' | 'none') ignores the selection entirely.
// A report built for a whole financial year from any month of it
// (periodScope 'fy') is built once per financial year picked instead.
import type { ReportDefinition } from '@/lib/reportRegistry';
import type { ReportTable } from '@/utils/allClientsReports';

const needsPeriod = (r: ReportDefinition) => r.needs === 'month' || r.needs === 'client+month';

/**
 * The financial year (April to March) of a MM/YYYY period, named as the
 * builders name it through fyMonthsForKey ("06/2026" is "FY 2026-27"), with
 * the year it starts in for ordering; null for anything that is not a month.
 * Kept here rather than imported, so this file stays free of the Supabase
 * client the builders' module loads.
 */
export const financialYearOf = (period: string): { label: string; start: number } | null => {
  const m = /^(\d{2})\/(\d{4})$/.exec(period.trim());
  if (!m || +m[1] < 1 || +m[1] > 12) return null;
  const start = +m[1] >= 4 ? +m[2] : +m[2] - 1;
  return { label: `FY ${start}-${String(start + 1).slice(-2)}`, start };
};

/**
 * One month per financial year among `periods`: the first picked of each
 * year, the years in calendar order whatever order they were picked in.
 * Anything that is not a month is its own entry, after the years, as given.
 */
export const oneMonthPerYear = (periods: string[]): { period: string; year: string }[] => {
  const byYear = new Map<string, { period: string; year: string; start: number }>();
  for (const period of periods) {
    const fy = financialYearOf(period);
    const year = fy?.label ?? period;
    if (!byYear.has(year)) byYear.set(year, { period, year, start: fy?.start ?? Number.MAX_SAFE_INTEGER });
  }
  return [...byYear.values()].sort((a, b) => a.start - b.start).map(({ period, year }) => ({ period, year }));
};

/**
 * Stitches per-period row blocks into one: a blank-filled section header
 * naming each period, and each block's TOTAL row renamed "TOTAL (MM/YYYY)".
 * Every report's row shape already varies, so this stays generic rather than
 * assuming which column a "period" label would belong in. Used for the rows
 * and, when a report has one, for its summary table.
 */
export const mergeRows = (blocks: (string | number)[][][], periods: string[], colCount: number): (string | number)[][] => {
  const rows: (string | number)[][] = [];
  blocks.forEach((block, i) => {
    const period = periods[i];
    rows.push([`— ${period} —`, ...Array(Math.max(colCount - 1, 0)).fill('')]);
    for (const row of block) {
      const isTotalRow = row.some((c) => String(c).toUpperCase() === 'TOTAL');
      rows.push(isTotalRow ? row.map((c) => (String(c).toUpperCase() === 'TOTAL' ? `TOTAL (${period})` : c)) : row);
    }
  });
  return rows;
};

/**
 * The table a merge takes its shape from (headers, widths, column groups, its
 * own merge): the first period that was built and has rows. A builder may
 * answer an empty month with fewer columns (the interest calculator's
 * ['Item', 'Value'] when a month has no GSTR-3B), and a merge shaped by it
 * would cut the other months' rows to that width. Else the first built, else
 * the first.
 */
const templateOf = (tables: ReportTable[]): ReportTable =>
  tables.find((t) => !t.failedReason && t.rows.length > 0) ?? tables.find((t) => !t.failedReason) ?? tables[0];

/**
 * Several periods' tables as one (see the header comment). A table with
 * subtitleParts keeps only the common part in the merged subtitle; each
 * period's own part (its "as of" dates) leads that period's notes.
 */
export const mergeTables = (tables: ReportTable[], list: string[]): ReportTable => {
  const first = templateOf(tables);
  // A report that knows how to combine its own months (a reconciliation
  // recomputing its summaries) does so.
  if (first.merge) return first.merge(tables, list);
  const rows = mergeRows(tables.map((t) => t.rows), list, first.headers.length);
  // Per-row hints follow their rows; a period band has none.
  const parallel = <T,>(pick: (t: ReportTable) => (T | null)[] | undefined): (T | null)[] | undefined => {
    if (!tables.some((t) => pick(t))) return undefined;
    return tables.flatMap((t) => [null, ...t.rows.map((_, i) => pick(t)?.[i] ?? null)]);
  };
  const summary = first.summary
    ? {
      ...first.summary,
      rows: mergeRows(tables.map((t) => t.summary?.rows ?? []), list, first.summary.headers.length),
      rowTones: undefined,
      rowKinds: undefined,
      notes: tables.flatMap((t, i) => [t.subtitleParts?.period, ...(t.summary?.notes ?? [])]
        .filter((n): n is string => !!n)
        .map((n) => `${list[i]}: ${n}`)),
    }
    : undefined;
  const extraSheets = first.extraSheets?.map((sheet, k) => ({
    ...sheet,
    rows: mergeRows(tables.map((t) => t.extraSheets?.[k]?.rows ?? []), list, sheet.headers.length),
    rowTones: undefined,
    rowKinds: undefined,
  }));
  return {
    ...first,
    subtitle: `${first.subtitleParts?.common ?? first.subtitle}   |   ${list.length} periods combined`,
    meta: first.meta ? [...first.meta.filter((f) => !/^(period|month|return period)$/i.test(f.label)), { label: 'Periods', value: `${list.length} combined` }] : undefined,
    // One month's figures do not describe several.
    kpis: undefined,
    rows,
    rowTones: parallel((t) => t.rowTones),
    rowKinds: parallel((t) => t.rowKinds),
    rowIds: first.rowIds ? parallel((t) => t.rowIds) : undefined,
    clientIds: first.clientIds ? parallel((t) => t.clientIds) : undefined,
    rowFlags: first.rowFlags ? parallel((t) => t.rowFlags) : undefined,
    ...(summary ? { summary } : {}),
    ...(extraSheets ? { extraSheets } : {}),
    fileNameBase: `${first.fileNameBase}_${list.length}periods`,
  };
};

/**
 * A merge of whole financial years named by all of them. Each block's
 * subtitle names its own year, and the merge keeps the first one's, so the
 * view and the Excel / PDF strip would say "FY 2025-26" over a table holding
 * FY 2026-27 too: that segment (or a Financial year meta field) lists every
 * year merged instead. A year's own word (a ledger's "Same-day order: …", a
 * statement "NOT PULLED") is a segment the other years' subtitles do not
 * carry: it is kept, named by its year ("FY 2026-27: …"), rather than lost
 * with every subtitle but the first or shown as if it spoke for every year.
 * A year that could not be built says so in its own block, not here.
 */
const SUBTITLE_SEP = '   |   ';
const namingEveryYear = (merged: ReportTable, tables: ReportTable[], years: string[]): ReportTable => {
  const all = years.join(', ');
  const meta = merged.meta ? { meta: merged.meta.map((f) => (/^(fy|financial year)$/i.test(f.label.trim()) ? { ...f, value: all } : f)) } : {};
  const template = templateOf(tables);
  // A report combining its own years (a merge hook) words its own subtitle.
  if (template.merge) {
    return { ...merged, subtitle: merged.subtitle.split(SUBTITLE_SEP).map((seg) => (years.includes(seg.trim()) ? all : seg)).join(SUBTITLE_SEP), ...meta };
  }
  const segments = (t: ReportTable): string[] => (t.subtitleParts?.common ?? t.subtitle).split(SUBTITLE_SEP).map((seg) => seg.trim()).filter(Boolean);
  const built = tables.flatMap((t, i) => (t.failedReason ? [] : [{ year: years[i], own: segments(t) }]));
  const shared = (seg: string): boolean => years.includes(seg) || built.every((b) => b.own.includes(seg));
  const common = segments(template).filter(shared).map((seg) => (years.includes(seg) ? all : seg));
  const perYear = built.flatMap((b) => b.own.filter((seg) => !shared(seg)).map((seg) => `${b.year}: ${seg}`));
  return { ...merged, subtitle: [...common, ...perYear, `${years.length} periods combined`].join(SUBTITLE_SEP), ...meta };
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * A period that could not be built, as a block of the merge: its heading and,
 * for a report with a summary, the reason in the notes (the document list stays
 * clean); otherwise one row carrying the reason.
 */
const failedTable = (template: ReportTable, message: string): ReportTable => ({
  ...template,
  failedReason: message,
  reco: undefined,
  kpis: undefined,
  rowTones: undefined,
  rowKinds: undefined,
  rowIds: undefined,
  clientIds: undefined,
  rowFlags: undefined,
  subtitleParts: template.subtitleParts ? { common: template.subtitleParts.common, period: '' } : undefined,
  rows: template.summary ? [] : [[`Not built: ${message}`, ...Array(Math.max(template.headers.length - 1, 0)).fill('')]],
  ...(template.summary ? { summary: { ...template.summary, rows: [], rowTones: undefined, rowKinds: undefined, notes: [`Not built: ${message}`] } } : {}),
  ...(template.extraSheets ? { extraSheets: template.extraSheets.map((x) => ({ ...x, rows: [], rowTones: undefined, rowKinds: undefined })) } : {}),
});

/**
 * Builds each selected period and merges them. One period that cannot be built
 * (no 2B for a quarterly taxpayer's first two months, a statement not pulled)
 * no longer sinks the rest: it shows its reason in its own block. Only when no
 * period can be built does the whole report fail.
 *
 * A whole-year report (periodScope 'fy') builds the same year from any month
 * of it, so it is built once per financial year picked, from the first month
 * picked of that year: Apr, May and Jun are that year once, as one month
 * gives it (no band, its FY TOTAL once), where building each month would
 * print the year three times over in the view and in every download. Two
 * years are two blocks, each named by its year ("— FY 2025-26 —"), in order.
 */
export const buildForPeriods = async (
  report: ReportDefinition,
  periods: string[],
  clientId: string,
): Promise<ReportTable> => {
  if (!needsPeriod(report)) return report.build({ month: '', clientId });

  const wholeYears = report.periodScope === 'fy' && periods.length > 0;
  // What is built (`month`) and what its block is named by (`key`).
  const runs = wholeYears
    ? oneMonthPerYear(periods).map(({ period, year }) => ({ month: period, key: year }))
    : (periods.length ? periods : ['']).map((p) => ({ month: p, key: p }));
  if (runs.length === 1) return report.build({ month: runs[0].month, clientId });

  const list = runs.map((r) => r.key);
  const settled = await Promise.allSettled(runs.map((r) => report.build({ month: r.month, clientId })));
  const built = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (!built.length) {
    throw new Error(settled.map((s, i) => `${list[i]}: ${messageOf((s as PromiseRejectedResult).reason)}`).join('  '));
  }
  // A failed period's block takes the merge's own shape (its "Not built" line as wide as the rest).
  const template = templateOf(built);
  const tables = settled.map((s) => (s.status === 'fulfilled' ? s.value : failedTable(template, messageOf(s.reason))));
  const merged = mergeTables(tables, list);
  return wholeYears ? namingEveryYear(merged, tables, list) : merged;
};
