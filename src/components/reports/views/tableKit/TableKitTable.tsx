// The kit's table body, as the document list draws it: period bands of a
// multi-month merge, section headings, groups with collapsible subtotals, the
// rows, the report's own TOTAL rows in place, and the TOTAL pinned at the
// bottom (recomputed and marked "filtered" once anything is filtered, so no
// figure on screen describes hidden rows). A view keeps its own look through
// the hooks: renderCell for a badge, link or delta in one column, rowClassName
// and onRowClick for its rows, and leading / trailing columns for a tick box
// or the row's actions.
import React, { useEffect, useRef } from 'react';
import { Badge } from '@/components/gstr9/badge';
import { Table, TableBody, TableCell, TableFooter, TableRow } from '@/components/ui/table';
import { WS_TABLE, WS_TD, WS_TR_HEADING, WS_TR_TOTAL } from '@/components/workspace/theme';
import { CalendarRange, ChevronDown, ChevronRight, ExternalLink, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_VARIANT, isSentinelCell, isUrlCell, kitCellClass, statusVariant } from './cellRules';
import { TableKitHeader, type KitExtraColumn } from './TableKitHead';
import type { DisplayItem, ModelRow } from './tableModel';
import type { TableKit } from './useTableKit';

export interface TableKitTableProps {
  kit: TableKit;
  /** One cell's own look (a badge, a link, a delta). Return undefined for the standard cell. */
  renderCell?: (row: ModelRow, col: number) => React.ReactNode | undefined;
  /** Extra classes for a document row (a tint, a selected row). */
  rowClassName?: (row: ModelRow) => string | undefined;
  /** Extra classes for a document row's cell. */
  cellClassName?: (row: ModelRow, col: number) => string | undefined;
  /** A document row was clicked (or Enter pressed on it); clicks on its links, buttons and tick boxes are left to them. */
  onRowClick?: (row: ModelRow) => void;
  /** Columns before the report's own (row.i indexes rowIds / clientIds / rowFlags / rowTones). */
  leading?: KitExtraColumn[];
  /** Columns after the report's own (an actions column). */
  trailing?: KitExtraColumn[];
  /** A slightly tighter row than the house default (default true). */
  dense?: boolean;
  /** The header, bands, group headings and the TOTAL stay in sight while the rows scroll (default true). */
  sticky?: boolean;
  /** Classes for the scrolling wrapper (default: from 160px up to 65% of the window). */
  containerClassName?: string;
  /** Said when the filters leave no row (a "Clear all" link follows). */
  noMatchText?: React.ReactNode;
  /** Said when the report has no rows at all. */
  emptyText?: React.ReactNode;
  /** The table's accessible name. */
  label?: string;
}

const DEFAULT_CONTAINER = 'min-h-[160px] max-h-[65vh] flex-[0_1_auto] rounded-md border bg-card';

// A sticky period band needs a solid fill (a navy tint over the card colour),
// or the rows scrolling under it show through.
const BAND_FILL = '[background:linear-gradient(hsl(var(--primary)/0.08),hsl(var(--primary)/0.08)),hsl(var(--card))]';

/** "No rows" for a report with nothing in it: in place of the toolbar and the table. */
export const TableKitEmpty: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
    <Inbox className="h-5 w-5 opacity-60" />
    <p className="text-sm">{children ?? 'No rows in this report for the selected client and period.'}</p>
  </div>
);

/** The standard look of one cell; a view's renderCell can fall back to it. */
export const StandardCell: React.FC<{ kit: TableKit; row: ModelRow; col: number }> = ({ kit, row, col }) => {
  if (col === kit.model.periodCol) return <>{kit.text(row, col)}</>;
  const cell = row.cells[col];
  if (isUrlCell(cell)) {
    return (
      <a href={cell} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline">
        <ExternalLink className="h-3 w-3" /> View
      </a>
    );
  }
  if (isSentinelCell(cell)) {
    return (
      <Badge variant="outline" className="border-dashed py-0 text-[10px] font-normal text-muted-foreground">
        Not Pulled
      </Badge>
    );
  }
  if (col === kit.statusCol && String(cell ?? '').trim() !== '') {
    const tone = kit.table.rowTones?.[row.i];
    return (
      <Badge variant={tone ? TONE_VARIANT[tone] : statusVariant(String(cell))} className="py-0 text-[10px] font-medium">
        {String(cell)}
      </Badge>
    );
  }
  if (typeof cell === 'number') return <>{kit.figure(col, cell)}</>;
  return <>{kit.text(row, col)}</>;
};

// A click meant for a control inside the row is the control's, not the row's.
const fromControl = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('a,button,input,select,textarea,label,[role="checkbox"],[role="menuitem"],[data-row-click-ignore]');

