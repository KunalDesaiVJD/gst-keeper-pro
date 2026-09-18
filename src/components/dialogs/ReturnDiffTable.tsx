import React from 'react';
import { DiffRow, diffFieldLabel } from '@/utils/gstReturnDiff';

// Renders the field-level changes between two versions of a return. Grouped by
// GST table so a reviewer reads "Table 3.1" or "B2B" as a block rather than a
// flat list of paths.

const inr = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Rupee fields get rupee formatting; rates, dates, codes and flags are shown as-is.
const NON_CURRENCY = new Set(['rt', 'idt', 'nt_dt', 'pos', 'rchrg', 'inv_typ', 'ntty', 'typ',
  'sply_ty', 'uqc', 'desc', 'qty', 'sbpcode', 'sbnum', 'sbdt', 'num', 'from', 'to',
  'totnum', 'cancel', 'net_issue']);

const fmt = (field: string, v: string | number | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number' && !NON_CURRENCY.has(field)) return `₹${inr(v)}`;
  return String(v);
};

const KIND_STYLE: Record<DiffRow['kind'], { label: string; cls: string }> = {
  added: { label: 'Added', cls: 'text-success' },
  removed: { label: 'Removed', cls: 'text-destructive' },
  changed: { label: 'Changed', cls: 'text-warning' },
};

export const ReturnDiffTable: React.FC<{
  rows: DiffRow[];
  /** What this diff is against, e.g. "v3". Shown when there is nothing to report. */
  againstLabel?: string;
  emptyMessage?: string;
}> = ({ rows, againstLabel, emptyMessage }) => {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        {emptyMessage || `No figures changed${againstLabel ? ` since ${againstLabel}` : ''}.`}
      </p>
    );
  }

  // Preserve the section ordering the diff already sorted into.
  const sections: { section: string; rows: DiffRow[] }[] = [];
  rows.forEach((r) => {
    const last = sections[sections.length - 1];
    if (last && last.section === r.section) last.rows.push(r);
    else sections.push({ section: r.section, rows: [r] });
  });

  return (
    <div className="space-y-3">
      {sections.map(({ section, rows: secRows }) => (
        <div key={section} className="rounded border bg-background overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/60 text-xs font-semibold">{section}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium px-3 py-1.5 w-20">Change</th>
                  <th className="text-left font-medium px-3 py-1.5">Row</th>
                  <th className="text-left font-medium px-3 py-1.5">Field</th>
                  <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Before</th>
                  <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">After</th>
                </tr>
              </thead>
              <tbody>
                {secRows.map((r, ri) =>
                  r.fields.map((f, fi) => (
                    <tr key={`${ri}-${fi}`} className="border-t">
                      {fi === 0 && (
                        <>
                          <td rowSpan={r.fields.length} className={`px-3 py-1.5 align-top font-medium ${KIND_STYLE[r.kind].cls}`}>
                            {KIND_STYLE[r.kind].label}
                          </td>
                          <td rowSpan={r.fields.length} className="px-3 py-1.5 align-top font-mono">
                            {r.row}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-1.5">{diffFieldLabel(f.field)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                        {fmt(f.field, f.before)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">
                        {fmt(f.field, f.after)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ReturnDiffTable;
