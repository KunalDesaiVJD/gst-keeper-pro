import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ClipboardCheck, CornerUpLeft, Loader2, Lock, LockOpen, ShieldCheck, Undo2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { useStaffList } from '@/hooks/useStaffList';
import { REVIEW_CHECKLIST, ROLE_LABEL } from '@/lib/gstr9/signoff';
import {
  allotBlock, can, changesSinceSignoff, clientStage, currentStep, displayName, nextSentence, SLOT_WORD, STAGE_META,
  type SignoffState, type Slot, type Step,
} from '@/lib/gstr9/signoffFlow';
import { allotAnnualReturn, ChangedSinceError, loadUnackedChanges } from '@/lib/gstr9/store';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { ChangesList } from '../signoff/ChangesList';
import { AllotChip, SignoffRail } from '../signoff/SignoffRail';
import { StageTrack } from '../signoff/StageTrack';
import { StaffPicker } from '../signoff/StaffPicker';
import { diffTabParams, fmtWhen, REVIEW_TAB_PARAM, rupees, rupeesShort, stepMeta, sumTax, useGoToStep } from './steps';

const SHOW_BLOCKERS = 6;
/** ?signoff=verify|lock — the register's "Verify in working" / "Review & lock in working" open the dialog. */
const SIGNOFF_PARAM = 'signoff';

type DialogKind = null | 'prepare' | 'verify' | 'lock' | 'send_back' | 'unlock';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Sign-off & lock: the working is allotted, then prepared, verified by a
 * second person, and reviewed & locked by a GST manager or the superadmin who
 * neither prepared nor verified it. The database enforces who may sign and
 * records each stamp, the checklist and the payables, and snapshots every
 * sheet at the lock. A client login sees who signed and when — no notes.
 */
