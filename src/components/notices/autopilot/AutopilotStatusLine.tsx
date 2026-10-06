// The Autopilot page's status line (audit U-01-4, S-13: one state, never a
// hard-coded "healthy"): is the queue's runner reporting — the scheduled Chrome
// (the default since 6 Oct 2026) or the office agent — is the autopilot on, the
// next run, and today's queue. With the office agent it also gives today's human
// time at the CAPTCHA wall. Each count opens the list it counts.
import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import {
  autopilotState, chromeRunners, latestAgent, nextRunWords, pausedUntilWords, autopilotQueueHref, runnerMode, type AutopilotStatus,
} from '@/lib/autopilot';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { INLINE_LINK } from './parts';
import { cn } from '@/lib/utils';

const Sep = () => <span aria-hidden>·</span>;

/** "Scheduled Chrome online · Reception PC, seen 20 s ago" and the dot's colour. */
function chromeWords(s: AutopilotStatus): { text: string; detail: string | null; ok: boolean } {
  const runners = chromeRunners(s);
  const online = runners.filter((r) => r.online);
  if (online.length > 1) return { text: `${online.length} scheduled Chromes online`, detail: online.map((r) => r.label || 'Chrome').join(', '), ok: true };
  if (online.length === 1) return { text: 'Scheduled Chrome online', detail: `${online[0].label || 'Chrome'}, seen ${fmtAgo(online[0].last_seen)}`, ok: true };
  if (runners.length) return { text: 'Scheduled Chrome offline', detail: `${runners[0].label || 'Chrome'}, last seen ${fmtAgo(runners[0].last_seen)}`, ok: false };
  return { text: 'No scheduled Chrome has reported yet', detail: null, ok: false };
}

export const AutopilotStatusLine: React.FC<{ s: AutopilotStatus | undefined }> = ({ s }) => {
  if (!s) return <Skeleton className="h-4 w-96 max-w-full" />;
  const state = autopilotState(s.settings);
  const autopilot = (
    <span className="font-medium text-foreground">
      Autopilot {state === 'on' ? 'on' : state === 'paused' ? `paused ${pausedUntilWords(s.settings?.paused_until)}` : 'off'}
    </span>
  );
  const counts = (
    <>
      <Link to={autopilotQueueHref('running')} className={INLINE_LINK}>{s.queue.running} running</Link>
      <Sep />
      <Link to={autopilotQueueHref('succeeded')} className={INLINE_LINK}>{s.today.succeeded} done today</Link>
      <Sep />
      <Link to={autopilotQueueHref('failed')} className={cn(INLINE_LINK, s.today.failed > 0 && 'text-destructive-strong hover:text-destructive-strong')}>
        {s.today.failed} failed today
      </Link>
    </>
  );

  if (runnerMode(s) === 'chrome') {
    const c = chromeWords(s);
    const next = nextRunWords(s.settings);
    const dot = state === 'off' ? 'bg-muted-foreground' : !c.ok || state === 'paused' ? 'bg-warning' : 'bg-success';
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
        <span className="font-medium text-foreground">{c.text}</span>
        {c.detail && <><Sep /><span>{c.detail}</span></>}
        <Sep />
        {autopilot}
        {state === 'on' && next && <><Sep /><span>next run {next}</span></>}
        <Sep />
        <Link to={autopilotQueueHref('queued')} className={INLINE_LINK}>{s.queue.queued + s.queue.retrying} queued</Link>
        <Sep />
        {counts}
      </p>
    );
  }

  const agent = latestAgent(s);
  const waiting = s.queue.waiting_captcha + s.queue.needs_human;
  const dot = state === 'off' ? 'bg-muted-foreground' : !s.agent_online || state === 'paused' ? 'bg-warning' : 'bg-success';
  const version = agent?.info?.version;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
      <span className="font-medium text-foreground">
        {agent ? `Office agent ${s.agent_online ? 'online' : 'offline'}` : 'No office agent has reported yet'}
      </span>
      {agent && <><Sep /><span>{s.agent_online ? 'seen' : 'last seen'} {fmtAgo(agent.last_seen)}{version ? ` · agent v${version}` : ''}</span></>}
      <Sep />
      {autopilot}
      <Sep />
      <Link to={autopilotQueueHref('captcha')} className={INLINE_LINK}>{plural(waiting, 'client')} waiting for a CAPTCHA</Link>
      <Sep />
      {counts}
      <Sep />
      <Link to="/notices-autopilot?tab=acceptance" className={INLINE_LINK}>time at the CAPTCHAs today {s.today.typing_minutes} min</Link>
      <Sep />
      <span>wall open (attentive) {s.human.wall_minutes} min</span>
    </p>
  );
};

export default AutopilotStatusLine;
