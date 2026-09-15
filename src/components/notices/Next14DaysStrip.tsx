import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2, CalendarDays } from 'lucide-react';

export interface DeadlineItem {
  date: string; // YYYY-MM-DD
  type: 'reply_due' | 'hearing' | 'appeal_limitation' | 'issued' | 'other';
  label: string; // short label like "DRC-01" or client name
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

const MAX_VISIBLE_CHIPS = 3;

const chipStyles: Record<DeadlineItem['type'], string> = {
  reply_due: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  hearing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  appeal_limitation: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  issued: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  other: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const legendDotStyles: Record<DeadlineItem['type'], string> = {
  reply_due: 'bg-red-500',
  hearing: 'bg-amber-500',
  appeal_limitation: 'bg-purple-500',
  issued: 'bg-blue-500',
  other: 'bg-gray-400',
};

const legendLabels: Record<DeadlineItem['type'], string> = {
  reply_due: 'Reply Due',
  hearing: 'Hearing',
  appeal_limitation: 'Appeal Limitation',
  issued: 'Issued',
  other: 'Other',
};

function generateDays(count: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
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
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export default function Next14DaysStrip({ items, onClickItem, onClickDate, loading }: Next14DaysStripProps) {
  const days = useMemo(() => generateDays(14), []);

  const grouped = useMemo(() => {
    const map: Record<string, DeadlineItem[]> = {};
    for (const item of items) {
      if (!map[item.date]) map[item.date] = [];
      map[item.date].push(item);
    }
    return map;
  }, [items]);

  const week1 = days.slice(0, 7);
  const week2 = days.slice(7, 14);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Next 14 Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderWeek(weekDays: Date[]) {
    return (
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((d) => {
          const key = formatDateKey(d);
          const dayItems = grouped[key] || [];
          const visible = dayItems.slice(0, MAX_VISIBLE_CHIPS);
          const overflow = dayItems.length - MAX_VISIBLE_CHIPS;
          const today = isToday(d);
          const weekend = isWeekend(d);

          return (
            <div
              key={key}
              className={cn(
                'rounded-md border p-1 min-h-[60px] flex flex-col',
                today && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                weekend && 'bg-muted/50'
              )}
            >
              {/* Day header */}
              <div
                className={cn('text-center mb-0.5', onClickDate && 'cursor-pointer hover:bg-muted/60 rounded')}
                onClick={onClickDate ? () => onClickDate(key) : undefined}
              >
                <div
                  className={cn(
                    'text-[10px] font-medium leading-tight',
                    today && 'text-primary font-semibold'
                  )}
                >
                  {d.getDate()}
                </div>
                <div className="text-[9px] text-muted-foreground leading-tight">
                  {WEEKDAY_ABBR[d.getDay()]}
                </div>
              </div>

              {/* Chips */}
              <div className="flex flex-col gap-0.5 flex-1">
                {visible.map((item, idx) => (
                  <button
                    key={`${item.noticeId ?? item.label}-${idx}`}
                    type="button"
                    onClick={() => onClickItem?.(item)}
                    className={cn(
                      'rounded-full px-1 py-px text-[8px] leading-tight font-medium truncate text-left',
                      'hover:opacity-80 transition-opacity',
                      chipStyles[item.type],
                      !onClickItem && 'cursor-default'
                    )}
                    title={item.label}
                  >
                    {item.label}
                  </button>
                ))}
                {overflow > 0 && (
                  <span className="text-[8px] text-muted-foreground text-center leading-tight">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Next 14 Days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {renderWeek(week1)}
        {renderWeek(week2)}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
          {(Object.keys(legendLabels) as DeadlineItem['type'][]).map((type) => (
            <div key={type} className="flex items-center gap-1">
              <span
                className={cn('inline-block h-2 w-2 rounded-full', legendDotStyles[type])}
              />
              <span className="text-[10px] text-muted-foreground">{legendLabels[type]}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
