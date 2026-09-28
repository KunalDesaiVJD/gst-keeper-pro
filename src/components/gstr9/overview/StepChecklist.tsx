import React, { useMemo } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Progress } from '@/components/ui/progress';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { PHASES, STEP_META, stepStatuses, useGoToStep } from './steps';

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
      description={`${complete} of ${work.length} steps complete. Each step shows what is entered and what still needs attention.`}
    >
      <Progress value={(complete / work.length) * 100} className="h-1.5" aria-label={`${complete} of ${work.length} steps complete`} />
      <div className="space-y-3">
        {PHASES.map((phase) => (
          <div key={phase} className="space-y-1">
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
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                          ok ? 'bg-success/15 text-success-strong' : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden
                      >
                        {ok ? <Check className="h-3.5 w-3.5" /> : s.n}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{s.label}</span>
                        {st.detail && <span className="block text-xs text-muted-foreground">{st.detail}</span>}
                      </span>
                      <Badge variant={st.tone} className="shrink-0 whitespace-nowrap text-[10px] font-medium">{st.label}</Badge>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
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
