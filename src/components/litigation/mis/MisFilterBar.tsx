// The MIS's one filter bar (audit U-100-3): client, owner, lifecycle and
// priority — the Matters list's own filters, so every link from the page keeps
// them and lands on a list with the same count — shared by every tab and kept
// in the URL, with a chip per active filter.
import React from 'react';
import { X } from 'lucide-react';
import { FilterPill } from '@/components/notices/FilterPill';
import { LIFECYCLES, PRIORITIES, lifecycleLabel, type MisData, type MisFilters } from './misData';

export const MisFilterBar: React.FC<{
  data: MisData | undefined;
  filters: MisFilters;
  onChange: (patch: MisFilters) => void;
  actions?: React.ReactNode;
}> = ({ data, filters, onChange, actions }) => {
  const clients = data?.clients ?? [];
  const staff = data?.staff ?? [];
  // Lifecycles on record (old keys too), in the Matters list's order.
  const order = new Map(LIFECYCLES.map((l, i) => [l.key, i]));
  const lifecycles = [...new Set([...(data?.matters ?? []).map((m) => m.lifecycle), ...(filters.lifecycle ? [filters.lifecycle] : [])])]
    .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b))
    .map((key) => ({ key, label: lifecycleLabel(key) }));
  const set = (key: keyof MisFilters) => (v: string) => onChange({ [key]: v === 'all' ? undefined : v });
  const ownerName = filters.owner === 'none' ? 'Unassigned' : staff.find((s) => s.userId === filters.owner)?.name ?? 'one person';

  const chips: { key: keyof MisFilters; label: string }[] = [];
  if (filters.client) chips.push({ key: 'client', label: `Client: ${clients.find((c) => c.id === filters.client)?.name ?? 'one client'}` });
  if (filters.owner) chips.push({ key: 'owner', label: `Owner: ${ownerName}` });
  if (filters.lifecycle) chips.push({ key: 'lifecycle', label: `Lifecycle: ${lifecycleLabel(filters.lifecycle)}` });
  if (filters.priority) chips.push({ key: 'priority', label: `Priority: ${filters.priority}` });

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill label="Client" allLabel="All" value={filters.client ?? 'all'} onChange={set('client')} options={[]}
          extraOptions={clients.map((c) => ({ value: c.id, label: c.name }))} className="max-w-full" />
        <FilterPill label="Owner" allLabel="Anyone" value={filters.owner ?? 'all'} onChange={set('owner')} options={[]}
          extraOptions={[{ value: 'none', label: 'Unassigned' }, ...staff.map((s) => ({ value: s.userId, label: s.name }))]} />
        <FilterPill label="Lifecycle" allLabel="Any" value={filters.lifecycle ?? 'all'} onChange={set('lifecycle')} options={[]}
          extraOptions={lifecycles.map((l) => ({ value: l.key, label: l.label }))} />
        <FilterPill label="Priority" allLabel="Any" value={filters.priority ?? 'all'} onChange={set('priority')} options={[...PRIORITIES]} />
        {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Showing only:</span>
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => onChange({ [c.key]: undefined })}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="truncate">{c.label}</span> <X className="h-3 w-3 shrink-0" aria-hidden /><span className="sr-only">(remove)</span>
            </button>
          ))}
          <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => onChange({ client: undefined, owner: undefined, lifecycle: undefined, priority: undefined })}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};

export default MisFilterBar;
