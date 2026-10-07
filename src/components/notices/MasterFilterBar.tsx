// The master filter bar under the module's tabs (the firm's request of
// 7 October 2026): client, financial year, owner, form and priority, one row,
// kept from page to page. Each page applies the same five to everything it
// shows; its own bar keeps only what is particular to it.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Filter, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FilterPill } from './FilterPill';
import { useNoticeFilterOptions } from './NoticeFilterBar';
import { useStaffList } from '@/hooks/useStaffList';
import { fmtFy } from '@/lib/noticeFormat';
import { fyKey, MASTER_KEYS, useMaster, type MasterKey } from '@/lib/masterFilters';
import { cn } from '@/lib/utils';

interface ClientOpt { id: string; name: string; gstin: string | null }

function useMasterOptions() {
  return useQuery({
    queryKey: ['master-filter-options'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [clients, matters] = await Promise.all([
        supabase.from('clients').select('id, name, gstin').order('name'),
        fetchAllRows<{ financial_years: string[] | null }>('litigation_matters', 'financial_years', (q) => q.order('id')),
      ]);
      if (clients.error) throw clients.error;
      return {
        clients: (clients.data ?? []).map((c) => ({ id: c.id, name: c.name ?? 'Unnamed client', gstin: c.gstin })) as ClientOpt[],
        matterFys: [...new Set(matters.flatMap((m) => m.financial_years ?? []).map(fyKey).filter(Boolean))],
      };
    },
  });
}

/** A pill like FilterPill, with a search box (for the client list). */
const SearchPill: React.FC<{ label: string; allLabel: string; value: string | undefined; options: ClientOpt[]; onChange: (v: string | undefined) => void }> = ({ label, allLabel, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.id === value);
  const shown = value ? cur?.name ?? 'One client' : allLabel;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${shown}`}
          className={cn('inline-flex h-8 max-w-[16rem] items-center gap-1 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground')}>
          <span className="truncate">{label}: {shown}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Client or GSTIN…" className="h-9 text-xs" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-3 text-center text-xs">No client found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__all" onSelect={() => { onChange(undefined); setOpen(false); }} className="text-xs">
                <Check className={cn('mr-2 h-3.5 w-3.5', !value ? 'opacity-100' : 'opacity-0')} /> {allLabel}
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.id} value={`${o.name} ${o.gstin ?? ''}`} onSelect={() => { onChange(o.id); setOpen(false); }} className="text-xs">
                  <Check className={cn('mr-2 h-3.5 w-3.5', value === o.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.name}</span>{o.gstin && <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground">{o.gstin}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const MasterFilterBar: React.FC<{ keys?: readonly MasterKey[]; className?: string }> = ({ keys = MASTER_KEYS, className }) => {
  const { m, set, clear, count } = useMaster();
  const { staff } = useStaffList();
  const notice = useNoticeFilterOptions().data;
  const opts = useMasterOptions().data;
  const fys = [...new Set([...(notice?.fys ?? []).map(fyKey), ...(opts?.matterFys ?? [])].filter(Boolean))].sort().reverse();
  const has = (k: MasterKey) => keys.includes(k);
  const shownCount = keys.filter((k) => !!m[k]).length;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="Filters for every page">
      <span className="inline-flex items-center gap-1 pr-0.5 text-[11px] font-medium text-muted-foreground"><Filter className="h-3.5 w-3.5" aria-hidden /> Filters</span>
      {has('client') && <SearchPill label="Client" allLabel="All" value={m.client} options={opts?.clients ?? []} onChange={(v) => set({ client: v })} />}
      {has('fy') && (
        <FilterPill label="FY" allLabel="Any" value={m.fy ? (m.fy === 'none' ? 'none' : fyKey(m.fy)) : 'all'} onChange={(v) => set({ fy: v })} options={[]}
          extraOptions={[...fys.map((y) => ({ value: y, label: fmtFy(y) })), { value: 'none', label: 'Not stated' }]} />
      )}
      {has('owner') && (
        <FilterPill label="Owner" allLabel="Anyone" value={m.owner ?? 'all'} onChange={(v) => set({ owner: v })} options={[]}
          extraOptions={[{ value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...staff.map((s) => ({ value: s.userId, label: s.name }))]} />
      )}
      {has('form') && (
        <FilterPill label="Form" allLabel="Any" value={m.form ?? 'all'} onChange={(v) => set({ form: v })} options={[]}
          extraOptions={[...(notice?.forms ?? []).map((f) => ({ value: f.code, label: `${f.code} · ${f.label}` })), { value: 'none', label: 'Not recognised' }]} />
      )}
      {has('priority') && <FilterPill label="Priority" allLabel="Any" value={m.priority ?? 'all'} onChange={(v) => set({ priority: v })} options={['High', 'Medium', 'Low']} />}
      {shownCount > 0 && (
        <button type="button" onClick={clear} className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          <X className="h-3 w-3" aria-hidden /> Clear{count > 1 ? ` (${count})` : ''}
        </button>
      )}
    </div>
  );
};

export default MasterFilterBar;
