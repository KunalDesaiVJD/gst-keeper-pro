import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { StaffMember } from '@/hooks/useStaffList';
import { signoffStateOf } from '@/lib/gstr9/register';
import { allotBlock, displayName, SLOT_WORD, type Load, type Slot } from '@/lib/gstr9/signoffFlow';
import { allotAnnualReturn } from '@/lib/gstr9/store';
import { ViewSwitch } from '../reco/StepTabs';
import { Monogram } from '../signoff/Monogram';
import { StaffPicker, type StaffPick } from '../signoff/StaffPicker';
import { useRegisterSignoff, type SignoffRowInfo } from './signoffContext';
import { SKIP_TEXT } from './SignoffPanel';

type Method = 'one' | 'spread';

interface Plan {
  /** client id → who gets it */
  give: Map<string, StaffPick>;
  /** reason → rows skipped for it */
  skipped: Map<string, SignoffRowInfo[]>;
}

const LOAD_KEY: Record<Slot, keyof Load> = { preparer: 'prepare', verifier: 'verify', reviewer: 'review' };
const isManagerRole = (role: string) => role === 'superadmin' || role === 'gst_manager';

const skip = (m: Map<string, SignoffRowInfo[]>, why: string, r: SignoffRowInfo) => m.set(why, [...(m.get(why) ?? []), r]);

/**
 * Who gets what. One person: every row they can take. Spread: the rows of a
 * PAN stay together (one person per PAN — the turnover and the workings are
 * the PAN's), the largest groups go first, each to whoever of the chosen staff
 * holds the least of that step now (counting what this run has given them).
 */
export function planAllotment(rows: SignoffRowInfo[], slot: Slot, method: Method, one: StaffMember | null, team: StaffMember[], loads: Map<string, Load>, onlyEmpty: boolean): Plan {
  const give = new Map<string, StaffPick>();
  const skipped = new Map<string, SignoffRowInfo[]>();
  const todo = rows.filter((r) => {
    if (onlyEmpty && r.s[slot]) { skip(skipped, `already has a ${SLOT_WORD[slot]}`, r); return false; }
    return true;
  });
  if (method === 'one') {
    if (!one) return { give, skipped };
    todo.forEach((r) => {
      if (r.s[slot]?.id === one.userId) { skip(skipped, `already ${displayName(one.name)}`, r); return; }
      const b = allotBlock(r.s, slot, { id: one.userId, role: one.role });
      if (b) skip(skipped, b === 'prepares this' || b === 'verifies this' || b === 'reviews this' ? `${displayName(one.name)} ${b}` : b, r);
      else give.set(r.id, { userId: one.userId, name: one.name });
    });
    return { give, skipped };
  }
  if (!team.length) return { give, skipped };
  const groups = new Map<string, SignoffRowInfo[]>();
  todo.forEach((r) => {
    const signed = allotBlock(r.s, slot, { id: '', role: 'gst_manager' });
    if (signed === 'locked' || signed === 'already prepared' || signed === 'already verified') { skip(skipped, signed, r); return; }
    const k = r.pan ?? r.id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });
  const given = new Map<string, number>();
  const load = (id: string) => (loads.get(id)?.[LOAD_KEY[slot]] ?? 0) + (given.get(id) ?? 0);
  [...groups.values()]
    .sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name))
    .forEach((g) => {
      const fit = team
        .filter((t) => g.every((r) => r.s[slot]?.id === t.userId || !allotBlock(r.s, slot, { id: t.userId, role: t.role })))
        .sort((a, b) => load(a.userId) - load(b.userId) || a.name.localeCompare(b.name))[0];
      if (!fit) { g.forEach((r) => skip(skipped, 'nobody chosen can take it (three different people sign)', r)); return; }
      g.forEach((r) => {
        if (r.s[slot]?.id === fit.userId) { skip(skipped, `already ${displayName(fit.name)}`, r); return; }
        give.set(r.id, { userId: fit.userId, name: fit.name });
      });
      given.set(fit.userId, (given.get(fit.userId) ?? 0) + g.length);
    });
  return { give, skipped };
}

