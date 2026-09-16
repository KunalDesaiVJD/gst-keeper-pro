import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface DeadlineItem {
  date: string; // YYYY-MM-DD
  type: 'reply_due' | 'hearing' | 'appeal_limitation' | 'issued' | 'other';
  label: string;
  noticeId?: string;
  clientId?: string;
}

interface Next14DaysStripProps {
  items: DeadlineItem[];
  onClickItem?: (item: DeadlineItem) => void;
  onClickDate?: (dateISO: string) => void;
  loading?: boolean;
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const chipColor: Record<DeadlineItem['type'], string> = {
  appeal_limitation: 'bg-destructive/15 text-destructive font-bold',
  reply_due: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold',
  issued: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 font-bold',
  hearing: 'bg-primary/15 text-primary font-bold',
  other: 'bg-muted text-muted-foreground font-bold',
};

const legendDotColor: Record<string, string> = {
  appeal_limitation: 'bg-destructive',
  reply_due: 'bg-amber-500',
  issued: 'bg-blue-500',
  hearing: 'bg-primary',
};

const legendLabels: Record<string, string> = {
  appeal_limitation: 'Appeal limitation',
  reply_due: 'Reply due',
  issued: 'Issued',
  hearing: 'Hearing',
};

function todayIST(): Date {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return new Date(iso + 'T00:00:00');
}

function generateDays(count: number): Date[] {
  const days: Date[] = [];
  const today = todayIST();
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isToday(d: Date): boolean {
  const now = todayIST();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function Next14DaysStrip({ items, onClickItem, onClickDate, loading }: Next14DaysStripProps) {
  const [range, setRange] = useState<'2w' | 'month'>('2w');
  const days = useMemo(() => generateDays(range === 'month' ? 35 : 14), [range]);
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const grouped = useMemo(() => {
    const map: Record<string, DeadlineItem[]> = {};
    for (const item of items) {
      if (!map[item.date]) map[item.date] = [];
      map[item.date].push(item);
    }
    return map;
  }, [items]);

  // Find the spotlight item: first appeal_limitation, or first item overall
  const spotlightItem = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.find((i) => i.type === 'appeal_limitation') || sorted[0] || null;
  }, [items]);

  if (loading) {
    return (
      <Card>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Next 14 days</h2>
        </div>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  function renderWeek(weekDays: Date[]) {
    return (
      <div className="grid grid-cols-7 gap-1.5">
        {weekDays.map((d) => {
          const key = formatDateKey(d);
          const dayItems = grouped[key] || [];
          const today = isToday(d);

          // Group by type and count
          const typeCounts = new Map<string, number>();
          dayItems.forEach((item) => {
            typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
          });

          return (
            <div
              key={key}
              className={cn(
                'rounded-lg border p-1.5 min-h-[64px] flex flex-col items-center text-center',
                today && 'border-primary shadow-[inset_0_0_0_1px] shadow-primary',
                onClickDate && 'cursor-pointer hover:bg-muted/40',
              )}
              onClick={onClickDate ? () => onClickDate(key) : undefined}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                {WEEKDAY_ABBR[d.getDay()]}
              </div>
              <div className={cn('text-sm font-semibold leading-tight', today && 'text-primary')}>
                {d.getDate()}
              </div>

              {/* Count-based chips */}
              {typeCounts.size > 0 && (
                <div className="mt-1 flex flex-wrap gap-0.5 justify-center">
                  {Array.from(typeCounts.entries()).map(([type, count]) => {
                    // A chip standing for exactly one notice opens that notice
                    // directly; an aggregated chip has no single target, so it
                    // falls through to the day's own drill-down.
                    const only = count === 1
                      ? dayItems.find((i) => i.type === type && i.noticeId && i.clientId)
                      : undefined;
                    const chipAction = only && onClickItem
                      ? () => onClickItem(only)
                      : onClickDate
                        ? () => onClickDate(key)
                        : undefined;
                    return (
                      <span
                        key={type}
                        role={chipAction ? 'button' : undefined}
                        tabIndex={chipAction ? 0 : undefined}
                        title={only ? only.label : undefined}
                        className={cn(
                          'rounded-full px-1.5 py-px text-[9px]',
                          chipColor[type as DeadlineItem['type']] || chipColor.other,
                          chipAction && 'cursor-pointer hover:ring-1 hover:ring-current',
                        )}
                        onClick={chipAction ? (e) => { e.stopPropagation(); chipAction(); } : undefined}
                        onKeyDown={chipAction ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); chipAction(); }
                        } : undefined}
                      >
                        {type === 'hearing' ? 'PH' : count}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Next {range === 'month' ? 35 : 14} days</h2>
          <p className="text-[11px] text-muted-foreground">Statutory due dates &amp; hearings</p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {([['2w', '2 weeks'], ['month', 'Month']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                range === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <CardContent className="space-y-1.5 pt-3 pb-3">
        {weeks.map((w, i) => <Fragment key={i}>{renderWeek(w)}</Fragment>)}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 pt-2">
          {Object.entries(legendLabels).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', legendDotColor[type])} />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
          {spotlightItem ? (
            <button
              type="button"
              className="truncate text-left hover:text-foreground hover:underline"
              onClick={() => {
                if (spotlightItem.noticeId && spotlightItem.clientId && onClickItem) onClickItem(spotlightItem);
                else onClickDate?.(spotlightItem.date);
              }}
            >
              {new Date(spotlightItem.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}: {spotlightItem.label}
            </button>
          ) : <span />}
          <Link to="/notices-all?filter=due7" className="shrink-0 font-semibold text-primary hover:underline">
            Full calendar →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
