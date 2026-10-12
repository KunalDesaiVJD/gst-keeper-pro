// The next step of a case in one line, for lists: the assistant's headline
// when it has advised the case, else the usual step for its form.
import React from 'react';
import { CornerDownRight, Sparkles } from 'lucide-react';
import { usualStep, type AdviceRow } from '@/lib/noticeAdvice';
import type { CaseRow, Track } from '@/lib/noticeCases';
import { cn } from '@/lib/utils';

export const NextStepLine: React.FC<{ r: CaseRow; advice: AdviceRow | undefined; className?: string }> = ({ r, advice, className }) => {
  if (!r.is_open) return null;
  const a = advice?.advice;
  const text = a?.headline || usualStep(r.form_code, (r.track ?? 'litigation') as Track, !!r.is_overdue).headline;
  return (
    <div className={cn('flex min-w-0 items-center gap-1 text-xs', a ? (a.can_close ? 'text-success' : 'text-primary') : 'text-muted-foreground', className)}
      title={a ? `AI: ${a.situation}` : 'The usual step for this form; the AI has not advised this case yet'}>
      {a ? <Sparkles className="h-3 w-3 shrink-0" aria-hidden /> : <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{text}</span>
    </div>
  );
};

export default NextStepLine;
