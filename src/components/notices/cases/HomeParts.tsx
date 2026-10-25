// Home's side panels (the UX audit of 25 October 2026): overdue cases by age,
// what is coming, and what just came in from the portal. Each opens the list it
// counts, with the master filters.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Panel } from '@/components/notices/ui/Panel';
import { LoadError } from '@/components/notices/autopilot/parts';
import { supabase } from '@/integrations/supabase/client';
import { hrefWithMaster, type Master } from '@/lib/masterFilters';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { caseHref, type Track, type TrackCounts } from '@/lib/noticeCases';
import { fmtAgo, fmtDay, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

// Cases opens on every kind the firm acts on ('work'); a kind is named in the link.
const casesHref = (track: Track | 'work', show: string, m: Master) =>
  hrefWithMaster(`/notices-cases?${new URLSearchParams({ ...(track === 'work' ? {} : { kind: track }), ...(show ? { show } : {}) })}`, m);

// ── Overdue by age (one series: a bar per age band, labelled) ──────────────
export const OverdueByAge: React.FC<{ c: TrackCounts | undefined; track: Track | 'work'; master: Master }> = ({ c, track, master }) => {
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

/** What came in: track 'work' is every kind the firm acts on; days limits it to what arrived lately. */
export const NewFromPortal: React.FC<{ track: Track | 'work'; limit?: number; days?: number; title?: string }> = ({ track, limit = 6, days, title = 'New from the portal' }) => {
  const q = useQuery({
    queryKey: ['notice-new-items', track, limit, days],
    staleTime: 60_000,
    queryFn: async () => {
      let cq = supabase.from('notice_cases').select('client_id, case_key, client_name').gt('new_items', 0);
      cq = track === 'work' ? cq.neq('track', 'other') : cq.eq('track', track);
      const cases = await cq.limit(500);
      if (cases.error) throw cases.error;
      const names = new Map((cases.data ?? []).map((c) => [`${c.client_id}:${c.case_key}`, c.client_name as string]));
      if (!names.size) return [] as (NewItem & { client_name: string })[];
      let iq = supabase.from('notice_case_correspondence').select('client_id, case_key, kind, label, from_party, first_seen_at')
        .eq('is_new', true).in('client_id', [...new Set((cases.data ?? []).map((c) => c.client_id as string))]);
      if (days) iq = iq.gte('first_seen_at', new Date(Date.now() - days * 86_400_000).toISOString());
      const items = await iq.order('first_seen_at', { ascending: false }).limit(200);
      if (items.error) throw items.error;
      return ((items.data ?? []) as NewItem[]).filter((i) => names.has(`${i.client_id}:${i.case_key}`)).slice(0, limit)
        .map((i) => ({ ...i, client_name: names.get(`${i.client_id}:${i.case_key}`) ?? '' }));
    },
  });
  return (
    <Panel title={title}>
      {q.error ? <LoadError what="what came in" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-40 w-full" />
        : !q.data?.length ? <p className="text-xs text-muted-foreground">{days ? `Nothing new in the last ${days} days.` : 'Nothing new since the cases were last opened.'}</p>
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