export const TableKitTable: React.FC<TableKitTableProps> = ({
  kit, renderCell, rowClassName, cellClassName, onRowClick, leading = [], trailing = [],
  dense = true, sticky = true, containerClassName, noMatchText, emptyText, label,
}) => {
  const { model, view, state, cols, labelAt, pageView } = kit;
  const tableRef = useRef<HTMLTableElement>(null);

  // A new filter, sort, grouping or page starts at the top of the list.
  useEffect(() => { tableRef.current?.parentElement?.scrollTo?.({ top: 0 }); }, [pageView.page, state]);

  if (kit.table.rows.length === 0) return <TableKitEmpty>{emptyText}</TableKitEmpty>;

  const extras = leading.length + trailing.length;
  const span = cols.length + extras;
  // Bands and group headings stick under the header: one row of 2rem, or 3.75rem under a column-group band.
  const under = !sticky ? '' : kit.columnGroups ? 'sticky top-[3.75rem] z-[5]' : 'sticky top-8 z-[5]';
  const figureCell = (c: number) => cn(WS_TD, 'whitespace-nowrap', kit.isFigure(c) && 'text-right tabular-nums');
  const blankExtras = (xs: KitExtraColumn[], cls?: string) => xs.map((x) => <TableCell key={x.key} className={cn(WS_TD, x.className, cls)} />);

  // A TOTAL drawn from sums: the label where the report puts it, figures under their columns.
  const sumCells = (lbl: React.ReactNode, sums: Map<number, number>) => cols.map((c, k) => (
    <TableCell key={c} className={figureCell(c)}>
      {k === labelAt ? lbl : sums.has(c) ? kit.figure(c, sums.get(c) as number) : ''}
    </TableCell>
  ));
  const ownTotalCells = (row: ModelRow) => {
    // Its label may sit in a hidden column: carry it ("TOTAL (04/2025)") to a shown one.
    const shownLabel = cols.some((c) => /total/i.test(String(row.cells[c] ?? '')));
    const lbl = row.cells.map((v) => String(v ?? '').trim()).find((v) => /total/i.test(v)) ?? 'TOTAL';
    return cols.map((c, k) => {
      const v = c === model.periodCol ? '' : row.cells[c];
      return (
        <TableCell key={c} className={figureCell(c)}>
          {typeof v === 'number' ? kit.figure(c, v) : !shownLabel && k === labelAt ? lbl : String(v ?? '')}
        </TableCell>
      );
    });
  };

  // The first figure column shown: a group heading spans the text columns before it.
  const firstFigurePos = cols.findIndex((c) => model.summable.includes(c));
  const headSpan = firstFigurePos > 0 ? firstFigurePos : cols.length;

  const clickable = !!onRowClick;
  let zebra = 0;
  const renderItem = (it: DisplayItem, k: number): React.ReactNode => {
    switch (it.type) {
      case 'band':
        zebra = 0;
        return (
          <TableRow key={`b${it.key}${it.continued ? 'c' : ''}`} className={cn(under, 'hover:bg-transparent')}>
            <TableCell colSpan={span} className={cn(WS_TD, BAND_FILL, 'py-1 font-semibold text-primary')}>
              <span className="inline-flex items-center gap-2">
                <CalendarRange className="h-3.5 w-3.5" />
                {it.label}
                <span className="font-normal text-muted-foreground">
                  {it.continued ? '(continued)' : view.filtered ? `${it.count} matching` : ''}
                </span>
              </span>
            </TableCell>
          </TableRow>
        );
      case 'section':
        return (
          <TableRow key={`s${it.row.i}${it.continued ? 'c' : ''}`} className={cn(WS_TR_HEADING, 'hover:bg-muted/50')}>
            <TableCell colSpan={span} className={cn(WS_TD, 'py-1 text-[13px]')}>
              {it.label} {it.continued && <span className="font-normal text-muted-foreground">(continued)</span>}
            </TableCell>
          </TableRow>
        );
      case 'group': {
        zebra = 0;
        const gcol = state.groupBy !== null ? model.columns[state.groupBy] : null;
        return (
          <TableRow
            key={`g${it.key}${it.continued ? 'c' : ''}`}
            className={cn(under, 'cursor-pointer bg-muted hover:bg-muted', WS_TR_HEADING)}
            onClick={() => kit.toggleCollapsed(it.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kit.toggleCollapsed(it.key); } }}
            tabIndex={0}
            aria-expanded={!it.collapsed}
          >
            <TableCell colSpan={leading.length + headSpan} className={cn(WS_TD, 'bg-muted font-semibold')}>
              <span className="inline-flex items-center gap-1.5">
                {it.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span className="font-normal text-muted-foreground">{gcol?.name}:</span>
                <span className="max-w-[420px] truncate" title={it.label}>{it.label}</span>
                <span className="font-normal text-muted-foreground">
                  ({it.count.toLocaleString('en-IN')} {it.count === 1 ? kit.rowNoun[0] : kit.rowNoun[1]}{it.continued ? ', continued' : ''})
                </span>
              </span>
            </TableCell>
            {headSpan < cols.length && cols.slice(headSpan).map((c) => (
              <TableCell key={c} className={cn(WS_TD, 'bg-muted font-semibold', kit.isFigure(c) && 'whitespace-nowrap text-right tabular-nums')}>
                {it.sums.has(c) ? kit.figure(c, it.sums.get(c) as number) : ''}
              </TableCell>
            ))}
            {blankExtras(trailing, 'bg-muted')}
          </TableRow>
        );
      }
      case 'data': {
        const odd = zebra++ % 2 === 1;
        const row = it.row;
        return (
          <TableRow
            key={`d${row.i}`}
            className={cn('hover:bg-primary/[0.04]', odd && 'bg-muted/25', clickable && 'cursor-pointer', rowClassName?.(row))}
            {...(clickable ? {
              tabIndex: 0,
              onClick: (e: React.MouseEvent) => { if (!fromControl(e.target)) onRowClick(row); },
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !fromControl(e.target)) { e.preventDefault(); onRowClick(row); } },
            } : {})}
          >
            {leading.map((x) => <TableCell key={x.key} className={cn(WS_TD, dense && 'py-1', x.className)}>{x.cell(row)}</TableCell>)}
            {cols.map((c) => (
              <TableCell
                key={c}
                className={cn(kitCellClass(kit, c, dense), cellClassName?.(row, c))}
                title={typeof row.cells[c] === 'string' && !isUrlCell(row.cells[c]) ? String(row.cells[c]) : undefined}
              >
                {renderCell?.(row, c) ?? <StandardCell kit={kit} row={row} col={c} />}
              </TableCell>
            ))}
            {trailing.map((x) => <TableCell key={x.key} className={cn(WS_TD, dense && 'py-1', x.className)}>{x.cell(row)}</TableCell>)}
          </TableRow>
        );
      }
      case 'total':
        return (
          <TableRow key={`t${it.row.i}`} className={cn(WS_TR_TOTAL, 'border-t hover:bg-muted [&>td]:border-t-foreground/30 [&>td]:border-t')}>
            {blankExtras(leading)}
            {ownTotalCells(it.row)}
            {blankExtras(trailing)}
          </TableRow>
        );
      case 'sum':
        return (
          <TableRow key={`m${k}`} className={cn(WS_TR_TOTAL, 'hover:bg-muted [&>td]:border-t [&>td]:border-t-foreground/30')}>
            {blankExtras(leading)}
            {sumCells(<span className="italic">{it.label}</span>, it.sums)}
            {blankExtras(trailing)}
          </TableRow>
        );
      case 'blank':
        return <TableRow key={`x${it.row.i}`} className="h-3 hover:bg-transparent"><TableCell colSpan={span} className="h-3 p-0" /></TableRow>;
    }
  };

  return (
    // Its own wrapper scrolls, so the header and the TOTAL stay pinned.
    <Table ref={tableRef} className={WS_TABLE} containerClassName={containerClassName ?? DEFAULT_CONTAINER} aria-label={label}>
      <TableKitHeader kit={kit} leading={leading} trailing={trailing} sticky={sticky} />

      <TableBody>
        {view.rows.length === 0 && view.filtered && (
          <TableRow>
            <TableCell colSpan={span} className="border-b py-6 text-center text-sm text-muted-foreground">
              {noMatchText ?? 'No rows match these filters.'}{' '}
              <button type="button" className="text-primary hover:underline" onClick={kit.clearAll}>Clear all</button>
            </TableCell>
          </TableRow>
        )}
        {pageView.items.map(renderItem)}
      </TableBody>

      {view.footer && (
        <TableFooter className={cn(sticky && 'sticky bottom-0 z-10', 'border-t-0 bg-muted')}>
          <TableRow className={cn(WS_TR_TOTAL, 'hover:bg-muted [&>td]:border-t-2 [&>td]:border-t-foreground/40 [&>td]:font-bold')}>
            {blankExtras(leading)}
            {view.footer.type === 'total' ? ownTotalCells(view.footer.row) : sumCells(view.footer.label, view.footer.sums)}
            {blankExtras(trailing)}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
};
