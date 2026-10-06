// The Autopilot page's status line (audit U-01-4, S-13: one state, never a
// hard-coded "healthy"): is the office agent reporting, is the autopilot on,
// today's queue, and today's human time — minutes the CAPTCHAs were on screen
// in front of someone (the acceptance measure), with the attentive wall time
// beside it. Each count opens the list it counts.
import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { autopilotState, latestAgent, pausedUntilWords, autopilotQueueHref, type AutopilotStatus } from '@/lib/autopilot';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { INLINE_LINK } from './parts';
import { cn } from '@/lib/utils';

const Sep = () => <span aria-hidden>·</span>;

export const AutopilotStatusLine: React.FC<{ s: AutopilotStatus | undefined }> = ({ s }) => {
  if (!s) return <Skeleton className="h-4 w-96 max-w-full" />;
  const agent = latestAgent(s);
  const state = autopilotState(s.settings);
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
      <span className="font-medium text-foreground">
        Autopilot {state === 'on' ? 'on' : state === 'paused' ? `paused ${pausedUntilWords(s.settings?.paused_until)}` : 'off'}
      </span>
      <Sep />
      <Link to={autopilotQueueHref('captcha')} className={INLINE_LINK}>{plural(waiting, 'client')} waiting for a CAPTCHA</Link>
      <Sep />
      <Link to={autopilotQueueHref('running')} className={INLINE_LINK}>{s.queue.running} running</Link>
      <Sep />
      <Link to={autopilotQueueHref('succeeded')} className={INLINE_LINK}>{s.today.succeeded} done today</Link>
      <Sep />
      <Link to={autopilotQueueHref('failed')} className={cn(INLINE_LINK, s.today.failed > 0 && 'text-destructive-strong hover:text-destructive-strong')}>
        {s.today.failed} failed today
      </Link>
      <Sep />
      <Link to="/notices-autopilot?tab=acceptance" className={INLINE_LINK}>time at the CAPTCHAs today {s.today.typing_minutes} min</Link>
      <Sep />
      <span>wall open (attentive) {s.human.wall_minutes} min</span>
    </p>
  );
};

export default AutopilotStatusLine;
