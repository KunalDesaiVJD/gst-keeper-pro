// A matter's next clock as one readable cell (audit U-80-2, U-84-3): what the
// date is for, the date (and time for a hearing, in IST) and an IST days-left
// chip — overdue in red, this week in amber.
import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { fmtDate, fmtDateTime } from '@/lib/noticeFormat';
import type { MatterClock } from '@/lib/litigationData';
import { cn } from '@/lib/utils';

export const clockWords = (days: number) => (days === 0 ? 'today' : days > 0 ? `in ${days} d` : `${-days} d late`);

export const DaysChip: React.FC<{ days: number; className?: string }> = ({ days, className }) => (
  <Badge variant={days < 0 ? 'destructive' : days <= 7 ? 'warning' : 'secondary'}
    className={cn('whitespace-nowrap px-1.5 py-0 text-[11px] font-medium tabular-nums', className)}>
    {clockWords(days)}
  </Badge>
);

/** "05 Oct 2026, 10:30" for a hearing, "05 Oct 2026" otherwise. */
export const clockWhen = (c: Pick<MatterClock, 'date' | 'at'>) => (c.at ? fmtDateTime(c.at) : fmtDate(c.date));

export const ClockCell: React.FC<{ clock: MatterClock | null; open: boolean; className?: string }> = ({ clock, open, className }) => {
  if (!open) return <span className={cn('text-xs text-muted-foreground', className)}>closed</span>;
  if (!clock) return <span className={cn('text-xs text-muted-foreground', className)}>no clock running</span>;
  return (
    <span className={cn('block text-xs leading-tight', className)}>
      <span className="block font-medium text-foreground">{clock.label}</span>
      <span className="flex flex-wrap items-center gap-1">
        <span className={cn('font-semibold tabular-nums', clock.days < 0 && 'text-destructive-strong')}>{clockWhen(clock)}</span>
        <DaysChip days={clock.days} />
      </span>
    </span>
  );
};

export default ClockCell;
