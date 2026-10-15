// The kit's controls over a list: the search, the Period filter of a merged
// multi-month table, the count shown, Group by, the Columns chooser and the
// "filtered" Excel / PDF; under them a chip per active filter, each removable,
// and Clear all. A view's own controls go in the left slot (after the count:
// quick filters) or the right slot (before Group by: its own actions).
import React from 'react';
import { WS_BTN } from '@/components/workspace/theme';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarRange, Columns3, FileSpreadsheet, FileText, Layers, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ValuesPanel } from './ColumnFilter';
import { isFilterActive } from './tableModel';
import type { TableKit } from './useTableKit';

export interface TableKitToolbarProps {
  kit: TableKit;
  /** What the search looks in, in the reader's words (default "Search every column…"). */
  searchPlaceholder?: string;
  /** A view's own controls after the count (quick filters, a preset). */
  left?: React.ReactNode;
  /** A view's own controls before Group by (a bulk action, a download). */
  right?: React.ReactNode;
  /** false: no Excel (filtered) / PDF (filtered) buttons (the view exports another way). */
  exports?: boolean;
  /** false: no Columns chooser. */
  columns?: boolean;
  className?: string;
}

export const TableKitToolbar: React.FC<TableKitToolbarProps> = ({
  kit, searchPlaceholder = 'Search every column…', left, right, exports = true, columns = true, className,
}) => {
  const { model, state, view, hidden, cols, filters, exporting } = kit;
  const periodFilter = model.merged ? state.filters[model.periodCol] : undefined;
  const ticked = periodFilter?.type === 'values' ? periodFilter.values.length : 0;
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.search}
            onChange={(e) => kit.setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search the rows"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {state.search && (
            <Button variant="ghost" size="icon" className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => kit.setSearch('')} aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {model.merged && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn(WS_BTN, isFilterActive(periodFilter) && 'border-primary text-primary')}>
                <CalendarRange className="h-3.5 w-3.5" />
                {ticked ? `Periods: ${ticked} of ${model.periods.length}` : `Periods: all ${model.periods.length}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3">
              <p className="mb-1.5 text-sm font-semibold">Period</p>
              <ValuesPanel model={model} state={state} col={model.periodCol} filter={periodFilter} onChange={(f) => kit.setFilter(model.periodCol, f)} />
            </PopoverContent>
          </Popover>
        )}

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">{kit.countText}</span>

        {left}

        <div className="flex-1" />

        {right}

        {kit.groupable.length > 0 && (
          <div className="flex items-center gap-1">
            <Select value={state.groupBy === null ? 'none' : String(state.groupBy)} onValueChange={(v) => kit.setGroup(v === 'none' ? null : Number(v))}>
              <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Group by">
                <Layers className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">No grouping</SelectItem>
                {kit.groupable.map((c) => (
                  <SelectItem key={c.index} value={String(c.index)} className="text-xs">Group by {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {view.groups && (
              <Button variant="ghost" size="sm" className={WS_BTN} onClick={() => kit.setAllCollapsed(kit.collapsed.size === 0)}>
                {kit.collapsed.size ? 'Expand all' : 'Collapse all'}
              </Button>
            )}
          </div>
        )}

        {columns && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn(WS_BTN, hidden.size > 0 && 'border-primary text-primary')}>
                <Columns3 className="h-3.5 w-3.5" /> Columns{hidden.size ? ` (${hidden.size} hidden)` : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-xs font-semibold">Columns shown</p>
                {hidden.size > 0 && (
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline" onClick={kit.showAllColumns}>Show all</button>
                )}
              </div>
              <div className="max-h-72 overflow-auto">
                {model.columns.filter((c) => !c.virtual || view.showPeriodColumn).map((c) => {
                  const on = !hidden.has(c.index);
                  // The last column shown stays: a list with no columns says nothing.
                  const last = on && cols.length === 1;
                  return (
                    <label key={c.index} className={cn('flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted', last && 'cursor-not-allowed opacity-60')}>
                      <Checkbox checked={on} disabled={last} className="h-3.5 w-3.5" onCheckedChange={() => kit.toggleHidden(c.index)} />
                      <span className="truncate">{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {exports && (
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => kit.exportView('xlsx')} disabled={exporting !== null} title="The rows and columns shown, as filtered, sorted and grouped here">
              {exporting === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              Excel (filtered)
            </Button>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => kit.exportView('pdf')} disabled={exporting !== null} title="The rows and columns shown, as filtered, sorted and grouped here">
              {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              PDF (filtered)
            </Button>
          </>
        )}
      </div>

      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <span
              key={f.col === 'custom' ? `custom:${f.id}` : String(f.col)}
              className="inline-flex max-w-[460px] items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.06] py-0.5 pl-2.5 pr-1 text-[11px] text-foreground"
            >
              <span className="truncate" title={f.text}>{f.text}</span>
              <button
                type="button"
                aria-label={`Remove filter: ${f.text}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                onClick={() => kit.removeFilter(f)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={kit.clearAll}>Clear all</Button>
        </div>
      )}
    </div>
  );
};
