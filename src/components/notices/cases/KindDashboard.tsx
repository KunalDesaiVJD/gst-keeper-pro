// The dashboard of a kind other than notices and demands (refunds,
// registration, other): its own figures and its cases, nothing about demands,
// evidence or hearings.
import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { CasesPanel } from './CasesPanel';
import { hrefWithMaster, type Master } from '@/lib/masterFilters';
import { type Track, type TrackCounts } from '@/lib/noticeCases';
import { fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const Tile: React.FC<{ label: string; value: number; sub: string; to: string; tone?: 'bad' | 'info' }> = ({ label, value, sub, to, tone }) => (
  <Link to={to} className="group rounded-lg border bg-card px-3 py-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    <div className={cn('text-xl font-semibold tabular-nums', value > 0 && tone === 'bad' && 'text-destructive-strong', value > 0 && tone === 'info' && 'text-info')}>{value}</div>
    <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
  </Link>
);

/** A kind's figures; each opens its cases. */
export const KindTiles: React.FC<{ track: Track; counts: TrackCounts | undefined; master: Master }> = ({ track, counts, master }) => {
  const href = (show: string) => hrefWithMaster(`/notices-cases?${track === 'litigation' ? '' : `kind=${track}&`}${show ? `show=${show}` : ''}`, master);
  if (!counts) return <Skeleton className="h-[74px] w-full" />;
  if (track === 'other') {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="On record" value={counts.cases} sub="LUT, payments, approvals" to={href('all')} />
        <Tile label="New" value={counts.new} sub={`${counts.new_items} items since last opened`} to={href('new')} tone="info" />
      </div>
    );
  }
  return (
    <div className={cn('grid grid-cols-2 gap-2', track === 'litigation' ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-4')}>
      <Tile label="Open cases" value={counts.open} sub={`of ${counts.cases} in all`} to={href('')} />
      <Tile label="New correspondence" value={counts.new} sub={`${counts.new_items} items from the portal`} to={href('new')} tone="info" />
      <Tile label="Due in 7 days" value={counts.due7} sub="a reply or a step is due" to={href('')} />
      <Tile label="Overdue" value={counts.overdue} sub="past the due date" to={href('')} tone="bad" />
      {track === 'litigation' && <Tile label="Hearings ahead" value={counts.hearings} sub="cases with a hearing fixed" to="/notices-hearings" />}
      {track === 'litigation' && (
        <Link to={href('')} className="rounded-lg border bg-card px-3 py-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="text-[11px] font-medium text-muted-foreground">Open exposure</div>
          <div className="text-xl font-semibold tabular-nums">{fmtInrShort(counts.exposure)}</div>
          <div className="truncate text-[11px] text-muted-foreground">{counts.unassigned ? `${counts.unassigned} cases unassigned` : 'every open case has an owner'}</div>
        </Link>
      )}
    </div>
  );
};

export const KindDashboard: React.FC<{ track: Track; counts: TrackCounts | undefined; master: Master }> = ({ track, counts, master }) => {
  return (
    <div className="space-y-3">
      <KindTiles track={track} counts={counts} master={master} />
      {track === 'other'
        ? <CasesPanel track={track} master={master} show="all" limit={15} title="Latest on record" />
        : (
          <CasesPanel track={track} master={master} limit={20} />
        )}
    </div>
  );
};

export default KindDashboard;
