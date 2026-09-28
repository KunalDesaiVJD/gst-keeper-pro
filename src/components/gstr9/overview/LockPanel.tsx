import React, { useState } from 'react';
import { ArrowUpRight, CheckCircle2, Loader2, Lock, LockOpen, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, periodStatus, rupeesShort, stepMeta, useGoToStep } from './steps';

const SHOW_BLOCKERS = 6;

/** Lock / unlock the financial year. The lock is enforced by the database, not the screen. */
export const LockPanel: React.FC = () => {
  const { workings: w, period, readOnly, locked, canUnlock, setStatus, flush, financialYear } = useWorkspace();
  const confirm = useConfirm();
  const go = useGoToStep();
  const [busy, setBusy] = useState<null | 'lock' | 'unlock' | 'progress'>(null);
  const status = periodStatus(period);
  const isClient = readOnly && !locked;
  const blockers = w.diffs.filter((d) => d.open);

  const act = async (kind: 'lock' | 'unlock' | 'progress', run: () => Promise<void>, done: string) => {
    setBusy(kind);
    try {
      await run();
      toast.success(done);
    } catch (e) {
      toast.error(`Could not ${kind === 'progress' ? 'update the status' : kind}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const lock = async () => {
    const ok = await confirm({
      title: `Lock FY ${financialYear}?`,
      description:
        'Everything pending is saved first. Once locked, the database refuses every edit to this working — from any screen, by anyone — until it is unlocked by a superadmin, a GST manager or a user with the unlock-sheets permission.',
      confirmText: 'Lock the year',
    });
    if (!ok) return;
    await act('lock', async () => { await flush(); await setStatus('locked'); }, `FY ${financialYear} is locked.`);
  };

  const unlock = async () => {
    const ok = await confirm({
      title: `Unlock FY ${financialYear}?`,
      description: 'The working becomes editable again for all staff, and the reasons stay as they are. Lock it again once the changes are done.',
      confirmText: 'Unlock',
      destructive: true,
    });
    if (!ok) return;
    await act('unlock', () => setStatus('in_progress'), `FY ${financialYear} is unlocked.`);
  };

  const spin = (k: typeof busy, icon: React.ReactNode) => (busy === k ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : icon);

  return (
    <SectionCard title="Lock the year" description="Locking freezes the working for filing; unlocking needs superadmin, GST manager or the unlock-sheets permission.">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <Badge variant={status.tone} className="gap-1 text-[10px]">
          {status.key === 'locked' && <Lock className="h-3 w-3" />}
          {status.label}
        </Badge>
        {locked && (period?.locked_by || period?.locked_at) && (
          <span className="text-xs text-muted-foreground">
            {period?.locked_by ? `by ${period.locked_by}` : ''}{period?.locked_at ? ` · ${fmtWhen(period.locked_at)}` : ''}
          </span>
        )}
      </div>

      {locked ? (
        <>
          <Note tone="info">The database refuses every edit to this working until it is unlocked. Exports still work.</Note>
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
                Locking is blocked by {blockers.length === 1 ? '1 difference' : `${blockers.length} differences`} without a reason:
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
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Every difference is matched, within {rupeesShort(w.tolerance)} or justified.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={lock} disabled={!!busy || blockers.length > 0}>
              {spin('lock', <Lock className="mr-1 h-3.5 w-3.5" />)} Lock FY {financialYear}
            </Button>
            {status.key === 'not_started' && (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('progress', () => setStatus('in_progress'), 'Marked in progress.')}>
                {spin('progress', <PlayCircle className="mr-1 h-3.5 w-3.5" />)} Mark in progress
              </Button>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
};

export default LockPanel;
