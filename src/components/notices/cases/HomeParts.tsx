// The Notices home (the firm's requests of 9 and 10 October 2026: short, but not
// "basic"): a card per kind of service, the kind's figures with what they mean,
// the work list with quick filters, and beside it the overdue cases by age, the
// next 14 days and what just came in from the portal.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, Archive, ArrowDownLeft, ArrowUpRight, Building2, CalendarClock, ChevronRight, Gavel, Inbox, IndianRupee,
  ReceiptIndianRupee, Scale, type LucideIcon,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Panel } from '@/components/notices/ui/Panel';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { hrefWithMaster, type Master } from '@/lib/masterFilters';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { caseHref, loadCases, TRACKS, type CaseRow, type CaseShow, type Track, type TrackCounts } from '@/lib/noticeCases';
import { fmtAgo, fmtDate, fmtDay, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const casesHref = (track: Track, show: string, m: Master) =>
  hrefWithMaster(`/notices-cases?${new URLSearchParams({ ...(track === 'litigation' ? {} : { kind: track }), ...(show ? { show } : {}) })}`, m);

const KIND_ICON: Record<Track, LucideIcon> = { litigation: Gavel, refund: ReceiptIndianRupee, registration: Building2, other: Archive };

// ── The four kinds, as cards ───────────────────────────────────────────────
export const KindCards: React.FC<{ value: Track; counts: Record<Track, TrackCounts> | undefined; onChange: (t: Track) => void }> = ({ value, counts, onChange }) => (
  <div role="tablist" aria-label="Kind of service" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
    {TRACKS.map((t) => {
      const c = counts?.[t.key];
      const Icon = KIND_ICON[t.key];
      const active = value === t.key;
      return (
        <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.key)}
          className={cn('group flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-all hover:border-primary/40 hover:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'border-primary bg-primary/[0.04] shadow-sm ring-1 ring-primary/30')}>
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/70')}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{t.label}</span>
            {c ? (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span><span className="font-semibold tabular-nums text-foreground">{t.key === 'other' ? c.cases : c.open}</span> {t.key === 'other' ? 'on record' : 'open'}</span>
                {c.new > 0 && <span className="font-medium text-info">{c.new} new</span>}
                {c.overdue > 0 && t.key !== 'other' && <span className="font-medium text-destructive-strong">{c.overdue} overdue</span>}
              </span>
            ) : <Skeleton className="mt-1 h-3 w-24" />}
          </span>
        </button>
      );
    })}
  </div>
);

// ── The kind's figures ─────────────────────────────────────────────────────
interface Kpi { label: string; value: string; sub: string; to: string; icon: LucideIcon; tone: 'primary' | 'info' | 'warning' | 'destructive' | 'neutral'; hot?: boolean }
const TONE: Record<Kpi['tone'], string> = {
  primary: 'bg-primary/10 text-primary', info: 'bg-info/15 text-info', warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive-strong', neutral: 'bg-muted text-foreground/70',
};

export const KpiCards: React.FC<{ track: Track; c: TrackCounts | undefined; master: Master }> = ({ track, c, master }) => {
  if (!c) return <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">{Array.from({ length: track === 'litigation' ? 5 : 4 }).map((_, i) => <Skeleton key={i} className="h-[88px]" />)}</div>;
  const kpis: Kpi[] = track === 'other' ? [
    { label: 'On record', value: String(c.cases), sub: 'LUT, payments, approvals', to: casesHref(track, 'all', master), icon: Archive, tone: 'neutral' },
    { label: 'New', value: String(c.new), sub: plural(c.new_items, 'item') + ' since last opened', to: casesHref(track, 'new', master), icon: Inbox, tone: 'info', hot: c.new > 0 },
  ] : [
    { label: 'Open cases', value: String(c.open), sub: `of ${c.cases}${c.unassigned ? ` · ${c.unassigned} unassigned` : ''}`, to: casesHref(track, '', master), icon: Scale, tone: 'primary' },
    { label: 'New from the portal', value: String(c.new), sub: c.new ? plural(c.new_items, 'item') + ' to look at' : 'nothing new', to: casesHref(track, 'new', master), icon: Inbox, tone: 'info', hot: c.new > 0 },
    { label: 'Due this week', value: String(c.due7), sub: c.next_due ? `next ${fmtDate(c.next_due)}` : 'nothing due ahead', to: casesHref(track, 'due7', master), icon: CalendarClock, tone: 'warning', hot: c.due7 > 0 },
    { label: 'Overdue', value: String(c.overdue), sub: c.oldest_overdue_days ? `oldest ${c.oldest_overdue_days > 365 ? `${Math.floor(c.oldest_overdue_days / 365)} y` : `${c.oldest_overdue_days} d`}` : 'none', to: casesHref(track, 'overdue', master), icon: AlarmClock, tone: 'destructive', hot: c.overdue > 0 },
    ...(track === 'litigation'
      ? [{ label: 'Open exposure', value: fmtInrShort(c.exposure), sub: c.in_appeal ? `${c.in_appeal} in appeal` : 'demand still open', to: casesHref(track, '', master), icon: IndianRupee, tone: 'neutral' } as Kpi]
      : []),
  ];
  return (
    <div className={cn('grid grid-cols-2 gap-2', kpis.length > 4 ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-4')}>
      {kpis.map((k) => (
        <Link key={k.label} to={k.to} className="group rounded-xl border bg-card p-3 transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-muted-foreground">{k.label}</span>
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', TONE[k.tone])}><k.icon className="h-4 w-4" aria-hidden /></span>
          </div>
          <div className={cn('mt-1 text-2xl font-bold tabular-nums leading-none', k.hot && k.tone === 'destructive' && 'text-destructive-strong', k.hot && k.tone === 'info' && 'text-info')}>{k.value}</div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">{k.sub}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </div>
        </Link>
      ))}
    </div>
  );
};

// ── The work list ──────────────────────────────────────────────────────────
function urgency(r: CaseRow): string {
  if (r.is_overdue) return 'bg-destructive';
  if (r.is_due_in_7) return 'bg-warning';
  if ((r.new_items ?? 0) > 0) return 'bg-info';
  return 'bg-border';
}

function DueText({ r }: { r: CaseRow }) {
  if (!r.is_open) return <span className="text-xs text-muted-foreground">closed</span>;
  if (r.stage === 'appeal') return <span className="text-xs font-medium text-info">in appeal</span>;
  if (!r.next_due) return <span className="text-xs text-muted-foreground">no date</span>;
  const days = r.today_ist ? Math.round((Date.parse(r.next_due) - Date.parse(r.today_ist)) / 86_400_000) : null;
  return (
    <span className={cn('text-xs tabular-nums', r.is_overdue ? 'font-semibold text-destructive-strong' : r.is_due_in_7 ? 'font-semibold text-warning' : 'text-foreground/80')}>
      {fmtDate(r.next_due)}
      {days !== null && <span className="block text-[10px] font-normal text-muted-foreground">{days < 0 ? `${-days} d late` : days === 0 ? 'today' : `in ${days} d`}</span>}
    </span>
  );
}

export const WorkList: React.FC<{ track: Track; master: Master; counts: TrackCounts | undefined; limit?: number }> = ({ track, master, counts, limit = 10 }) => {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const segs: { key: CaseShow; label: string; n: number | undefined }[] = track === 'other'
    ? [{ key: 'all', label: 'All', n: counts?.cases }, { key: 'new', label: 'New', n: counts?.new }]
    : [
        { key: 'overdue', label: 'Overdue', n: counts?.overdue },
        { key: 'due7', label: 'Due this week', n: counts?.due7 },
        { key: 'new', label: 'New', n: counts?.new },
        { key: 'open', label: 'All open', n: counts?.open },
      ];
  const [picked, setPicked] = useState<CaseShow | null>(null);
  const firstWithWork = segs.find((s) => (s.n ?? 0) > 0)?.key ?? segs[segs.length - 1].key;
  const show = picked && segs.some((s) => s.key === picked) ? picked : firstWithWork;
  const q = useQuery({
    queryKey: ['notice-cases', { track, show, q: '', master, meId }, 1, limit],
    queryFn: () => loadCases({ track, show, q: '', master, meId }, 1, limit),
    staleTime: 60_000,
  });
  const total = q.data?.total ?? 0;
  return (
    <Panel title="Work list" bodyClassName="px-0 pb-0"
      actions={total > limit && <Link to={casesHref(track, show === 'open' ? '' : show, master)} className="text-xs font-medium text-primary hover:underline">All {total} →</Link>}>
      <div className="flex flex-wrap gap-1 border-b px-3.5 pb-2">
        {segs.map((sg) => (
          <button key={sg.key} type="button" onClick={() => setPicked(sg.key)} aria-pressed={show === sg.key}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              show === sg.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            {sg.label}
            {sg.n !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', show === sg.key ? 'bg-primary-foreground/20' : 'bg-muted')}>{sg.n}</span>}
          </button>
        ))}
      </div>
      {q.error ? <div className="p-3"><LoadError what="the cases" error={q.error} onRetry={() => q.refetch()} /></div>
        : q.isLoading ? <div className="p-3"><Skeleton className="h-72 w-full" /></div>
        : !q.data?.rows.length ? <div className="p-3"><EmptyBox className="p-6">Nothing here.</EmptyBox></div>
        : (
          <ul className="divide-y">
            {q.data.rows.map((r) => (
              <li key={`${r.client_id}:${r.case_key}`}>
                <Link to={caseHref(r.client_id as string, r.case_key as string)}
                  className="group flex items-center gap-3 py-2.5 pl-0 pr-3.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className={cn('h-10 w-1 shrink-0 rounded-r', urgency(r))} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{r.client_name}</span>
                      {(r.new_items ?? 0) > 0 && <Badge variant="info" className="shrink-0 text-[10px]">{r.new_items} new</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.form_code ? <span className="font-medium text-foreground/80">{r.form_code}</span> : null}{r.form_code ? ' · ' : ''}{r.title}
                      {r.financial_year ? ` · FY ${r.financial_year}` : ''}{(r.notices ?? 0) > 1 ? ` · ${r.notices} notices` : ''}
                    </div>
                  </div>
                  {track !== 'other' && <span className="hidden shrink-0 md:block"><OwnerChip name={r.assign_to} /></span>}
                  {track === 'litigation' && r.is_open && <span className="hidden shrink-0 lg:block"><StageBadge stage={r.stage} /></span>}
                  {track === 'litigation' && (
                    <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-foreground/80 sm:block">{Number(r.exposure) > 0 ? fmtInrShort(r.exposure) : ''}</span>
                  )}
                  <span className="w-20 shrink-0 text-right">{track === 'other' ? <span className="text-xs text-muted-foreground">{fmtDate(r.latest_date)}</span> : <DueText r={r} />}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
};

// ── Overdue by age (one series: a bar per age band, labelled) ──────────────
export const OverdueByAge: React.FC<{ c: TrackCounts | undefined; track: Track; master: Master }> = ({ c, track, master }) => {
  if (!c || !c.overdue) return null;
  const bands = [
    { label: 'Up to 30 days', n: c.overdue_age.d30 },
    { label: '31 to 90 days', n: c.overdue_age.d90 },
    { label: '91 days to a year', n: c.overdue_age.d365 },
    { label: 'Over a year', n: c.overdue_age.older },
  ];
  const max = Math.max(1, ...bands.map((b) => b.n));
  return (
    <Panel title="Overdue by age" actions={<Link to={casesHref(track, 'overdue', master)} className="text-xs font-medium text-primary hover:underline">Open list →</Link>}>
      <ul className="space-y-2" aria-label="Overdue cases by how late they are">
        {bands.map((b) => (
          <li key={b.label} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-xs" title={`${b.label}: ${plural(b.n, 'case')}`}>
            <span className="text-muted-foreground">{b.label}</span>
            <span className="h-2 w-full rounded-full bg-muted">
              <span className="block h-2 rounded-full bg-destructive/80" style={{ width: `${(b.n / max) * 100}%`, minWidth: b.n ? 4 : 0 }} />
            </span>
            <span className="text-right font-semibold tabular-nums">{b.n}</span>
          </li>
        ))}
      </ul>
      {c.overdue_age.older > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Cases late by over a year are often already settled: close them in bulk from Notices.</p>}
    </Panel>
  );
};

// ── What came in from the portal ───────────────────────────────────────────
interface NewItem { client_id: string; case_key: string; kind: string; label: string; from_party: string; first_seen_at: string }

export const NewFromPortal: React.FC<{ track: Track; limit?: number }> = ({ track, limit = 6 }) => {
  const q = useQuery({
    queryKey: ['notice-new-items', track, limit],
    staleTime: 60_000,
    queryFn: async () => {
      const cases = await supabase.from('notice_cases').select('client_id, case_key, client_name').eq('track', track).gt('new_items', 0).limit(500);
      if (cases.error) throw cases.error;
      const names = new Map((cases.data ?? []).map((c) => [`${c.client_id}:${c.case_key}`, c.client_name as string]));
      if (!names.size) return [] as (NewItem & { client_name: string })[];
      const items = await supabase.from('notice_case_correspondence').select('client_id, case_key, kind, label, from_party, first_seen_at')
        .eq('is_new', true).in('client_id', [...new Set((cases.data ?? []).map((c) => c.client_id as string))])
        .order('first_seen_at', { ascending: false }).limit(200);
      if (items.error) throw items.error;
      return ((items.data ?? []) as NewItem[]).filter((i) => names.has(`${i.client_id}:${i.case_key}`)).slice(0, limit)
        .map((i) => ({ ...i, client_name: names.get(`${i.client_id}:${i.case_key}`) ?? '' }));
    },
  });
  return (
    <Panel title="New from the portal">
      {q.error ? <LoadError what="what came in" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-40 w-full" />
        : !q.data?.length ? <p className="text-xs text-muted-foreground">Nothing new since the cases were last opened.</p>
        : (
          <ul className="space-y-1">
            {q.data.map((i, k) => (
              <li key={k}>
                <Link to={caseHref(i.client_id, i.case_key)} className="flex items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted/50">
                  <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', i.from_party === 'department' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')}
                    title={i.from_party === 'department' ? 'From the department' : 'From us'}>
                    {i.from_party === 'department' ? <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden /> : <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{i.client_name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{i.label}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtAgo(i.first_seen_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
};

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
