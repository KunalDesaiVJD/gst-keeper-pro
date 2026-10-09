import React, { useMemo } from 'react';
import { Loader2, UserMinus, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import type { StaffMember } from '@/hooks/useStaffList';
import { displayName, type Load, type Person, type Slot } from '@/lib/gstr9/signoffFlow';
import { cn } from '@/lib/utils';
import { Monogram } from './Monogram';

const ROLE_PILL: Record<string, string> = { superadmin: 'Superadmin', gst_manager: 'GST manager' };
const LOAD_KEY: Record<Slot, keyof Load> = { preparer: 'prepare', verifier: 'verify', reviewer: 'review' };
const LOAD_WORD: Record<Slot, string> = { preparer: 'to prepare', verifier: 'to verify', reviewer: 'to review' };

export interface StaffPick { userId: string; name: string }

/**
 * Pick who takes a slot: "Me" first, then every staff member with their role
 * and how much of that step they already hold. People who cannot take it
 * (they sign another stage, or are not a GST manager for the review) are
 * listed but disabled, with the reason.
 */
export const StaffPicker: React.FC<{
  slot: Slot;
  staff: StaffMember[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  loads: Map<string, Load>;
  meId: string;
  current: Person | null;
  /** Why a person can't take the slot (null = they can). */
  blockOf?: (s: StaffMember) => string | null;
  onPick: (who: StaffPick | null) => void;
  busy?: boolean;
  /** Offer "Unallot" (or "Any manager") when someone holds the slot. */
  allowClear?: boolean;
  className?: string;
}> = ({ slot, staff, loading, error, onRetry, loads, meId, current, blockOf, onPick, busy, allowClear = true, className }) => {
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    staff.forEach((s) => seen.set(s.name.toLowerCase(), (seen.get(s.name.toLowerCase()) ?? 0) + 1));
    return seen;
  }, [staff]);
  // Who can take the slot first (GST managers first for the review), then the rest with the reason they can't.
  const ordered = useMemo(() => {
    const rank = (s: StaffMember) => (blockOf?.(s) ? 2 : slot === 'reviewer' || ROLE_PILL[s.role] === undefined ? 0 : 1);
    return [...staff].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [staff, blockOf, slot]);
  const me = staff.find((s) => s.userId === meId);
  const meBlock = me ? blockOf?.(me) ?? null : null;
  const label = (s: StaffMember) => displayName(s.name) + ((dupes.get(s.name.toLowerCase()) ?? 0) > 1 ? ` (${s.email.split('@')[0]})` : '');
  const loadText = (id: string) => {
    const n = loads.get(id)?.[LOAD_KEY[slot]] ?? 0;
    return n ? `${n} ${LOAD_WORD[slot]}` : '';
  };

  return (
    <Command className={cn('rounded-none', className)}>
      <CommandInput placeholder={`Allot ${slot}…`} aria-label={`Search staff to allot as ${slot}`} />
      <CommandList className="max-h-64">
        {loading && <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading staff…</div>}
        {error && (
          <div className="space-y-2 p-3 text-xs">
            <div className="text-destructive-strong">Couldn&apos;t load staff.</div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>Retry</Button>
          </div>
        )}
        {!loading && !error && (
          <>
            <CommandEmpty>No staff found.</CommandEmpty>
            {((me && me.userId !== current?.id && !meBlock) || (allowClear && current)) && (
              <>
                <CommandGroup heading="Quick">
                  {me && me.userId !== current?.id && !meBlock && (
                    <CommandItem value={`me ${me.name}`} disabled={busy} onSelect={() => onPick({ userId: me.userId, name: me.name })}>
                      <UserRound className="mr-2 h-4 w-4" /> Me ({displayName(me.name)})
                    </CommandItem>
                  )}
                  {allowClear && current && (
                    <CommandItem value="unallot nobody" disabled={busy} onSelect={() => onPick(null)}>
                      <UserMinus className="mr-2 h-4 w-4" /> {slot === 'preparer' ? 'Unallot' : 'Any GST manager (unallot)'}
                    </CommandItem>
                  )}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="Staff">
              {ordered.map((s) => {
                const block = blockOf?.(s) ?? null;
                const isCurrent = s.userId === current?.id;
                return (
                  <CommandItem
                    key={s.userId}
                    value={`${s.name} ${s.email} ${ROLE_PILL[s.role] ?? ''}`}
                    disabled={busy || !!block || isCurrent}
                    onSelect={() => onPick({ userId: s.userId, name: s.name })}
                    className="gap-2"
                  >
                    <Monogram name={s.name} me={s.userId === meId} muted={!!block} />
                    <span className="min-w-0 truncate">{label(s)}</span>
                    {ROLE_PILL[s.role] && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{ROLE_PILL[s.role]}</span>}
                    <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                      {isCurrent ? 'current' : block ?? loadText(s.userId)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );
};

export default StaffPicker;
