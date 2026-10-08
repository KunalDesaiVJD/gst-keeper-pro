// Notices & Litigation · Calendar (audit U-11-*, U-25-*): the real month with
// reply dues, hearings and appeal / attachment clocks per day, weekends tinted,
// and the chosen day's list beneath it with ‹ › to move a day. The 14-day strip
// on the command centre opens here; a day's count there is this list's length
// (both read public.notice_calendar). Opened from the strip (dash=1) it shows
// only the notice types on the dashboard, as the strip counts them (contract
// §A), with a chip that removes the filter.
import React, { useMemo } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { CALENDAR_KIND_LABEL, loadCalendar, type CalendarItem } from '@/lib/noticeCommandCentre';
import { addDays, istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { useMaster } from '@/lib/masterFilters';
import { inScope, useMasterScope } from '@/lib/masterScope';
import { cn } from '@/lib/utils';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_TONE: Record<CalendarItem['kind'], 'warning' | 'info' | 'destructive' | 'secondary'> = {
  reply: 'warning', hearing: 'info', appeal: 'destructive', attachment: 'secondary',
};

function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;            // Monday first
  const start = new Date(Date.UTC(year, month, 1 - offset));
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  return days;
}

const NoticesCalendarPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { m: master } = useMaster();
  const { scope } = useMasterScope(master, user?.id ?? null);
  const today = istToday();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? (sp.get('date') as string) : today;
  const monthKey = /^\d{4}-\d{2}$/.test(sp.get('month') || '') ? (sp.get('month') as string) : day.slice(0, 7);
  const [y, m] = monthKey.split('-').map(Number);
  const grid = useMemo(() => monthGrid(y, m - 1), [y, m]);
  const dashOnly = sp.get('dash') === '1';
  const q = useQuery({
    queryKey: ['notice-calendar', grid[0], grid[41], dashOnly],
    queryFn: () => loadCalendar(grid[0], grid[41], { dashboardOnly: dashOnly }),
  });

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  // The master filters keep an item when its notice is kept (a matter's item, by its client).
  const all = (q.data ?? []).filter((it) => (it.notice_id ? inScope(scope, it) : !master.client || it.client_id === master.client));
  const byDay = new Map<string, CalendarItem[]>();
  all.forEach((it) => byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]));
  const set = (patch: { date?: string; month?: string }) => {
    const next = new URLSearchParams(sp);
    if (patch.date) next.set('date', patch.date);
    if (patch.month) next.set('month', patch.month);
    setSp(next, { replace: true });
  };
  const shiftMonth = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    set({ month: d.toISOString().slice(0, 7) });
  };
  const items = byDay.get(day) ?? [];
  const monthItems = all.filter((it) => it.day.startsWith(monthKey));
  const dropDash = () => {
    const next = new URLSearchParams(sp);
    next.delete('dash');
    setSp(next, { replace: true });
  };

  return (
    <NoticesShell section="Calendar" master
      actions={monthItems.length > 0 && (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => downloadIcs(monthItems.map((it) => ({
          uid: `${it.kind}-${it.notice_id ?? it.detail}-${it.day}`, date: it.day,
          title: `${CALENDAR_KIND_LABEL[it.kind]} — ${it.client_name}${it.form_code ? ` · ${it.form_code}` : ''}`,
          description: [it.title, it.reference, it.owner ? `Owner: ${it.owner}` : ''].filter(Boolean).join('\n'),
        })), `notices-${monthKey}`, `GST Keeper ${MONTHS[m - 1]} ${y}`)}>
          <CalendarPlus className="h-3.5 w-3.5" /> {MONTHS[m - 1]} to calendar (.ics)
        </Button>
      )}>
      {dashOnly && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <button type="button" onClick={dropDash} aria-label="Remove filter Dashboard notice types only"
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Dashboard notice types only <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionCard title={`${MONTHS[m - 1]} ${y}`} description="Reply due · personal hearings · appeal and attachment clocks"
          actions={<div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => set({ date: today, month: today.slice(0, 7) })}>Today</Button>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
          </div>}>
          {q.isLoading ? <Skeleton className="h-80 w-full" /> : q.error ? <Note tone="warn">Couldn't load the calendar.</Note> : (
            <div className="grid grid-cols-7 gap-1" role="group" aria-label={`${MONTHS[m - 1]} ${y}`}>
              {WEEKDAYS.map((w) => <div key={w} aria-hidden className="pb-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">{w}</div>)}
              {grid.map((d, i) => {
                const list = byDay.get(d) ?? [];
                const inMonth = d.startsWith(monthKey);
                const weekend = i % 7 >= 5;
                const counts = { reply: 0, hearing: 0, clock: 0 };
                list.forEach((it) => { if (it.kind === 'reply') counts.reply++; else if (it.kind === 'hearing') counts.hearing++; else counts.clock++; });
                return (
                  <button key={d} type="button" aria-pressed={d === day} aria-current={d === today ? 'date' : undefined} onClick={() => set({ date: d })}
                    className={cn('flex min-h-[4.25rem] flex-col items-start gap-0.5 rounded-md border p-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      !inMonth && 'border-dashed text-muted-foreground', weekend && 'bg-muted/40', d === day && 'border-primary ring-1 ring-primary', d === today && 'font-semibold', list.length > 0 && 'hover:bg-muted')}>
                    <span className="sr-only">{fmtDate(d)}{list.length ? '' : ', nothing due'}</span>
                    <span aria-hidden className={cn('tabular-nums', d.endsWith('-01') && inMonth && 'text-primary')}>{d.endsWith('-01') ? `1 ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}` : Number(d.slice(8))}</span>
                    {counts.reply > 0 && <span className="rounded bg-warning/25 px-1 text-[10px] text-foreground">{counts.reply} due</span>}
                    {counts.hearing > 0 && <span className="rounded bg-info/20 px-1 text-[10px] text-foreground">{counts.hearing} <abbr title="personal hearing" className="no-underline">PH</abbr></span>}
                    {counts.clock > 0 && <span className="rounded bg-destructive/15 px-1 text-[10px] text-foreground">{counts.clock} clock</span>}
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title={fmtDate(day)} description={items.length ? plural(items.length, 'item') : 'Nothing due this day'}
          actions={<div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => set({ date: addDays(day, -1), month: addDays(day, -1).slice(0, 7) })} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => set({ date: addDays(day, 1), month: addDays(day, 1).slice(0, 7) })} aria-label="Next day"><ChevronRight className="h-4 w-4" /></Button>
          </div>}>
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No reply, hearing or clock falls on this day.</p> : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={`${it.kind}-${it.notice_id ?? ''}-${it.detail ?? ''}-${it.reference ?? ''}`} className="flex items-start gap-2 py-2 text-sm">
                  <Badge variant={KIND_TONE[it.kind]} className="mt-0.5 shrink-0 text-[10px]">{CALENDAR_KIND_LABEL[it.kind]}</Badge>
                  <div className="min-w-0 flex-1">
                    <Link to={it.detail?.startsWith('matter:') ? `/litigation/${it.detail.slice(7)}?tab=hearings`
                      : `/notices/${it.notice_id}${it.kind === 'hearing' ? '?tab=hearings' : it.kind === 'reply' ? '' : '?tab=deadlines'}`} className="font-medium hover:underline">
                      {it.client_name}{it.form_code ? ` · ${it.form_code}` : ''}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">{it.title}{it.reference ? ` · ${it.reference}` : ''}{it.kind === 'reply' && it.detail === 'computed' ? ' · computed date' : ''}</div>
                  </div>
                  <StageBadge stage={it.stage} />
                  <OwnerChip name={it.owner} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </NoticesShell>
  );
};

export default NoticesCalendarPage;
