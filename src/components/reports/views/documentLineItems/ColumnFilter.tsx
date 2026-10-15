// The per-column menu of the document-list preview: sort, group and filter
// one column from its header, the way a reviewer works a register in Excel.
// What a filter does is decided in tableModel.ts; this is only the controls.
import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Filter, Layers, Search, X } from 'lucide-react';
import { fmtDate } from '@/lib/reportExport/layout';
import { cn } from '@/lib/utils';
import {
  dateRange, facetValues, isFilterActive,
  type ColumnFilter as ColFilter, type ModelColumn, type SortState, type TableModel, type ViewState,
} from './tableModel';

// ── Ticked values ──────────────────────────────────────────────────────────

/** A searchable list of a column's values with how many rows each would show. */
export const ValuesPanel: React.FC<{
  model: TableModel;
  state: ViewState;
  col: number;
  filter: ColFilter | undefined;
  onChange: (f: ColFilter | undefined) => void;
}> = ({ model, state, col, filter, onChange }) => {
  const values = useMemo(() => facetValues(model, state, col), [model, state, col]);
  const [q, setQ] = useState('');
  const ticked = new Set(filter?.type === 'values' ? filter.values : []);
  const shown = q.trim() ? values.filter((v) => v.label.toLowerCase().includes(q.trim().toLowerCase())) : values;
  const set = (next: Set<string>) => onChange(next.size ? { type: 'values', values: [...next] } : undefined);
  const toggle = (key: string) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set(next);
  };
  return (
    <div className="space-y-1.5">
      {values.length > 8 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a value…" className="h-7 pl-7 text-xs" autoFocus />
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{ticked.size ? `${ticked.size} ticked: rows with any of them` : 'Tick the values to keep'}</span>
        <span className="flex gap-2">
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => set(new Set([...ticked, ...shown.map((v) => v.key)]))}>
            Tick {q.trim() ? 'found' : 'all'}
          </button>
          {ticked.size > 0 && (
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => set(new Set())}>Clear</button>
          )}
        </span>
      </div>
      <div className="max-h-60 overflow-auto rounded border" role="listbox" aria-label="Values">
        {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No value matches.</p>}
        {shown.map((v) => (
          <label
            key={v.key}
            className={cn('flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-muted', v.count === 0 && !ticked.has(v.key) && 'opacity-50')}
          >
            <Checkbox checked={ticked.has(v.key)} onCheckedChange={() => toggle(v.key)} className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate" title={v.label}>{v.label}</span>
            <span className="tabular-nums text-[11px] text-muted-foreground">{v.count.toLocaleString('en-IN')}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

// ── Text, figures, dates ───────────────────────────────────────────────────

const ContainsPanel: React.FC<{ filter: ColFilter | undefined; onChange: (f: ColFilter | undefined) => void }> = ({ filter, onChange }) => (
  <div className="space-y-1">
    <p className="text-[11px] text-muted-foreground">Rows whose text contains</p>
    <Input
      autoFocus
      value={filter?.type === 'contains' ? filter.text : ''}
      onChange={(e) => onChange(e.target.value ? { type: 'contains', text: e.target.value } : undefined)}
      placeholder="Type part of the value…"
      className="h-7 text-xs"
    />
  </div>
);

const parseNum = (s: string): number | null => {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const NumberPanel: React.FC<{ filter: ColFilter | undefined; onChange: (f: ColFilter | undefined) => void }> = ({ filter, onChange }) => {
  const f = filter?.type === 'number' ? filter : { type: 'number' as const, min: null, max: null, nonZero: false };
  // Typed text is kept as typed ("1," mid-entry); the filter takes the number.
  const [minText, setMinText] = useState(f.min === null ? '' : String(f.min));
  const [maxText, setMaxText] = useState(f.max === null ? '' : String(f.max));
  const emit = (next: { min: number | null; max: number | null; nonZero?: boolean }) => {
    const out: ColFilter = { type: 'number', ...next };
    onChange(isFilterActive(out) ? out : undefined);
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          At least
          <Input
            inputMode="decimal" value={minText} placeholder="Min" className="h-7 text-right text-xs tabular-nums" autoFocus
            onChange={(e) => { setMinText(e.target.value); emit({ min: parseNum(e.target.value), max: f.max, nonZero: f.nonZero }); }}
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          At most
          <Input
            inputMode="decimal" value={maxText} placeholder="Max" className="h-7 text-right text-xs tabular-nums"
            onChange={(e) => { setMaxText(e.target.value); emit({ min: f.min, max: parseNum(e.target.value), nonZero: f.nonZero }); }}
          />
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox checked={!!f.nonZero} onCheckedChange={(v) => emit({ min: f.min, max: f.max, nonZero: v === true })} className="h-3.5 w-3.5" />
        Not nil (leave out zero)
      </label>
    </div>
  );
};

const DatePanel: React.FC<{ model: TableModel; col: number; filter: ColFilter | undefined; onChange: (f: ColFilter | undefined) => void }> = ({ model, col, filter, onChange }) => {
  const f = filter?.type === 'date' ? filter : { type: 'date' as const, from: null, to: null };
  const range = useMemo(() => dateRange(model, col), [model, col]);
  const emit = (from: string | null, to: string | null) => onChange(from || to ? { type: 'date', from, to } : undefined);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          From
          <Input type="date" value={f.from ?? ''} min={range?.min} max={range?.max} className="h-7 text-xs" onChange={(e) => emit(e.target.value || null, f.to)} />
        </label>
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          To
          <Input type="date" value={f.to ?? ''} min={range?.min} max={range?.max} className="h-7 text-xs" onChange={(e) => emit(f.from, e.target.value || null)} />
        </label>
      </div>
      {range && (
        <p className="text-[11px] text-muted-foreground">
          This column runs from {fmtDate(range.min)} to {fmtDate(range.max)}. Both ends are included.
        </p>
      )}
    </div>
  );
};

// ── The header menu ────────────────────────────────────────────────────────

const sortWords = (c: ModelColumn): [string, string] => {
  if (c.kind === 'date') return ['Oldest first', 'Newest first'];
  if (c.kind === 'amount' || c.kind === 'int' || c.kind === 'rate') return ['Smallest first', 'Largest first'];
  if (c.kind === 'period') return ['Earliest first', 'Latest first'];
  return ['A to Z', 'Z to A'];
};

export const ColumnFilter: React.FC<{
  model: TableModel;
  state: ViewState;
  col: number;
  onFilter: (col: number, f: ColFilter | undefined) => void;
  onSort: (sort: SortState | null) => void;
  onGroup: (col: number | null) => void;
}> = ({ model, state, col, onFilter, onSort, onGroup }) => {
  const c = model.columns[col];
  const filter = state.filters[col];
  const active = isFilterActive(filter);
  const [asc, desc] = sortWords(c);
  const sorted = state.sort?.col === col ? state.sort.dir : null;
  const grouped = state.groupBy === col;
  // Clearing remounts the panel, so figures typed into it go too.
  const [epoch, setEpoch] = useState(0);
  const set = (f: ColFilter | undefined) => onFilter(col, f);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${c.label}`}
          title={active ? 'Filtered: change or clear' : `Filter, sort or group by ${c.label}`}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-background hover:text-foreground',
            active && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
          )}
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2.5 p-3" onOpenAutoFocus={(e) => { if (c.filter === 'values' && c.distinct <= 8) e.preventDefault(); }}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-tight">{c.label}</p>
          {active && (
            <button type="button" className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { set(undefined); setEpoch((e) => e + 1); }}>
              <X className="h-3 w-3" /> Clear filter
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant={sorted === 'asc' ? 'default' : 'outline'} className="h-6 gap-1 px-2 text-[11px]" onClick={() => onSort(sorted === 'asc' ? null : { col, dir: 'asc' })}>
            <ArrowUpNarrowWide className="h-3 w-3" /> {asc}
          </Button>
          <Button type="button" size="sm" variant={sorted === 'desc' ? 'default' : 'outline'} className="h-6 gap-1 px-2 text-[11px]" onClick={() => onSort(sorted === 'desc' ? null : { col, dir: 'desc' })}>
            <ArrowDownWideNarrow className="h-3 w-3" /> {desc}
          </Button>
          {c.groupable && (
            <Button type="button" size="sm" variant={grouped ? 'default' : 'outline'} className="h-6 gap-1 px-2 text-[11px]" onClick={() => onGroup(grouped ? null : col)}>
              <Layers className="h-3 w-3" /> {grouped ? 'Grouped' : 'Group by this'}
            </Button>
          )}
        </div>
        <div key={epoch} className="border-t pt-2">
          {c.filter === 'values' && <ValuesPanel model={model} state={state} col={col} filter={filter} onChange={set} />}
          {c.filter === 'contains' && <ContainsPanel filter={filter} onChange={set} />}
          {c.filter === 'number' && <NumberPanel filter={filter} onChange={set} />}
          {c.filter === 'date' && <DatePanel model={model} col={col} filter={filter} onChange={set} />}
        </div>
      </PopoverContent>
    </Popover>
  );
};
