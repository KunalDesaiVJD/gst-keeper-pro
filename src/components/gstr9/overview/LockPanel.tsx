import React, { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ClipboardCheck, Loader2, Lock, LockOpen, PlayCircle, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REVIEW_CHECKLIST, ROLE_LABEL } from '@/lib/gstr9/signoff';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, periodStatus, rupees, rupeesShort, stepMeta, sumTax, useGoToStep } from './steps';

const SHOW_BLOCKERS = 6;

/**
 * Sign-off and lock. The preparer marks the working ready for review; a GST
 * manager or superadmin verifies it against the checklist and locks the year.
 * The database refuses a lock by any other role, records the reviewer, the
 * checklist, the note and the payables, and snapshots every sheet.
 */
export const LockPanel: React.FC = () => {
  const { workings: w, period, readOnly, locked, canUnlock, canVerify, role, setStatus, markReady, financialYear, userName } = useWorkspace();
  const confirm = useConfirm();
  const go = useGoToStep();
  const [busy, setBusy] = useState<null | 'lock' | 'unlock' | 'progress' | 'ready'>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const status = periodStatus(period);
  const isClient = readOnly && !locked;
  const blockers = w.diffs.filter((d) => d.open);

  const act = async (kind: NonNullable<typeof busy>, run: () => Promise<void>, done: string): Promise<boolean> => {
    setBusy(kind);
    try {
      await run();
      toast.success(done);
      return true;
    } catch (e) {
      const what = kind === 'progress' ? 'update the status' : kind === 'ready' ? 'mark it ready for review' : kind;
      toast.error(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const unlock = async () => {
    const ok = await confirm({
      title: `Unlock FY ${financialYear}?`,
      description: 'The working becomes editable again for all staff. The verification is withdrawn — it has to be verified and locked again once the changes are done. The revision history keeps the earlier sign-off.',
      confirmText: 'Unlock',
      destructive: true,
    });
    if (!ok) return;
    await act('unlock', () => setStatus('in_progress'), `FY ${financialYear} is unlocked.`);
  };

  const spin = (k: typeof busy, icon: React.ReactNode) => (busy === k ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : icon);
  const checklist = (period?.review_checklist ?? {}) as Record<string, boolean>;

  return (
    <SectionCard
      title="Sign-off & lock"
      description="Prepared by staff, verified and locked by a GST manager or superadmin. Once locked, the database refuses every edit until it is unlocked."
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <Badge variant={status.tone} className="gap-1 text-[10px]">
          {status.key === 'locked' && <Lock className="h-3 w-3" />}
          {status.label}
        </Badge>
      </div>

      {/* Prepared */}
      <div className="rounded-md border px-3 py-2 text-xs">
        <div className="mb-0.5 font-semibold text-muted-foreground">Prepared</div>
        {period?.prepared_by_name ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-success-strong" aria-hidden />
              Ready for review — <span className="font-medium">{period.prepared_by_name}</span>{period.prepared_at ? `, ${fmtWhen(period.prepared_at)}` : ''}
              {period.prepared_note ? <span className="text-muted-foreground"> · “{period.prepared_note}”</span> : null}
            </span>
            {!locked && !isClient && (
              <Button size="sm" variant="ghost" className="h-7" disabled={!!busy}
                onClick={() => void act('ready', () => markReady(undefined, true), 'Withdrawn — no longer marked ready for review.')}>
                {spin('ready', <Undo2 className="mr-1 h-3.5 w-3.5" />)} Withdraw
              </Button>
            )}
          </div>
        ) : locked ? (
          <span className="text-muted-foreground">Not marked ready for review before the lock.</span>
        ) : isClient ? (
          <span className="text-muted-foreground">Not yet.</span>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">When the working is complete, mark it ready so a GST manager or superadmin can verify it.</span>
            <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => setReadyOpen(true)}>
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Mark ready for review
            </Button>
          </div>
        )}
      </div>

      {/* Reviewed / locked */}
      {locked ? (
        <>
          <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs">
            <div className="mb-1 font-semibold">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-success-strong" aria-hidden />
              Verified and locked by {period?.reviewed_by_name ?? period?.locked_by ?? '—'}
              {period?.reviewed_role ? ` (${ROLE_LABEL[period.reviewed_role] ?? period.reviewed_role})` : ''}
              {period?.reviewed_at || period?.locked_at ? `, ${fmtWhen(period?.reviewed_at ?? period?.locked_at)}` : ''}
            </div>
            {period?.review_note && <p className="mb-1">“{period.review_note}”</p>}
            {period?.review_checklist && (
              <ul className="space-y-0.5">
                {REVIEW_CHECKLIST.map((c) => (
                  <li key={c.key} className="flex items-start gap-1.5">
                    {checklist[c.key]
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" aria-label="Checked" />
                      : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive-strong" aria-label="Not checked" />}
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canUnlock ? (
            <Button size="sm" variant="outline" onClick={unlock} disabled={!!busy}>
              {spin('unlock', <LockOpen className="mr-1 h-3.5 w-3.5" />)} Unlock FY {financialYear}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only a superadmin, a GST manager or a user with the unlock-sheets permission can unlock it.</p>
          )}
        </>
      ) : isClient ? (
        <p className="text-xs text-muted-foreground">Read-only.</p>
      ) : (
        <>
          {blockers.length > 0 ? (
            <Note tone="warn">
              <span className="font-medium">
                Verification is blocked by {blockers.length === 1 ? '1 difference' : `${blockers.length} differences`} without a reason:
              </span>
              <ul className="mt-1 space-y-0.5">
                {blockers.slice(0, SHOW_BLOCKERS).map((d) => (
                  <li key={d.key}>
                    <button
                      type="button"
                      onClick={() => go(d.step)}
                      className="inline-flex items-center gap-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-muted-foreground">{stepMeta(d.step).label}:</span> {d.label}
                      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {blockers.length > SHOW_BLOCKERS && <p className="mt-1 text-muted-foreground">…and {blockers.length - SHOW_BLOCKERS} more in the list above.</p>}
            </Note>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success-strong" /> Every difference is matched, within {rupeesShort(w.tolerance)} or justified.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setVerifyOpen(true)} disabled={!!busy || blockers.length > 0 || !canVerify}>
              {spin('lock', <ShieldCheck className="mr-1 h-3.5 w-3.5" />)} Verify & lock FY {financialYear}
            </Button>
            {status.key === 'not_started' && (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act('progress', () => setStatus('in_progress'), 'Marked in progress.')}>
                {spin('progress', <PlayCircle className="mr-1 h-3.5 w-3.5" />)} Mark in progress
              </Button>
            )}
          </div>
          {!canVerify && (
            <p className="text-xs text-muted-foreground">
              Only a GST manager or a superadmin can verify and lock the year{ROLE_LABEL[role] ? ` (you are signed in as ${ROLE_LABEL[role].toLowerCase()})` : ''}. Mark it ready for review so they know it is complete.
            </p>
          )}
        </>
      )}

      <ReadyDialog open={readyOpen} onOpenChange={setReadyOpen} busy={busy === 'ready'}
        onConfirm={async (note) => {
          if (await act('ready', () => markReady(note), 'Marked ready for review.')) setReadyOpen(false);
        }} />
      <VerifyDialog open={verifyOpen} onOpenChange={setVerifyOpen} busy={busy === 'lock'} reviewer={userName} roleLabel={ROLE_LABEL[role] ?? role}
        payable={sumTax(w.payables.totals.payable)} balance={sumTax(w.payables.totals.balance)} financialYear={financialYear}
        onConfirm={async (note, list) => {
          if (await act('lock', () => setStatus('locked', { note, checklist: list }), `FY ${financialYear} is verified and locked.`)) setVerifyOpen(false);
        }} />
    </SectionCard>
  );
};

const ReadyDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onConfirm: (note: string) => void }> = ({ open, onOpenChange, busy, onConfirm }) => {
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setNote(''); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark ready for review</DialogTitle>
          <DialogDescription>Everything pending is saved first. A GST manager or superadmin then verifies the working and locks the year.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ready-note" className="text-xs">Note for the reviewer (optional)</Label>
          <Textarea id="ready-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. 3B for March pulled again after the amendment; Table 13 agreed with the client." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(note.trim())} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1 h-3.5 w-3.5" />} Mark ready
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const VerifyDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  reviewer: string;
  roleLabel: string;
  payable: number;
  balance: number;
  financialYear: string;
  onConfirm: (note: string, checklist: Record<string, boolean>) => void;
}> = ({ open, onOpenChange, busy, reviewer, roleLabel, payable, balance, financialYear, onConfirm }) => {
  const manual = useMemo(() => REVIEW_CHECKLIST.filter((c) => !c.auto), []);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const all = manual.every((c) => ticks[c.key]);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setTicks({}); setNote(''); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Verify & lock FY {financialYear}</DialogTitle>
          <DialogDescription>
            Signed off as <span className="font-medium text-foreground">{reviewer}</span> ({roleLabel}). Tick each check you have made. Everything pending is saved first; the
            database then snapshots every sheet and refuses any edit until the year is unlocked.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {REVIEW_CHECKLIST.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              {c.auto ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" aria-label="Checked by the app" />
              ) : (
                <Checkbox id={`chk-${c.key}`} checked={!!ticks[c.key]} onCheckedChange={(v) => setTicks((t) => ({ ...t, [c.key]: v === true }))} className="mt-0.5" />
              )}
              <label htmlFor={c.auto ? undefined : `chk-${c.key}`} className={c.auto ? 'text-muted-foreground' : 'cursor-pointer'}>
                {c.label}{c.auto ? ' — checked by the app' : ''}
              </label>
            </li>
          ))}
        </ul>
        {payable > 0.5 && (
          <Note tone="info">
            {rupees(payable)} is payable ({rupees(balance)} not yet set off). It is disclosed output-wise and input-wise on the Payables & set-off step and can be set off there after the lock — only against a DRC-03 in the system or a GSTR-3B effect with its copy.
          </Note>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="verify-note" className="text-xs">Review note (optional — printed on the sign-off page)</Label>
          <Textarea id="verify-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(note.trim(), Object.fromEntries(REVIEW_CHECKLIST.map((c) => [c.key, c.auto ? true : !!ticks[c.key]])))} disabled={busy || !all}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Lock className="mr-1 h-3.5 w-3.5" />} Verify & lock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LockPanel;
