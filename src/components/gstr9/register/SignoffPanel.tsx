import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, ClipboardCheck, CornerUpLeft, History, Loader2, LockOpen, ShieldCheck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { signoffStateOf } from '@/lib/gstr9/register';
import {
  allotBlock, can, changesSinceSignoff, currentStep, displayName, nextSentence, SKIP_TEXT, SLOT_WORD, STAGE_META,
  type SignoffState, type Slot, type Step,
} from '@/lib/gstr9/signoffFlow';
import { allotAnnualReturn, setPeriodStatus, signoffAnnualReturn, SignoffStaleError, type SignoffRow } from '@/lib/gstr9/store';
import { cn } from '@/lib/utils';
import { Note } from '../ui';
import { ChangesList } from '../signoff/ChangesList';
import { StaffPicker, type StaffPick } from '../signoff/StaffPicker';
import { AllotChip, SignoffRail } from '../signoff/SignoffRail';
import { useRegisterSignoff, type SignoffRowInfo } from './signoffContext';


const SLOT_VERB: Record<Slot, string> = { preparer: 'prepare', verifier: 'verify', reviewer: 'review & lock' };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A note box inside the popover: Ctrl+Enter confirms, Escape cancels. */
const NoteForm: React.FC<{
  id: string;
  label: string;
  placeholder?: string;
  hint?: string;
  min?: number;
  confirm: string;
  busy: boolean;
  destructive?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  children?: React.ReactNode;
}> = ({ id, label, placeholder, hint, min = 0, confirm, busy, destructive, onConfirm, onCancel, children }) => {
  const [note, setNote] = useState('');
  const ok = note.trim().length >= min;
  return (
    <div data-signoff-substate="" className="mt-1.5 space-y-1.5 rounded-md border bg-muted/30 p-2">
      {children}
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <Textarea
        id={id}
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="min-h-[52px] text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok && !busy) { e.preventDefault(); onConfirm(note.trim()); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
      />
      {hint && <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" variant={destructive ? 'destructive' : 'default'} className="h-7 text-xs" disabled={busy || !ok} onClick={() => onConfirm(note.trim())}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{confirm}
        </Button>
      </div>
    </div>
  );
};

/**
 * The Sign-off popover: the three steps with who is allotted to each (a
 * GST manager / superadmin re-allots from the chip), who signed and when, and
 * the one or two things the viewer may do now. Prepare, send back, withdraw
 * and unlock happen here; verify and review & lock open the working, which
 * saves everything and checks the open differences first.
 */
export const SignoffPanel: React.FC<{ row: SignoffRowInfo }> = ({ row: r }) => {
  const ctx = useRegisterSignoff();
  const { me, financialYear: fy } = ctx;
  const s = r.s;
  const [checking, setChecking] = useState(true);
  const [picking, setPicking] = useState<Slot | null>(null);
  const [form, setForm] = useState<null | 'prepare' | 'send_back' | 'unlock'>(null);
  const [returnTo, setReturnTo] = useState<'preparer' | 'verifier'>('verifier');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  // Whatever the register loaded may be minutes old: read this working again on open.
  useEffect(() => {
    let live = true;
    ctx.refreshRow(r.id).catch(() => undefined).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  const stale = async () => {
    const fresh = await ctx.refreshRow(r.id).catch(() => null);
    setNotice(`This changed while you were looking${fresh ? ` (now: ${STAGE_META[fresh.stage].label})` : ''}. Nothing of yours was applied.`);
    setForm(null);
  };

  const run = async (key: string, verb: string, fn: () => Promise<SignoffRow>, done: (next: SignoffState) => string) => {
    setBusy(key);
    setNotice(null);
    try {
      const next = signoffStateOf(await fn());
      ctx.patchRow(r.id, next);
      toast.success(done(next));
      setForm(null);
    } catch (e) {
      if (e instanceof SignoffStaleError) await stale();
      else toast.error(`Could not ${verb}: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const signoff = (action: 'prepare' | 'withdraw_prepared' | 'withdraw_verified' | 'send_back', note: string | undefined, verb: string, done: (n: SignoffState) => string, to?: 'preparer' | 'verifier') =>
    run(action, verb, () => signoffAnnualReturn(r.id, fy, action, { expectedRev: s.rev, actorId: me.id, note, returnTo: to }), done);

  const allot = async (slot: Slot, pick: StaffPick | null, prevOverride?: SignoffState) => {
    setPicking(null);
    const before = prevOverride ?? s;
    const prev = before[slot];
    ctx.patchRow(r.id, { ...before, [slot]: pick ? { id: pick.userId, name: pick.name } : null });
    setBusy(`allot-${slot}`);
    try {
      const [res] = await allotAnnualReturn(fy, slot, [{ clientId: r.id, userId: pick?.userId ?? null, expectUserId: prev?.id ?? null }], me.id);
      ctx.patchRow(r.id, res?.row ? signoffStateOf(res.row) : before);
      if (!res?.applied) {
        if (res?.reason !== 'unchanged') toast.error(`Not allotted: ${res?.reason ? SKIP_TEXT[res.reason] : 'refused'}.`);
        return;
      }
      toast.success(pick ? `${displayName(pick.name)} will ${SLOT_VERB[slot]} ${r.name}` : `No ${SLOT_WORD[slot]} allotted for ${r.name} now`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void allotAnnualReturn(fy, slot, [{ clientId: r.id, userId: prev?.id ?? null, expectUserId: pick?.userId ?? null }], me.id)
              .then(([u]) => { if (u?.row) ctx.patchRow(r.id, signoffStateOf(u.row)); if (!u?.applied) toast.error(`Could not undo: ${u?.reason ? SKIP_TEXT[u.reason] : 'refused'}.`); })
              .catch((e) => toast.error(`Could not undo: ${errText(e)}`));
          },
        },
      });
    } catch (e) {
      ctx.patchRow(r.id, before);
      toast.error(`Could not allot: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  /** A working that is no longer filed: take everyone off the slots that are not signed yet. */
  const clearAllotment = async () => {
    setBusy('clear');
    let cur: SignoffState = s;
    const refused: string[] = [];
    try {
      const slots = (['reviewer', 'verifier', 'preparer'] as const).filter((slot) =>
        cur[slot] && !(slot === 'preparer' && cur.prepared) && !(slot === 'verifier' && cur.verified));
      for (const slot of slots) {
        const [res] = await allotAnnualReturn(fy, slot, [{ clientId: r.id, userId: null, expectUserId: cur[slot]?.id ?? null }], me.id);
        if (res?.row) { cur = signoffStateOf(res.row); ctx.patchRow(r.id, cur); }
        if (!res?.applied && res?.reason !== 'unchanged') refused.push(`${SLOT_WORD[slot]}: ${res?.reason ? SKIP_TEXT[res.reason] : 'refused'}`);
      }
      if (refused.length) {
        toast.error(`Not cleared — ${refused.join('; ')}.`);
      } else {
        toast.success(`Allotment cleared for ${r.name}`);
        // Nothing left to show: the cell turns to "—", so close its popover (and hand the keys back to the grid).
        if (!cur.preparer && !cur.verifier && !cur.reviewer) {
          const back = ctx.restoreFocusRef.current;
          ctx.restoreFocusRef.current = null;
          ctx.setOpenFor(null);
          back?.();
        }
      }
    } catch (e) {
      toast.error(`Could not clear the allotment: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const openIn = (signoffParam?: 'verify' | 'lock') => {
    ctx.setOpenFor(null);
    ctx.onOpen(r.id, signoffParam ? { step: 'review', reviewtab: 'signoff', signoff: signoffParam } : undefined);
  };

  // ---- Allotment chip (a picker for managers while the slot can still change)
  const renderChip = (slot: Slot) => {
    const signed = s.stage === 'locked' || (slot === 'preparer' && !!s.prepared) || (slot === 'verifier' && !!s.verified);
    const chip = <AllotChip slot={slot} person={s[slot]} meId={me.id} />;
    if (!me.isManager || signed) return chip;
    return (
      <button
        type="button"
        onClick={() => setPicking(slot)}
        disabled={!!busy}
        className="inline-flex min-w-0 max-w-[150px] items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        aria-label={`${s[slot] ? `Change the ${SLOT_WORD[slot]} (${displayName(s[slot]?.name)})` : `Allot a ${SLOT_WORD[slot]}`}`}
      >
        {busy === `allot-${slot}` ? <Loader2 className="h-3 w-3 animate-spin" /> : chip}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    );
  };

  // ---- "6 figure changes since" under the latest signed step
  const latestSigned: Step | null = s.verified ? 'verify' : s.prepared ? 'prepare' : null;
  const changed = changesSinceSignoff(s);
  const renderExtra = (step: Step) => {
    if (step !== latestSigned || !changed || s.stage === 'locked') return null;
    const since = step === 'verify' ? s.verified?.at : s.prepared?.at;
    return (
      <div className="mt-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-1 text-[11px] text-foreground">
          <AlertTriangle className="h-3 w-3 text-warning" aria-hidden />
          {changed} figure change{changed === 1 ? '' : 's'} since {step === 'verify' ? 'verified' : 'prepared'}
          {s.changes?.lastBy && <span className="text-muted-foreground">· last by {displayName(s.changes.lastBy)}</span>}
          <button type="button" onClick={() => setShowChanges((v) => !v)} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {showChanges ? 'Hide' : 'See'}
          </button>
        </p>
        {showChanges && since && <ChangesList clientId={r.id} financialYear={fy} since={since} onOpenHistory={() => { ctx.setOpenFor(null); ctx.onOpen(r.id, { step: 'review', reviewtab: 'history' }); }} />}
      </div>
    );
  };

  // ---- What the viewer may do, on the step it concerns
  const cur = currentStep(s);
  const why = (reason?: string) => (reason ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{reason}</p> : null);
  const row = (children: React.ReactNode) => <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{children}</div>;

  const renderActions = (step: Step): React.ReactNode => {
    if (checking) return null;
    if (step === 'prepare') {
      if (cur === 'prepare') {
        const c = can(s, me, 'prepare');
        if (!c.ok) return why(c.reason);
        if (form === 'prepare') {
          return (
            <NoteForm id={`prep-${r.id}`} label="Note for the verifier (optional)" confirm="Mark prepared" busy={busy === 'prepare'}
              hint="Marks what is saved. Anything saved after this shows as a change since prepared."
              onCancel={() => setForm(null)}
              onConfirm={(note) => void signoff('prepare', note, 'mark it prepared', (n) => `Prepared. Next: ${(nextSentence(n) ?? '').replace(/^With /, '')}.`)} />
          );
        }
        return row(
          <Button size="sm" className="h-7 text-xs" disabled={!!busy} onClick={() => setForm('prepare')}>
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Mark prepared
          </Button>,
        );
      }
      if (s.prepared && !s.verified && s.stage !== 'locked') {
        const w = can(s, me, 'withdraw_prepared');
        const again = changed > 0 && can(s, me, 'prepare').ok;
        if (!w.ok && !again) return null;
        if (form === 'prepare') {
          return (
            <NoteForm id={`prep-${r.id}`} label="Note for the verifier (optional)" confirm="Mark prepared again" busy={busy === 'prepare'}
              onCancel={() => setForm(null)}
              onConfirm={(note) => void signoff('prepare', note, 'mark it prepared', () => 'Marked prepared again.')} />
          );
        }
        return row(
          <>
            {again && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => setForm('prepare')}>Mark prepared again</Button>}
            {w.ok && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy}
                onClick={() => void signoff('withdraw_prepared', undefined, 'withdraw it', () => 'Withdrawn — no longer marked prepared.')}>
                {busy === 'withdraw_prepared' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />} Withdraw
              </Button>
            )}
          </>,
        );
      }
      return null;
    }

    if (step === 'verify') {
      if (cur === 'verify') {
        const c = can(s, me, 'verify');
        const back = can(s, me, 'send_back');
        // The superadmin may lock without a verification, with a recorded reason (in the working).
        const skip = can(s, me, 'lock');
        const override = skip.ok && !!skip.override;
        if (form === 'send_back') {
          return (
            <NoteForm id={`back-${r.id}`} label={`What needs fixing? ${displayName(s.preparer?.name ?? s.prepared?.name ?? 'The preparer')} sees this.`}
              min={5} confirm={`Send back to ${displayName(s.preparer?.name ?? s.prepared?.name ?? 'the preparer')}`} busy={busy === 'send_back'}
              onCancel={() => setForm(null)}
              onConfirm={(note) => void signoff('send_back', note, 'send it back', () => `Sent back to ${displayName(s.preparer?.name ?? s.prepared?.name ?? 'the preparer')}.`, 'preparer')} />
          );
        }
        if (!c.ok && !back.ok && !override) return why(c.reason);
        return (
          <>
            {row(
              <>
                {c.ok && (
                  <Button size="sm" className="h-7 text-xs" disabled={!!busy} onClick={() => openIn('verify')}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verify in working <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                )}
                {back.ok && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy} onClick={() => setForm('send_back')}>
                    <CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Send back…
                  </Button>
                )}
                {override && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy} onClick={() => openIn('lock')}>
                    Lock without verification <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </>,
            )}
            {!c.ok && why(c.reason)}
          </>
        );
      }
      if (s.verified && s.stage !== 'locked' && can(s, me, 'withdraw_verified').ok) {
        return row(
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy}
            onClick={() => void signoff('withdraw_verified', undefined, 'withdraw the verification', () => 'Verification withdrawn — back to Prepared.')}>
            {busy === 'withdraw_verified' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />} Withdraw verification
          </Button>,
        );
      }
      return null;
    }

    // Review & lock
    if (s.stage === 'locked') {
      if (!can(s, me, 'unlock').ok) return null;
      if (form === 'unlock') {
        return (
          <NoteForm id={`unlock-${r.id}`} label="Why is it being unlocked?" min={5} confirm="Unlock" destructive busy={busy === 'unlock'}
            hint={`It goes back to ${s.verified ? `Verified (${displayName(s.verified.name)})` : 'Prepared'}; changes made after this must be checked at the next lock.`}
            onCancel={() => setForm(null)}
            onConfirm={(note) => void run('unlock', 'unlock it', () => setPeriodStatus(r.id, fy, { to: 'in_progress', expectedRev: s.rev, actorId: me.id, note }),
              (n) => `Unlocked. It is back at ${STAGE_META[n.stage].label}.`)} />
        );
      }
      return row(
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => setForm('unlock')}>
          <LockOpen className="mr-1 h-3.5 w-3.5" /> Unlock…
        </Button>,
      );
    }
    if (cur !== 'review') return null;
    const c = can(s, me, 'lock');
    const back = can(s, me, 'send_back');
    if (form === 'send_back') {
      const who = (slot: 'preparer' | 'verifier') => displayName((slot === 'preparer' ? s.preparer?.name ?? s.prepared?.name : s.verifier?.name ?? s.verified?.name) ?? `the ${slot}`);
      return (
        <NoteForm id={`back-${r.id}`} label={`What needs fixing? ${who(returnTo)} sees this.`} min={5} confirm={`Send back to ${who(returnTo)}`} busy={busy === 'send_back'}
          onCancel={() => setForm(null)}
          onConfirm={(note) => void signoff('send_back', note, 'send it back', () => `Sent back to ${who(returnTo)}.`, returnTo)}>
          <div role="radiogroup" aria-label="Send back to" className="flex flex-wrap gap-1">
            {(['verifier', 'preparer'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={returnTo === t} onClick={() => setReturnTo(t)}
                className={cn('rounded-full border px-2 py-0.5 text-[11px]', returnTo === t ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
                To the {t} ({who(t)})
              </button>
            ))}
          </div>
        </NoteForm>
      );
    }
    if (!c.ok && !back.ok) return why(c.reason);
    return (
      <>
        {row(
          <>
            {c.ok && (
              <Button size="sm" className="h-7 text-xs" disabled={!!busy} onClick={() => openIn('lock')}>
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> {c.override ? 'Lock with override in working' : 'Review & lock in working'} <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
            {back.ok && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy} onClick={() => { setReturnTo('verifier'); setForm('send_back'); }}>
                <CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Send back…
              </Button>
            )}
          </>,
        )}
        {c.ok && c.override && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.override} As the superadmin you can still lock it, with a reason that is recorded.</p>}
        {!c.ok && why(c.reason)}
      </>
    );
  };

  const meta = STAGE_META[s.stage];

  if (picking) {
    return (
      <div data-signoff-substate="" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setPicking(null); } }}>
        <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPicking(null)} aria-label="Back"><ArrowLeft className="h-3.5 w-3.5" /></Button>
          <span className="min-w-0 truncate text-xs font-medium">Allot {SLOT_WORD[picking]} · {r.name}</span>
        </div>
        <StaffPicker
          slot={picking}
          staff={ctx.staff}
          loading={ctx.staffLoading}
          error={ctx.staffError}
          onRetry={ctx.reloadStaff}
          loads={ctx.loads}
          meId={me.id}
          current={s[picking]}
          blockOf={(st) => allotBlock(s, picking, { id: st.userId, role: st.role })}
          onPick={(who) => void allot(picking, who)}
          busy={!!busy}
        />
      </div>
    );
  }

  return (
    <div onKeyDown={(e) => { if (e.key === 'Escape' && form) { e.preventDefault(); setForm(null); } }}>
      <div className="border-b px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[13px] font-semibold" title={r.name}>{r.name}</span>
          <Badge variant={meta.tone} className="shrink-0 text-[10px] font-normal">{meta.label}</Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{r.gstin || '—'}</span>
          <span aria-hidden>·</span>
          <span>FY {fy} · {r.returns}</span>
          {checking && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</span>}
        </div>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {notice && <Note tone="info">{notice}</Note>}
        {!r.inScope ? (
          <>
            <Note tone="info">GSTR-9 is not being filed for FY {fy} ({r.returns.toLowerCase()}). The allotment is kept in case that changes.</Note>
            <SignoffRail state={s} meId={me.id} renderChip={renderChip} />
            {me.isManager && (s.preparer || s.verifier || s.reviewer) && s.stage !== 'locked' && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy || checking}
                onClick={() => void clearAllotment()}>
                Clear allotment
              </Button>
            )}
          </>
        ) : (
          <SignoffRail state={s} meId={me.id} renderChip={renderChip} renderActions={renderActions} renderExtra={renderExtra} />
        )}
      </div>
      <div className="flex h-9 items-center justify-between border-t bg-muted/40 px-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openIn()}>
          Open working <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { ctx.setOpenFor(null); ctx.onOpen(r.id, { step: 'review', reviewtab: 'history' }); }}>
          <History className="mr-1 h-3.5 w-3.5" /> History
        </Button>
      </div>
      {cur && !checking && <span className="sr-only" aria-live="polite">{nextSentence(s)}</span>}
    </div>
  );
};

export default SignoffPanel;
