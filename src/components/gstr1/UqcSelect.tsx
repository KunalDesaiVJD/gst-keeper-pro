import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { classifyUqc, GSTN_UQC, uqcLabel } from '@/lib/gstr1/uqc';

const SERVICE_TITLE = 'A service (HSN/SAC starting 99) always goes to the portal as NA with quantity 0.';

/**
 * Table 12 unit picker. Offers GSTN's own list ("KGS-KILOGRAMS") and stores
 * only the code, as the portal does, so a typed "Others" can never reach the
 * JSON again. A service row shows NA and can't be changed; a stored value GSTN
 * doesn't know is shown in red until someone chooses.
 */
export const UqcSelect: React.FC<{
  value: unknown;
  hsn: unknown;
  onChange: (code: string) => void;
  className?: string;
}> = ({ value, hsn, onChange, className }) => {
  const [open, setOpen] = React.useState(false);
  const v = classifyUqc(value, hsn);
  const hsnTyped = String(hsn ?? '').trim() !== '';

  if (v.kind === 'service') {
    return (
      <span title={SERVICE_TITLE} className={cn('flex h-9 items-center px-2 text-sm text-muted-foreground', className)}>
        NA
      </span>
    );
  }

  const code = v.kind === 'ok' ? v.code : null;
  const face = code ? uqcLabel(code)
    : v.kind === 'unknown' ? `"${v.raw}": choose`
      : hsnTyped ? 'Choose unit' : '—';
  const title = code ? uqcLabel(code)
    : v.kind === 'unknown' ? `"${v.raw}" is not a GSTN unit, so the portal would reject this row. Choose one.`
      : hsnTyped ? 'No unit chosen. It goes to the portal as OTH-OTHERS unless you choose one.' : 'Type the HSN first';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={`Unit (UQC): ${title}`}
          title={title}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-1 bg-transparent px-2 text-left text-sm focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary',
            v.kind === 'unknown' && 'font-medium text-destructive-strong',
            v.kind === 'defaulted' && (hsnTyped ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'),
            className,
          )}
        >
          <span className="truncate">{face}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search unit (e.g. kilo, box)…" />
          <CommandList>
            <CommandEmpty>No GSTN unit matches. Use OTH-OTHERS.</CommandEmpty>
            <CommandGroup>
              {GSTN_UQC.map((u) => (
                <CommandItem
                  key={u.code}
                  value={uqcLabel(u.code)}
                  onSelect={() => { onChange(u.code); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', code === u.code ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="font-mono text-xs">{u.code}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{u.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/**
 * Table 12 unit as stored, for the read-only grid. Flags a value the portal
 * would reject, and what the push will send instead.
 */
export const UqcText: React.FC<{ value: unknown; hsn: unknown; className?: string }> = ({ value, hsn, className }) => {
  const v = classifyUqc(value, hsn);
  const raw = value === null || value === undefined ? '' : String(value);
  if ((v.kind === 'ok' || v.kind === 'service') && v.exact) return <span className={className} title={uqcLabel(v.code)}>{raw}</span>;
  if (v.kind === 'unknown') {
    return (
      <span className={cn('font-medium text-destructive-strong', className)} title={`"${raw}" is not a GSTN unit, so the portal would reject this row. Choose one in the HSN summary editor before uploading.`}>
        {raw || '—'}
      </span>
    );
  }
  return (
    <span className={cn('text-amber-700 dark:text-amber-400', className)} title={`Stored as ${raw ? `"${raw}"` : 'blank'}; goes to the portal as ${v.code}.`}>
      {raw || '—'} → {v.code}
    </span>
  );
};

export default UqcSelect;
