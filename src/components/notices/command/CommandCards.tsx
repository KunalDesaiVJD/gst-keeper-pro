// The command centre's cards (roadmap Phase 2 task 2; rebalanced 7 October 2026:
// one panel per question, panels side by side end level, explanations behind (i)).
// Every number links to the list it counts, with the same filter, so the two
// always agree (supabase/tests/notices/test_95_command_centre.sql); links keep
// the master filters (lib/masterFilters). The dashboard counts only the notice
// types shown on it (contract §A), so each list link carries dash=1 (dashListHref).
import { ProblemLine } from '@/components/notices/ui/ProblemLine';
import { reasonLabel } from '@/lib/autopilot';
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { dashListHref as dashHref, noticesListHref } from '@/lib/noticeQueries';
import { fmtAgo, fmtDay, fmtInrShort, plural } from '@/lib/noticeFormat';
import { useMasterHref } from '@/lib/masterFilters';
import { useAutopilotBadge } from '@/lib/autopilot';
import { Panel } from '@/components/notices/ui/Panel';
import { cn } from '@/lib/utils';

// ── KPI tiles ──────────────────────────────────────────────────────────────
type Accent = 'destructive' | 'warning' | 'info' | 'primary' | 'success' | 'muted';
const ACCENT: Record<Accent, string> = {
  destructive: 'border-l-destructive',
  warning: 'border-l-warning',
  info: 'border-l-info',
  primary: 'border-l-primary',
  success: 'border-l-success',
  muted: 'border-l-muted-foreground/40',
};

/** A KPI tile that is a saved filter: the whole tile is a link to its list (U-01-2). */
export const TileLink: React.FC<{
  to: string; label: string; value: React.ReactNode; hint?: React.ReactNode; accent: Accent; strong?: boolean;
}> = ({ to, label, value, hint, accent, strong }) => (
  <Link to={to}
    className={cn('group block rounded-lg border border-l-4 bg-card px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', ACCENT[accent])}>
    <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span className="truncate">{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
    </div>
    <div className={cn('text-2xl font-semibold leading-tight tabular-nums', strong && 'text-destructive-strong')}>{value}</div>
    {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
  </Link>
);

export const CommandTiles: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const t = cc.tiles;
  const mh = useMasterHref();
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <TileLink to={mh(dashHref({ filter: 'overdue' }))} label="Overdue & still open" accent="destructive" strong={t.overdue.count > 0}
        value={t.overdue.count.toLocaleString('en-IN')}
        hint={t.overdue.count ? `${fmtInrShort(t.overdue.amount)} at risk · oldest ${t.overdue.oldest_days ?? 0} d` : 'nothing overdue'} />
      <TileLink to={mh(dashHref({ filter: 'due7' }))} label="Due in next 7 days" accent="warning"
        value={t.due7.count.toLocaleString('en-IN')}
        hint={t.due7.next_date ? `next ${fmtDay(t.due7.next_date)} · ${t.due7.next_client}` : `${plural(t.due7.hearings, 'hearing')} · ${plural(t.due7.clocks, 'appeal clock')}`} />
      <TileLink to={mh(dashHref({ filter: 'new' }))} label="New in last 24 h" accent="info"
        value={t.new.count.toLocaleString('en-IN')}
        hint={t.new.count ? `${t.new.with_demand} with demand · ${t.new.unassigned} unassigned` : 'none since yesterday'} />
      <TileLink to={mh(dashHref({ filter: 'unassigned' }))} label="Without an owner" accent="primary"
        value={t.unassigned.toLocaleString('en-IN')} hint={`of ${t.open.toLocaleString('en-IN')} open`} />
      <TileLink to={mh(dashHref({ filter: 'open', stage: 'partner_review' }))} label="In partner review" accent="warning"
        value={t.review.count.toLocaleString('en-IN')}
        hint={t.review.approved ? `${t.review.approved} approved, ready to file` : `${t.waiting_client} waiting on clients`} />
      <TileLink to={mh(dashHref({ filter: 'exposure' }))} label="Exposure under dispute" accent="muted"
        value={fmtInrShort(t.exposure.total)}
        hint={`${plural(t.exposure.notices, 'notice')}${t.exposure.matters ? ` · ${plural(t.exposure.matters, 'matter')}` : ''}`} />
    </div>
  );
};

