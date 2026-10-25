// Home's side panel (the UX audit of 25 October 2026): what is coming in the
// next 14 days, each day opening the calendar with the master filters.
// Overdue by age and Just in were taken off Home on 25 October 2026 (Meet):
// the overdue figure and the work list's new badges already say both.
import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Panel } from '@/components/notices/ui/Panel';
import { hrefWithMaster, type Master } from '@/lib/masterFilters';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { fmtDay, plural } from '@/lib/noticeFormat';

// ── The next 14 days, as a timeline ────────────────────────────────────────
export const Upcoming: React.FC<{ cc: CommandCentre | undefined; master: Master }> = ({ cc, master }) => {
  const days = (cc?.next14 ?? []).filter((d) => d.total > 0);
  return (
    <Panel title="Next 14 days" actions={<Link to={hrefWithMaster('/notices-calendar', master)} className="text-xs font-medium text-primary hover:underline">Calendar →</Link>}>
      {!cc ? <Skeleton className="h-24 w-full" /> : !days.length ? <p className="text-xs text-muted-foreground">Nothing due in the next two weeks.</p> : (
        <ol className="space-y-1">
          {days.map((d) => {
            const [wd, ...rest] = fmtDay(d.date).split(' ');
            return (
              <li key={d.date}>
                <Link to={hrefWithMaster(`/notices-calendar?date=${d.date}&dash=1`, master)} className="flex items-center gap-3 rounded-md px-1.5 py-1 hover:bg-muted/50">
                  <span className="flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md border bg-card leading-none">
                    <span className="text-[9px] uppercase text-muted-foreground">{wd}</span>
                    <span className="text-sm font-bold tabular-nums">{rest[0]}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {d.reply > 0 && <Badge variant="warning" className="text-[10px]">{plural(d.reply, 'reply due', 'replies due')}</Badge>}
                    {d.hearing > 0 && <Badge variant="destructive" className="text-[10px]">{plural(d.hearing, 'hearing')}</Badge>}
                    {d.clock > 0 && <Badge variant="secondary" className="text-[10px]">{plural(d.clock, 'appeal clock')}</Badge>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
};
