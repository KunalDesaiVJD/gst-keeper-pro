import React from 'react';
import { Check, CornerUpLeft, Minus, AlertTriangle } from 'lucide-react';
import {
  clientStage, clientView, currentStep, displayName, overrideText, type Person, type SignoffState, type Slot, type Step,
} from '@/lib/gstr9/signoffFlow';
import { ROLE_LABEL } from '@/lib/gstr9/signoff';
import { cn } from '@/lib/utils';
import { fmtWhen } from '../overview/steps';
import { Monogram } from './Monogram';
import { CURRENT_RING, dotStates, type DotState } from './StageTrack';

export const STEPS: { step: Step; slot: Slot; label: string }[] = [
  { step: 'prepare', slot: 'preparer', label: 'Prepare' },
  { step: 'verify', slot: 'verifier', label: 'Verify' },
  { step: 'review', slot: 'reviewer', label: 'Review & lock' },
];

/** "3 hours ago", "2 days ago". */
export const ago = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

/** Who is allotted to a step, as text (no picker). */
export const AllotChip: React.FC<{ slot: Slot; person: Person | null; meId?: string }> = ({ slot, person, meId }) => (
  <span className="inline-flex min-w-0 items-center gap-1 text-[11px]">
    {person ? <Monogram name={person.name} me={person.id === meId} /> : <Monogram kind={slot === 'preparer' ? 'nobody' : 'managers'} />}
    <span className={cn('truncate', !person && 'text-muted-foreground')}>
      {person ? (person.id === meId ? 'You' : displayName(person.name)) : slot === 'preparer' ? 'Unallotted' : 'Any GST manager'}
    </span>
  </span>
);

const roleText = (role: string | null | undefined) => (role ? ROLE_LABEL[role] ?? role : '');

/** Each dot's state, read out. */
const SR_STATE: Record<DotState, string> = {
  done: 'done',
  current: 'waiting on this step',
  todo: 'not yet',
  stale: 'done, figures changed since',
  skipped: 'skipped',
};

/**
 * Prepare → Verify → Review & lock as three steps on a rail: who is allotted
 * to each, who signed it and when, a send-back, and the actions the viewer
 * may take (rendered by the caller). A client login sees signers and dates
 * only — no allotment, notes or send-backs.
 */
export const SignoffRail: React.FC<{
  state: SignoffState;
  meId?: string;
  forClient?: boolean;
  /** The allotment chip of a step (a picker for managers); defaults to plain text. */
  renderChip?: (slot: Slot) => React.ReactNode;
  /** Shown under the step the working waits on (and under a done step, e.g. Withdraw). */
  renderActions?: (step: Step) => React.ReactNode;
  /** Under a step's line: e.g. "6 figure changes since". */
  renderExtra?: (step: Step) => React.ReactNode;
  className?: string;
}> = ({ state, meId, forClient, renderChip, renderActions, renderExtra, className }) => {
  // A client login's rail never shows the send-back — not even as the ring's colour.
  const s = forClient ? clientView(state) : state;
  const dots = dotStates(s);
  const at = currentStep(s);
  const stage = forClient ? clientStage(s) : s.stage;
  const backTo = !forClient && s.stage === 'sent_back' ? s.returned?.to : undefined;
  const legacy = s.overrides.find((o) => o.kind === 'legacy');
  const override = s.overrides.find((o) => o.kind !== 'legacy');

  const line = (step: Step): React.ReactNode => {
    const stamp = step === 'prepare' ? s.prepared : step === 'verify' ? s.verified : s.locked;
    if (stamp) {
      const role = step !== 'prepare' && stamp.role ? ` (${roleText(stamp.role)})` : '';
      return <>Done by <span className="font-medium text-foreground">{displayName(stamp.name)}</span>{role} · {fmtWhen(stamp.at)}</>;
    }
    if (backTo && STEPS.find((x) => x.step === step)?.slot === backTo) {
      return <span className="text-destructive-strong">Sent back by <span className="font-medium">{displayName(s.returned?.by)}</span> · {fmtWhen(s.returned?.at)}</span>;
    }
    if (step === 'verify' && stage === 'locked') {
      return legacy ? 'Verified and locked in one step, before the three-stage sign-off' : 'Not verified — locked with a superadmin override';
    }
    if (step === 'prepare' && stage === 'locked') return 'Not recorded — locked before the three-stage sign-off';
    if (step === 'prepare' && at === 'prepare') {
      if (stage === 'not_started') return 'Not started';
      return s.lastSavedAt ? `In progress · last saved ${ago(s.lastSavedAt)}` : 'In progress';
    }
    return at === step ? 'Waiting' : 'Not yet';
  };

  const note = (step: Step): string | null => {
    if (forClient) return null;
    const stamp = step === 'prepare' ? s.prepared : step === 'verify' ? s.verified : s.locked;
    if (stamp?.note) return stamp.note;
    if (backTo && STEPS.find((x) => x.step === step)?.slot === backTo) return s.returned?.note ?? null;
    return null;
  };

  return (
    <ol className={cn('space-y-0', className)}>
      {STEPS.map(({ step, slot, label }, i) => {
        const st = dots[i];
        const back = backTo === slot;
        const n = note(step);
        return (
          <li key={step} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 pb-3 last:pb-0">
            {i < 2 && <span aria-hidden className="absolute bottom-0 left-[8.5px] top-[20px] w-px bg-border" />}
            <span
              aria-hidden
              className={cn(
                'relative z-[1] mt-px flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold',
                back ? 'border-[1.5px] border-destructive bg-card text-destructive-strong'
                  : st === 'done' ? 'bg-success text-white'
                    : st === 'stale' ? 'bg-warning text-foreground'
                      : st === 'skipped' ? 'border border-dashed border-muted-foreground/60 bg-card text-muted-foreground'
                        : st === 'current' ? cn('border-[1.5px] bg-card text-foreground', CURRENT_RING[stage])
                          : 'border border-muted-foreground/40 bg-card text-muted-foreground',
              )}
            >
              {back ? <CornerUpLeft className="h-2.5 w-2.5" /> : st === 'done' || st === 'stale' ? <Check className="h-3 w-3" strokeWidth={3} /> : st === 'skipped' ? <Minus className="h-3 w-3" /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex min-h-[20px] items-center justify-between gap-2">
                <span className={cn('text-xs font-medium', at === step && 'text-foreground', at !== step && !(st === 'done' || st === 'stale') && 'text-muted-foreground')}>
                  {label}
                  <span className="sr-only">: {back ? 'sent back' : SR_STATE[st]}</span>
                </span>
                {!forClient && (renderChip ? renderChip(slot) : <AllotChip slot={slot} person={s[slot]} meId={meId} />)}
              </div>
              <div className="text-[11px] leading-snug text-muted-foreground">{line(step)}</div>
              {n && <p className={cn('mt-0.5 line-clamp-2 text-[11px] leading-snug', back ? 'text-destructive-strong' : 'text-foreground/80')} title={n}>“{n}”</p>}
              {step === 'review' && stage === 'locked' && !forClient && override && (
                <p className="mt-0.5 text-[11px] leading-snug text-foreground">
                  <AlertTriangle className="mr-1 inline h-3 w-3 -translate-y-px text-warning" aria-hidden />{overrideText(override)}
                </p>
              )}
              {renderExtra?.(step)}
              {renderActions?.(step)}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default SignoffRail;
