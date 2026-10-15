// Small components every tab of the reconciliation view shares: the status
// word, coloured counts, a difference figure, a sortable column header and an
// empty state (formats and colours are in ./format.ts). Kept light: the
// document list draws thousands of cells, so nothing here holds state or a
// portal.
import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RecoStatus } from '@/lib/itcReco/types';
import { STATUS_INK, STATUS_PILL, fmtAmt, fmtCount, type SortDir } from './format';

/** The status as a word in a pill (the tint only helps). */
export const StatusBadge: React.FC<{ status: RecoStatus; label: string; className?: string }> = ({ status, label, className }) => (
  <span className={className ? cn(STATUS_PILL[status], className) : STATUS_PILL[status]}>{label}</span>
);

/** Small coloured counts by status (matched, only left, only right, differ, not compared): a dash for nil. */
export const CountCell: React.FC<{ n: number; status: RecoStatus; className?: string }> = ({ n, status, className }) => (
  <td className={cn('border-b border-r px-2 py-1 text-right tabular-nums whitespace-nowrap', n ? STATUS_INK[status] : 'text-muted-foreground/60', n && status !== 'matched' && status !== 'not_compared' && 'font-semibold', className)}>
    {fmtCount(n)}
  </td>
);

/** A figure that is a difference: red and bold beyond the tolerance, a dash at nil. */
export const DiffText: React.FC<{ v: number | null | undefined; tolerance: number; className?: string }> = ({ v, tolerance, className }) => {
  if (v === null || v === undefined) return <span className={cn('text-muted-foreground/60', className)} title="Not compared">{''}</span>;
  const big = Math.abs(v) > tolerance;
  return <span className={cn('tabular-nums', big ? 'font-semibold text-destructive-strong' : 'text-muted-foreground', className)}>{fmtAmt(v)}</span>;
};

/**
 * A column heading that sorts: the first click sorts figures largest first and
 * text A to Z, the second reverses, the third goes back to the default order.
 */
export function SortHead<K extends string>({
  label, sortKey, sort, onSort, numeric, className, title,
}: {
  label: React.ReactNode;
  sortKey: K;
  sort: { key: K; dir: SortDir } | null;
  onSort: (next: { key: K; dir: SortDir } | null) => void;
  numeric?: boolean;
  className?: string;
  title?: string;
}) {
  const active = sort?.key === sortKey;
  const first: SortDir = numeric ? 'desc' : 'asc';
  const next = () => {
    if (!active) onSort({ key: sortKey, dir: first });
    else if (sort?.dir === first) onSort({ key: sortKey, dir: first === 'asc' ? 'desc' : 'asc' });
    else onSort(null);
  };
  const Icon = !active ? ArrowUpDown : sort?.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('border-b border-r bg-muted p-0 text-[12px] font-semibold text-foreground/75', className)}
      title={title}
    >
      <button
        type="button"
        onClick={next}
        className={cn(
          'flex w-full items-center gap-1 px-2 py-1.5 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          numeric ? 'justify-end text-right' : 'justify-start text-left',
          active && 'text-foreground',
        )}
      >
        <span className="whitespace-nowrap">{label}</span>
        <Icon className={cn('h-3 w-3 shrink-0', active ? 'opacity-90' : 'opacity-30')} aria-hidden="true" />
      </button>
    </th>
  );
}

/** A panel's empty state: one line, and an action when there is one. */
export const EmptyLine: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
    <span>{children}</span>
    {action}
  </div>
);
