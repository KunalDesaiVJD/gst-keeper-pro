// The months a report read, one chip each (green: full figures, amber: totals
// only, red: nothing held), with one line on what to do about the rest. Used
// where a report is built month by month from sources that may be missing (the
// GSTR-1 HSN summary), so a missing month is a chip, not a paragraph of errors.
import React from 'react';
import type { ReportCoverage } from '@/utils/allClientsReports';
import { cn } from '@/lib/utils';

const CHIP: Record<'ok' | 'partial' | 'missing', string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  partial: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  missing: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
};

export const CoverageStrip: React.FC<{ coverage: ReportCoverage }> = ({ coverage }) => {
  const { periods } = coverage;
  if (!periods.length) return null;
  const ok = periods.filter((p) => p.status === 'ok').length;
  const allOk = ok === periods.length;
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-foreground">
          Data for {ok} of {periods.length} month{periods.length === 1 ? '' : 's'}
        </span>
        {periods.map((p) => (
          <span
            key={p.period}
            title={`${p.label}: ${p.source}`}
            className={cn('rounded border px-1.5 py-0.5 text-[11px] leading-none', CHIP[p.status])}
          >
            {p.label}
          </span>
        ))}
      </div>
      {!allOk && coverage.action && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{coverage.action}</p>
      )}
    </div>
  );
};

export default CoverageStrip;