export const LockPanel: React.FC = () => {
  const {
    workings: w, client, financialYear, isStaff, signoffState: s, me, signoff, setStatus, refreshSignoff, period,
  } = useWorkspace();
  const go = useGoToStep();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const blockers = w.diffs.filter((d) => d.open);
  const cur = currentStep(s);
  const changed = changesSinceSignoff(s);

  const showDifferences = () => {
    const next = new URLSearchParams(params);
    next.set(REVIEW_TAB_PARAM, 'differences');
    setParams(next, { replace: true });
  };

  // Arriving from the register's "Verify in working" / "Review & lock in working": open that dialog (or say why not).
  const wanted = params.get(SIGNOFF_PARAM);
  useEffect(() => {
    if (!wanted) return;
    const next = new URLSearchParams(params);
    next.delete(SIGNOFF_PARAM);
    setParams(next, { replace: true });
    if (!isStaff) return;
    const action = wanted === 'verify' ? 'verify' : wanted === 'lock' ? 'lock' : null;
    if (!action) return;
    const c = can(s, me, action);
    if (!c.ok) { toast.info(c.reason ?? 'Not available.'); return; }
    if (blockers.length) { toast.info(`${blockers.length} difference${blockers.length === 1 ? ' needs' : 's need'} a reason first — see below.`); return; }
    setDialog(action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const act = async (key: string, run: () => Promise<void>, done: string, verb: string): Promise<boolean> => {
    setBusy(key);
    try {
      await run();
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(`Could not ${verb}: ${errText(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const nextAfter = (fn: (n: SignoffState) => string) => fn; // readability in the calls below

  // ---- Allotment (GST manager / superadmin), from the step's chip
  const { staff, loading: staffLoading, error: staffError, reload: reloadStaff } = useStaffList();
  const [picking, setPicking] = useState<Slot | null>(null);
  const allot = async (slot: Slot, userId: string | null, name: string | null) => {
    setPicking(null);
    setBusy(`allot-${slot}`);
    try {
      const [res] = await allotAnnualReturn(financialYear, slot, [{ clientId: client.id, userId, expectUserId: s[slot]?.id ?? null }], me.id);
      await refreshSignoff();
      if (!res?.applied && res?.reason !== 'unchanged') toast.error(`Not allotted: ${res?.reason?.replace('_', ' ') ?? 'refused'}.`);
      else if (res?.applied) toast.success(userId ? `${displayName(name)} will ${slot === 'preparer' ? 'prepare' : slot === 'verifier' ? 'verify' : 'review & lock'} it.` : `No ${SLOT_WORD[slot]} allotted now.`);
    } catch (e) {
      toast.error(`Could not allot: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const renderChip = (slot: Slot) => {
    const signed = s.stage === 'locked' || (slot === 'preparer' && !!s.prepared) || (slot === 'verifier' && !!s.verified);
    const chip = <AllotChip slot={slot} person={s[slot]} meId={me.id} />;
    if (!me.isManager || signed) return chip;
    return (
      <Popover open={picking === slot} onOpenChange={(o) => setPicking(o ? slot : null)}>
        <PopoverTrigger asChild>
          <button type="button" disabled={!!busy}
            className="inline-flex min-w-0 max-w-[180px] items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            aria-label={s[slot] ? `Change the ${SLOT_WORD[slot]} (${displayName(s[slot]?.name)})` : `Allot a ${SLOT_WORD[slot]}`}>
            {busy === `allot-${slot}` ? <Loader2 className="h-3 w-3 animate-spin" /> : chip}
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <StaffPicker slot={slot} staff={staff} loading={staffLoading} error={staffError} onRetry={reloadStaff} loads={new Map()}
            meId={me.id} current={s[slot]} blockOf={(st) => allotBlock(s, slot, { id: st.userId, role: st.role })}
            onPick={(who) => void allot(slot, who?.userId ?? null, who?.name ?? null)} busy={!!busy} />
        </PopoverContent>
      </Popover>
    );
  };

  // ---- "6 figure changes since" under the latest signed step
  const latestSigned: Step | null = s.verified ? 'verify' : s.prepared ? 'prepare' : null;
  const renderExtra = (step: Step) => {
    if (!isStaff || step !== latestSigned || !changed || s.stage === 'locked') return null;
    const since = step === 'verify' ? s.verified?.at : s.prepared?.at;
    return (
      <div className="mt-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-1 text-[11px]">
          <AlertTriangle className="h-3 w-3 text-warning" aria-hidden />
          {changed} figure change{changed === 1 ? '' : 's'} since {step === 'verify' ? 'verified' : 'prepared'}
          {s.changes?.lastBy && <span className="text-muted-foreground">· last by {displayName(s.changes.lastBy)}</span>}
          <button type="button" onClick={() => setShowChanges((v) => !v)} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {showChanges ? 'Hide' : 'See'}
          </button>
        </p>
        {showChanges && since && <ChangesList clientId={client.id} financialYear={financialYear} since={since}
          onOpenHistory={() => { const n = new URLSearchParams(params); n.set(REVIEW_TAB_PARAM, 'history'); setParams(n, { replace: true }); }} />}
      </div>
    );
  };

  // ---- What the viewer may do, on the step it concerns
  const why = (reason?: string) => (reason ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{reason}</p> : null);
  const row = (children: React.ReactNode) => <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{children}</div>;
  const spin = (k: string, icon: React.ReactNode) => (busy === k ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : icon);
  const checklist = (period?.review_checklist ?? {}) as Record<string, boolean>;

  const renderActions = (step: Step): React.ReactNode => {
    if (!isStaff) return null;
    if (step === 'prepare') {
      if (cur === 'prepare') {
        const c = can(s, me, 'prepare');
        return c.ok
          ? row(<Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => setDialog('prepare')}><ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Mark prepared</Button>)
          : why(c.reason);
      }
      if (s.prepared && !s.verified && s.stage !== 'locked') {
        const wd = can(s, me, 'withdraw_prepared');
        const again = changed > 0 && can(s, me, 'prepare').ok;
        if (!wd.ok && !again) return null;
        return row(
          <>
            {again && <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => setDialog('prepare')}>Mark prepared again</Button>}
            {wd.ok && (
              <Button size="sm" variant="ghost" className="h-7" disabled={!!busy}
                onClick={() => void act('withdraw_prepared', () => signoff('withdraw_prepared'), 'Withdrawn — no longer marked prepared.', 'withdraw it')}>
                {spin('withdraw_prepared', <Undo2 className="mr-1 h-3.5 w-3.5" />)} Withdraw
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
        if (!c.ok && !back.ok) return why(c.reason);
        return (
          <>
            {row(
              <>
                {c.ok && (
                  <Button size="sm" className="h-7" disabled={!!busy || blockers.length > 0} onClick={() => setDialog('verify')}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verify…
                  </Button>
                )}
                {back.ok && <Button size="sm" variant="ghost" className="h-7" disabled={!!busy} onClick={() => setDialog('send_back')}><CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Send back…</Button>}
              </>,
            )}
            {!c.ok && why(c.reason)}
          </>
        );
      }
      if (s.verified && s.stage !== 'locked' && can(s, me, 'withdraw_verified').ok) {
        return row(
          <Button size="sm" variant="ghost" className="h-7" disabled={!!busy}
            onClick={() => void act('withdraw_verified', () => signoff('withdraw_verified'), 'Verification withdrawn — back to Prepared.', 'withdraw the verification')}>
            {spin('withdraw_verified', <Undo2 className="mr-1 h-3.5 w-3.5" />)} Withdraw verification
          </Button>,
        );
      }
      return null;
    }
    // Review & lock
    if (s.stage === 'locked') {
      return (
        <>
          {period?.review_checklist && (
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {REVIEW_CHECKLIST.map((c) => (
                <li key={c.key} className="flex items-start gap-1.5">
                  {checklist[c.key]
                    ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success-strong" aria-label="Checked" />
                    : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive-strong" aria-label="Not checked" />}
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
          )}
          {can(s, me, 'unlock').ok
            ? row(<Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => setDialog('unlock')}><LockOpen className="mr-1 h-3.5 w-3.5" /> Unlock FY {financialYear}…</Button>)
            : why('Only the superadmin, a GST manager or a user with the unlock-sheets permission can unlock it.')}
        </>
      );
    }
    if (cur !== 'review') return null;
    const c = can(s, me, 'lock');
    const back = can(s, me, 'send_back');
    if (!c.ok && !back.ok) return why(c.reason);
    return (
      <>
        {row(
          <>
            {c.ok && (
              <Button size="sm" className="h-7" disabled={!!busy || blockers.length > 0} onClick={() => setDialog('lock')}>
                <Lock className="mr-1 h-3.5 w-3.5" /> {c.override ? 'Lock with override…' : `Review & lock FY ${financialYear}…`}
              </Button>
            )}
            {back.ok && <Button size="sm" variant="ghost" className="h-7" disabled={!!busy} onClick={() => setDialog('send_back')}><CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Send back…</Button>}
          </>,
        )}
        {c.ok && c.override && why(`${c.override} As the superadmin you can still lock it, with a reason that is recorded.`)}
        {!c.ok && why(c.reason)}
      </>
    );
  };

  const stage = isStaff ? s.stage : clientStage(s);
  const meta = STAGE_META[stage];
  const next = isStaff ? nextSentence(s) : null;

  return (
    <SectionCard
      title="Sign-off & lock"
      description="Allotted, prepared, verified, then reviewed and locked — by three different people. Once locked, the database refuses every edit until it is unlocked."
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StageTrack state={s} size="md" />
        <Badge variant={meta.tone} className="gap-1 text-[10px]">
          {stage === 'locked' && <Lock className="h-3 w-3" />}
          {meta.label}
        </Badge>
        {next && <span className="text-xs text-muted-foreground">Next: {next.replace(/^With /, '')}</span>}
      </div>

      <div className="rounded-md border px-3 py-2.5">
        <SignoffRail state={s} meId={me.id} forClient={!isStaff} renderChip={renderChip} renderActions={renderActions} renderExtra={renderExtra} />
      </div>

      {isStaff && s.stage !== 'locked' && (cur === 'verify' || cur === 'review') && (
        blockers.length > 0 ? (
          <Note tone="warn">
            <span className="font-medium">
              {cur === 'verify' ? 'Verification' : 'The lock'} is blocked by {blockers.length === 1 ? '1 difference' : `${blockers.length} differences`} without a reason:
            </span>
            <ul className="mt-1 space-y-0.5">
              {blockers.slice(0, SHOW_BLOCKERS).map((d) => (
                <li key={d.key}>
                  <button type="button" onClick={() => go(d.step, diffTabParams(d))}
                    className="inline-flex items-center gap-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="text-muted-foreground">{stepMeta(d.step).label}:</span> {d.label}
                    <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {blockers.length > SHOW_BLOCKERS && (
              <p className="mt-1 text-muted-foreground">
                …and {blockers.length - SHOW_BLOCKERS} more —{' '}
                <button type="button" onClick={showDifferences} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  see the Differences tab
                </button>.
              </p>
            )}
          </Note>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success-strong" /> Every difference is matched, within {rupeesShort(w.tolerance)} or justified.
          </p>
        )
      )}
      {!isStaff && <p className="text-xs text-muted-foreground">Read-only.</p>}

      {isStaff && (
        <>
          <PrepareDialog open={dialog === 'prepare'} onOpenChange={(o) => setDialog(o ? 'prepare' : null)} busy={busy === 'prepare'}
            again={!!s.prepared} verifier={s.verifier ? displayName(s.verifier.name) : null}
            onConfirm={async (note) => {
              if (await act('prepare', () => signoff('prepare', { note }), 'Marked prepared.', 'mark it prepared')) setDialog(null);
            }} />
          <SignDialog kind="verify" open={dialog === 'verify'} onOpenChange={(o) => setDialog(o ? 'verify' : null)} busy={busy === 'verify'} />
          <SignDialog kind="lock" open={dialog === 'lock'} onOpenChange={(o) => setDialog(o ? 'lock' : null)} busy={busy === 'lock'} />
          <SendBackDialog open={dialog === 'send_back'} onOpenChange={(o) => setDialog(o ? 'send_back' : null)} busy={busy === 'send_back'}
            state={s}
            onConfirm={async (note, to) => {
              const who = displayName((to === 'preparer' ? s.preparer?.name ?? s.prepared?.name : s.verifier?.name ?? s.verified?.name) ?? `the ${to}`);
              if (await act('send_back', () => signoff('send_back', { note, returnTo: to }), `Sent back to ${who}.`, 'send it back')) setDialog(null);
            }} />
          <UnlockDialog open={dialog === 'unlock'} onOpenChange={(o) => setDialog(o ? 'unlock' : null)} busy={busy === 'unlock'} financialYear={financialYear}
            backTo={s.verified ? `Verified (${displayName(s.verified.name)}, ${fmtWhen(s.verified.at)})` : 'Prepared'}
            onConfirm={async (note) => {
              if (await act('unlock', () => setStatus('in_progress', { note }), nextAfter(() => `FY ${financialYear} is unlocked. It is back at ${s.verified ? 'Verified' : 'Prepared'}.`)(s), 'unlock it')) setDialog(null);
            }} />
        </>
      )}
    </SectionCard>
  );
};

const PrepareDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; again: boolean; verifier: string | null; onConfirm: (note: string) => void }> = ({
  open, onOpenChange, busy, again, verifier, onConfirm,
}) => {
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setNote(''); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{again ? 'Mark prepared again' : 'Mark prepared'}</DialogTitle>
          <DialogDescription>Everything pending is saved first. {verifier ?? 'A GST manager'} then verifies it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="prepare-note" className="text-xs">Note for the verifier (optional)</Label>
          <Textarea id="prepare-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. 3B for March pulled again after the amendment; Table 13 agreed with the client." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(note.trim())} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1 h-3.5 w-3.5" />} Mark prepared
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Verify, or review & lock. Both show the figure changes made by others since
 * the previous stamp, which have to be ticked as checked — the database
 * refuses if more changed meanwhile. The lock also takes the review checklist
 * and, for a superadmin override, the reason.
 */
const SignDialog: React.FC<{ kind: 'verify' | 'lock'; open: boolean; onOpenChange: (o: boolean) => void; busy: boolean }> = ({ kind, open, onOpenChange, busy: _busy }) => {
  const { client, financialYear, signoffState: s, me, signoff, setStatus, workings: w, userName } = useWorkspace();
  const manual = useMemo(() => REVIEW_CHECKLIST.filter((c) => !c.auto), []);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState(false);
  const [checkedChanges, setCheckedChanges] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [unacked, setUnacked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const c = can(s, me, kind === 'verify' ? 'verify' : 'lock');
  const override = kind === 'lock' ? c.override : undefined;
  const since = kind === 'verify' ? s.prepared?.at : s.verified?.at ?? s.prepared?.at;

  const loadUnacked = async () => {
    setUnacked(null);
    try { setUnacked(await loadUnackedChanges(client.id, financialYear, kind, me.id)); } catch { setUnacked(0); }
  };
  useEffect(() => {
    if (!open) return;
    setTicks({}); setSeen(false); setCheckedChanges(false); setNote(''); setReason('');
    void loadUnacked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allTicked = kind === 'verify' ? seen : manual.every((m) => ticks[m.key]);
  const ready = allTicked && unacked !== null && (unacked === 0 || checkedChanges) && (!override || reason.trim().length >= 5);
  const payable = sumTax(w.payables.totals.payable);
  const balance = sumTax(w.payables.totals.balance);
  const roleLabel = ROLE_LABEL[me.role] ?? me.role;

  const confirm = async () => {
    setBusy(true);
    try {
      if (kind === 'verify') await signoff('verify', { note: note.trim(), changesAck: unacked ?? 0 });
      else await setStatus('locked', { note: note.trim(), checklist: Object.fromEntries(REVIEW_CHECKLIST.map((x) => [x.key, x.auto ? true : !!ticks[x.key]])), changesAck: unacked ?? 0, overrideReason: override ? reason.trim() : undefined });
      toast.success(kind === 'verify' ? 'Verified.' : `FY ${financialYear} is reviewed and locked.`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ChangedSinceError) { setCheckedChanges(false); void loadUnacked(); }
      toast.error(`Could not ${kind === 'verify' ? 'verify it' : 'lock it'}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className={kind === 'verify' ? 'max-w-lg' : 'max-w-xl'}>
        <DialogHeader>
          <DialogTitle>{kind === 'verify' ? `Verify FY ${financialYear}` : `Review & lock FY ${financialYear}`}</DialogTitle>
          <DialogDescription>
            Signed as <span className="font-medium text-foreground">{displayName(userName)}</span> ({roleLabel}). Everything pending is saved first; the working must have no open difference.
            {kind === 'lock' && ' The database then snapshots every sheet and refuses any edit until the year is unlocked.'}
          </DialogDescription>
        </DialogHeader>

        {kind === 'verify' ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={seen} onCheckedChange={(v) => setSeen(v === true)} className="mt-0.5" />
            <span>I have gone through the working as prepared by {displayName(s.prepared?.name)}{s.prepared?.at ? ` on ${fmtWhen(s.prepared.at)}` : ''}.</span>
          </label>
        ) : (
          <ul className="space-y-2 text-sm">
            {REVIEW_CHECKLIST.map((x) => (
              <li key={x.key} className="flex items-start gap-2">
                {x.auto ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" aria-label="Checked by the app" />
                  : <Checkbox id={`chk-${x.key}`} checked={!!ticks[x.key]} onCheckedChange={(v) => setTicks((t) => ({ ...t, [x.key]: v === true }))} className="mt-0.5" />}
                <label htmlFor={x.auto ? undefined : `chk-${x.key}`} className={x.auto ? 'text-muted-foreground' : 'cursor-pointer'}>
                  {x.label}{x.auto ? ' — checked by the app' : ''}
                </label>
              </li>
            ))}
          </ul>
        )}

        {unacked === null ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for changes since {kind === 'verify' ? 'it was prepared' : 'the verification'}…</p>
        ) : unacked > 0 && since ? (
          <Note tone="warn">
            <span className="font-medium">{unacked} figure change{unacked === 1 ? ' was' : 's were'} made by others since {kind === 'verify' ? 'it was prepared' : s.verified ? 'the verification' : 'it was prepared'}. Latest:</span>
            <div className="mt-1"><ChangesList clientId={client.id} financialYear={financialYear} since={since} /></div>
            <label className="mt-2 flex cursor-pointer items-start gap-2">
              <Checkbox checked={checkedChanges} onCheckedChange={(v) => setCheckedChanges(v === true)} className="mt-0.5" />
              <span>I have checked {unacked === 1 ? 'this change' : `these ${unacked} changes`}.</span>
            </label>
          </Note>
        ) : null}

        {kind === 'lock' && payable > 0.5 && (
          <Note tone="info">
            {rupees(payable)} is payable ({rupees(balance)} not yet set off). It is disclosed output-wise and input-wise on the Payables &amp; set-off step and can be set off there after the lock — only against a DRC-03 in the system or a GSTR-3B effect with its copy.
          </Note>
        )}

        {override && (
          <div className="space-y-1.5 rounded-md border border-warning/50 bg-warning/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> {override} Locking now is a superadmin override; the reason is printed on the sign-off page.</p>
            <Label htmlFor="override-reason" className="text-xs">Override reason (required)</Label>
            <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-note`} className="text-xs">{kind === 'verify' ? 'Verification note (optional — printed on the sign-off page)' : 'Review note (optional — printed on the sign-off page)'}</Label>
          <Textarea id={`${kind}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void confirm()} disabled={busy || !ready || !c.ok}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : kind === 'verify' ? <ShieldCheck className="mr-1 h-3.5 w-3.5" /> : <Lock className="mr-1 h-3.5 w-3.5" />}
            {kind === 'verify' ? 'Verify' : override ? 'Lock with override' : 'Review & lock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SendBackDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; state: SignoffState; onConfirm: (note: string, to: 'preparer' | 'verifier') => void }> = ({
  open, onOpenChange, busy, state: s, onConfirm,
}) => {
  const [note, setNote] = useState('');
  const atVerified = !!s.verified;
  const [to, setTo] = useState<'preparer' | 'verifier'>('verifier');
  useEffect(() => { if (open) { setNote(''); setTo(atVerified ? 'verifier' : 'preparer'); } }, [open, atVerified]);
  const who = (t: 'preparer' | 'verifier') => displayName((t === 'preparer' ? s.preparer?.name ?? s.prepared?.name : s.verifier?.name ?? s.verified?.name) ?? `the ${t}`);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send back</DialogTitle>
          <DialogDescription>
            {atVerified ? 'Back to the verifier undoes the verification; back to the preparer undoes both stamps.' : 'Back to the preparer undoes “Prepared”.'} The note is shown to them and kept in the revision history.
          </DialogDescription>
        </DialogHeader>
        {atVerified && (
          <div role="radiogroup" aria-label="Send back to" className="flex flex-wrap gap-1.5">
            {(['verifier', 'preparer'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={to === t} onClick={() => setTo(t)}
                className={to === t ? 'rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary' : 'rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'}>
                To the {t} ({who(t)})
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sendback-note" className="text-xs">What needs fixing? (required)</Label>
          <Textarea id="sendback-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(note.trim(), atVerified ? to : 'preparer')} disabled={busy || note.trim().length < 5}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CornerUpLeft className="mr-1 h-3.5 w-3.5" />} Send back to {who(atVerified ? to : 'preparer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const UnlockDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; financialYear: string; backTo: string; onConfirm: (note: string) => void }> = ({
  open, onOpenChange, busy, financialYear, backTo, onConfirm,
}) => {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unlock FY {financialYear}?</DialogTitle>
          <DialogDescription>
            The working becomes editable again. It returns to {backTo}; changes made after this must be checked at the next lock. The revision history keeps this sign-off.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="unlock-note" className="text-xs">Why is it being unlocked? (required)</Label>
          <Textarea id="unlock-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. DRC-03 for the late ITC reversal found after the lock" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => onConfirm(note.trim())} disabled={busy || note.trim().length < 5}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <LockOpen className="mr-1 h-3.5 w-3.5" />} Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LockPanel;
