// The command centre's cards (roadmap Phase 2 task 2, target-dashboard.png).
// Every number links to the list it counts, with the same filter, so the two
// always agree (supabase/tests/notices/test_95_command_centre.sql).
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { noticesListHref } from '@/lib/noticeQueries';
import { fmtAgo, fmtDay, fmtInrShort, plural } from '@/lib/noticeFormat';
import { runNoticeAlerts, describeAlertRun } from '@/lib/noticeAlertQueue';
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
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <TileLink to={noticesListHref({ filter: 'overdue' })} label="Overdue & still open" accent="destructive" strong={t.overdue.count > 0}
        value={t.overdue.count.toLocaleString('en-IN')}
        hint={t.overdue.count ? `${fmtInrShort(t.overdue.amount)} at risk · oldest ${t.overdue.oldest_days ?? 0} d` : 'nothing overdue'} />
      <TileLink to={noticesListHref({ filter: 'due7' })} label="Due in next 7 days" accent="warning"
        value={t.due7.count.toLocaleString('en-IN')}
        hint={t.due7.next_date ? `next ${fmtDay(t.due7.next_date)} · ${t.due7.next_client}` : `${plural(t.due7.hearings, 'hearing')} · ${plural(t.due7.clocks, 'appeal clock')}`} />
      <TileLink to={noticesListHref({ filter: 'new' })} label="New in last 24 h" accent="info"
        value={t.new.count.toLocaleString('en-IN')}
        hint={t.new.count ? `${t.new.with_demand} with demand · ${t.new.unassigned} unassigned` : 'none since yesterday'} />
      <TileLink to={noticesListHref({ filter: 'unassigned' })} label="Without an owner" accent="primary"
        value={t.unassigned.toLocaleString('en-IN')} hint={`of ${t.open.toLocaleString('en-IN')} open`} />
      <TileLink to={noticesListHref({ filter: 'open', stage: 'partner_review' })} label="In partner review" accent="warning"
        value={t.review.count.toLocaleString('en-IN')}
        hint={t.review.approved ? `${t.review.approved} approved, ready to file` : `${t.waiting_client} waiting on clients`} />
      <TileLink to={noticesListHref({ filter: 'exposure' })} label="Exposure under dispute" accent="muted"
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

export const AutopilotLine: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const h = cc.health;
  const { tone, failing } = healthState(cc);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" aria-live="polite">
      <span className={cn('inline-block h-2 w-2 rounded-full', tone === 'ok' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-destructive')} aria-hidden />
      <span className="font-medium text-foreground">{h.fresh} of {h.eligible} GSTINs synced in 24 h</span>
      <span>· last sync {fmtAgo(h.last_success_at)}</span>
      <span>· {plural(h.new_today, 'new notice')} today</span>
      {h.auto_closed_today > 0 && <span>· {h.auto_closed_today} closed automatically</span>}
      <span>· alerts {h.alerts_mode === 'live' ? 'live' : h.alerts_mode === 'off' ? 'off' : 'in preview'}</span>
      {failing > 0 && (
        <Link to="/notices-company-list?status=failed" className="font-medium text-destructive-strong underline-offset-2 hover:underline">
          · {failing} need{failing === 1 ? 's' : ''} you →
        </Link>
      )}
    </p>
  );
};

