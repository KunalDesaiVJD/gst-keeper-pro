// Change who looks after a client from the list (audit U-50-6: owner edits stay
// on the list). The owner is the client master's "assigned accountant", which
// the notices take their suggested owner from. The staff list loads only when
// the popover opens, not once per row.
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useStaffList } from '@/hooks/useStaffList';
import { cn } from '@/lib/utils';

const Picker: React.FC<{ current: string | null; onPick: (name: string | null) => void; saving: boolean }> = ({ current, onPick, saving }) => {
  const { staff, loading, error, reload } = useStaffList();
  if (loading) return <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading staff…</div>;
  if (error) return <div className="space-y-1 text-xs"><div className="text-destructive-strong">Couldn't load staff.</div><Button size="sm" variant="outline" className="h-7 text-xs" onClick={reload}>Retry</Button></div>;
  return (
    <ul className="max-h-60 space-y-0.5 overflow-auto" aria-label="Staff">
      {staff.map((s) => (
        <li key={s.userId}>
          <button type="button" disabled={saving || s.name === current} onClick={() => onPick(s.name)}
            className={cn('w-full rounded px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
              s.name === current && 'font-semibold')}>
            {s.name}{s.name === current && <span className="text-xs font-normal text-muted-foreground"> · current</span>}
          </button>
        </li>
      ))}
      {current && (
        <li><button type="button" disabled={saving} onClick={() => onPick(null)}
          className="w-full rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Nobody</button></li>
      )}
    </ul>
  );
};

export const OwnerPopover: React.FC<{ client: { id: string; name: string; assigned_accountant: string | null }; onSaved: () => void }> = ({ client, onSaved }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pick = async (name: string | null) => {
    setSaving(true);
    const { error } = await supabase.from('clients').update({ assigned_accountant: name }).eq('id', client.id);
    setSaving(false);
    if (error) { toast.error(`Couldn't change the owner: ${error.message}`); return; }
    toast.success(name ? `${client.name} is now looked after by ${name}.` : `${client.name} has no owner now.`);
    setOpen(false);
    onSaved();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {client.assigned_accountant || 'no owner'}<span className="sr-only">, change who looks after {client.name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-1.5 p-2">
        <div className="px-1 text-xs font-semibold">Who looks after {client.name}</div>
        {open && <Picker current={client.assigned_accountant} onPick={pick} saving={saving} />}
      </PopoverContent>
    </Popover>
  );
};

export default OwnerPopover;
