// The one filter state of the reconciliation view. Every tab, the figures
// across the top and the filtered export read `rows` from here, so a count on
// any of them is a count of the same documents. Nothing is persisted: a report
// opens unfiltered. The whole filter is applied a beat behind the input
// (useDeferredValue): deferring only the search still re-filtered and
// re-sorted a year of documents on every keystroke with the old search.
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import {
  EMPTY_FILTERS, activePreset, allFacetCounts, applyFilters, filterChips, isFiltering, presetFilters, removeChip,
  type Facet, type FilterChip, type PresetKey, type RecoFilters,
} from '@/lib/itcReco/filters';
import type { RecoViewData, RecoViewRow } from '@/lib/itcReco/viewTypes';

export interface RecoFilterState {
  /** As typed (the search box shows this). */
  filters: RecoFilters;
  /** As applied to `rows` (the search a beat behind the typing): what an export describes. */
  applied: RecoFilters;
  /** The rows every filter leaves (the search as last applied). */
  rows: RecoViewRow[];
  /** Per facet: value → rows left by every other filter. */
  counts: Record<Facet, Map<string, number>>;
  filtering: boolean;
  preset: PresetKey | null;
  chips: FilterChip[];
  toggle: (facet: Facet, value: string) => void;
  setFacet: (facet: Facet, values: string[]) => void;
  setField: <K extends keyof RecoFilters>(key: K, value: RecoFilters[K]) => void;
  remove: (chip: FilterChip) => void;
  applyPreset: (key: PresetKey) => void;
  clear: () => void;
}

export function useRecoFilters(data: RecoViewData): RecoFilterState {
  const [filters, setFilters] = useState<RecoFilters>(EMPTY_FILTERS);
  const applied = useDeferredValue(filters);
  const rows = useMemo(() => applyFilters(data.rows, applied), [data.rows, applied]);
  const counts = useMemo(() => allFacetCounts(data.rows, applied), [data.rows, applied]);
  const chips = useMemo(() => filterChips(filters, data), [filters, data]);

  const toggle = useCallback((facet: Facet, value: string) => setFilters((f) => ({
    ...f, [facet]: f[facet].includes(value) ? f[facet].filter((v) => v !== value) : [...f[facet], value],
  })), []);
  const setFacet = useCallback((facet: Facet, values: string[]) => setFilters((f) => ({ ...f, [facet]: values })), []);
  const setField = useCallback(<K extends keyof RecoFilters>(key: K, value: RecoFilters[K]) => setFilters((f) => ({ ...f, [key]: value })), []);
  const remove = useCallback((chip: FilterChip) => setFilters((f) => removeChip(f, chip)), []);
  const applyPreset = useCallback((key: PresetKey) => setFilters(presetFilters(key, data.tolerance)), [data.tolerance]);
  const clear = useCallback(() => setFilters(EMPTY_FILTERS), []);

  return {
    filters,
    applied,
    rows,
    counts,
    filtering: isFiltering(filters),
    preset: activePreset(filters, data.tolerance),
    chips,
    toggle,
    setFacet,
    setField,
    remove,
    applyPreset,
    clear,
  };
}
