// Phase 2 of the Reports roadmap: one multi-select period picker instead of
// a single month, for every report that needs a period — no per-report
// build() rewrite required. Each selected period is built individually
// (every report's build() already exists and is unit-tested by use), then
// stitched into one combined table here. A report that doesn't take a
// period at all (needs: 'client' | 'none') ignores the selection entirely.
import type { ReportDefinition } from '@/lib/reportRegistry';
import type { ReportTable } from '@/utils/allClientsReports';

const needsPeriod = (r: ReportDefinition) => r.needs === 'month' || r.needs === 'client+month';

export const buildForPeriods = async (
  report: ReportDefinition,
  periods: string[],
  clientId: string,
): Promise<ReportTable> => {
  if (!needsPeriod(report)) return report.build({ month: '', clientId });

  const list = periods.length ? periods : [''];
  if (list.length === 1) return report.build({ month: list[0], clientId });

  const tables = await Promise.all(list.map((p) => report.build({ month: p, clientId })));
  const first = tables[0];
  const colCount = first.headers.length;
  const rows: (string | number)[][] = [];

  tables.forEach((t, i) => {
    const period = list[i];
    // A blank-filled section header naming the period — every report's row
    // shape already varies, so this stays generic rather than assuming
    // which column a "period" label would belong in.
    rows.push([`— ${period} —`, ...Array(Math.max(colCount - 1, 0)).fill('')]);
    for (const row of t.rows) {
      const isTotalRow = row.some((c) => String(c).toUpperCase() === 'TOTAL');
      rows.push(isTotalRow ? row.map((c) => (String(c).toUpperCase() === 'TOTAL' ? `TOTAL (${period})` : c)) : row);
    }
  });

  return {
    ...first,
    subtitle: `${first.subtitle}   |   ${list.length} periods combined`,
    rows,
    fileNameBase: `${first.fileNameBase}_${list.length}periods`,
  };
};
