// The kit's header: one cell per column with its sort button (aria-sort says
// which way) and its filter menu (filled when a filter is on), under a band of
// the report's column groups when it has them ("2A" over the 2A figures).
// A view with a bespoke table puts TableKitHead in its own header row; one on
// TableKitTable gets TableKitHeader whole.
import React from 'react';
import type { RowTone } from '@/utils/allClientsReports';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WS_TH, WS_TH_GROUP } from '@/components/workspace/theme';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ColumnFilter } from './ColumnFilter';
import type { ModelRow } from './tableModel';
import type { TableKit } from './useTableKit';

/** A column a view adds before or after the report's own (a tick box, an actions column). */
export interface KitExtraColumn {
  key: string;
  /** Its heading (e.g. a select-all tick box); empty by default. */
  header?: React.ReactNode;
  /** Classes for its heading and its cells (a width, an alignment). */
  className?: string;
  /** Its cell on a document row; heading, band and TOTAL rows leave it blank. */
  cell: (row: ModelRow) => React.ReactNode;
}

export interface TableKitHeadProps {
  kit: TableKit;
  /** A model column index (kit.cols holds the ones shown). */
  col: number;
  /** The heading text (default: the column's label). */
  label?: React.ReactNode;
  /** A tooltip for the heading (default: "Sort by <label>"). */
  title?: string;
  /** false: the label only, no sort button. */
  sortable?: boolean;
  /** false: no filter menu. */
  filterable?: boolean;
  className?: string;
}

/** One header cell: the label as a sort button and the column's filter menu. */
export const TableKitHead: React.FC<TableKitHeadProps> = ({ kit, col, label, title, sortable = true, filterable = true, className }) => {
  const { model, state } = kit;
  const mc = model.columns[col];
  const right = kit.isFigure(col);
  const sorted = state.sort?.col === col ? state.sort.dir : null;
  // Shown short; named in full for the tooltip and screen readers when the label is shared.
  const name = mc?.name ?? '';
  return (
    <TableHead
      className={cn(WS_TH, 'group/th h-8 px-1.5 py-0', right && 'text-right', className)}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
    >
      <div className={cn('flex items-center gap-0.5', right && 'justify-end')}>
        {sortable ? (
          <button
            type="button"
            onClick={() => kit.cycleSort(col)}
            className="inline-flex items-center gap-1 rounded px-0.5 hover:text-foreground"
            title={title ?? `Sort by ${name}`}
            aria-label={`Sort by ${name}`}
          >
            {label ?? mc?.label}
            {sorted === null
              ? <ArrowUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover/th:opacity-50" />
              : sorted === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />}
          </button>
        ) : (
          <span className="px-0.5" title={title}>{label ?? mc?.label}</span>
        )}
        {filterable && mc && (
          <ColumnFilter model={model} state={state} col={col} onFilter={kit.setFilter} onSort={kit.setSort} onGroup={kit.setGroup} />
        )}
      </div>
    </TableHead>
  );
};

// Opaque fills: rows scroll under a sticky heading. A tone is laid over the card colour.
const GROUP_TONE: Record<RowTone, string> = {
  good: 'bg-card text-success-strong shadow-[inset_0_0_0_999px_hsl(var(--success)/0.12)]',
  warn: 'bg-card text-foreground/80 shadow-[inset_0_0_0_999px_hsl(var(--warning)/0.16)]',
  bad: 'bg-card text-destructive-strong shadow-[inset_0_0_0_999px_hsl(var(--destructive)/0.08)]',
  info: 'bg-card text-primary shadow-[inset_0_0_0_999px_hsl(var(--primary)/0.12)]',
  muted: 'bg-muted text-muted-foreground',
};

/** The band of column groups over the columns shown (nothing when the report has none). */
export const TableKitGroupRow: React.FC<{ kit: TableKit; leading?: number; trailing?: number; sticky?: boolean }> = ({
  kit, leading = 0, trailing = 0, sticky = true,
}) => {
  if (!kit.columnGroups) return null;
  const cell = cn(WS_TH_GROUP, 'h-7 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-0 text-[12px]', sticky && 'sticky top-0 z-20');
  return (
    <TableRow className="hover:bg-transparent">
      {Array.from({ length: leading }, (_, k) => <TableHead key={`l${k}`} className={cell} />)}
      {kit.columnGroups.map((g, k) => (
        <TableHead key={k} colSpan={g.span} scope="colgroup" className={cn(cell, g.tone && g.label ? GROUP_TONE[g.tone] : '')} title={g.label || undefined}>
          {g.label}
        </TableHead>
      ))}
      {Array.from({ length: trailing }, (_, k) => <TableHead key={`t${k}`} className={cell} />)}
    </TableRow>
  );
};

/** The whole header: the column-group band when there is one, then a TableKitHead per column shown. */
export const TableKitHeader: React.FC<{ kit: TableKit; leading?: KitExtraColumn[]; trailing?: KitExtraColumn[]; sticky?: boolean }> = ({
  kit, leading = [], trailing = [], sticky = true,
}) => {
  const banded = !!kit.columnGroups;
  // Under a band the column headings stick 1.75rem lower (the band's height).
  const place = !sticky ? 'static' : banded ? 'top-7' : undefined;
  const extraHead = (x: KitExtraColumn) => (
    <TableHead key={x.key} className={cn(WS_TH, 'h-8 px-1.5 py-0', place, x.className)}>{x.header}</TableHead>
  );
  return (
    <TableHeader className={cn(sticky && 'sticky top-0 z-20')}>
      <TableKitGroupRow kit={kit} leading={leading.length} trailing={trailing.length} sticky={sticky} />
      <TableRow>
        {leading.map(extraHead)}
        {kit.cols.map((c) => <TableKitHead key={c} kit={kit} col={c} className={place} />)}
        {trailing.map(extraHead)}
      </TableRow>
    </TableHeader>
  );
};
