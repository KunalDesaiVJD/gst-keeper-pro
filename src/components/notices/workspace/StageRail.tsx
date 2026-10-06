import React from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { OPEN_STAGES, stageDef, stageIndex, type StageKey } from '@/lib/noticeStages';
import { closeReasonText, fmtDate } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

interface Props {
  stage: string;
  /** Stages this notice has actually been in (from its event history); null = no history. */
  visited: Set<string> | null;
  since: string | null;
  by: string | null;
  closeReason: string | null;
  replyDate: string | null;
  hearingDate: string | null;
  orderDate: string | null;
}

/**
 * The stage rail (audit U-41-2, U-44-2): every open stage in one line with the
 * current one in navy, its date under it, and readable numbers for the ones to
 * come. A closed notice shows Closed as an end state with its reason, and
 * ticks only what actually happened (a reply, a hearing, an order).
 */
export const StageRail: React.FC<Props> = (p) => {
  const closed = p.stage === 'closed';
  const cur = stageIndex(p.stage);
  const evidence: Partial<Record<StageKey, string | null>> = { filed: p.replyDate, hearing: p.hearingDate, order: p.orderDate };
  // A stage counts as done when the notice was in it (its history) or the facts
  // show it happened; one it went past without entering is shown as skipped.
  const happened = (key: StageKey) => !!evidence[key] || (p.visited ? p.visited.has(key) : false);
  const done = (key: StageKey, i: number) => (closed || p.visited ? happened(key) && (closed || i < cur) : i < cur);
  const skipped = (key: StageKey, i: number) => !closed && !done(key, i) && i < cur;
  const caption = (key: StageKey, i: number) => {
    if (!closed && i === cur) return p.since ? `since ${fmtDate(p.since.slice(0, 10))}` : '';
    const ev = evidence[key];
    return ev && done(key, i) ? fmtDate(ev) : '';
  };

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      {/* Phones: where it is (the stage is changed from the header). */}
      <div className="text-xs text-muted-foreground md:hidden">
        {closed ? <>Closed{p.closeReason ? ` · ${closeReasonText(p.closeReason)}` : ''}</>
          : <>Stage {cur + 1} of {OPEN_STAGES.length} · <span className="font-semibold text-foreground">{stageDef(p.stage).label}</span>{p.since ? ` since ${fmtDate(p.since.slice(0, 10))}` : ''}</>}
      </div>
      <div className="hidden items-start gap-2 md:flex">
        <ol className="flex min-w-0 flex-1 items-start" aria-label="Stages">
          {OPEN_STAGES.map((s, i) => {
            const isCur = !closed && i === cur;
            const isDone = done(s.key, i);
            const isSkipped = !isCur && skipped(s.key, i);
            return (
              <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={isCur ? 'step' : undefined}>
                {i > 0 && <span aria-hidden className={cn('absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2', isDone || isCur ? 'bg-success/70' : 'bg-border')} />}
                <span className={cn('relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold',
                  isCur ? 'border-primary bg-primary text-primary-foreground' : isDone ? 'border-success bg-success text-success-foreground'
                    : isSkipped ? 'border-dashed border-muted-foreground/50 bg-card text-muted-foreground' : 'border-muted-foreground/40 bg-card text-muted-foreground')}>
                  {isDone && !isCur ? <Check className="h-3.5 w-3.5" aria-hidden /> : isSkipped ? '–' : i + 1}
                </span>
                <span className={cn('mt-1 px-0.5 text-[11px] leading-tight', isCur ? 'font-semibold' : isSkipped ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'text-muted-foreground')}>{s.label}</span>
                <span className="px-0.5 text-[10px] leading-tight text-muted-foreground">{isSkipped ? 'skipped' : caption(s.key, i)}</span>
                <span className="sr-only">{isCur ? 'current stage' : isDone ? 'done' : isSkipped ? 'skipped' : 'not yet'}</span>
              </li>
            );
          })}
        </ol>
        {closed && (
          <div className="flex shrink-0 flex-col items-end gap-1 pl-2">
            <Badge variant="secondary" className="text-[11px]">Closed</Badge>
            {p.closeReason && <span className="max-w-[14rem] text-right text-[11px] text-muted-foreground">{closeReasonText(p.closeReason)}</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default StageRail;
