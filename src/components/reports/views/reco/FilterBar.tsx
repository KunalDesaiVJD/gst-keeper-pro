// The filter bar of the reconciliation view: presets, status toggles, one
// pop-over per facet (each value with how many documents it would show given
// every other filter), the tax-difference and date bounds, a search box, the
// active filters as removable chips, and the export of exactly what is shown.
// A facet with a single value in the data offers no choice, so it is left out
// until it holds a selection.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileSpreadsheet, FileText, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import {
  PRESETS, applyFilters, facetName, facetOptions, presetFilters,
  type Facet, type FacetOption, type PresetKey,
} from '@/lib/itcReco/filters';
import type { RecoStatus } from '@/lib/itcReco/types';
import type { RecoViewData } from '@/lib/itcReco/viewTypes';
import { STATUS_FILL, fmtCountPlain } from './format';
import type { RecoFilterState } from './useRecoFilters';

/** The facets offered as pop-overs, in the bar's order (status has its own toggles). */
const POPOVER_FACETS: Facet[] = ['reason', 'supplier', 'period', 'docType', 'section', 'itc', 'rate', 'reverseCharge', 'flag', 'confirmation'];
/** Rendered at most per pop-over; a search narrows the rest (a year can hold 300+ suppliers). */
const MAX_OPTIONS = 150;

