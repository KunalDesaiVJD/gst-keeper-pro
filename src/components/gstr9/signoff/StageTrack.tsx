import React from 'react';
import { changesSinceSignoff, currentStep, type SignoffState, type Stage } from '@/lib/gstr9/signoffFlow';
import { cn } from '@/lib/utils';

export type DotState = 'todo' | 'current' | 'done' | 'stale' | 'skipped';

const STEP_INDEX = { prepare: 0, verify: 1, review: 2 } as const;

/** The ring colour of the step a working waits on, by stage. */
export const CURRENT_RING: Record<Stage, string> = {
  not_started: 'border-muted-foreground/60',
  preparing: 'border-warning',
  sent_back: 'border-destructive',
  prepared: 'border-info',
  verified: 'border-primary',
  locked: 'border-success',
};

/** Prepare · Verify · Review — each done, stale (done, figures changed since), current, skipped or still to come. */
export const dotStates = (s: SignoffState): [DotState, DotState, DotState] => {
  // A year locked before the three-stage sign-off may have no Prepared stamp either.
  if (s.stage === 'locked') return [s.prepared ? 'done' : 'skipped', s.verified ? 'done' : 'skipped', 'done'];
  const step = currentStep(s);
  const at = step ? STEP_INDEX[step] : 0;
  const stale = changesSinceSignoff(s) > 0;
  return [0, 1, 2].map((i) => {
    if (i < at) return stale && i === at - 1 ? 'stale' : 'done';
    if (i === at) return 'current';
    return 'todo';
  }) as [DotState, DotState, DotState];
};

const DOT: Record<Exclude<DotState, 'current'>, string> = {
  todo: 'border border-muted-foreground/40 bg-card',
  done: 'bg-success',
  stale: 'bg-warning',
  skipped: 'border border-success bg-card',
};

/** Three dots joined by a rule: where a working stands, at a glance. Decorative — the stage word carries the meaning. */
export const StageTrack: React.FC<{ state: SignoffState; size?: 'sm' | 'md'; className?: string }> = ({ state, size = 'sm', className }) => {
  const dots = dotStates(state);
  const d = size === 'md' ? 'h-[9px] w-[9px]' : 'h-[7px] w-[7px]';
  const gap = size === 'md' ? 'w-1.5' : 'w-[3px]';
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center', className)}>
      {dots.map((st, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className={cn('h-px bg-border', gap)} />}
          <span className={cn('rounded-full', d, st === 'current' ? cn('border-[1.5px] bg-card', CURRENT_RING[state.stage]) : DOT[st])} />
        </React.Fragment>
      ))}
    </span>
  );
};

export default StageTrack;
