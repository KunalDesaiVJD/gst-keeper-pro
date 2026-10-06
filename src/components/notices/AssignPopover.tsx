import React, { useState } from 'react';
import { Loader2, UserMinus, UserRound, Sparkles } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffList, matchStaffByName } from '@/hooks/useStaffList';

export interface OwnerPick { userId: string; name: string }

/**
 * Assign in place (audit U-12-2): "Me", the client's accountant as a
 * suggestion, then a searchable staff list. Failing to load staff says so
 * (U-12-1) instead of showing an empty strip.
 */
export const AssignPopover: React.FC<{
  children: React.ReactElement;
  currentOwnerId?: string | null;
  /** The client master's assigned accountant, offered first. */
  suggestedName?: string | null;
  onAssign: (owner: OwnerPick | null) => Promise<void> | void;
  align?: 'start' | 'end' | 'center';
}> = ({ children, currentOwnerId, suggestedName, onAssign, align = 'end' }) => {
  const { user } = useAuth();
  const { staff, loading, error, reload } = useStaffList();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const suggested = matchStaffByName(staff, suggestedName);
  const me = staff.find((s) => s.userId === user?.id) ?? (user ? { userId: user.id, name: user.firstName, email: user.email, role: user.role } : null);

  const pick = async (owner: OwnerPick | null) => {
    setSaving(true);
    try { await onAssign(owner); setOpen(false); } finally { setSaving(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Assign to…" aria-label="Search staff" />
          <CommandList>
            {loading && <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading staff…</div>}
            {error && (
              <div className="space-y-2 p-3 text-xs">
                <div className="text-destructive-strong">Couldn't load staff.</div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={reload}>Retry</Button>
              </div>
            )}
            {!loading && !error && (
              <>
                <CommandEmpty>No staff found.</CommandEmpty>
                <CommandGroup heading="Quick">
                  {me && me.userId !== currentOwnerId && (
                    <CommandItem value={`me ${me.name}`} disabled={saving} onSelect={() => pick({ userId: me.userId, name: me.name })}>
                      <UserRound className="mr-2 h-4 w-4" /> Me ({me.name})
                    </CommandItem>
                  )}
                  {suggested && suggested.userId !== currentOwnerId && suggested.userId !== me?.userId && (
                    <CommandItem value={`suggested ${suggested.name}`} disabled={saving} onSelect={() => pick({ userId: suggested.userId, name: suggested.name })}>
                      <Sparkles className="mr-2 h-4 w-4" /> {suggested.name} <span className="ml-1 text-muted-foreground">· client's accountant</span>
                    </CommandItem>
                  )}
                  {currentOwnerId && (
                    <CommandItem value="unassign nobody" disabled={saving} onSelect={() => pick(null)}>
                      <UserMinus className="mr-2 h-4 w-4" /> Unassign
                    </CommandItem>
                  )}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Staff">
                  {staff.map((s) => (
                    <CommandItem key={s.userId} value={`${s.name} ${s.email}`} disabled={saving || s.userId === currentOwnerId}
                      onSelect={() => pick({ userId: s.userId, name: s.name })}>
                      <span className="truncate">{s.name}</span>
                      {s.userId === currentOwnerId && <span className="ml-auto text-[11px] text-muted-foreground">current</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default AssignPopover;
