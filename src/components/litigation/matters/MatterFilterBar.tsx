// One filter bar for the matters list (audit U-80-4, U-81-1, U-81-3): search
// over matter no., title, client, GSTIN and notice references; pills; one
// client control driven by the URL; a chip with ✕ for every active filter.
import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterPill } from '@/components/notices/FilterPill';
import { useStaffList } from '@/hooks/useStaffList';
import { STAGES, stageLabel } from '@/lib/noticeStages';
import {
  AGE_BUCKETS, CLOCK_FILTERS, LIFECYCLES, lifecycleLabel, type MatterListParams, type MatterStatusFilter,
} from '@/lib/litigationData';
import { ClientPicker, type ClientOption } from './ClientPicker';

const AGE_LABEL: Record<string, string> = {
  '0-30': 'Up to 30 days', '31-90': '31–90 days', '91-180': '91–180 days', '181-365': '181–365 days', '365+': 'Over a year',
};
export const ageLabel = (a: string) => AGE_LABEL[a] ?? a;

export const MatterFilterBar: React.FC<{
  params: MatterListParams;
  onChange: (patch: Partial<MatterListParams>) => void;
  clients: ClientOption[];
  meId: string | null;
  actions?: React.ReactNode;
  /** The page shows the master filter bar: leave client, owner, priority, FY and form to it. */
  master?: boolean;
}> = ({ params, onChange, clients, meId, actions, master = false }) => {
  const { staff } = useStaffList();
  const [q, setQ] = useState(params.q ?? '');
  useEffect(() => { setQ(params.q ?? ''); }, [params.q]);
  useEffect(() => {
    if ((params.q ?? '') === q) return;
    const t = setTimeout(() => onChange({ q: q || undefined, page: 1 }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (key: keyof MatterListParams) => (v: string) => onChange({ [key]: v === 'all' ? undefined : v, page: 1 });
  const staffName = (id: string) => (id === 'none' ? 'Unassigned' : staff.find((s) => s.userId === id)?.name ?? (id === meId ? 'Me' : 'someone'));
  const clientName = clients.find((c) => c.id === params.client)?.name ?? 'one client';

  const chips: { key: keyof MatterListParams; label: string }[] = [];
  if (params.client && !master) chips.push({ key: 'client', label: `Client: ${clientName}` });
  if (params.clock) chips.push({ key: 'clock', label: CLOCK_FILTERS.find((c) => c.key === params.clock)?.label ?? params.clock });
  if (params.stage) chips.push({ key: 'stage', label: `Stage: ${stageLabel(params.stage)}` });
  if (params.lifecycle) chips.push({ key: 'lifecycle', label: `Type: ${lifecycleLabel(params.lifecycle)}` });
  if (params.owner && !master) chips.push({ key: 'owner', label: `Owner: ${staffName(params.owner)}` });
  if (params.priority && !master) chips.push({ key: 'priority', label: `Priority: ${params.priority}` });
  if (params.age) chips.push({ key: 'age', label: `Opened: ${ageLabel(params.age)} ago` });
  if (params.q) chips.push({ key: 'q', label: `Search: “${params.q}”` });

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Matter no., title, client, GSTIN, reference…" aria-label="Search matters" className="h-8 pl-7 text-xs" />
        </div>
        <FilterPill label="Show" allLabel="All matters" value={params.status === 'all' ? 'all' : params.status}
          onChange={(v) => onChange({ status: (v === 'all' ? 'all' : v) as MatterStatusFilter, page: 1 })}
          options={[]} extraOptions={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
        {!master && <ClientPicker clients={clients} value={params.client ?? null} onChange={(id) => onChange({ client: id ?? undefined, page: 1 })} />}
        <FilterPill label="Stage" allLabel="Any" value={params.stage ?? 'all'} onChange={set('stage')} options={[]}
          extraOptions={STAGES.map((s) => ({ value: s.key, label: s.label }))} />
        <FilterPill label="Type" allLabel="Any" value={params.lifecycle ?? 'all'} onChange={set('lifecycle')} options={[]}
          extraOptions={LIFECYCLES.map((l) => ({ value: l.key, label: l.label }))} />
        {!master && (
          <>
            <FilterPill label="Owner" allLabel="Anyone" value={params.owner ?? 'all'} onChange={(v) => onChange({ owner: v === 'all' ? undefined : v, page: 1 })} options={[]}
              extraOptions={[...(meId ? [{ value: meId, label: 'Me' }] : []), { value: 'none', label: 'Unassigned' },
                ...staff.filter((s) => s.userId !== meId).map((s) => ({ value: s.userId, label: s.name }))]} />
            <FilterPill label="Priority" allLabel="Any" value={params.priority ?? 'all'} onChange={set('priority')} options={['High', 'Medium', 'Low']} />
          </>
        )}
        <FilterPill label="Opened" allLabel="Any time" value={params.age ?? 'all'} onChange={set('age')} options={[]}
          extraOptions={AGE_BUCKETS.map((a) => ({ value: a, label: `${ageLabel(a)} ago` }))} />
        {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => onChange({ [c.key]: undefined, page: 1 })}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="truncate">{c.label}</span> <X className="h-3 w-3 shrink-0" aria-hidden /><span className="sr-only">(remove this filter)</span>
            </button>
          ))}
          <button type="button" className="text-[11px] text-foreground/70 underline underline-offset-2 hover:text-foreground"
            onClick={() => onChange(master
              ? { stage: undefined, lifecycle: undefined, age: undefined, clock: undefined, q: undefined, page: 1 }
              : { stage: undefined, client: undefined, owner: undefined, lifecycle: undefined, priority: undefined, age: undefined, clock: undefined, q: undefined, page: 1 })}>
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
};

export default MatterFilterBar;