const FacetPopover: React.FC<{
  name: string;
  options: FacetOption[];
  counts: Map<string, number>;
  selected: string[];
  onToggle: (value: string) => void;
  onSet: (values: string[]) => void;
  wide?: boolean;
}> = ({ name, options, counts, selected, onToggle, onSet, wide }) => {
  const [q, setQ] = useState('');
  const searchable = options.length > 10;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = needle ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.sub ?? '').toLowerCase().includes(needle)) : options;
    // What is ticked stays at the top of a long list, so it can be unticked
    // without scrolling (not in a grouped list, whose headings would repeat).
    const grouped = hit.some((o) => o.group);
    return searchable && !grouped ? [...hit.filter((o) => selected.includes(o.value)), ...hit.filter((o) => !selected.includes(o.value))] : hit;
  }, [options, q, selected, searchable]);
  const n = selected.length;
  let lastGroup: string | undefined;
  return (
    <Popover onOpenChange={(o) => { if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(WS_BTN, 'h-7 px-2 font-normal', n > 0 && 'border-primary/60 bg-primary/[0.06] font-medium text-primary')}
          aria-label={`${name} filter${n ? `, ${n} selected` : ''}`}
        >
          {name}
          {n > 0 && <span className="rounded bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums">{n}</span>}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('p-0', wide ? 'w-[420px]' : 'w-72')}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold">{name}</span>
          <button type="button" className="text-[11px] font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline" disabled={!n} onClick={() => onSet([])}>
            Clear
          </button>
        </div>
        {searchable && (
          <div className="relative border-b p-2">
            <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${name.toLowerCase()}…`} className="h-8 pl-7 text-xs md:text-xs" aria-label={`Find a ${name.toLowerCase()}`} />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto p-1" role="group" aria-label={name}>
          {shown.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing matches.</div>}
          {shown.slice(0, MAX_OPTIONS).map((o) => {
            const c = counts.get(o.value) ?? 0;
            const on = selected.includes(o.value);
            const heading = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <React.Fragment key={o.value}>
                {heading && <div className="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>}
                <label className={cn('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted', !c && !on && 'opacity-50')}>
                  <Checkbox checked={on} onCheckedChange={() => onToggle(o.value)} className="mt-px h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words leading-snug">{o.label}</span>
                    {o.sub && <span className="block font-mono text-[10.5px] text-muted-foreground">{o.sub}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{fmtCountPlain(c)}</span>
                </label>
              </React.Fragment>
            );
          })}
          {shown.length > MAX_OPTIONS && (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{shown.length - MAX_OPTIONS} more: type to find them.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** A number box that keeps what is typed and reports a number (or null once cleared). */
const AmountBox: React.FC<{ value: number | null; onChange: (v: number | null) => void; label: string }> = ({ value, onChange, label }) => {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { setText(value === null ? '' : String(value)); }, [value]);
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={text}
      aria-label={label}
      placeholder="0"
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n);
      }}
      className="h-7 w-24 text-xs tabular-nums md:text-xs"
    />
  );
};

export const FilterBar: React.FC<{
  data: RecoViewData;
  state: RecoFilterState;
  onExport: (format: 'xlsx' | 'pdf') => void;
  exportBusy: 'xlsx' | 'pdf' | null;
}> = ({ data, state, onExport, exportBusy }) => {
  const { filters, counts, filtering, preset, chips } = state;
  const options = useMemo(() => Object.fromEntries([...POPOVER_FACETS, 'status' as Facet].map((f) => [f, facetOptions(data, f)])) as Record<Facet, FacetOption[]>, [data]);
  // Each preset's own size, over every document (a preset replaces the filter).
  const presetCounts = useMemo(
    () => Object.fromEntries(PRESETS.map((p) => [p.key, applyFilters(data.rows, presetFilters(p.key, data.tolerance)).length])) as Record<PresetKey, number>,
    [data],
  );
  const facets = POPOVER_FACETS.filter((f) => (f !== 'period' || data.periods.length > 1) && (options[f].length > 1 || filters[f].length > 0));

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <div role="group" aria-label="Presets" className="inline-flex h-8 items-center rounded-md border border-primary/20 bg-primary/[0.08] p-0.5 text-xs">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              title={p.hint}
              onClick={() => state.applyPreset(p.key)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                preset === p.key ? 'bg-card font-semibold text-primary shadow ring-1 ring-primary/30' : 'text-foreground/75 hover:bg-card/70 hover:text-foreground',
              )}
            >
              {p.label}
              <span className="tabular-nums text-[11px] font-normal opacity-70">{fmtCountPlain(presetCounts[p.key])}</span>
            </button>
          ))}
        </div>

        <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1">
          {options.status.map((o) => {
            const on = filters.status.includes(o.value);
            const c = counts.status.get(o.value) ?? 0;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => state.toggle('status', o.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
                  !c && !on && 'opacity-50',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', STATUS_FILL[o.value as RecoStatus], on && 'ring-1 ring-primary-foreground/80')} aria-hidden="true" />
                {o.label}
                <span className={cn('tabular-nums text-[11px]', on ? 'text-primary-foreground/85' : 'text-muted-foreground')}>{fmtCountPlain(c)}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button" variant="outline" size="sm" className={WS_BTN}
            disabled={!filtering || !state.rows.length || exportBusy !== null}
            onClick={() => onExport('xlsx')}
            title={filtering ? 'Excel of the documents shown, with the filter in its header' : 'Set a filter first; the Excel button above exports the whole report'}
          >
            {exportBusy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Excel (filtered)
          </Button>
          <Button
            type="button" variant="outline" size="sm" className={WS_BTN}
            disabled={!filtering || !state.rows.length || exportBusy !== null}
            onClick={() => onExport('pdf')}
            title={filtering ? 'PDF of the documents shown, with the filter in its header' : 'Set a filter first; the PDF button above exports the whole report'}
          >
            {exportBusy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            PDF (filtered)
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t px-3 py-2">
        <div className="relative w-72 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={filters.search}
            onChange={(e) => state.setField('search', e.target.value)}
            placeholder="Search GSTIN, name, number, reason…"
            aria-label="Search the documents"
            className="h-7 pl-8 pr-7 text-xs md:text-xs"
          />
          {filters.search && (
            <button type="button" aria-label="Clear the search" onClick={() => state.setField('search', '')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {facets.map((f) => (
          <FacetPopover
            key={f}
            name={facetName(f, data)}
            options={options[f]}
            counts={counts[f]}
            selected={filters[f]}
            onToggle={(v) => state.toggle(f, v)}
            onSet={(vs) => state.setFacet(f, vs)}
            wide={f === 'reason' || f === 'supplier'}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed px-3 py-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          Tax difference at least ₹
          <AmountBox value={filters.minDiff} onChange={(v) => state.setField('minDiff', v)} label="Tax difference at least, in rupees" />
        </label>
        <div role="group" aria-label="Document date" className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          Document date
          <Input type="date" value={filters.dateFrom ?? ''} max={filters.dateTo ?? undefined} onChange={(e) => state.setField('dateFrom', e.target.value || null)} className="h-7 w-[132px] px-2 text-xs md:text-xs" aria-label="Document date from" />
          <span>to</span>
          <Input type="date" value={filters.dateTo ?? ''} min={filters.dateFrom ?? undefined} onChange={(e) => state.setField('dateTo', e.target.value || null)} className="h-7 w-[132px] px-2 text-xs md:text-xs" aria-label="Document date to" />
        </div>
      </div>

      {filtering && (
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/30 px-3 py-1.5">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">Showing {fmtCountPlain(state.rows.length)} of {fmtCountPlain(data.rows.length)} documents</span>
          {preset && preset !== 'all' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/[0.06] py-0.5 pl-2 pr-1 text-[11px] font-medium text-primary">
              {PRESETS.find((p) => p.key === preset)?.label}
              <button type="button" aria-label="Remove the preset" onClick={state.clear} className="rounded-full p-0.5 hover:bg-primary/10">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {/* A preset is one chip, not the statuses it sets. */}
          {(preset && preset !== 'all' ? [] : chips).map((c) => (
            <span key={`${c.kind}|${c.value ?? ''}`} className="inline-flex max-w-[360px] items-center gap-1 rounded-full border border-primary/30 bg-card py-0.5 pl-2 pr-1 text-[11px]">
              <span className="truncate" title={c.label}>{c.label}</span>
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => state.remove(c)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" onClick={state.clear} className="ml-1 text-[11px] font-semibold text-primary hover:underline">Clear all</button>
        </div>
      )}
    </div>
  );
};
