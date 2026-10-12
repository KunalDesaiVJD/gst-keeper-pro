// Whose move it is on a case: with us, with the department, or closed.
import React from 'react';
import { CheckCircle2, Hourglass, UserRound } from 'lucide-react';
import { WAITING, waitingOf } from '@/lib/noticeCases';
import { cn } from '@/lib/utils';

const STYLE = {
  us: 'border-warning/40 bg-warning/10 text-warning',
  department: 'border-info/40 bg-info/10 text-info',
  closed: 'border-border bg-muted text-muted-foreground',
} as const;

export const WaitingChip: React.FC<{ r: { waiting_on?: string | null; is_open?: boolean | null }; className?: string; long?: boolean }> = ({ r, className, long }) => {
  const w = waitingOf(r);
  const Icon = w === 'us' ? UserRound : w === 'department' ? Hourglass : CheckCircle2;
  return (
    <span title={WAITING[w].hint} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', STYLE[w], className)}>
      <Icon className="h-3 w-3" aria-hidden />{long ? WAITING[w].label : WAITING[w].short}
    </span>
  );
};

export default WaitingChip;
