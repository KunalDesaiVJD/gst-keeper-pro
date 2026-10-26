// Notices & Litigation · Calendar (audit U-11-*, U-25-*): the real month with
// reply dues, hearings and appeal / attachment clocks per day, weekends tinted,
// and the chosen day's list beneath it with ‹ › to move a day. The 14-day strip
// on the command centre opens here; a day's count there is this list's length
// (both read public.notice_calendar). Opened from the strip (dash=1) it shows
// only the notice types on the dashboard, as the strip counts them (contract
// §A), with a chip that removes the filter. Since the UX audit of 25 October
// 2026 it also shows the dates the law attaches to each open case (time to
// appeal, pre-deposit, pay to close: notice_case_key_dates_range), and an
// Agenda view (?view=agenda) lists the next 60 days by day; the old Hearings
// page lands there.
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
import { CALENDAR_KIND_LABEL, loadCalendar, loadCaseDates, type CalendarItem, type CaseDateItem } from '@/lib/noticeCommandCentre';
import { addDays, istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { useMaster } from '@/lib/masterFilters';
import { inScope, useMasterScope } from '@/lib/masterScope';
import { cn } from '@/lib/utils';
import { caseHref, noticeCaseHref } from '@/lib/noticeCases';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_TONE: Record<CalendarItem['kind'], 'warning' | 'info' | 'destructive' | 'secondary'> = {
  reply: 'warning', hearing: 'info', appeal: 'destructive', attachment: 'secondary',
};

/** One line on the calendar: a notice's date (notice_calendar) or a case's key date. */
interface Entry {
  key: string; day: string; group: 'reply' | 'hearing' | 'clock' | 'case';
  badge: string; tone: 'warning' | 'info' | 'destructive' | 'secondary' | 'outline';
  href: string; head: string; sub: string; stage?: string; owner?: string | null;
}
const GROUP_LABEL: Record<Entry['group'], string> = { reply: 'reply due', hearing: 'hearing', clock: 'clock', case: 'case date' };
const CASE_DATE_LABEL: Record<string, string> = {
  appeal_window: 'Time to appeal', predeposit: 'Pre-deposit', pay_to_close: 'Pay to close', payment_due: 'Payment due',
  adjournment: 'Adjourned to', appeal_filed: 'Appeal filed',
  limitation: 'Limitation', withdrawal: 'Deemed withdrawal', revocation: 'Revocation', rectification: 'Rectification', order_check: 'Order check',
};

function fromCalendar(it: CalendarItem): Entry {
  return {
    key: `${it.kind}-${it.notice_id ?? ''}-${it.detail ?? ''}-${it.reference ?? ''}`, day: it.day,
    group: it.kind === 'reply' ? 'reply' : it.kind === 'hearing' ? 'hearing' : 'clock',
    badge: CALENDAR_KIND_LABEL[it.kind], tone: KIND_TONE[it.kind],
    href: it.detail?.startsWith('matter:') ? `/litigation/${it.detail.slice(7)}?tab=hearings` : noticeCaseHref({ id: it.notice_id as string }),
    head: `${it.client_name}${it.form_code ? ` · ${it.form_code}` : ''}`,
    sub: `${it.title ?? ''}${it.reference ? ` · ${it.reference}` : ''}${it.kind === 'reply' && it.detail === 'computed' ? ' · computed date' : ''}`,
    stage: it.stage, owner: it.owner,
  };
}

function fromCase(k: CaseDateItem): Entry {
  return {
    key: `case-${k.client_id}-${k.case_key}-${k.kind}-${k.item_id ?? ''}-${k.day}`, day: k.day, group: 'case',
    badge: CASE_DATE_LABEL[k.kind] ?? 'Case date', tone: k.tone === 'danger' ? 'destructive' : 'outline',
    href: caseHref(k.client_id, k.case_key),
    head: `${k.client_name ?? 'Client'}${k.case_key === 'REG' ? ' · Registration' : ` · ${k.case_key}`}`,
    sub: `${k.title ?? ''}${k.law ? ` (${k.law})` : ''}`,
  };
}

/** Both sources as one list; a case's appeal date on a day the matter's appeal clock already shows is left out. */
function merge(cal: CalendarItem[], cases: CaseDateItem[]): Entry[] {
  const clocks = new Set(cal.filter((it) => it.kind === 'appeal').map((it) => `${it.client_id}:${it.day}`));
  return [...cal.map(fromCalendar), ...cases.filter((k) => !(k.kind === 'appeal_window' && clocks.has(`${k.client_id}:${k.day}`))).map(fromCase)];
}

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
  const agenda = sp.get('view') === 'agenda';
  const [from, to] = agenda ? [today, addDays(today, 60)] : [grid[0], grid[41]];
  const q = useQuery({
    queryKey: ['notice-calendar', from, to, dashOnly],
    queryFn: () => loadCalendar(from, to, { dashboardOnly: dashOnly }),
  });
  // Case dates have no notice type, so the dashboard-only view leaves them out.
  const cd = useQuery({ queryKey: ['notice-case-dates', from, to], queryFn: () => loadCaseDates(from, to), enabled: !dashOnly });

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  // The master filters keep an item when its notice is kept (a matter's item, by its client).
  const cal = (q.data ?? []).filter((it) => (it.notice_id ? inScope(scope, it) : !master.client || it.client_id === master.client));
  const caseDates = (dashOnly ? [] : cd.data ?? []).filter((k) => !master.client || k.client_id === master.client);
  const all = merge(cal, caseDates).sort((a, b) => a.day.localeCompare(b.day) || a.group.localeCompare(b.group));
  const byDay = new Map<string, Entry[]>();
  all.forEach((it) => byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]));
  const set = (patch: { date?: string; month?: string; view?: string | null }) => {
    const next = new URLSearchParams(sp);
    if (patch.date) next.set('date', patch.date);
    if (patch.month) next.set('month', patch.month);
    if (patch.view !== undefined) { if (patch.view) next.set('view', patch.view); else next.delete('view'); }
    setSp(next, { replace: true });
  };
  const shiftMonth = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    set({ month: d.toISOString().slice(0, 7) });
  };
  const items = byDay.get(day) ?? [];
  const monthItems = all.filter((it) => it.day.startsWith(monthKey));
  const monthGroups = (['reply', 'hearing', 'clock', 'case'] as const).filter((g) => monthItems.some((it) => it.group === g));
  const icsItems = agenda ? all : monthItems;
  const icsName = agenda ? 'the next 60 days' : `${MONTHS[m - 1]} ${y}`;
  const entryRow = (it: Entry) => (
    <li key={it.key} className="flex items-start gap-2 py-2 text-sm">
      <Badge variant={it.tone} className="mt-0.5 shrink-0 text-[10px]">{it.badge}</Badge>
      <div className="min-w-0 flex-1">
        <Link to={it.href} className="font-medium hover:underline">{it.head}</Link>
        <div className="truncate text-xs text-muted-foreground" title={it.sub}>{it.sub}</div>
      </div>
      {it.stage && <StageBadge stage={it.stage} />}
      {it.owner !== undefined && <OwnerChip name={it.owner} />}
    </li>
  );
  const viewToggle = (
    <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="Month or agenda">
      {([['month', 'Month'], ['agenda', 'Agenda']] as const).map(([k, label]) => (
        <button key={k} type="button" aria-pressed={(k === 'agenda') === agenda} onClick={() => set({ view: k === 'agenda' ? 'agenda' : null })}
          className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors', (k === 'agenda') === agenda ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {label}
        </button>
      ))}
    </div>
  );
  const dropDash = () => {
    const next = new URLSearchParams(sp);
    next.delete('dash');
    setSp(next, { replace: true });
  };

  return (
    <NoticesShell section="Calendar" master
      actions={<>
        {viewToggle}
        {icsItems.length > 0 && (
          <Button size="sm" variant="outline" className={WS_BTN} onClick={() => downloadIcs(icsItems.map((it) => ({
            uid: `${it.key}-${it.day}`, date: it.day, title: `${it.badge} — ${it.head}`,
            description: [it.sub, it.owner ? `Owner: ${it.owner}` : ''].filter(Boolean).join('\n'),
          })), agenda ? `notices-agenda-${today}` : `notices-${monthKey}`, `GST Keeper ${icsName}`)}>
            <CalendarPlus className="h-3.5 w-3.5" /> {agenda ? 'Agenda' : MONTHS[m - 1]} to calendar (.ics)
          </Button>
        )}
      </>}>
      {dashOnly && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <button type="button" onClick={dropDash} aria-label="Remove filter Dashboard notice types only"
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Dashboard notice types only <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
      {agenda ? (
        <SectionCard title="The next 60 days" description={all.length ? `${plural(all.length, 'date')} from today` : 'Nothing due'}>
          {q.isLoading || cd.isLoading ? <Skeleton className="h-64 w-full" /> : q.error || cd.error ? <Note tone="warn">Couldn't load the agenda.</Note>
            : all.length === 0 ? <p className="text-sm text-muted-foreground">No reply, hearing, clock or case date in the next 60 days.</p> : (
            <div className="space-y-3">
              {[...byDay.entries()].map(([d, list]) => (
                <section key={d} aria-label={fmtDate(d)} className="grid gap-x-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <h3 className={cn('pt-2 text-xs font-semibold', d === today ? 'text-primary' : 'text-muted-foreground')}>
                    {d === today ? 'Today' : fmtDate(d)}
                  </h3>
                  <ul className="divide-y border-b">{list.map(entryRow)}</ul>
                </section>
              ))}
            </div>
          )}
        </SectionCard>
      ) : (
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionCard title={`${MONTHS[m - 1]} ${y}`} description={monthGroups.length ? monthGroups.map((g) => `${monthItems.filter((it) => it.group === g).length} ${GROUP_LABEL[g]}`).join(' · ') : 'Nothing due this month'}
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
                const counts = { reply: 0, hearing: 0, clock: 0, case: 0 };
                list.forEach((it) => { counts[it.group]++; });
                return (
                  <button key={d} type="button" aria-pressed={d === day} aria-current={d === today ? 'date' : undefined} onClick={() => set({ date: d })}
                    className={cn('flex min-h-[4.25rem] flex-col items-start gap-0.5 rounded-md border p-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      !inMonth && 'border-dashed text-muted-foreground', weekend && 'bg-muted/40', d === day && 'border-primary ring-1 ring-primary', d === today && 'font-semibold', list.length > 0 && 'hover:bg-muted')}>
                    <span className="sr-only">{fmtDate(d)}{list.length ? '' : ', nothing due'}</span>
                    <span aria-hidden className={cn('tabular-nums', d.endsWith('-01') && inMonth && 'text-primary')}>{d.endsWith('-01') ? `1 ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}` : Number(d.slice(8))}</span>
                    {counts.reply > 0 && <span className="rounded bg-warning/25 px-1 text-[10px] text-foreground">{counts.reply} due</span>}
                    {counts.hearing > 0 && <span className="rounded bg-info/20 px-1 text-[10px] text-foreground">{counts.hearing} <abbr title="personal hearing" className="no-underline">PH</abbr></span>}
                    {counts.clock > 0 && <span className="rounded bg-destructive/15 px-1 text-[10px] text-foreground">{counts.clock} clock</span>}
                    {counts.case > 0 && <span className="rounded border px-1 text-[10px] text-foreground">{counts.case} case</span>}
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
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No reply, hearing, clock or case date falls on this day.</p> : (
            <ul className="divide-y">{items.map(entryRow)}</ul>
          )}
        </SectionCard>
      </div>
      )}
    </NoticesShell>
  );
};

export default NoticesCalendarPage;