// ── Status line under the header (U-01-4: one health state, never "always green") ─
export function healthState(cc: CommandCentre): { tone: 'ok' | 'warn' | 'error'; failing: number } {
  const failing = Object.values(cc.health.failing).reduce((a, b) => a + b, 0);
  const share = cc.health.eligible ? cc.health.fresh / cc.health.eligible : 1;
  const tone = share >= 0.9 && failing === 0 ? 'ok' : share >= 0.5 ? 'warn' : 'error';
  return { tone, failing };
}

const QUIET_LINK = 'underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';

/**
 * Sync health in one line (the full picture is on the Autopilot and Clients
 * pages), and what the dashboard leaves out: notices of the types taken off it
 * (contract §A), which open as their own list (dash=0).
 */
/** Under the command centre's title: only a problem (syncs failing, the last run failed); nothing on a normal day. */
const SHORT_REASON: Record<string, string> = {
  agent_offline: 'Chrome offline', login_failed: 'login failed', captcha_failed: 'CAPTCHA', captcha_timeout: 'CAPTCHA not typed',
  not_reached: 'not reached', portal_error: 'portal error', stalled: 'stalled', session_mismatch: 'wrong GSTIN',
};

/** Under the home page's title: one short line, only when clients are not synced or the last run failed. */
export const AutopilotLine: React.FC<{ cc: CommandCentre; onOpenTypes?: () => void }> = ({ cc }) => {
  const run = cc.health.last_run;
  const reasons = Object.entries(cc.health.failing).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = reasons.reduce((s, [, n]) => s + n, 0);
  return (
    <ProblemLine problems={[
      total > 0 && {
        key: 'failing',
        text: `${plural(total, 'client')} not synced (${reasons.map(([r, n]) => `${n} ${SHORT_REASON[r] ?? reasonLabel(r).toLowerCase()}`).join(' · ')})`,
        to: '/notices-company-list?status=failed',
      },
      run && run.status === 'failed' && { key: 'run', text: `Last sync run failed ${fmtAgo(run.started_at)}`, to: '/notices-company-list?tab=log' },
    ]} />
  );
};

