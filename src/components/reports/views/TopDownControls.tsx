// What the two views read top to bottom share on top of the table kit: the
// as-filed return summaries (FiledReturnSummaryView) and the working papers
// (WorkingPaperView). Their rows are a return's tables or a computation's
// steps, not a list of documents, so the report's order and its section
// headings are the default, and the kit runs inside them:
//   - splitPeriods (./topDownRows.ts): a multi-month merge read one month's
//     block at a time, so each block gets its own section headings;
//   - SectionFilter: tick the sections to keep (a view's own filter, so it is
//     a chip, narrows the counts and the "filtered" export, and survives a Pull);
//   - NonZeroToggle: leave out rows whose figures are all nil;
//   - TopDownHint: one line saying what a filter or a sort does here, so a
//     filtered return or working paper is never taken for the whole of it.
import React, { useMemo, useState } from 'react';
import { WS_BTN } from '@/components/workspace/theme';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info, ListTree } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compile, type TableKit } from './tableKit';
import { cellText, isNilRow, sectionTitleOf } from './topDownRows';

// ── The Section filter ──────────────────────────────────────────────────────

const SECTION_ID = 'section';

const listTitles = (titles: string[]): string =>
  (titles.length <= 2 ? titles.join(' or ') : `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`);

/**
 * Tick the sections to keep. The ticked titles live in the kit's own filter
 * (a chip, Clear all and a fresh report clear it), matched by title so a
 * multi-month merge keeps the same section in every month.
 */
export const SectionFilter: React.FC<{ kit: TableKit }> = ({ kit }) => {
  const { model, state, table } = kit;
  // The sections in the report's order, each once (a merge repeats them per month).
  const titles = useMemo(() => {
    const seen: string[] = [];
    for (const r of model.rows) {
      if (r.kind !== 'section') continue;
      const t = (r.cells ?? []).map(cellText).find((s) => s !== '') ?? '';
      if (t && !seen.includes(t)) seen.push(t);
    }
    return seen;
  }, [model]);
  // The ticked titles; they count only while the kit holds the filter, so a
  // chip removed, Clear all or a different report clears them too.
  const [picked, setPicked] = useState<string[]>([]);
  const active = !!state.custom?.some((c) => c.id === SECTION_ID);
  const ticked = useMemo(() => new Set(active ? picked : []), [active, picked]);
  // How many rows each section would show under every other filter.
  const counts = useMemo(() => {
    const pass = compile(model, { ...state, custom: state.custom?.filter((c) => c.id !== SECTION_ID) });
    const out = new Map<string, number>();
    for (const r of model.data) if (pass(r)) out.set(sectionTitleOf(r, table), (out.get(sectionTitleOf(r, table)) ?? 0) + 1);
    return out;
  }, [model, state, table]);

  if (titles.length < 2) return null;
  const set = (next: string[]) => {
    setPicked(next);
    if (!next.length) { kit.setCustomFilter(SECTION_ID, null); return; }
    const keep = new Set(next);
    kit.setCustomFilter(SECTION_ID, { label: `Section is ${listTitles(next)}`, test: (r, t) => keep.has(sectionTitleOf(r, t)) });
  };
  const toggle = (t: string) => set(titles.filter((x) => (x === t ? !ticked.has(x) : ticked.has(x))));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(WS_BTN, ticked.size > 0 && 'border-primary text-primary')}>
          <ListTree className="h-3.5 w-3.5" />
          {ticked.size ? `Sections: ${ticked.size} of ${titles.length}` : `Sections: all ${titles.length}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-sm font-semibold">Section</p>
          {ticked.size > 0 && (
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline" onClick={() => set([])}>Clear</button>
          )}
        </div>
        <p className="mb-1.5 text-[11px] text-muted-foreground">{ticked.size ? 'Rows of the ticked sections are shown.' : 'Tick the sections to keep.'}</p>
        <div className="max-h-64 overflow-auto rounded border" role="listbox" aria-label="Sections">
          {titles.map((t) => {
            const n = counts.get(t) ?? 0;
            return (
              <label key={t} className={cn('flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-muted', n === 0 && !ticked.has(t) && 'opacity-50')}>
                <Checkbox checked={ticked.has(t)} onCheckedChange={() => toggle(t)} className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate" title={t}>{t}</span>
                <span className="tabular-nums text-[11px] text-muted-foreground">{n.toLocaleString('en-IN')}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// ── Non-zero rows only ──────────────────────────────────────────────────────

const NON_ZERO_ID = 'non-zero';

export const NonZeroToggle: React.FC<{ kit: TableKit }> = ({ kit }) => {
  const on = !!kit.state.custom?.some((c) => c.id === NON_ZERO_ID);
  const toggle = () => kit.setCustomFilter(NON_ZERO_ID, on ? null : { label: 'Non-zero rows only', test: (r) => !isNilRow(r.cells) });
  return (
    <label className={cn('inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 text-xs', on ? 'border-primary text-primary' : 'hover:bg-muted')}>
      <Checkbox checked={on} onCheckedChange={toggle} className="h-3.5 w-3.5" aria-label="Non-zero rows only" />
      Non-zero rows only
    </label>
  );
};

// ── What a filter or sort does here ─────────────────────────────────────────

/**
 * One muted line under the toolbar while anything is filtered, sorted or
 * grouped: rows stay under their section heading (or a group's, without a
 * subtotal), and where the report's own TOTAL or result is. Grouped (or
 * sorted across the report) the kit lists those after the rows, as printed,
 * so the line says so only then; `filteredNote` (what the TOTAL or result
 * describes) is said only while a filter hides rows. `totalName` is what the
 * report calls its total line ("TOTAL", a working paper's "Result").
 */
export const TopDownHint: React.FC<{ kit: TableKit; totalName?: string; filteredNote?: React.ReactNode }> = ({ kit, totalName = 'TOTAL', filteredNote }) => {
  const { view, state, model } = kit;
  if (!view.filtered && !state.sort && !view.groups) return null;
  const sortedBy = state.sort ? model.columns[state.sort.col]?.name : null;
  const groupedBy = view.groups && state.groupBy !== null ? model.columns[state.groupBy]?.name : null;
  const parts: React.ReactNode[] = [];
  if (groupedBy) {
    parts.push(`Grouped by ${groupedBy}${sortedBy ? `, sorted by ${sortedBy} within each group` : ''}, in place of the sections; a group heading carries no subtotal.`);
  } else if (view.filtered) {
    parts.push('Filtered: each row still sits under its section heading, and sections with no row left are hidden.');
  }
  if (sortedBy && !groupedBy) {
    parts.push(view.sortedWithinSections
      ? `Sorted by ${sortedBy} within each section; the sections keep the report's order.`
      : `Sorted by ${sortedBy}.`);
  }
  if (view.reportTotals?.length) {
    const after = groupedBy ? 'groups' : 'rows';
    parts.push(model.merged
      ? `Each period's own ${totalName} follows the ${after}, as printed.`
      : `The report's own ${totalName} lines follow the ${after}, as printed.`);
  }
  if (view.filtered && filteredNote) parts.push(filteredNote);
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-primary/20 bg-primary/[0.04] px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
      <span>{parts.map((p, k) => <React.Fragment key={k}>{k > 0 && ' '}{p}</React.Fragment>)}</span>
    </p>
  );
};
