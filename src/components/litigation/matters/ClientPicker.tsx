// A searchable client control (audit U-81-1, U-82-4): name and GSTIN, typed
// to search, as a filter pill or as a form field.
import React, { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

export interface ClientOption { id: string; name: string; gstin: string | null }

export const ClientPicker: React.FC<{
  clients: ClientOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** 'pill' reads "Client: Any" like the other filters; 'field' is a form control. */
  variant?: 'pill' | 'field';
  id?: string;
  /** The visible label's id (field variant): the control is named by it plus the value shown. */
  labelId?: string;
  allowClear?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}> = ({ clients, value, onChange, variant = 'pill', id, labelId, allowClear = true, disabled, invalid }) => {
  const [open, setOpen] = useState(false);
  const current = clients.find((c) => c.id === value) ?? null;
  const pill = variant === 'pill';
  const text = pill ? `Client: ${current?.name ?? 'Any'}` : current ? current.name : 'Search name or GSTIN';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-invalid={invalid || undefined}
          aria-labelledby={labelId && id ? `${labelId} ${id}-value` : undefined}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
            pill ? cn('h-8 max-w-full rounded-full border px-2.5', current ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground')
              : cn('h-9 w-full justify-between rounded-md border bg-background px-3 text-sm font-normal', !current && 'text-muted-foreground', invalid && 'border-destructive'),
          )}>
          <span id={id ? `${id}-value` : undefined} className="truncate">{text}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Client name or GSTIN…" aria-label="Search clients" />
          <CommandList>
            <CommandEmpty>No client found.</CommandEmpty>
            <CommandGroup>
              {allowClear && pill && (
                <CommandItem value="any client all clients" onSelect={() => { onChange(null); setOpen(false); }}>
                  <Check className={cn('mr-2 h-4 w-4', !value ? 'text-primary' : 'invisible')} aria-hidden /> Any client
                </CommandItem>
              )}
              {clients.map((c) => (
                <CommandItem key={c.id} value={`${c.name} ${c.gstin ?? ''} ${c.id}`} onSelect={() => { onChange(c.id); setOpen(false); }}>
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', value === c.id ? 'text-primary' : 'invisible')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.gstin && <span className="ml-2 shrink-0 font-mono text-[11px] text-muted-foreground">{c.gstin}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default ClientPicker;