// ── By stage: where open work sits, how long, and the money in it ──────────
export const StagePanel: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const mh = useMasterHref();
  const money = new Map(cc.exposure_by_stage.map((e) => [e.stage, e]));
  const keep = new Set(['new', 'triaged', 'draft', 'partner_review', 'filed']);
  const rows = cc.pipeline
    .filter((p) => p.count > 0 || keep.has(p.stage) || money.has(p.stage))
    .map((p) => ({ ...p, money: money.get(p.stage) }));
  // Matters' stages with money but no open notice (an appeal, say) close the list.
  cc.exposure_by_stage.forEach((e) => {
    if (!rows.some((r) => r.stage === e.stage)) rows.push({ stage: e.stage, label: e.label, count: 0, median_days: null, money: e });
  });
  const max = Math.max(1, ...rows.map((r) => r.count));
  const open = rows.reduce((s, r) => s + r.count, 0);
  const r = cc.replies;
  return (
    <Panel title="By stage"
      info="Open notices in each stage, the median days they have been there, and the demand under dispute: notices' demand (each dispute once) plus open matters' outstanding."
      actions={<Badge variant="secondary" className="text-[11px]">{open.toLocaleString('en-IN')} open · {fmtInrShort(cc.tiles.exposure.total)}</Badge>}>
      <div className="flex h-full flex-col justify-between gap-2">
        <ul className="space-y-0.5">
          {rows.map((p) => (
            <li key={p.stage} className="grid grid-cols-[minmax(6.5rem,1fr)_minmax(3rem,5rem)_2rem_2.5rem_4.5rem] items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/40">
              <Link to={mh(dashHref({ filter: 'open', stage: p.stage }))} className="truncate hover:underline">{p.label}</Link>
              <span className="h-1.5 rounded-full bg-muted" aria-hidden>
                <span className="block h-1.5 rounded-full bg-primary/70" style={{ width: `${(p.count / max) * 100}%` }} />
              </span>
              <Link to={mh(dashHref({ filter: 'open', stage: p.stage }))} className="text-right font-semibold tabular-nums hover:underline">{p.count.toLocaleString('en-IN')}</Link>
              <span className={cn('text-right tabular-nums text-muted-foreground', (p.median_days ?? 0) > 14 && 'text-destructive-strong')} title="Median days in this stage">
                {p.median_days !== null && p.median_days !== undefined ? `${p.median_days} d` : ''}
              </span>
              <span className="text-right tabular-nums">
                {p.money && p.money.total > 0
                  ? <Link to={p.money.notices > 0 ? mh(dashHref({ filter: 'exposure', stage: p.stage })) : mh(`/litigation?stage=${p.stage}`)} className="hover:underline" title={p.money.matters > 0 ? `${fmtInrShort(p.money.notices)} notices + ${fmtInrShort(p.money.matters)} matters` : undefined}>{fmtInrShort(p.money.total)}</Link>
                  : <span className="text-muted-foreground">—</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          {r.median_days_this_month !== null ? <>Issue to reply this month: <b className="text-foreground">{r.median_days_this_month} d</b> median{r.median_days_last_month !== null ? ` (last month ${r.median_days_last_month} d)` : ''}</> : 'No replies logged this month yet'}
        </p>
      </div>
    </Panel>
  );
};

// ── Next 14 days ───────────────────────────────────────────────────────────
export const Next14Days: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const mh = useMasterHref();
  return (
    <Panel title="Next 14 days" info="Reply due dates, personal hearings (PH) and appeal or attachment clocks. Click a day for its list."
      actions={<Link to={mh('/notices-calendar')} className="text-xs font-medium text-primary hover:underline">Calendar →</Link>}>
      <div className="grid grid-cols-7 gap-1.5">
        {cc.next14.map((d, i) => {
          const [y, m, dd] = d.date.split('-').map(Number);
          const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
          const cell = (
            <>
              <span className="sr-only">{fmtDay(d.date)}:{d.total ? '' : ' nothing due'}</span>
              <span aria-hidden className="text-[10px] uppercase text-muted-foreground">{fmtDay(d.date).split(' ')[0]}</span>
              <span aria-hidden className="text-base font-semibold leading-none">{dd}</span>
              <span className="flex min-h-[1rem] flex-wrap justify-center gap-0.5">
                {d.reply > 0 && <span className="rounded bg-warning/25 px-1 text-[10px] font-medium">{d.reply} due</span>}
                {d.hearing > 0 && <span className="rounded bg-info/20 px-1 text-[10px] font-medium">{d.hearing} <abbr title="personal hearing" className="no-underline">PH</abbr></span>}
                {d.clock > 0 && <span className="rounded bg-destructive/15 px-1 text-[10px] font-medium">{d.clock} appeal</span>}
              </span>
            </>
          );
          const cls = cn('flex flex-col items-center gap-1 rounded-md border px-0.5 py-1.5 text-center',
            i === 0 && 'border-primary ring-1 ring-primary', (wd === 0 || wd === 6) && 'bg-muted/40');
          return d.total > 0 ? (
            <Link key={d.date} to={mh(`/notices-calendar?date=${d.date}&dash=1`)}
              className={cn(cls, 'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{cell}</Link>
          ) : (
            <div key={d.date} className={cls}>{cell}</div>
          );
        })}
      </div>
    </Panel>
  );
};

// ── Clients needing attention ──────────────────────────────────────────────
export const ClientsAttention: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const mh = useMasterHref();
  return (
    <Panel title="Clients needing attention" info="Most overdue first · open · overdue · exposure"
      actions={<Link to={mh('/notices-gstin-wise-count')} className="text-xs font-medium text-primary hover:underline">All clients →</Link>}>
      {cc.clients.length === 0 ? <p className="text-xs text-muted-foreground">No client has an open notice.</p> : (
        <ul className="divide-y">
          {cc.clients.map((c) => (
            <li key={c.client_id} className="flex items-center gap-2 py-1.5 text-xs">
              <Link to={`/notices-company/${c.client_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.name}</Link>
              <Link to={mh(dashHref({ filter: 'open', client: c.client_id }))} className="shrink-0 tabular-nums hover:underline">
                <span className="sr-only">{c.name}: </span>{c.open}<span className="sr-only"> open,</span> · <span className={cn(c.overdue > 0 && 'font-semibold text-destructive-strong')}>{c.overdue}</span><span className="sr-only"> overdue</span>
              </Link>
              <span className="w-16 shrink-0 text-right tabular-nums">{fmtInrShort(c.exposure)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
