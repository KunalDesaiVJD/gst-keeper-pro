// A searchable pick-list of clients for "Fetch a report" (audit U-110-2: a
// searchable picker, never a firm-wide run by default). Clients without a
// portal login cannot be picked; inactive ones say so.
import React, { useId, useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WS_BTN } from '@/components/workspace/theme';
import { plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

export interface PickClient { id: string; name: string; gstin: string | null; hasLogin: boolean; inactive: boolean; excluded: boolean }

export const ClientPicker: React.FC<{
  clients: PickClient[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}> = ({ clients, value, onChange, disabled }) => {
  const uid = useId();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? clients.filter((c) => `${c.name} ${c.gstin ?? ''}`.toLowerCase().includes(s)) : clients;
  }, [clients, q]);
  const picked = new Set(value);
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));
  const names = value.map((id) => clients.find((c) => c.id === id)).filter((c): c is PickClient => !!c);

  return (
    <div className="space-y-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className={cn(WS_BTN, 'w-full justify-between sm:w-72')} disabled={disabled}>
            <span className="truncate">{value.length ? `${plural(value.length, 'client')} picked` : 'Pick clients'}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-2 p-2">
          <div className="relative">
            <Label htmlFor={`${uid}-q`} className="sr-only">Search clients</Label>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id={`${uid}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or GSTIN" className="h-8 pl-7 text-xs" autoComplete="off" />
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto" aria-label="Clients">
            {shown.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No client matches.</li>}
            {shown.map((c) => (
              <li key={c.id}>
                <label className={cn('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted', !c.hasLogin && 'cursor-not-allowed')}>
                  <Checkbox checked={picked.has(c.id)} disabled={!c.hasLogin} onCheckedChange={(v) => toggle(c.id, !!v)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {c.gstin}{!c.hasLogin ? ' · no portal login' : c.inactive ? ' · inactive' : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {value.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onChange([])}>Clear the {plural(value.length, 'client')}</Button>
          )}
        </PopoverContent>
      </Popover>
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Picked clients">
          {names.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle(c.id, false)} aria-label={`Remove ${c.name}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="truncate">{c.name}</span> <X className="h-3 w-3 shrink-0" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClientPicker;
