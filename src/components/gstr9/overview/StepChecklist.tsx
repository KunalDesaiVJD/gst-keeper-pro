import React, { useMemo } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Progress } from '@/components/ui/progress';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { PHASES, STEP_META, stepStatuses, useGoToStep, type Phase } from './steps';

/**
 * Where each phase sits in the grid. One column on narrow screens; two on a
 * laptop (Collect | Reconcile over Returns | Finish, 8 rows tall); three on a
 * wide screen, with Returns and Finish stacked in the third (5 rows tall).
 */
const PLACE: Record<Phase, string> = {
  Collect: 'xl:col-start-1 xl:row-start-1 2xl:row-span-2',
  Reconcile: 'xl:col-start-2 xl:row-start-1 2xl:row-span-2',
  Returns: 'xl:col-start-1 xl:row-start-2 2xl:col-start-3 2xl:row-start-1',
  Finish: 'xl:col-start-2 xl:row-start-2 2xl:col-start-3 2xl:row-start-2',
};

/** Every step with what is in it and what still needs attention; each row opens the step. */
export const StepChecklist: React.FC = () => {
  const { docs, workings, period } = useWorkspace();
  const go = useGoToStep();
  const statuses = useMemo(() => stepStatuses(docs, workings, period), [docs, workings, period]);
  const work = STEP_META.filter((s) => s.key !== 'overview' && s.key !== 'review');
  const complete = work.filter((s) => ['done', 'nil'].includes(statuses[s.key].state)).length;

  return (
    <SectionCard
      title="Progress"
      description={`${complete} of ${work.length} steps complete · what is entered and what still needs attention; a row opens its step.`}
      actions={<Progress value={(complete / work.length) * 100} className="h-1.5 w-32" aria-label={`${complete} of ${work.length} steps complete`} />}
    >
      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 xl:grid-cols-2 2xl:grid-cols-3">
        {PHASES.map((phase) => (
          <div key={phase} className={cn('min-w-0 space-y-1', PLACE[phase])}>
            <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{phase}</div>
            <ul className="divide-y overflow-hidden rounded-md border">
              {STEP_META.filter((s) => s.phase === phase && s.key !== 'overview').map((s) => {
                const st = statuses[s.key];
                const ok = st.state === 'done' || st.state === 'nil' || st.state === 'locked';
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => go(s.key)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                          ok ? 'bg-success/15 text-success-strong' : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden
                      >
                        {ok ? <Check className="h-3 w-3" /> : s.n}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium leading-tight">{s.label}</span>
                        {st.detail && <span className="block text-[11px] leading-snug text-muted-foreground">{st.detail}</span>}
                      </span>
                      <Badge variant={st.tone} className="shrink-0 whitespace-nowrap px-1.5 text-[10px] font-medium">{st.label}</Badge>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
};

export default StepChecklist;
