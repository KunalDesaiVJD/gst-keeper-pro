// The Notices home (redesigned 9 October 2026, the firm's request: "very poor home
// page"): one slim strip of figures, the cases needing attention as a short list,
// and beside it what just came in from the portal and the next 14 days.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Panel } from '@/components/notices/ui/Panel';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { hrefWithMaster, type Master } from '@/lib/masterFilters';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { caseHref, loadCases, type Track, type TrackCounts } from '@/lib/noticeCases';
import { fmtAgo, fmtDate, fmtDay, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const casesHref = (track: Track, show: string, m: Master) =>
  hrefWithMaster(`/notices-cases?${new URLSearchParams({ ...(track === 'litigation' ? {} : { kind: track }), ...(show ? { show } : {}) })}`, m);

/** The kind's figures in one strip; each opens its cases. */
export const StatStrip: React.FC<{ track: Track; c: TrackCounts | undefined; master: Master }> = ({ track, c, master }) => {
  if (!c) return <Skeleton className="h-14 w-full" />;
  const items: { label: string; value: string; to: string; tone?: 'bad' | 'info' }[] = track === 'other'
    ? [{ label: 'On record', value: String(c.cases), to: casesHref(track, 'all', master) },
       { label: 'New', value: String(c.new), to: casesHref(track, 'new', master), tone: 'info' }]
    : [
        { label: 'Open', value: String(c.open), to: casesHref(track, '', master) },
        { label: 'New', value: String(c.new), to: casesHref(track, 'new', master), tone: 'info' },
        { label: 'Due this week', value: String(c.due7), to: casesHref(track, '', master) },
        { label: 'Overdue', value: String(c.overdue), to: casesHref(track, '', master), tone: 'bad' },
        ...(track === 'litigation' ? [{ label: 'Exposure', value: fmtInrShort(c.exposure), to: casesHref(track, '', master) }] : []),
      ];
  return (
    <div className="flex flex-wrap divide-x rounded-lg border bg-card">
      {items.map((i) => (
        <Link key={i.label} to={i.to} className="min-w-[7rem] flex-1 px-4 py-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="text-[11px] font-medium text-muted-foreground">{i.label}</div>
          <div className={cn('text-lg font-semibold tabular-nums', Number(i.value) > 0 && i.tone === 'bad' && 'text-destructive-strong',
            Number(i.value) > 0 && i.tone === 'info' && 'text-info')}>{i.value}</div>
        </Link>
      ))}
    </div>
  );
};

/** The cases needing attention: client, case, and what is due — one line each. */
export const AttentionList: React.FC<{ track: Track; master: Master; limit?: number }> = ({ track, master, limit = 12 }) => {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const show = track === 'other' ? 'all' : 'open';
  const q = useQuery({
    queryKey: ['notice-cases', { track, show, q: '', master, meId }, 1, limit],
    queryFn: () => loadCases({ track, show, q: '', master, meId }, 1, limit),
    staleTime: 60_000,
  });
  const total = q.data?.total ?? 0;
  return (
    <Panel title={track === 'other' ? 'Latest on record' : 'Needs attention'}
      actions={total > limit && <Link to={casesHref(track, track === 'other' ? 'all' : '', master)} className="text-xs font-medium text-primary hover:underline">All {total} →</Link>}>
      {q.error ? <LoadError what="the cases" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-72 w-full" />
        : !q.data?.rows.length ? <EmptyBox className="p-4">Nothing needs attention.</EmptyBox>
        : (
          <ul className="divide-y">
            {q.data.rows.map((r) => (
              <li key={`${r.client_id}:${r.case_key}`}>
                <Link to={caseHref(r.client_id as string, r.case_key as string)} className="flex items-center gap-3 px-1 py-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.client_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.form_code ? `${r.form_code} · ` : ''}{r.title}{r.financial_year ? ` · FY ${r.financial_year}` : ''}</div>
                  </div>
                  {r.new_items ? <Badge variant="info" className="shrink-0 text-[10px]">{r.new_items} new</Badge> : null}
                  {track === 'litigation' && Number(r.exposure) > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtInrShort(r.exposure)}</span>}
                  {r.is_open && r.next_due ? (
                    <span className={cn('w-24 shrink-0 text-right text-xs tabular-nums', r.is_overdue ? 'font-semibold text-destructive-strong' : r.is_due_in_7 ? 'font-semibold text-warning' : 'text-muted-foreground')}>
                      {r.is_overdue ? 'overdue' : `due ${fmtDate(r.next_due)}`}
                    </span>
                  ) : <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{r.stage === 'appeal' ? 'in appeal' : ''}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
};

interface NewItem { client_id: string; case_key: string; kind: string; label: string; from_party: string; first_seen_at: string }

/** What came in from the portal since the cases were last opened, newest first. */
export const NewFromPortal: React.FC<{ track: Track; limit?: number }> = ({ track, limit = 8 }) => {
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
          <ul className="space-y-2">
            {q.data.map((i, k) => (
              <li key={k}>
                <Link to={caseHref(i.client_id, i.case_key)} className="flex gap-2 rounded px-1 py-0.5 hover:bg-muted/40">
                  {i.from_party === 'department'
                    ? <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label="From the department" />
                    : <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-label="From us" />}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{i.client_name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{i.label} · {fmtAgo(i.first_seen_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
};

/** The next 14 days as a short list of the days with something on them. */
export const Upcoming: React.FC<{ cc: CommandCentre | undefined; master: Master }> = ({ cc, master }) => {
  const days = (cc?.next14 ?? []).filter((d) => d.total > 0);
  return (
    <Panel title="Next 14 days" actions={<Link to={hrefWithMaster('/notices-calendar', master)} className="text-xs font-medium text-primary hover:underline">Calendar →</Link>}>
      {!cc ? <Skeleton className="h-24 w-full" /> : !days.length ? <p className="text-xs text-muted-foreground">Nothing due.</p> : (
        <ul className="space-y-1">
          {days.map((d) => (
            <li key={d.date}>
              <Link to={hrefWithMaster(`/notices-calendar?date=${d.date}&dash=1`, master)} className="flex items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-muted/40">
                <span className="font-medium">{fmtDay(d.date)}</span>
                <span className="text-muted-foreground">
                  {[d.reply && plural(d.reply, 'reply due', 'replies due'), d.hearing && plural(d.hearing, 'hearing'), d.clock && plural(d.clock, 'appeal clock')].filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
