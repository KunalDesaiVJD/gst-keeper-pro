// Phase 2 of the Reports roadmap: one multi-select period picker instead of
// a single month, for every report that needs a period — no per-report
// build() rewrite required. Each selected period is built individually
// (every report's build() already exists and is unit-tested by use), then
// stitched into one combined table here. A report that doesn't take a
// period at all (needs: 'client' | 'none') ignores the selection entirely.
import type { ReportDefinition } from '@/lib/reportRegistry';
import type { ReportTable } from '@/utils/allClientsReports';

const needsPeriod = (r: ReportDefinition) => r.needs === 'month' || r.needs === 'client+month';

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
 * Several periods' tables as one (see the header comment). A table with
 * subtitleParts keeps only the common part in the merged subtitle; each
 * period's own part (its "as of" dates) leads that period's notes.
 */
export const mergeTables = (tables: ReportTable[], list: string[]): ReportTable => {
  const first = tables[0];
  const rows = mergeRows(tables.map((t) => t.rows), list, first.headers.length);
  const summary = first.summary
    ? {
      ...first.summary,
      rows: mergeRows(tables.map((t) => t.summary?.rows ?? []), list, first.summary.headers.length),
      notes: tables.flatMap((t, i) => [t.subtitleParts?.period, ...(t.summary?.notes ?? [])]
        .filter((n): n is string => !!n)
        .map((n) => `${list[i]}: ${n}`)),
    }
    : undefined;
  return {
    ...first,
    subtitle: `${first.subtitleParts?.common ?? first.subtitle}   |   ${list.length} periods combined`,
    rows,
    ...(summary ? { summary } : {}),
    fileNameBase: `${first.fileNameBase}_${list.length}periods`,
  };
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * A period that could not be built, as a block of the merge: its heading and,
 * for a report with a summary, the reason in the notes (the document list stays
 * clean); otherwise one row carrying the reason.
 */
const failedTable = (template: ReportTable, message: string): ReportTable => ({
  ...template,
  subtitleParts: template.subtitleParts ? { common: template.subtitleParts.common, period: '' } : undefined,
  rows: template.summary ? [] : [[`Not built: ${message}`, ...Array(Math.max(template.headers.length - 1, 0)).fill('')]],
  ...(template.summary ? { summary: { ...template.summary, rows: [], notes: [`Not built: ${message}`] } } : {}),
});

/**
 * Builds each selected period and merges them. One period that cannot be built
 * (no 2B for a quarterly taxpayer's first two months, a statement not pulled)
 * no longer sinks the rest: it shows its reason in its own block. Only when no
 * period can be built does the whole report fail.
 */
export const buildForPeriods = async (
  report: ReportDefinition,
  periods: string[],
  clientId: string,
): Promise<ReportTable> => {
  if (!needsPeriod(report)) return report.build({ month: '', clientId });

  const list = periods.length ? periods : [''];
  if (list.length === 1) return report.build({ month: list[0], clientId });

  const settled = await Promise.allSettled(list.map((p) => report.build({ month: p, clientId })));
  const built = settled.find((s): s is PromiseFulfilledResult<ReportTable> => s.status === 'fulfilled');
  if (!built) {
    throw new Error(settled.map((s, i) => `${list[i]}: ${messageOf((s as PromiseRejectedResult).reason)}`).join('  '));
  }
  const tables = settled.map((s) => (s.status === 'fulfilled' ? s.value : failedTable(built.value, messageOf(s.reason))));
  return mergeTables(tables, list);
};