/** Allot one slot on many workings: the rows shown in the register (in scope, not locked). */
export const BulkAllotDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; rows: SignoffRowInfo[] }> = ({ open, onOpenChange, rows }) => {
  const ctx = useRegisterSignoff();
  const { me, staff, loads, financialYear: fy } = ctx;
  const [slot, setSlot] = useState<Slot>('preparer');
  const [method, setMethod] = useState<Method>('one');
  const [one, setOne] = useState<StaffMember | null>(null);
  const [team, setTeam] = useState<Set<string>>(new Set());
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setSlot('preparer'); setMethod('one'); setOne(null); setTeam(new Set()); setOnlyEmpty(true); setBusy(false); }
  }, [open]);
  useEffect(() => {
    // The reviewer is a GST manager / superadmin: drop anyone else picked for another slot.
    if (slot === 'reviewer') {
      setOne((o) => (o && !isManagerRole(o.role) ? null : o));
      setTeam((t) => new Set([...t].filter((id) => isManagerRole(staff.find((s) => s.userId === id)?.role ?? ''))));
    }
  }, [slot, staff]);

  const eligibleStaff = slot === 'reviewer' ? staff.filter((s) => isManagerRole(s.role)) : staff;
  const teamList = staff.filter((s) => team.has(s.userId));
  const plan = useMemo(() => planAllotment(rows, slot, method, one, teamList, loads, onlyEmpty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, slot, method, one, team, loads, onlyEmpty, staff]);

  const perPerson = useMemo(() => {
    const m = new Map<string, { pick: StaffPick; rows: string[] }>();
    plan.give.forEach((p, id) => {
      const e = m.get(p.userId) ?? { pick: p, rows: [] };
      e.rows.push(rows.find((r) => r.id === id)?.name ?? id);
      m.set(p.userId, e);
    });
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [plan, rows]);

  const apply = async () => {
    const items = [...plan.give].map(([clientId, p]) => ({ clientId, userId: p.userId, expectUserId: rows.find((r) => r.id === clientId)?.s[slot]?.id ?? null }));
    if (!items.length) return;
    setBusy(true);
    try {
      const res = await allotAnnualReturn(fy, slot, items, me.id);
      res.forEach((x) => { if (x.row) ctx.patchRow(x.clientId, signoffStateOf(x.row)); });
      const done = res.filter((x) => x.applied);
      const notDone = res.filter((x) => !x.applied && x.reason !== 'unchanged');
      onOpenChange(false);
      toast.success(`Allotted ${done.length} ${SLOT_WORD[slot]}${done.length === 1 ? '' : 's'}${notDone.length ? ` · ${notDone.length} skipped (${[...new Set(notDone.map((x) => (x.reason ? SKIP_TEXT[x.reason] : 'refused')))].join('; ')})` : ''}`, {
        action: done.length ? {
          label: 'Undo',
          onClick: () => {
            const back = done.map((x) => ({ clientId: x.clientId, userId: x.previous?.id ?? null, expectUserId: items.find((i) => i.clientId === x.clientId)?.userId ?? null }));
            void allotAnnualReturn(fy, slot, back, me.id)
              .then((u) => {
                u.forEach((x) => { if (x.row) ctx.patchRow(x.clientId, signoffStateOf(x.row)); });
                const failed = u.filter((x) => !x.applied && x.reason !== 'unchanged').length;
                if (failed) toast.error(`${failed} could not be undone — changed meanwhile.`);
                else toast.success('Allotment undone.');
              })
              .catch((e) => toast.error(`Could not undo: ${e instanceof Error ? e.message : String(e)}`));
          },
        } : undefined,
      });
    } catch (e) {
      toast.error(`Could not allot: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const without = rows.filter((r) => !r.s[slot]).length;
  const loadOf = (id: string) => loads.get(id)?.[LOAD_KEY[slot]] ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Allot sign-off · FY {fy}</DialogTitle>
          <DialogDescription>
            {rows.length} working{rows.length === 1 ? '' : 's'} in this view that can be allotted (locked ones and those not being filed are left out) · {without} without a {SLOT_WORD[slot]}.
            Three different people prepare, verify and review each one.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Allot the</span>
              <ViewSwitch<Slot> label="Which step" value={slot} onChange={setSlot}
                options={[{ value: 'preparer', label: 'Preparer' }, { value: 'verifier', label: 'Verifier' }, { value: 'reviewer', label: 'Reviewer' }]} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">To</span>
              <ViewSwitch<Method> label="How" value={method} onChange={setMethod}
                options={[{ value: 'one', label: 'One person' }, { value: 'spread', label: 'Spread across staff', title: 'One person per PAN, to whoever of those chosen holds the least' }]} />
            </div>
            {method === 'one' ? (
              <div className="overflow-hidden rounded-md border">
                {one && (
                  <div className="flex items-center gap-2 border-b bg-primary/[0.06] px-3 py-1.5 text-xs">
                    <Monogram name={one.name} /> <span className="font-medium">{displayName(one.name)}</span>
                    <span className="text-muted-foreground">· holds {loadOf(one.userId)} to {slot === 'preparer' ? 'prepare' : slot === 'verifier' ? 'verify' : 'review'}</span>
                  </div>
                )}
                <StaffPicker slot={slot} staff={eligibleStaff} loading={ctx.staffLoading} error={ctx.staffError} onRetry={ctx.reloadStaff}
                  loads={loads} meId={me.id} current={null} allowClear={false}
                  onPick={(p) => setOne(staff.find((s) => s.userId === p?.userId) ?? null)} />
              </div>
            ) : (
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                  <span>{team.size} chosen</span>
                  <button type="button" className="font-medium text-primary hover:underline"
                    onClick={() => setTeam(team.size ? new Set() : new Set(eligibleStaff.map((s) => s.userId)))}>
                    {team.size ? 'Clear' : 'Choose all'}
                  </button>
                </div>
                <ul className="max-h-64 overflow-y-auto py-1">
                  {eligibleStaff.map((s) => (
                    <li key={s.userId}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs hover:bg-muted">
                        <Checkbox checked={team.has(s.userId)} onCheckedChange={(v) => setTeam((t) => { const n = new Set(t); if (v === true) n.add(s.userId); else n.delete(s.userId); return n; })} />
                        <Monogram name={s.name} me={s.userId === me.id} />
                        <span className="min-w-0 truncate">{displayName(s.name)}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">{loadOf(s.userId) || ''}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={onlyEmpty} onCheckedChange={(v) => setOnlyEmpty(v === true)} />
              Only workings without a {SLOT_WORD[slot]}
            </label>
          </div>

          <div className="min-w-0 space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-medium">Preview</div>
            {!plan.give.size && !plan.skipped.size && (
              <p className="text-muted-foreground">{method === 'one' ? 'Pick a person.' : 'Choose the staff to spread the workings across.'}</p>
            )}
            {perPerson.length > 0 && (
              <ul className="space-y-1">
                {perPerson.map(({ pick, rows: names }) => (
                  <li key={pick.userId}>
                    <details>
                      <summary className="flex cursor-pointer list-none items-center gap-2">
                        <Monogram name={pick.name} me={pick.userId === me.id} />
                        <span className="font-medium">{displayName(pick.name)}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">{loadOf(pick.userId)} → {loadOf(pick.userId) + names.length} <span className="text-success-strong">(+{names.length})</span></span>
                      </summary>
                      <ul className="ml-7 mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
                        {names.sort().map((n) => <li key={n} className="truncate">{n}</li>)}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {plan.skipped.size > 0 && (
              <div className="space-y-0.5 border-t pt-2">
                <div className="text-[11px] font-medium text-muted-foreground">Skipped</div>
                {[...plan.skipped].map(([why, list]) => (
                  <div key={why} className="flex gap-2 text-[11px]" title={list.map((r) => r.name).join('\n')}>
                    <span className="tabular-nums">{list.length}</span><span className="text-muted-foreground">{why}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void apply()} disabled={busy || !plan.give.size}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UsersRound className="mr-1 h-3.5 w-3.5" />}
            Allot {plan.give.size || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkAllotDialog;