// ── Reply pipeline ─────────────────────────────────────────────────────────
export const ReplyPipeline: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const rows = cc.pipeline.filter((p) => p.count > 0 || ['new', 'triaged', 'draft', 'partner_review', 'filed'].includes(p.stage));
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const bottleneck = [...rows].filter((r) => r.count > 0 && r.median_days !== null)
    .sort((a, b) => (b.median_days ?? 0) - (a.median_days ?? 0))[0];
  const r = cc.replies;
  return (
    <SectionCard title="Reply pipeline" description="Where every open notice sits · median days in the stage"
      actions={<Badge variant="secondary" className="text-[11px]">open {total.toLocaleString('en-IN')}</Badge>}>
      <ul className="space-y-1.5">
        {rows.map((p) => (
          <li key={p.stage}>
            <Link to={noticesListHref({ filter: 'open', stage: p.stage })}
              className="grid grid-cols-[minmax(7rem,9rem)_1fr_3rem_3.5rem] items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="truncate">{p.label}</span>
              <span className="h-2 rounded-full bg-muted" aria-hidden>
                <span className="block h-2 rounded-full bg-primary/70" style={{ width: `${(p.count / max) * 100}%` }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{p.count.toLocaleString('en-IN')}</span>
              <span className={cn('text-right tabular-nums text-muted-foreground', (p.median_days ?? 0) > 14 && 'text-destructive-strong')}>
                {p.median_days !== null ? `${p.median_days} d` : '—'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Note tone="info" open>
        {r.median_days_this_month !== null
          ? <>Median issue → reply this month: <b>{r.median_days_this_month} days</b>{r.median_days_last_month !== null ? ` (last month ${r.median_days_last_month})` : ''}. </>
          : <>No replies logged this month yet. </>}
        {bottleneck && <>Slowest stage: <b>{bottleneck.label}</b> ({bottleneck.median_days} d median).</>}
      </Note>
    </SectionCard>
  );
};

// ── Autopilot health ───────────────────────────────────────────────────────
const REASONS: Record<string, string> = {
  login_failed: 'Login failed — password changed?',
  captcha_timeout: 'CAPTCHA not typed',
  session_mismatch: 'Portal session was another GSTIN',
  portal_error: 'Portal error',
  timeout: 'Portal timed out',
  stalled: 'Run stalled',
  other: 'Other failure',
};

export const AutopilotHealth: React.FC<{ cc: CommandCentre; canRunAlerts: boolean; onAlertsRun: () => void }> = ({ cc, canRunAlerts, onAlertsRun }) => {
  const h = cc.health;
  const { tone } = healthState(cc);
  const [running, setRunning] = React.useState(false);
  const runAlerts = async () => {
    setRunning(true);
    const res = await runNoticeAlerts('all');
    setRunning(false);
    if (res.error) toast.error(res.error); else { toast.success(describeAlertRun(res)); onAlertsRun(); }
  };
  const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; to?: string; bad?: boolean }> = ({ label, value, to, bad }) => {
    const body = (
      <>
        <span className={cn('min-w-0 truncate', bad && 'text-destructive-strong')}>{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </>
    );
    return to
      ? <Link to={to} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>
      : <div className="flex items-center justify-between gap-2 px-1 py-1 text-xs">{body}</div>;
  };
  const run = h.last_run;
  return (
    <SectionCard title="Autopilot health" description="Runs on its own · tells you only what needs a person"
      actions={<Badge variant={tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : 'destructive'} className="text-[11px]">
        {tone === 'ok' ? 'Healthy' : tone === 'warn' ? 'Needs attention' : 'Stale'}
      </Badge>}>
      <div className="divide-y">
        <Row label={run ? `Last sync run · ${run.status}${run.ext_version ? ` · extension v${run.ext_version}` : ''}` : 'No sync run recorded yet'}
          value={run ? `${fmtAgo(run.started_at)}${run.clients_total ? ` · ${run.clients_done}/${run.clients_total}` : ''}` : '—'} to="/notices-company-list?tab=log" />
        <Row label="GSTINs synced in the last 24 h" value={`${h.fresh} / ${h.eligible}`} to="/notices-company-list" bad={h.fresh < h.eligible} />
        {h.never > 0 && <Row label="Never synced" value={h.never} to="/notices-company-list?status=never" bad />}
        {Object.entries(h.failing).map(([reason, n]) => (
          <Row key={reason} label={REASONS[reason] ?? reason} value={n} to={`/notices-company-list?status=failed&reason=${encodeURIComponent(reason)}`} bad />
        ))}
        <Row label="New notices captured today" value={h.new_today} to={noticesListHref({ filter: 'new' })} />
        <Row label="Closed automatically today (reviewable)" value={h.auto_closed_today} to={noticesListHref({ filter: 'auto_closed' })} />
        <Row label={`E-mail alerts · ${h.alerts_mode === 'live' ? 'live' : h.alerts_mode === 'off' ? 'off' : 'preview (nothing is sent)'}`}
          value={`${h.alerts_today} today`} to="/reminders" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
        <span>Alerts run every 15 min, 09:30 IST and Mondays; the closing sweep nightly at 03:00 IST.</span>
        {canRunAlerts && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={runAlerts} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Run alerts now
          </Button>
        )}
      </div>
    </SectionCard>
  );
};

// ── Next 14 days ───────────────────────────────────────────────────────────
export const Next14Days: React.FC<{ cc: CommandCentre }> = ({ cc }) => (
  <SectionCard title="Next 14 days" description="Reply due · hearings · appeal and attachment clocks"
    actions={<Link to="/notices-calendar" className="text-xs font-medium text-primary hover:underline">Calendar →</Link>}>
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
          <Link key={d.date} to={`/notices-calendar?date=${d.date}`}
            className={cn(cls, 'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{cell}</Link>
        ) : (
          <div key={d.date} className={cls}>{cell}</div>
        );
      })}
    </div>
    <p className="text-[11px] text-muted-foreground">Click a day for its list. PH = personal hearing.</p>
  </SectionCard>
);

// ── Exposure by stage ──────────────────────────────────────────────────────
export const ExposureByStage: React.FC<{ cc: CommandCentre }> = ({ cc }) => {
  const rows = cc.exposure_by_stage;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <SectionCard title="Exposure by stage" description="Open disputes: notices' demand (each dispute once) plus open matters' outstanding">
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">No open demand on record.</p> : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            // Notices and matters open different lists, so each amount links to its own (U-24-2).
            const toNotices = noticesListHref({ filter: 'exposure', stage: r.stage });
            const toMatters = `/litigation?stage=${r.stage}`;
            return (
              <li key={r.stage} className="grid grid-cols-[minmax(6rem,8rem)_1fr_auto] items-center gap-2 px-1 py-0.5 text-xs">
                <Link to={r.notices > 0 ? toNotices : toMatters} className="truncate hover:underline">{r.label}</Link>
                <span className="h-2 rounded-full bg-muted" aria-hidden>
                  <span className="block h-2 rounded-full bg-warning" style={{ width: `${(r.total / max) * 100}%` }} />
                </span>
                <span className="flex items-center justify-end gap-1.5 tabular-nums">
                  {r.notices > 0 && <Link to={toNotices} className="font-semibold hover:underline">{fmtInrShort(r.notices)}<span className="sr-only"> in notices</span></Link>}
                  {r.matters > 0 && <Link to={toMatters} className="text-foreground/70 hover:underline">{r.notices > 0 ? '+ ' : ''}{fmtInrShort(r.matters)} matters</Link>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Total {fmtInrShort(cc.tiles.exposure.total)} · notices {fmtInrShort(cc.tiles.exposure.notices_amount)} ·{' '}
        <Link to="/litigation" className="text-primary underline underline-offset-2">matters {fmtInrShort(cc.tiles.exposure.matters_amount)}</Link>
      </p>
    </SectionCard>
  );
};

// ── Clients needing attention ──────────────────────────────────────────────
export const ClientsAttention: React.FC<{ cc: CommandCentre }> = ({ cc }) => (
  <SectionCard title="Clients needing attention" description="Most overdue first · open · overdue · exposure"
    actions={<Link to="/notices-gstin-wise-count" className="text-xs font-medium text-primary hover:underline">All clients →</Link>}>
    {cc.clients.length === 0 ? <p className="text-xs text-muted-foreground">No client has an open notice.</p> : (
      <ul className="divide-y">
        {cc.clients.map((c) => (
          <li key={c.client_id} className="flex items-center gap-2 py-1.5 text-xs">
            <Link to={`/notices-company/${c.client_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.name}</Link>
            <Link to={noticesListHref({ filter: 'open', client: c.client_id })} className="shrink-0 tabular-nums hover:underline">
              <span className="sr-only">{c.name}: </span>{c.open}<span className="sr-only"> open,</span> · <span className={cn(c.overdue > 0 && 'font-semibold text-destructive-strong')}>{c.overdue}</span><span className="sr-only"> overdue</span>
            </Link>
            <span className="w-16 shrink-0 text-right tabular-nums">{fmtInrShort(c.exposure)}</span>
          </li>
        ))}
      </ul>
    )}
  </SectionCard>
);
