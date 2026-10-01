import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { CellTone } from '../grid/SheetGrid';
import { fmtMoney } from '../grid/money';
import { toneClass } from './helpers';

/**
 * Read-only table of computed figures for the reconciliation steps, used
 * where MatrixTable's fixed head columns are not enough (grouped Books /
 * Portal / Difference columns, an extra "Total tax" column). Sticky header,
 * sticky first column, right-aligned tabular figures, optional sticky totals
 * footer and a Status column for justifications.
 */

export interface FigColumn {
  key: string;
  header: string;
  /** Adjacent columns with the same group share a top header cell. */
  group?: string;
  width?: number;
}

export interface FigRow {
  key: string;
  /** Row letter / Table reference shown before the label, e.g. "4A". */
  code?: React.ReactNode;
  label: React.ReactNode;
  /** Chip / hint after the label. */
  note?: React.ReactNode;
  values?: Record<string, number | null | undefined>;
  /** Custom content per column (wins over `values`). */
  cells?: Record<string, React.ReactNode>;
  tones?: Record<string, CellTone>;
  kind?: 'row' | 'total' | 'heading' | 'sub';
  /** All-nil rows are shown dimmed. */
  muted?: boolean;
  status?: React.ReactNode;
}

export const FigureTable: React.FC<{
  label: string;
  columns: FigColumn[];
  rows: FigRow[];
  /** Sticky rows at the bottom (totals). */
  footer?: FigRow[];
  firstHeader?: string;
  /** Show the Status column (defaults to: any row has a status). */
  withStatus?: boolean;
  maxHeight?: number | string;
  /** Minimum width of the sticky Particulars column from the sm breakpoint (default 220 px), so long labels wrap less. */
  labelWidth?: number;
  /** A narrow Status column, for icon-only (compact) justification controls. */
  narrowStatus?: boolean;
  className?: string;
}> = ({ label, columns, rows, footer, firstHeader = 'Particulars', withStatus, maxHeight, labelWidth, narrowStatus, className }) => {
  const hasStatus = withStatus ?? [...rows, ...(footer ?? [])].some((r) => r.status !== undefined);
  const hasGroups = columns.some((c) => c.group);
  const spans = useMemo(() => {
    const out: Array<{ label: string; span: number; start: number }> = [];
    columns.forEach((c, i) => {
      const g = c.group ?? '';
      const last = out[out.length - 1];
      if (last && last.label === g) last.span += 1;
      else out.push({ label: g, span: 1, start: i });
    });
    return out;
  }, [columns]);
  const groupStart = useMemo(() => new Set(hasGroups ? spans.map((s) => s.start) : []), [spans, hasGroups]);
  const colCount = columns.length + 1 + (hasStatus ? 1 : 0);

  const renderRow = (r: FigRow, inFooter = false) => {
    if (r.kind === 'heading') {
      return (
        // Opaque in the pinned footer, so rows scrolling underneath don't show through.
        <tr key={r.key} className={inFooter ? 'bg-muted' : 'bg-muted/50'}>
          <td colSpan={colCount} className={cn('border-b px-2 py-1.5 text-xs font-semibold sm:sticky sm:left-0', inFooter && 'border-t')}>
            {r.code && <span className="mr-2 font-mono text-muted-foreground">{r.code}</span>}
            {r.label}
            {r.note && <span className="ml-2 inline-flex align-middle">{r.note}</span>}
          </td>
        </tr>
      );
    }
    const strong = r.kind === 'total' || inFooter;
    const rowBg = strong ? 'bg-muted' : 'bg-card';
    return (
      <tr key={r.key} className={cn(strong && 'font-semibold', r.muted && 'text-muted-foreground')}>
        <th
          scope="row"
          className={cn(
            'z-10 border-b border-r px-2 py-1.5 text-left align-top font-normal sm:sticky sm:left-0',
            rowBg,
            strong && 'font-semibold',
            inFooter && 'border-t',
          )}
        >
          <span className={cn('flex items-start gap-2', r.kind === 'sub' && 'pl-6 text-muted-foreground')}>
            {r.code !== undefined && <span className="w-9 shrink-0 font-mono text-[11px] text-muted-foreground">{r.code}</span>}
            <span className="min-w-0">
              {r.label}
              {r.note && <span className="ml-2 inline-flex align-middle">{r.note}</span>}
            </span>
          </span>
        </th>
        {columns.map((c, i) => {
          const custom = r.cells?.[c.key];
          const v = r.values?.[c.key];
          return (
            <td
              key={c.key}
              className={cn(
                'border-b border-r px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap',
                strong && 'bg-muted',
                inFooter && 'border-t',
                groupStart.has(i) && i > 0 && 'border-l border-l-border',
                r.kind === 'sub' && 'text-muted-foreground',
                toneClass(r.tones?.[c.key]),
              )}
            >
              {custom !== undefined ? custom : v === null || v === undefined ? <span className="text-muted-foreground">—</span> : fmtMoney(v)}
            </td>
          );
        })}
        {hasStatus && (
          <td className={cn('border-b px-2 py-1 text-right align-top', strong && 'bg-muted', inFooter && 'border-t')}>
            {r.status ?? null}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div
      className={cn('overflow-auto rounded-md border bg-card', className)}
      style={{ ...(maxHeight ? { maxHeight } : {}), ['--fig-label-w' as string]: `${labelWidth ?? 220}px` }}
    >
      {/* border-separate: the pinned header and footer rows paint solidly (collapsed borders let scrolled rows show through). */}
      <table className="w-full border-separate border-spacing-0 text-xs" aria-label={label}>
        <thead className="sticky top-0 z-20 bg-muted">
          {hasGroups && (
            <tr>
              <th rowSpan={2} scope="col" className="z-30 min-w-[160px] sm:sticky sm:left-0 sm:min-w-[var(--fig-label-w)] border-b border-r bg-muted px-2 py-1.5 text-left align-bottom font-semibold text-muted-foreground">
                {firstHeader}
              </th>
              {spans.map((s) => (
                <th
                  key={s.start}
                  colSpan={s.span}
                  scope="colgroup"
                  className={cn('border-b border-r px-2 py-1 text-center font-semibold text-foreground', s.start > 0 && 'border-l border-l-border')}
                >
                  {s.label}
                </th>
              ))}
              {hasStatus && (
                <th rowSpan={2} scope="col" className={cn(narrowStatus ? 'w-14' : 'w-32', 'border-b px-2 py-1.5 text-right align-bottom font-semibold text-muted-foreground')}>
                  Status
                </th>
              )}
            </tr>
          )}
          <tr>
            {!hasGroups && (
              <th scope="col" className="z-30 min-w-[160px] sm:sticky sm:left-0 sm:min-w-[var(--fig-label-w)] border-b border-r bg-muted px-2 py-1.5 text-left font-semibold text-muted-foreground">
                {firstHeader}
              </th>
            )}
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'border-b border-r px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap',
                  groupStart.has(i) && i > 0 && 'border-l border-l-border',
                )}
                style={{ minWidth: c.width ?? 112 }}
              >
                {c.header}
              </th>
            ))}
            {!hasGroups && hasStatus && (
              <th scope="col" className={cn(narrowStatus ? 'w-14' : 'w-32', 'border-b px-2 py-1.5 text-right font-semibold text-muted-foreground')}>
                Status
              </th>
            )}
          </tr>
        </thead>
        <tbody>{rows.map((r) => renderRow(r))}</tbody>
        {footer && footer.length > 0 && <tfoot className="sticky bottom-0 z-10">{footer.map((r) => renderRow(r, true))}</tfoot>}
      </table>
    </div>
  );
};

export default FigureTable;
